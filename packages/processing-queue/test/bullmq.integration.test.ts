import { describe, expect, it } from "vitest";
import { BullMQQueueAdapter, createQueueAdapter } from "../src/bullmq-adapter.js";

const runRedis = process.env.RUN_REDIS_TESTS === "1" && Boolean(process.env.REDIS_URL);

describe.runIf(runRedis)("BullMQQueueAdapter integration", () => {
  it("enqueues idempotently against Redis", async () => {
    const adapter = createQueueAdapter({
      redisUrl: process.env.REDIS_URL,
      queueName: `sharkflows-test-${Date.now()}`,
    });
    expect(adapter).toBeInstanceOf(BullMQQueueAdapter);

    const first = await adapter.enqueue({
      fileId: "f1",
      batchId: "b1",
      sourceUrl: "https://example.test/1.jpg",
    });
    const second = await adapter.enqueue({
      fileId: "f1",
      batchId: "b1",
      sourceUrl: "https://example.test/ignored.jpg",
    });
    expect(second.jobId).toBe(first.jobId);
    await adapter.close();
  });
});

describe.runIf(!runRedis)("BullMQQueueAdapter integration (skipped)", () => {
  it("skips unless RUN_REDIS_TESTS=1 and REDIS_URL are set", () => {
    expect(runRedis).toBe(false);
  });
});
