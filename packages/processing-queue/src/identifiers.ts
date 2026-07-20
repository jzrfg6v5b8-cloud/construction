import { createHash } from "node:crypto";
import type { ProcessingJobData } from "./types.js";

export function idempotencyKeyFor(data: ProcessingJobData): string {
  return `${data.batchId}:${data.fileId}`;
}

export function resolveJobId(data: ProcessingJobData, requested?: string): string {
  if (requested !== undefined) {
    if (!/^[a-zA-Z0-9_-]+$/.test(requested)) {
      throw new TypeError("jobId may contain only letters, numbers, underscores, and hyphens");
    }
    return requested;
  }

  return createHash("sha256").update(idempotencyKeyFor(data)).digest("hex");
}

export function assertJobData(data: ProcessingJobData): void {
  if (!data.fileId.trim() || !data.batchId.trim() || !data.sourceUrl.trim()) {
    throw new TypeError("fileId, batchId, and sourceUrl are required");
  }
}
