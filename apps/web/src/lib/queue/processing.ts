import { createQueueAdapter, type ProcessingJobData, type QueueAdapter } from "@sharkflows/processing-queue";
import { getDb } from "@/lib/db/client";
import { createVisionWorkerClient, VisionWorkerUnavailableError } from "@/lib/providers/vision-worker-client";

type GlobalQueue = typeof globalThis & {
  __sharkflowsQueue?: QueueAdapter<ProcessingJobData>;
  __sharkflowsQueueBootstrapped?: boolean;
};

function persistJob(job: {
  jobId: string;
  idempotencyKey: string;
  data: ProcessingJobData;
  status: string;
  progress: number;
  attemptsMade?: number;
  maxAttempts?: number;
  error?: unknown;
  result?: unknown;
}) {
  const stamp = new Date().toISOString();
  getDb().sqlite.prepare(
    `INSERT INTO processing_jobs (
      id, job_id, batch_id, file_id, idempotency_key, status, progress,
      attempts_made, max_attempts, source_url, error_json, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      progress = excluded.progress,
      error_json = excluded.error_json,
      result_json = excluded.result_json,
      updated_at = excluded.updated_at`,
  ).run(
    `pj_${job.jobId}`,
    job.jobId,
    job.data.batchId,
    job.data.fileId,
    job.idempotencyKey,
    job.status,
    job.progress,
    job.attemptsMade ?? 0,
    job.maxAttempts ?? 3,
    job.data.sourceUrl,
    job.error ? JSON.stringify(job.error) : null,
    job.result !== undefined ? JSON.stringify(job.result) : null,
    stamp,
    stamp,
  );
}

export function getProcessingQueue() {
  const g = globalThis as GlobalQueue;
  if (!g.__sharkflowsQueue) {
    g.__sharkflowsQueue = createQueueAdapter<ProcessingJobData>();
  }
  return g.__sharkflowsQueue;
}

export async function ensureProcessingWorker() {
  const g = globalThis as GlobalQueue;
  if (g.__sharkflowsQueueBootstrapped) return getProcessingQueue();
  const queue = getProcessingQueue();
  getDb();
  await queue.createWorker(async (job, report, signal) => {
    persistJob(job);
    await report({ status: "PREPROCESSING", progress: 10 });
    persistJob({ ...job, status: "PREPROCESSING", progress: 10 });

    const client = createVisionWorkerClient();
    try {
      await client.health(signal);
    } catch (error) {
      throw new VisionWorkerUnavailableError(
        error instanceof Error ? error.message : "Vision worker unavailable",
      );
    }

    await report({ status: "OCR_RUNNING", progress: 35 });
    persistJob({ ...job, status: "OCR_RUNNING", progress: 35 });
    await report({ status: "VISION_RUNNING", progress: 55 });
    persistJob({ ...job, status: "VISION_RUNNING", progress: 55 });

    const result = await client.createJob(
      {
        jobId: job.jobId,
        source: {
          filename: String(job.data.metadata?.filename ?? job.data.fileId),
          mediaType: job.data.mimeType,
          path: job.data.sourceUrl.startsWith("/") || job.data.sourceUrl.includes(":\\")
            ? job.data.sourceUrl
            : undefined,
          dataBase64: typeof job.data.metadata?.dataBase64 === "string"
            ? job.data.metadata.dataBase64
            : undefined,
        },
        options: {
          ocrMode: "auto",
          saveDerivedFiles: true,
        },
      },
      signal,
    );

    await report({ status: "LLM_RECONCILING", progress: 80 });
    persistJob({ ...job, status: "LLM_RECONCILING", progress: 80 });

    const requiresReview = result.status !== "succeeded" || result.warnings.length > 0;
    if (requiresReview) {
      await report({ status: "HUMAN_REVIEW_REQUIRED", progress: 97 });
      persistJob({ ...job, status: "HUMAN_REVIEW_REQUIRED", progress: 97, result });
      return result;
    }

    await report({ status: "COMPLETED", progress: 100 });
    persistJob({ ...job, status: "COMPLETED", progress: 100, result });
    return result;
  }, { concurrency: 1 });
  g.__sharkflowsQueueBootstrapped = true;
  return queue;
}
