import { describe, expect, it, vi } from "vitest";
import { createQueueAdapter } from "../src/bullmq-adapter.js";
import { QueueProcessingError, sanitizeError } from "../src/errors.js";
import { LocalQueueAdapter } from "../src/local-queue-adapter.js";
import { createProcessingWorker } from "../src/processing-worker.js";
import type { ProcessingJobData, QueueJob } from "../src/types.js";

const sample = (overrides: Partial<ProcessingJobData> = {}): ProcessingJobData => ({
  fileId: "file-1",
  batchId: "batch-1",
  sourceUrl: "https://example.test/a.jpg",
  ...overrides,
});

async function waitForJob(
  adapter: LocalQueueAdapter,
  jobId: string,
  predicate: (job: QueueJob) => boolean,
  timeoutMs = 5_000,
): Promise<QueueJob> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await adapter.getJob(jobId);
    if (job && predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

describe("createQueueAdapter", () => {
  it("returns LocalQueueAdapter when REDIS_URL is absent", () => {
    const previous = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      expect(createQueueAdapter()).toBeInstanceOf(LocalQueueAdapter);
    } finally {
      if (previous === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previous;
    }
  });
});

describe("LocalQueueAdapter", () => {
  it("enqueues idempotently by default job id", async () => {
    const queue = new LocalQueueAdapter();
    const first = await queue.enqueue(sample());
    const second = await queue.enqueue(sample({ sourceUrl: "https://example.test/changed.jpg" }));
    expect(second.jobId).toBe(first.jobId);
    expect(second.data.sourceUrl).toBe(first.data.sourceUrl);
    await queue.close();
  });

  it("isolates failures within a batch", async () => {
    const queue = new LocalQueueAdapter();
    const worker = await queue.createWorker(async (job, report) => {
      if (job.data.fileId === "bad") {
        throw new QueueProcessingError("boom", { code: "BAD_FILE", retryable: false });
      }
      await report({ status: "PREPROCESSING", progress: 5 });
      await report({ status: "OCR_RUNNING", progress: 25 });
      await report({ status: "VISION_RUNNING", progress: 50 });
      await report({ status: "LLM_RECONCILING", progress: 80 });
      await report({ status: "COMPLETED", progress: 100 });
      return { ok: true };
    }, { concurrency: 2 });

    const good = await queue.enqueue(sample({ fileId: "good" }));
    const bad = await queue.enqueue(sample({ fileId: "bad" }));

    const completed = await waitForJob(queue, good.jobId, (job) => job.status === "COMPLETED");
    const failed = await waitForJob(queue, bad.jobId, (job) => job.status === "FAILED");

    expect(completed.result).toEqual({ ok: true });
    expect(failed.error?.code).toBe("BAD_FILE");
    expect(failed.error?.message).not.toMatch(/api[_-]?key|sk-/i);

    const batch = await queue.getJobsByBatch("batch-1");
    expect(batch).toHaveLength(2);
    expect(batch.map((job) => job.status).sort()).toEqual(["COMPLETED", "FAILED"]);

    await worker.close();
    await queue.close();
  });

  it("sanitizes secrets in failed job errors", async () => {
    const queue = new LocalQueueAdapter();
    const worker = await queue.createWorker(async () => {
      throw new Error("authorization: Bearer secret-token-value redis://user:pass@localhost:6379");
    }, { concurrency: 1 });

    const job = await queue.enqueue(sample({ fileId: "secret" }), { maxAttempts: 1 });
    const failed = await waitForJob(queue, job.jobId, (item) => item.status === "FAILED");
    expect(failed.error?.message).toContain("[REDACTED]");
    expect(failed.error?.message).not.toContain("secret-token-value");
    expect(failed.error?.message).not.toContain("user:pass");

    await worker.close();
    await queue.close();
  });

  it("retries retryable errors then completes", async () => {
    const queue = new LocalQueueAdapter();
    let attempts = 0;
    const worker = await queue.createWorker(async (_job, report) => {
      attempts += 1;
      if (attempts < 2) {
        throw new QueueProcessingError("temporary", { code: "TEMP", retryable: true });
      }
      await report({ status: "PREPROCESSING", progress: 5 });
      await report({ status: "OCR_RUNNING", progress: 25 });
      await report({ status: "VISION_RUNNING", progress: 50 });
      await report({ status: "LLM_RECONCILING", progress: 80 });
      await report({ status: "COMPLETED", progress: 100 });
      return "done";
    });

    const enqueued = await queue.enqueue(sample({ fileId: "retry" }), {
      maxAttempts: 3,
      backoffMs: 1,
    });
    const done = await waitForJob(queue, enqueued.jobId, (job) => job.status === "COMPLETED");
    expect(done.result).toBe("done");
    expect(attempts).toBe(2);

    await worker.close();
    await queue.close();
  });
});

describe("sanitizeError", () => {
  it("redacts bearer tokens and redis credentials", () => {
    const sanitized = sanitizeError(
      new Error("Bearer abcdef password=hunter2 redis://alice:secret@host/0"),
    );
    expect(sanitized.message).toContain("[REDACTED]");
    expect(sanitized.message).not.toContain("abcdef");
    expect(sanitized.message).not.toContain("hunter2");
    expect(sanitized.message).not.toContain("alice:secret");
  });
});

describe("createProcessingWorker", () => {
  it("drives statuses through vision + deepseek hooks", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ vision: { walls: 2 }, ocr: { text: "厅" }, confidence: 0.9 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const processor = createProcessingWorker({
      visionServiceUrl: "https://vision.test/process",
      fetch: fetchMock as unknown as typeof fetch,
      deepSeek: {
        async reconcile(input) {
          return { result: { merged: input.vision }, requiresHumanReview: false };
        },
      },
    });

    const updates: string[] = [];
    const result = await processor(
      {
        jobId: "j1",
        idempotencyKey: "batch-1:file-1",
        data: sample(),
        status: "QUEUED",
        progress: 0,
        attemptsMade: 1,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      async (update) => {
        updates.push(update.status);
      },
      new AbortController().signal,
    );

    expect(updates).toEqual([
      "PREPROCESSING",
      "OCR_RUNNING",
      "VISION_RUNNING",
      "LLM_RECONCILING",
      "COMPLETED",
    ]);
    expect(result).toMatchObject({ requiresHumanReview: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
