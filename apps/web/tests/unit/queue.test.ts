import { describe, expect, it, vi } from "vitest";
import { LocalTaskQueue } from "../../src/lib";

describe("LocalTaskQueue", () => {
  it("deduplicates enqueue by idempotency key", async () => {
    const queue = new LocalTaskQueue();
    const first = await queue.enqueue({ type: "render", idempotencyKey: "scene:1:v1", payload: { sceneId: "1" } });
    const second = await queue.enqueue({ type: "render", idempotencyKey: "scene:1:v1", payload: { sceneId: "changed" } });
    expect(second).toEqual(first);
    expect(await queue.list()).toHaveLength(1);
  });

  it("executes a registered handler once and retains its result", async () => {
    const handler = vi.fn(async (payload: unknown) => ({ received: payload }));
    const queue = new LocalTaskQueue();
    queue.register("measure", handler);
    const task = await queue.enqueue({ type: "measure", idempotencyKey: "asset:1", payload: { assetId: "1" } });
    const completed = await queue.runNext();
    expect(completed).toMatchObject({ id: task.id, status: "succeeded", attempt: 1 });
    expect(completed?.result).toEqual({ received: { assetId: "1" } });
    expect(handler).toHaveBeenCalledOnce();
    expect(await queue.runNext()).toBeUndefined();
  });

  it("retries failures up to maxAttempts", async () => {
    let attempts = 0;
    const queue = new LocalTaskQueue();
    queue.register("unstable", async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("temporary");
      return "done";
    });
    await queue.enqueue({ type: "unstable", idempotencyKey: "unstable:1", payload: null, maxAttempts: 2 });
    const processed = await queue.drain();
    expect(processed.map((task) => task.status)).toEqual(["queued", "succeeded"]);
    expect(attempts).toBe(2);
  });

  it("marks a task failed after the final attempt", async () => {
    const queue = new LocalTaskQueue();
    queue.register("fail", async () => {
      throw new Error("permanent");
    });
    await queue.enqueue({ type: "fail", idempotencyKey: "fail:1", payload: {}, maxAttempts: 1 });
    const failed = await queue.runNext();
    expect(failed).toMatchObject({ status: "failed", attempt: 1, error: "permanent" });
  });
});
