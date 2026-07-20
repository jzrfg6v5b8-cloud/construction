import { z } from "zod";

export const DEFAULT_VISION_WORKER_URL = "http://127.0.0.1:8091";

export const VisionWorkerJobSourceSchema = z
  .object({
    filename: z.string().min(1),
    mediaType: z.string().optional(),
    dataBase64: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.dataBase64) !== Boolean(value.path), {
    message: "exactly one of dataBase64 or path is required",
  });

export const VisionWorkerJobRequestSchema = z.object({
  jobId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/),
  source: VisionWorkerJobSourceSchema,
  options: z
    .object({
      outputDir: z.string().optional(),
      rasterDpi: z.number().int().min(72).max(600).optional(),
      ocrMode: z.enum(["auto", "paddle", "heuristic", "mock"]).optional(),
      saveDerivedFiles: z.boolean().optional(),
    })
    .optional(),
});

export const VisionWorkerHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("vision-worker").optional(),
  ocrBackend: z.enum(["paddle", "unavailable"]),
});

export const VisionWorkerJobResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  jobId: z.string(),
  status: z.enum(["succeeded", "partial", "failed"]),
  sourceSha256: z.string(),
  pages: z.array(z.unknown()),
  warnings: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
});

export type VisionWorkerJobRequest = z.infer<typeof VisionWorkerJobRequestSchema>;
export type VisionWorkerJobResult = z.infer<typeof VisionWorkerJobResultSchema>;
export type VisionWorkerHealth = z.infer<typeof VisionWorkerHealthSchema>;

export class VisionWorkerUnavailableError extends Error {
  readonly code = "VISION_WORKER_UNAVAILABLE";

  constructor(message = "Vision worker is unreachable") {
    super(message);
    this.name = "VisionWorkerUnavailableError";
  }
}

export class VisionWorkerClient {
  constructor(
    private readonly baseUrl = process.env.VISION_WORKER_URL?.trim() || DEFAULT_VISION_WORKER_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get url() {
    return this.baseUrl.replace(/\/$/, "");
  }

  async health(signal?: AbortSignal): Promise<VisionWorkerHealth> {
    try {
      const response = await this.fetcher(`${this.url}/health`, {
        method: "GET",
        signal: signal ?? AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new VisionWorkerUnavailableError(`health ${response.status}`);
      return VisionWorkerHealthSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof VisionWorkerUnavailableError) throw error;
      throw new VisionWorkerUnavailableError(
        error instanceof Error ? error.message : "Vision worker health check failed",
      );
    }
  }

  /**
   * Proxies a job to the Python worker. Never invents OCR candidates when the
   * worker is down — callers must surface 503 / UNAVAILABLE instead.
   */
  async createJob(input: VisionWorkerJobRequest, signal?: AbortSignal): Promise<VisionWorkerJobResult> {
    const body = VisionWorkerJobRequestSchema.parse(input);
    let response: Response;
    try {
      response = await this.fetcher(`${this.url}/v1/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobId: body.jobId,
          source: {
            filename: body.source.filename,
            mediaType: body.source.mediaType,
            dataBase64: body.source.dataBase64,
            path: body.source.path,
          },
          options: body.options,
        }),
        signal: signal ?? AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new VisionWorkerUnavailableError(
        error instanceof Error ? error.message : "Vision worker request failed",
      );
    }

    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new VisionWorkerUnavailableError(`worker HTTP ${response.status}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`VISION_WORKER_JOB_FAILED:${response.status}:${detail.slice(0, 400)}`);
    }
    return VisionWorkerJobResultSchema.parse(await response.json());
  }
}

export function createVisionWorkerClient(baseUrl?: string) {
  return new VisionWorkerClient(
    baseUrl ?? (process.env.VISION_WORKER_URL?.trim() || DEFAULT_VISION_WORKER_URL),
  );
}
