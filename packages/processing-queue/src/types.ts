export const PROCESSING_STATUSES = [
  "QUEUED",
  "PREPROCESSING",
  "OCR_RUNNING",
  "VISION_RUNNING",
  "LLM_RECONCILING",
  "HUMAN_REVIEW_REQUIRED",
  "COMPLETED",
  "FAILED",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export interface ProcessingJobData {
  readonly fileId: string;
  readonly batchId: string;
  readonly sourceUrl: string;
  readonly mimeType?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface QueueJob<T extends ProcessingJobData = ProcessingJobData> {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly data: T;
  readonly status: ProcessingStatus;
  readonly progress: number;
  readonly attemptsMade: number;
  readonly maxAttempts: number;
  readonly error?: SanitizedError;
  readonly result?: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SanitizedError {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface EnqueueOptions {
  /**
   * Stable business key. Defaults to `${batchId}:${fileId}` so re-submitting
   * the same file in a batch returns the original job.
   */
  readonly jobId?: string;
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
}

export interface JobUpdate {
  readonly status: ProcessingStatus;
  readonly progress: number;
}

export type ProgressReporter = (update: JobUpdate) => Promise<void>;

export type JobProcessor<T extends ProcessingJobData = ProcessingJobData> = (
  job: QueueJob<T>,
  report: ProgressReporter,
  signal: AbortSignal,
) => Promise<unknown>;

export interface WorkerOptions {
  readonly concurrency?: number;
}

export interface QueueWorker {
  close(): Promise<void>;
}

export interface QueueAdapter<T extends ProcessingJobData = ProcessingJobData> {
  enqueue(data: T, options?: EnqueueOptions): Promise<QueueJob<T>>;
  getJob(jobId: string): Promise<QueueJob<T> | undefined>;
  getJobsByBatch(batchId: string): Promise<readonly QueueJob<T>[]>;
  getDeadLetters(): Promise<readonly QueueJob<T>[]>;
  createWorker(processor: JobProcessor<T>, options?: WorkerOptions): Promise<QueueWorker>;
  close(): Promise<void>;
}

export interface VisionServiceResult {
  readonly ocr?: unknown;
  readonly vision: unknown;
  readonly confidence?: number;
  readonly requiresHumanReview?: boolean;
}

export interface DeepSeekReconciliation {
  readonly result: unknown;
  readonly requiresHumanReview?: boolean;
}

export interface DeepSeekCoordinator<T extends ProcessingJobData = ProcessingJobData> {
  reconcile(
    input: VisionServiceResult,
    context: { readonly jobId: string; readonly data: T; readonly signal: AbortSignal },
  ): Promise<DeepSeekReconciliation>;
}

export interface ProcessingWorkerOptions<T extends ProcessingJobData = ProcessingJobData> {
  readonly visionServiceUrl: string;
  readonly deepSeek: DeepSeekCoordinator<T>;
  readonly fetch?: typeof globalThis.fetch;
  readonly requestTimeoutMs?: number;
}
