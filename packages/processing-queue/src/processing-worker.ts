import { QueueProcessingError } from "./errors.js";
import type {
  JobProcessor,
  JobUpdate,
  ProcessingJobData,
  ProcessingWorkerOptions,
  VisionServiceResult,
} from "./types.js";

const defaultPipeline: readonly JobUpdate[] = [
  { status: "PREPROCESSING", progress: 10 },
  { status: "OCR_RUNNING", progress: 30 },
  { status: "VISION_RUNNING", progress: 55 },
  { status: "LLM_RECONCILING", progress: 80 },
];

/**
 * Builds a JobProcessor that drives the OCR → vision → DeepSeek pipeline
 * with strict status transitions. One file failure is the caller's concern;
 * this processor never cancels sibling jobs.
 */
export function createProcessingWorker<T extends ProcessingJobData = ProcessingJobData>(
  options: ProcessingWorkerOptions<T>,
): JobProcessor<T> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.requestTimeoutMs ?? 60_000;

  return async (job, report, signal) => {
    for (const update of defaultPipeline.slice(0, 3)) {
      throwIfAborted(signal);
      await report(update);
    }

    const vision = await callVisionService(fetchImpl, options.visionServiceUrl, job.data, signal, timeoutMs);
    await report({ status: "LLM_RECONCILING", progress: 80 });

    const reconciliation = await options.deepSeek.reconcile(vision, {
      jobId: job.jobId,
      data: job.data,
      signal,
    });

    const requiresReview =
      vision.requiresHumanReview === true
      || reconciliation.requiresHumanReview === true
      || (typeof vision.confidence === "number" && vision.confidence < 0.7);

    if (requiresReview) {
      await report({ status: "HUMAN_REVIEW_REQUIRED", progress: 97 });
    } else {
      await report({ status: "COMPLETED", progress: 100 });
    }

    return {
      vision,
      reconciliation: reconciliation.result,
      requiresHumanReview: requiresReview,
    };
  };
}

async function callVisionService(
  fetchImpl: typeof globalThis.fetch,
  visionServiceUrl: string,
  data: ProcessingJobData,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<VisionServiceResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("VISION_TIMEOUT")), timeoutMs);

  try {
    const response = await fetchImpl(visionServiceUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileId: data.fileId,
        batchId: data.batchId,
        sourceUrl: data.sourceUrl,
        mimeType: data.mimeType,
        metadata: data.metadata,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new QueueProcessingError(`Vision service returned ${response.status}`, {
        code: "VISION_HTTP_ERROR",
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    const payload = (await response.json()) as Partial<VisionServiceResult>;
    if (payload.vision === undefined) {
      throw new QueueProcessingError("Vision service response missing vision payload", {
        code: "VISION_RESPONSE_INVALID",
        retryable: false,
      });
    }

    return {
      vision: payload.vision,
      ...(payload.ocr !== undefined ? { ocr: payload.ocr } : {}),
      ...(typeof payload.confidence === "number" ? { confidence: payload.confidence } : {}),
      ...(payload.requiresHumanReview !== undefined
        ? { requiresHumanReview: payload.requiresHumanReview }
        : {}),
    };
  } catch (error) {
    if (error instanceof QueueProcessingError) throw error;
    const message = error instanceof Error ? error.message : "Vision service request failed";
    throw new QueueProcessingError(message, {
      code: message.includes("VISION_TIMEOUT") ? "VISION_TIMEOUT" : "VISION_REQUEST_FAILED",
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new QueueProcessingError("Processing aborted", {
      code: "PROCESSING_ABORTED",
      retryable: false,
      cause: signal.reason,
    });
  }
}
