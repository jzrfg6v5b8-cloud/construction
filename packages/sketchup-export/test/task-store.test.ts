import { describe, expect, it } from "vitest";
import { InMemoryTaskStore, StoreError, validateFilename } from "../src/task-store.js";

const configuration = { id: "space-1", version: "v1", rooms: [] } as never;

describe("InMemoryTaskStore", () => {
  it("deduplicates equal requests and rejects key reuse for different payloads", () => {
    const store = new InMemoryTaskStore();
    const first = store.create(configuration, "request-1");
    const replay = store.create(configuration, "request-1");

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.task.id).toBe(first.task.id);
    expect(() => store.create({ id: "space-2" } as never, "request-1")).toThrowError(
      expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
    );
  });

  it("enforces transitions, progress, reports, and result completion", async () => {
    const store = new InMemoryTaskStore();
    const created = store.create(configuration, "request-2").task;
    const downloaded = await store.claimNext(0);
    expect(downloaded?.status).toBe("DOWNLOADED");

    store.update(created.id, { status: "MODEL_BUILDING", progress: 20 });
    store.update(created.id, {
      status: "MODEL_VALIDATING",
      progress: 70,
      versions: { pluginVersion: "1.2.3", sketchUpVersion: "2026" },
      components: { total: 3, succeeded: 2, failed: 0, skipped: 0, byType: { wall: 2, fixture: 1 } },
    });
    store.update(created.id, { status: "LAYOUT_REFRESH_REQUIRED", progress: 75 });
    store.update(created.id, { status: "EXPORTING", progress: 90 });
    const intermediate = store.saveResult(created.id, {
      filename: "plan.png",
      contentType: "image/png",
      bytes: Buffer.from("png"),
      final: false,
    });
    expect(intermediate.status).toBe("EXPORTING");
    expect(intermediate.results).toHaveLength(1);
    const completed = store.saveResult(created.id, {
      filename: "space.skp",
      contentType: "application/octet-stream",
      bytes: Buffer.from("sketchup"),
    });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.progress).toBe(100);
    expect(completed.result?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(completed.results).toHaveLength(2);
    expect(store.getResult(created.id, intermediate.results[0]?.id).bytes.toString()).toBe("png");
    expect(store.getResult(created.id).bytes.toString()).toBe("sketchup");
    expect(() => store.update(created.id, { progress: 99 })).toThrowError(
      expect.objectContaining({ code: "TASK_TERMINAL" }),
    );
  });

  it("fails expired queued and processing tasks with distinct timeout codes", async () => {
    let now = 1_000;
    const store = new InMemoryTaskStore({
      now: () => now,
      queueTimeoutMs: 10,
      processingTimeoutMs: 20,
    });
    const queued = store.create(configuration, "queued").task;
    now = 1_011;
    store.sweepTimeouts();
    expect(store.get(queued.id).error?.code).toBe("QUEUE_TIMEOUT");

    const processing = store.create(configuration, "processing").task;
    await store.claimNext(0);
    now = 1_032;
    store.sweepTimeouts();
    expect(store.get(processing.id).error?.code).toBe("PROCESSING_TIMEOUT");
  });

  it("rejects path-like result names", () => {
    for (const filename of ["../space.skp", "folder/space.skp", String.raw`folder\space.skp`, ".."]) {
      expect(() => validateFilename(filename)).toThrow(StoreError);
    }
    expect(validateFilename("客厅方案.skp")).toBe("客厅方案.skp");
  });
});
