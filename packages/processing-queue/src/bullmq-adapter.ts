import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { Redis } from "ioredis";
import { QueueProcessingError, sanitizeError } from "./errors.js";
import { assertJobData, idempotencyKeyFor, resolveJobId } from "./identifiers.js";
import { LocalQueueAdapter } from "./local-queue-adapter.js";
import { assertJobUpdate } from "./state-machine.js";
import type {
  EnqueueOptions,
  JobProcessor,
  JobUpdate,
  ProcessingJobData,
  QueueAdapter,
  QueueJob,
  QueueWorker,
  SanitizedError,
  WorkerOptions,
} from "./types.js";

const DEFAULT_QUEUE_NAME = "sharkflows-processing";

interface StoredPayload<T extends ProcessingJobData> {
  data: T;
  idempotencyKey: string;
  status: QueueJob<T>["status"];
  progress: number;
  error?: SanitizedError;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
  maxAttempts: number;
  backoffMs: number;
}

function withoutError<T extends ProcessingJobData>(
  payload: StoredPayload<T>,
): StoredPayload<T> {
  const { error: _ignored, ...rest } = payload;
  return rest;
}

export interface CreateQueueAdapterOptions {
  readonly redisUrl?: string;
  readonly queueName?: string;
}

export interface BullMQQueueAdapterOptions {
  readonly redisUrl: string;
  readonly queueName?: string;
}

/**
 * Returns BullMQ when REDIS_URL (or options.redisUrl) is set; otherwise LocalQueueAdapter.
 */
export function createQueueAdapter<T extends ProcessingJobData = ProcessingJobData>(
  options: CreateQueueAdapterOptions = {},
): QueueAdapter<T> {
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
  if (!redisUrl) {
    return new LocalQueueAdapter<T>();
  }
  return new BullMQQueueAdapter<T>({
    redisUrl,
    ...(options.queueName !== undefined ? { queueName: options.queueName } : {}),
  });
}

