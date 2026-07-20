import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, createDb, resetDbForTests } from "../../src/lib/db/client";
import {
  listProcessingJobsByBatch,
  recordStripeEvent,
  saveAsset,
  upsertProcessingJob,
  upsertUser,
} from "../../src/lib/db/repository";

let tempDir: string | undefined;

afterEach(async () => {
  closeDb();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("sqlite persistence", () => {
  it("creates schema and persists users, assets, and jobs", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "sharkflows-db-"));
    const dbPath = path.join(tempDir, "sharkflows.sqlite");
    const { db } = resetDbForTests(dbPath);

    const user = await upsertUser({ email: "demo@sharkflows.test", name: "Demo", plan: "pro" }, db);
    expect(user.email).toBe("demo@sharkflows.test");

    const asset = await saveAsset({
      id: "ast_1",
      projectId: "proj_1",
      userId: user.id,
      originalFilename: "plan.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 128,
      widthPx: 10,
      heightPx: 10,
      sha256: "abc",
      storageKey: "proj_1/ast_1.blob",
      thumbnailKey: null,
      processingStatus: "QUEUED",
      assetType: "image",
    }, db);
    expect(asset.projectId).toBe("proj_1");

    await upsertProcessingJob({
      id: "pj_1",
      jobId: "job_1",
      batchId: "batch_1",
      fileId: asset.id,
      idempotencyKey: "batch_1:ast_1",
      status: "QUEUED",
      progress: 0,
      attemptsMade: 0,
      maxAttempts: 3,
      sourceUrl: "file://plan.jpg",
      errorJson: null,
      resultJson: null,
    }, db);

    await upsertProcessingJob({
      id: "pj_1",
      jobId: "job_1",
      batchId: "batch_1",
      fileId: asset.id,
      idempotencyKey: "batch_1:ast_1",
      status: "COMPLETED",
      progress: 100,
      attemptsMade: 1,
      maxAttempts: 3,
      sourceUrl: "file://plan.jpg",
      errorJson: null,
      resultJson: JSON.stringify({ ok: true }),
    }, db);

    const jobs = await listProcessingJobsByBatch("batch_1", db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("COMPLETED");

    const event = await recordStripeEvent({
      stripeEventId: "evt_test_1",
      type: "checkout.session.completed",
      payload: { id: "cs_test" },
      processedAt: new Date().toISOString(),
    }, db);
    const again = await recordStripeEvent({
      stripeEventId: "evt_test_1",
      type: "checkout.session.completed",
      payload: { id: "cs_test" },
    }, db);
    expect(again.id).toBe(event.id);

    // ensureSchema is idempotent on reopen
    const reopened = createDb(dbPath);
    const listed = await listProcessingJobsByBatch("batch_1", reopened.db);
    expect(listed[0]?.progress).toBe(100);
    reopened.sqlite.close();
  });
});
