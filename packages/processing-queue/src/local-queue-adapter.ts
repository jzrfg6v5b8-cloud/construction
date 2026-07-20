import { QueueProcessingError, sanitizeError } from "./errors.js";
import { assertJobData, idempotencyKeyFor, resolveJobId } from "./identifiers.js";
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

interface MutableJob<T extends ProcessingJobData> {
  jobId: string;
  idempotencyKey: string;
  data: T;
  status: QueueJob<T>["status"];
  progress: number;
  attemptsMade: number;
  maxAttempts: number;
  backoffMs: number;
  error?: SanitizedError;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class LocalQueueAdapter<T extends ProcessingJobData = ProcessingJobData>
implements QueueAdapter<T> {
  readonly #jobs = new Map<string, MutableJob<T>>();
  readonly #pending: string[] = [];
  readonly #deadLetters = new Set<string>();
  readonly #running = new Set<Promise<void>>();
  #processor?: JobProcessor<T>;
  #concurrency = 1;
  #activeCount = 0;
  #accepting = true;
  #workerRunning = false;

  async enqueue(data: T, options: EnqueueOptions = {}): Promise<QueueJob<T>> {
    if (!this.#accepting) throw new QueueProcessingError("Queue is closed", { code: "QUEUE_CLOSED", retryable: false });
    assertJobData(data);

    const jobId = resolveJobId(data, options.jobId);
    const idempotencyKey = idempotencyKeyFor(data);
    const existing = this.#jobs.get(jobId);
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey) {
        throw new QueueProcessingError("jobId is already used by another file", {
          code: "JOB_ID_CONFLICT",
          retryable: false,
        });
      }
      return snapshot(existing);
    }

    const now = new Date().toISOString();
    const job: MutableJob<T> = {
      jobId,
      idempotencyKey,
      data,
      status: "QUEUED",
      progress: 0,
      attemptsMade: 0,
      maxAttempts: positiveInteger(options.maxAttempts, 3, "maxAttempts"),
      backoffMs: nonNegativeInteger(options.backoffMs, 250, "backoffMs"),
      createdAt: now,
      updatedAt: now,
    };
    this.#jobs.set(jobId, job);
    this.#pending.push(jobId);
    this.#pump();
    return snapshot(job);
  }

  async getJob(jobId: string): Promise<QueueJob<T> | undefined> {
    const job = this.#jobs.get(jobId);
    return job ? snapshot(job) : undefined;
  }

  async getJobsByBatch(batchId: string): Promise<readonly QueueJob<T>[]> {
    return [...this.#jobs.values()]
      .filter((job) => job.data.batchId === batchId)
      .map(snapshot);
  }

  async getDeadLetters(): Promise<readonly QueueJob<T>[]> {
    return [...this.#deadLetters]
      .map((jobId) => this.#jobs.get(jobId))
      .filter((job): job is MutableJob<T> => job !== undefined)
      .map(snapshot);
  }

  async createWorker(processor: JobProcessor<T>, options: WorkerOptions = {}): Promise<QueueWorker> {
    if (this.#processor) throw new QueueProcessingError("Local queue supports one worker", {
      code: "WORKER_EXISTS",
      retryable: false,
    });
    this.#processor = processor;
    this.#concurrency = positiveInteger(options.concurrency, 1, "concurrency");
    this.#workerRunning = true;
    this.#pump();

    return {
      close: async () => {
        this.#workerRunning = false;
        await Promise.all([...this.#running]);
      },
    };
  }

  async close(): Promise<void> {
    this.#accepting = false;
    this.#workerRunning = false;
    await Promise.all([...this.#running]);
  }

  #pump(): void {
    while (
      this.#workerRunning
      && this.#processor
      && this.#activeCount < this.#concurrency
      && this.#pending.length > 0
    ) {
      const jobId = this.#pending.shift();
      if (!jobId) continue;
      const job = this.#jobs.get(jobId);
      if (!job || job.status !== "QUEUED") continue;

      this.#activeCount += 1;
      const running = this.#run(job, this.#processor).finally(() => {
        this.#activeCount -= 1;
        this.#running.delete(running);
        this.#pump();
      });
      this.#running.add(running);
    }
  }

  async #run(job: MutableJob<T>, processor: JobProcessor<T>): Promise<void> {
    while (job.attemptsMade < job.maxAttempts) {
      job.attemptsMade += 1;
      job.updatedAt = new Date().toISOString();
      const controller = new AbortController();

      try {
        const result = await processor(
          snapshot(job),
          async (update) => this.#report(job, update),
          controller.signal,
        );
        if (job.status !== "COMPLETED" && job.status !== "HUMAN_REVIEW_REQUIRED") {
          throw new QueueProcessingError("Processor returned before reaching a final or review status", {
            code: "INCOMPLETE_PROCESSING",
            retryable: false,
          });
        }
        job.result = result;
        delete job.error;
        job.updatedAt = new Date().toISOString();
        return;
      } catch (error) {
        const sanitized = sanitizeError(error);
        job.error = sanitized;
        job.updatedAt = new Date().toISOString();
        if (sanitized.retryable && job.attemptsMade < job.maxAttempts && this.#workerRunning) {
          await sleep(job.backoffMs * 2 ** (job.attemptsMade - 1));
          job.status = "QUEUED";
          job.progress = 0;
          job.updatedAt = new Date().toISOString();
          continue;
        }

        const update = { status: "FAILED" as const, progress: job.progress };
        assertJobUpdate({ status: job.status, progress: job.progress }, update);
        job.status = update.status;
        job.updatedAt = new Date().toISOString();
        this.#deadLetters.add(job.jobId);
        return;
      }
    }
  }

  async #report(job: MutableJob<T>, update: JobUpdate): Promise<void> {
    assertJobUpdate({ status: job.status, progress: job.progress }, update);
    job.status = update.status;
    job.progress = update.progress;
    job.updatedAt = new Date().toISOString();
  }
}

function snapshot<T extends ProcessingJobData>(job: MutableJob<T>): QueueJob<T> {
  return Object.freeze({
    jobId: job.jobId,
    idempotencyKey: job.idempotencyKey,
    data: job.data,
    status: job.status,
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.maxAttempts,
    ...(job.error ? { error: Object.freeze({ ...job.error }) } : {}),
    ...(job.result !== undefined ? { result: job.result } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
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