export class BullMQQueueAdapter<T extends ProcessingJobData = ProcessingJobData>
implements QueueAdapter<T> {
  readonly #queueName: string;
  readonly #connection: Redis;
  readonly #queue: Queue<StoredPayload<T>>;
  readonly #workers: Worker<StoredPayload<T>>[] = [];
  #accepting = true;

  constructor(options: BullMQQueueAdapterOptions) {
    this.#queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
    this.#connection = new Redis(options.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    this.#queue = new Queue<StoredPayload<T>>(this.#queueName, {
      connection: this.#connection as unknown as ConnectionOptions,
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }

  async enqueue(data: T, options: EnqueueOptions = {}): Promise<QueueJob<T>> {
    if (!this.#accepting) {
      throw new QueueProcessingError("Queue is closed", { code: "QUEUE_CLOSED", retryable: false });
    }
    assertJobData(data);

    const jobId = resolveJobId(data, options.jobId);
    const idempotencyKey = idempotencyKeyFor(data);
    const existing = await this.#queue.getJob(jobId);
    if (existing) {
      const payload = existing.data;
      if (payload.idempotencyKey !== idempotencyKey) {
        throw new QueueProcessingError("jobId is already used by another file", {
          code: "JOB_ID_CONFLICT",
          retryable: false,
        });
      }
      return toQueueJob(existing);
    }

    const now = new Date().toISOString();
    const maxAttempts = positiveInteger(options.maxAttempts, 3, "maxAttempts");
    const backoffMs = nonNegativeInteger(options.backoffMs, 250, "backoffMs");
    const payload: StoredPayload<T> = {
      data,
      idempotencyKey,
      status: "QUEUED",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      maxAttempts,
      backoffMs,
    };

    const job = await this.#queue.add("process", payload, {
      jobId,
      attempts: maxAttempts,
      backoff: { type: "exponential", delay: backoffMs },
    });
    return toQueueJob(job);
  }

  async getJob(jobId: string): Promise<QueueJob<T> | undefined> {
    const job = await this.#queue.getJob(jobId);
    return job ? toQueueJob(job) : undefined;
  }

  async getJobsByBatch(batchId: string): Promise<readonly QueueJob<T>[]> {
    const jobs = await this.#queue.getJobs(["waiting", "active", "completed", "failed", "delayed", "paused"]);
    return jobs
      .filter((job) => job.data.data.batchId === batchId)
      .map(toQueueJob);
  }

  async getDeadLetters(): Promise<readonly QueueJob<T>[]> {
    const failed = await this.#queue.getJobs(["failed"]);
    return failed
      .filter((job) => job.data.status === "FAILED" || job.failedReason)
      .map(toQueueJob);
  }

  async createWorker(processor: JobProcessor<T>, options: WorkerOptions = {}): Promise<QueueWorker> {
    const concurrency = positiveInteger(options.concurrency, 1, "concurrency");
    const worker = new Worker<StoredPayload<T>>(
      this.#queueName,
      async (job, token) => this.#process(job, processor, token),
      {
        connection: this.#connection.duplicate() as unknown as ConnectionOptions,
        concurrency,
      },
    );
    this.#workers.push(worker);

    return {
      close: async () => {
        await worker.close();
        const index = this.#workers.indexOf(worker);
        if (index >= 0) this.#workers.splice(index, 1);
      },
    };
  }

  async close(): Promise<void> {
    this.#accepting = false;
    await Promise.all(this.#workers.map((worker) => worker.close()));
    this.#workers.length = 0;
    await this.#queue.close();
    await this.#connection.quit();
  }

  async #process(
    job: Job<StoredPayload<T>>,
    processor: JobProcessor<T>,
    _token?: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const report: (update: JobUpdate) => Promise<void> = async (update) => {
      assertJobUpdate({ status: job.data.status, progress: job.data.progress }, update);
      const next: StoredPayload<T> = {
        ...job.data,
        status: update.status,
        progress: update.progress,
        updatedAt: new Date().toISOString(),
      };
      await job.updateData(next);
      await job.updateProgress(update.progress);
    };

    try {
      const result = await processor(toQueueJob(job), report, controller.signal);
      const current = job.data;
      if (current.status !== "COMPLETED" && current.status !== "HUMAN_REVIEW_REQUIRED") {
        throw new QueueProcessingError("Processor returned before reaching a final or review status", {
          code: "INCOMPLETE_PROCESSING",
          retryable: false,
        });
      }
      await job.updateData({
        ...withoutError(current),
        result,
        updatedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const sanitized = sanitizeError(error);
      const current = job.data;
      const attemptsMade = job.attemptsMade + 1;
      const willRetry = sanitized.retryable && attemptsMade < current.maxAttempts;

      if (willRetry) {
        await job.updateData({
          ...current,
          status: "QUEUED",
          progress: 0,
          error: sanitized,
          updatedAt: new Date().toISOString(),
        });
        throw error;
      }

      const failedUpdate = { status: "FAILED" as const, progress: current.progress };
      assertJobUpdate({ status: current.status, progress: current.progress }, failedUpdate);
      await job.updateData({
        ...current,
        status: "FAILED",
        error: sanitized,
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }
}

function toQueueJob<T extends ProcessingJobData>(job: Job<StoredPayload<T>>): QueueJob<T> {
  const payload = job.data;
  return Object.freeze({
    jobId: String(job.id),
    idempotencyKey: payload.idempotencyKey,
    data: payload.data,
    status: payload.status,
    progress: payload.progress,
    attemptsMade: job.attemptsMade,
    maxAttempts: payload.maxAttempts,
    ...(payload.error ? { error: Object.freeze({ ...payload.error }) } : {}),
    ...(payload.result !== undefined ? { result: payload.result } : {}),
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  });
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) throw new TypeError(`${name} must be a positive integer`);
  return resolved;
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return resolved;
}
