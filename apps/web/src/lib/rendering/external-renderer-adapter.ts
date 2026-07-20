import { createHmac, timingSafeEqual } from "node:crypto";
import type { Renderer, RenderArtifact, RenderRequest } from "./types";

type ExternalJob = {
  jobId: string;
  status: "queued" | "rendering" | "ready" | "failed";
  sceneVersion?: string;
  sceneId?: string;
  imageUri?: string;
  skuCodes?: string[];
  materialCodes?: string[];
  error?: string;
};

export type ExternalRendererOptions = {
  endpoint: string;
  secret: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  maxPolls?: number;
};

function canonical(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function sameSet(left: readonly string[], right: readonly string[]) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export class ExternalRendererAdapter implements Renderer {
  readonly name = "external-renderer";
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ExternalRendererOptions) {
    if (!options.endpoint || !options.secret) throw new Error("EXTERNAL_RENDERER_NOT_CONFIGURED");
    this.fetcher = options.fetch ?? fetch;
  }

  async render(request: RenderRequest): Promise<RenderArtifact> {
    const body = JSON.stringify(request);
    const timestamp = Date.now().toString();
    const signature = createHmac("sha256", this.options.secret).update(`${timestamp}.${body}`).digest("hex");
    const submitted = await this.fetcher(`${this.options.endpoint.replace(/\/$/, "")}/renders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-render-timestamp": timestamp,
        "x-render-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!submitted.ok) throw new Error(`EXTERNAL_RENDER_SUBMIT_FAILED:${submitted.status}`);
    const accepted = await submitted.json() as ExternalJob;
    if (!accepted.jobId) throw new Error("EXTERNAL_RENDER_JOB_ID_MISSING");

    let job = accepted;
    for (let poll = 0; job.status === "queued" || job.status === "rendering"; poll += 1) {
      if (poll >= (this.options.maxPolls ?? 30)) throw new Error("EXTERNAL_RENDER_TIMEOUT");
      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs ?? 1_000));
      const response = await this.fetcher(
        `${this.options.endpoint.replace(/\/$/, "")}/renders/${encodeURIComponent(job.jobId)}`,
        { headers: { authorization: `HMAC ${signature}` }, signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) throw new Error(`EXTERNAL_RENDER_POLL_FAILED:${response.status}`);
      job = await response.json() as ExternalJob;
    }
    if (job.status !== "ready" || !job.imageUri) throw new Error(`EXTERNAL_RENDER_FAILED:${job.error ?? "unknown"}`);
    this.validateResult(job, request);
    const now = new Date().toISOString();
    return {
      renderId: job.jobId,
      projectId: request.projectId,
      sceneId: request.scene.id,
      sceneVersion: request.sceneVersion,
      renderer: this.name,
      status: "ready",
      width: request.size.width,
      height: request.size.height,
      imageUri: job.imageUri,
      skuCodes: canonical(job.skuCodes ?? []),
      materialCodes: canonical(job.materialCodes ?? []),
      createdAt: now,
      completedAt: now,
    };
  }

  private validateResult(job: ExternalJob, request: RenderRequest) {
    if (job.sceneVersion !== request.sceneVersion) throw new Error("EXTERNAL_RENDER_SCENE_VERSION_MISMATCH");
    if (job.sceneId !== request.scene.id) throw new Error("EXTERNAL_RENDER_SCENE_ID_MISMATCH");
    if (!sameSet(job.skuCodes ?? [], request.skuCodes)) throw new Error("EXTERNAL_RENDER_SKU_MISMATCH");
    if (!sameSet(job.materialCodes ?? [], request.materialCodes)) throw new Error("EXTERNAL_RENDER_MATERIAL_MISMATCH");
  }
}

export function verifyExternalRenderSignature(body: string, timestamp: string, provided: string, secret: string) {
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
