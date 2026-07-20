import {
  PROCESSING_STATUSES,
  type JobUpdate,
  type ProcessingStatus,
} from "./types.js";

const transitions: Readonly<Record<ProcessingStatus, readonly ProcessingStatus[]>> = {
  QUEUED: ["PREPROCESSING", "FAILED"],
  PREPROCESSING: ["OCR_RUNNING", "FAILED"],
  OCR_RUNNING: ["VISION_RUNNING", "FAILED"],
  VISION_RUNNING: ["LLM_RECONCILING", "FAILED"],
  LLM_RECONCILING: ["HUMAN_REVIEW_REQUIRED", "COMPLETED", "FAILED"],
  HUMAN_REVIEW_REQUIRED: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

const progressRanges: Readonly<Record<ProcessingStatus, readonly [number, number]>> = {
  QUEUED: [0, 0],
  PREPROCESSING: [1, 19],
  OCR_RUNNING: [20, 44],
  VISION_RUNNING: [45, 69],
  LLM_RECONCILING: [70, 94],
  HUMAN_REVIEW_REQUIRED: [95, 99],
  COMPLETED: [100, 100],
  FAILED: [0, 100],
};

export class InvalidJobTransitionError extends Error {
  override readonly name = "InvalidJobTransitionError";

  constructor(from: ProcessingStatus, to: ProcessingStatus) {
    super(`Invalid processing status transition: ${from} -> ${to}`);
  }
}

export class InvalidJobProgressError extends Error {
  override readonly name = "InvalidJobProgressError";

  constructor(status: ProcessingStatus, progress: number) {
    super(`Progress ${progress} is invalid for status ${status}`);
  }
}

export function isProcessingStatus(value: unknown): value is ProcessingStatus {
  return typeof value === "string" && PROCESSING_STATUSES.includes(value as ProcessingStatus);
}

export function assertJobUpdate(
  current: JobUpdate,
  next: JobUpdate,
): void {
  if (!isProcessingStatus(next.status)) {
    throw new InvalidJobTransitionError(current.status, String(next.status) as ProcessingStatus);
  }

  if (!Number.isFinite(next.progress) || !Number.isInteger(next.progress)) {
    throw new InvalidJobProgressError(next.status, next.progress);
  }

  const [minimum, maximum] = progressRanges[next.status];
  if (next.progress < minimum || next.progress > maximum) {
    throw new InvalidJobProgressError(next.status, next.progress);
  }

  if (next.status === current.status) {
    if (next.progress < current.progress) {
      throw new InvalidJobProgressError(next.status, next.progress);
    }
    return;
  }

  if (!transitions[current.status].includes(next.status)) {
    throw new InvalidJobTransitionError(current.status, next.status);
  }
}

export function nextJobUpdate(current: JobUpdate, next: JobUpdate): JobUpdate {
  assertJobUpdate(current, next);
  return Object.freeze({ ...next });
}
