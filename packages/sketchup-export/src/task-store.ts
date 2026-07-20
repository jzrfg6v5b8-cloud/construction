import { createHash, randomUUID } from "node:crypto";
import type { SpaceConfiguration } from "@sharkflows/space-schema";

export const TASK_STATUSES = [
  "QUEUED",
  "DOWNLOADED",
  "MODEL_BUILDING",
  "MODEL_VALIDATING",
  "LAYOUT_REFRESH_REQUIRED",
  "EXPORTING",
  "COMPLETED",
  "FAILED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface ComponentStatistics {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  byType: Record<string, number>;
  skuCounts: Record<string, number>;
}

export interface VersionReport {
  schemaVersion?: string;
  configurationVersion?: string;
  pluginVersion?: string;
  sketchUpVersion?: string;
}

export interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface ExportFileMetadata {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface ModelingTask {
  id: string;
  idempotencyKey: string;
  configuration: SpaceConfiguration;
  status: TaskStatus;
  progress: number;
  error: TaskError | null;
  versions: VersionReport;
  components: ComponentStatistics;
  result: ExportFileMetadata | null;
  results: ExportFileMetadata[];
  createdAt: string;
  updatedAt: string;
  deadlineAt: string;
}

export interface TaskUpdate {
  status?: TaskStatus;
  progress?: number;
  error?: TaskError | null;
  versions?: VersionReport;
  components?: Partial<ComponentStatistics>;
}

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  taskId?: string;
  remoteAddress?: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface TaskStoreOptions {
  queueTimeoutMs?: number;
  processingTimeoutMs?: number;
  longPollMaxMs?: number;
  maxResultBytes?: number;
  now?: () => number;
}

export class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

const transitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  QUEUED: ["DOWNLOADED", "FAILED"],
  DOWNLOADED: ["MODEL_BUILDING", "FAILED"],
  MODEL_BUILDING: ["MODEL_VALIDATING", "FAILED"],
  MODEL_VALIDATING: ["LAYOUT_REFRESH_REQUIRED", "EXPORTING", "FAILED"],
  LAYOUT_REFRESH_REQUIRED: ["MODEL_BUILDING", "EXPORTING", "FAILED"],
  EXPORTING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export interface StoredResult {
  metadata: ExportFileMetadata;
  bytes: Buffer;
}

interface StoredTask {
  task: ModelingTask;
  payloadHash: string;
  result?: StoredResult;
  results: Map<string, StoredResult>;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function defaultComponents(): ComponentStatistics {
  return { total: 0, succeeded: 0, failed: 0, skipped: 0, byType: {}, skuCounts: {} };
}

function safeClone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryTaskStore {
  readonly queueTimeoutMs: number;
  readonly processingTimeoutMs: number;
  readonly longPollMaxMs: number;
  readonly maxResultBytes: number;

  private readonly now: () => number;
  private readonly tasks = new Map<string, StoredTask>();
  private readonly idempotency = new Map<string, string>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly waiters = new Set<() => void>();

  constructor(options: TaskStoreOptions = {}) {
    this.queueTimeoutMs = options.queueTimeoutMs ?? 5 * 60_000;
    this.processingTimeoutMs = options.processingTimeoutMs ?? 30 * 60_000;
    this.longPollMaxMs = options.longPollMaxMs ?? 25_000;
    this.maxResultBytes = options.maxResultBytes ?? 100 * 1024 * 1024;
    this.now = options.now ?? Date.now;
  }

  create(configuration: SpaceConfiguration, idempotencyKey: string, remoteAddress?: string): { task: ModelingTask; created: boolean } {
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new StoreError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must contain 1-200 characters", 400);
    }
    const payloadHash = hash(configuration);
    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId) {
      const existing = this.tasks.get(existingId);
      if (!existing) throw new Error("Broken idempotency index");
      if (existing.payloadHash !== payloadHash) {
        throw new StoreError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used with a different configuration", 409);
      }
      this.audit("task.idempotent_replay", existingId, remoteAddress);
      return { task: safeClone(existing.task), created: false };
    }

    const now = this.now();
    const id = randomUUID();
    const task: ModelingTask = {
      id,
      idempotencyKey,
      configuration: safeClone(configuration),
      status: "QUEUED",
      progress: 0,
      error: null,
      versions: {},
      components: defaultComponents(),
      result: null,
      results: [],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + this.queueTimeoutMs).toISOString(),
    };
    this.tasks.set(id, { task, payloadHash, results: new Map() });
    this.idempotency.set(idempotencyKey, id);
    this.audit("task.created", id, remoteAddress);
    for (const wake of this.waiters) wake();
    this.waiters.clear();
    return { task: safeClone(task), created: true };
  }

  get(id: string): ModelingTask {
    this.sweepTimeouts();
    const stored = this.tasks.get(id);
    if (!stored) throw new StoreError("TASK_NOT_FOUND", "Task not found", 404);
    return safeClone(stored.task);
  }

  list(): ModelingTask[] {
    this.sweepTimeouts();
    return [...this.tasks.values()].map(({ task }) => safeClone(task));
  }

  update(id: string, update: TaskUpdate, remoteAddress?: string): ModelingTask {
    this.sweepTimeouts();
    const stored = this.requireTask(id);
    const current = stored.task;
    if (current.status === "COMPLETED" || current.status === "FAILED") {
      throw new StoreError("TASK_TERMINAL", "Terminal tasks cannot be updated", 409);
    }

    const nextStatus = update.status ?? current.status;
    if (nextStatus !== current.status && !transitions[current.status].includes(nextStatus)) {
      throw new StoreError("INVALID_TRANSITION", `Cannot transition ${current.status} to ${nextStatus}`, 409);
    }
    if (update.progress !== undefined && (!Number.isFinite(update.progress) || update.progress < current.progress || update.progress > 100)) {
      throw new StoreError("INVALID_PROGRESS", "Progress must be finite, monotonic, and between 0 and 100", 400);
    }
    if (nextStatus === "FAILED" && !update.error) {
      throw new StoreError("ERROR_REQUIRED", "FAILED tasks require an error", 400);
    }
    if (nextStatus === "COMPLETED" && stored.results.size === 0) {
      throw new StoreError("RESULT_REQUIRED", "A result file is required before completion", 409);
    }

    const now = this.now();
    current.status = nextStatus;
    current.progress = update.progress ?? current.progress;
    if (update.error !== undefined) current.error = safeClone(update.error);
    if (update.versions) current.versions = { ...current.versions, ...safeClone(update.versions) };
    if (update.components) {
      const components = {
        ...current.components,
        ...safeClone(update.components),
        byType: { ...current.components.byType, ...(update.components.byType ?? {}) },
        skuCounts: { ...current.components.skuCounts, ...(update.components.skuCounts ?? {}) },
      };
      this.validateComponents(components);
      current.components = components;
    }
    current.updatedAt = new Date(now).toISOString();
    current.deadlineAt = new Date(now + this.processingTimeoutMs).toISOString();
    this.audit("task.updated", id, remoteAddress, { status: current.status, progress: current.progress });
    return safeClone(current);
  }

  async claimNext(waitMs: number, signal?: AbortSignal, remoteAddress?: string): Promise<ModelingTask | null> {
    const boundedWait = Math.max(0, Math.min(waitMs, this.longPollMaxMs));
    const immediate = this.claim(remoteAddress);
    if (immediate || boundedWait === 0) return immediate;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(finish);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, boundedWait);
      timer.unref();
      this.waiters.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
    });
    if (signal?.aborted) return null;
    return this.claim(remoteAddress);
  }

  saveResult(
    id: string,
    input: { filename: string; contentType: string; bytes: Buffer; final?: boolean },
    remoteAddress?: string,
  ): ModelingTask {
    this.sweepTimeouts();
    const stored = this.requireTask(id);
    if (stored.task.status !== "EXPORTING") {
      throw new StoreError("INVALID_TRANSITION", "Result files are only accepted while EXPORTING", 409);
    }
    const filename = validateFilename(input.filename);
    if (input.bytes.length === 0 || input.bytes.length > this.maxResultBytes) {
      throw new StoreError("INVALID_RESULT_SIZE", `Result must contain 1-${this.maxResultBytes} bytes`, 413);
    }
    if (!/^[\w.+-]+\/[\w.+-]+$/i.test(input.contentType) || input.contentType.length > 100) {
      throw new StoreError("INVALID_CONTENT_TYPE", "Invalid result content type", 400);
    }
    const now = this.now();
    const metadata: ExportFileMetadata = {
      id: randomUUID(),
      filename,
      contentType: input.contentType,
      sizeBytes: input.bytes.length,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      createdAt: new Date(now).toISOString(),
    };
    const storedResult = { metadata, bytes: Buffer.from(input.bytes) };
    stored.result = storedResult;
    stored.results.set(metadata.id, storedResult);
    stored.task.result = metadata;
    stored.task.results.push(metadata);
    if (input.final !== false) {
      stored.task.status = "COMPLETED";
      stored.task.progress = 100;
    }
    stored.task.updatedAt = new Date(now).toISOString();
    stored.task.deadlineAt = input.final !== false
      ? stored.task.updatedAt
      : new Date(now + this.processingTimeoutMs).toISOString();
    this.audit("task.result_saved", id, remoteAddress, { sizeBytes: input.bytes.length });
    return safeClone(stored.task);
  }

  getResult(id: string, resultId?: string): StoredResult {
    const stored = this.requireTask(id);
    const result = resultId ? stored.results.get(resultId) : stored.result;
    if (!result) throw new StoreError("RESULT_NOT_FOUND", "Result not found", 404);
    return { metadata: safeClone(result.metadata), bytes: Buffer.from(result.bytes) };
  }

  listAudit(): AuditEvent[] {
    return safeClone(this.auditEvents);
  }

  sweepTimeouts(): number {
    const now = this.now();
    let count = 0;
    for (const stored of this.tasks.values()) {
      const task = stored.task;
      if ((task.status === "COMPLETED" || task.status === "FAILED") || Date.parse(task.deadlineAt) > now) continue;
      const previousStatus = task.status;
      const previousDeadline = task.deadlineAt;
      task.status = "FAILED";
      task.error = {
        code: previousStatus === "QUEUED" ? "QUEUE_TIMEOUT" : "PROCESSING_TIMEOUT",
        message: "Task exceeded its execution deadline",
        retryable: true,
      };
      task.updatedAt = new Date(now).toISOString();
      task.deadlineAt = task.updatedAt;
      this.audit("task.timed_out", task.id, undefined, { previousStatus, previousDeadline });
      count++;
    }
    return count;
  }

  private claim(remoteAddress?: string): ModelingTask | null {
    this.sweepTimeouts();
    const stored = [...this.tasks.values()]
      .filter(({ task }) => task.status === "QUEUED")
      .sort((a, b) => a.task.createdAt.localeCompare(b.task.createdAt))[0];
    if (!stored) return null;
    const now = this.now();
    stored.task.status = "DOWNLOADED";
    stored.task.updatedAt = new Date(now).toISOString();
    stored.task.deadlineAt = new Date(now + this.processingTimeoutMs).toISOString();
    this.audit("task.downloaded", stored.task.id, remoteAddress);
    return safeClone(stored.task);
  }

  private requireTask(id: string): StoredTask {
    const stored = this.tasks.get(id);
    if (!stored) throw new StoreError("TASK_NOT_FOUND", "Task not found", 404);
    return stored;
  }

  private validateComponents(value: ComponentStatistics): void {
    for (const key of ["total", "succeeded", "failed", "skipped"] as const) {
      if (!Number.isInteger(value[key]) || value[key] < 0) {
        throw new StoreError("INVALID_COMPONENT_STATISTICS", "Component counts must be non-negative integers", 400);
      }
    }
    if (value.succeeded + value.failed + value.skipped > value.total) {
      throw new StoreError("INVALID_COMPONENT_STATISTICS", "Component outcomes cannot exceed total", 400);
    }
    if (Object.values(value.byType).some((count) => !Number.isInteger(count) || count < 0)) {
      throw new StoreError("INVALID_COMPONENT_STATISTICS", "Component type counts must be non-negative integers", 400);
    }
    if (Object.values(value.skuCounts).some((count) => !Number.isInteger(count) || count < 0)) {
      throw new StoreError("INVALID_COMPONENT_STATISTICS", "SKU counts must be non-negative integers", 400);
    }
  }

  private audit(
    action: string,
    taskId?: string,
    remoteAddress?: string,
    details?: Record<string, string | number | boolean | null>,
  ): void {
    const event: AuditEvent = { id: randomUUID(), at: new Date(this.now()).toISOString(), action };
    if (taskId) event.taskId = taskId;
    if (remoteAddress) event.remoteAddress = remoteAddress;
    if (details) event.details = details;
    this.auditEvents.push(event);
  }
}

export function validateFilename(value: string): string {
  if (
    !value ||
    value.length > 180 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value !== value.normalize("NFC")
  ) {
    throw new StoreError("INVALID_FILENAME", "Filename must be a normalized basename without path segments", 400);
  }
  return value;
}
