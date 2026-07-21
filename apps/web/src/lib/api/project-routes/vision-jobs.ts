import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  createVisionWorkerClient,
  VisionWorkerJobRequestSchema,
  VisionWorkerUnavailableError,
} from "@/lib/providers/vision-worker-client";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  try { await requireOwnedProject(projectId); } catch (error) { return accessErrorResponse(error) ?? NextResponse.json({error:"INTERNAL_ERROR"},{status:500}); }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", projectId }, { status: 400 });
  }

  const parsed = VisionWorkerJobRequestSchema.safeParse({
    ...(typeof payload === "object" && payload !== null ? payload : {}),
    jobId:
      typeof payload === "object" &&
      payload !== null &&
      "jobId" in payload &&
      typeof (payload as { jobId?: unknown }).jobId === "string"
        ? (payload as { jobId: string }).jobId
        : `vj_${projectId}_${randomUUID().slice(0, 8)}`,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_VISION_JOB", projectId, issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const client = createVisionWorkerClient();
  try {
    await client.health();
  } catch (error) {
    return NextResponse.json(
      {
        error: "VISION_WORKER_UNAVAILABLE",
        code: "VISION_WORKER_UNAVAILABLE",
        projectId,
        workerUrl: client.url,
        message:
          error instanceof Error
            ? error.message
            : "Vision worker is not reachable; OCR was not fabricated.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await client.createJob(parsed.data);
    return NextResponse.json({ projectId, workerUrl: client.url, result });
  } catch (error) {
    if (error instanceof VisionWorkerUnavailableError) {
      return NextResponse.json(
        {
          error: "VISION_WORKER_UNAVAILABLE",
          code: "VISION_WORKER_UNAVAILABLE",
          projectId,
          workerUrl: client.url,
          message: error.message,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: "VISION_JOB_FAILED",
        projectId,
        message: error instanceof Error ? error.message : "Vision job failed",
      },
      { status: 502 },
    );
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  try { await requireOwnedProject(projectId); } catch (error) { return accessErrorResponse(error) ?? NextResponse.json({error:"INTERNAL_ERROR"},{status:500}); }
  const client = createVisionWorkerClient();
  try {
    const health = await client.health();
    return NextResponse.json({ projectId, available: true, workerUrl: client.url, health });
  } catch (error) {
    return NextResponse.json(
      {
        projectId,
        available: false,
        workerUrl: client.url,
        error: "VISION_WORKER_UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "Vision worker is not reachable; OCR was not fabricated.",
      },
      { status: 503 },
    );
  }
}
