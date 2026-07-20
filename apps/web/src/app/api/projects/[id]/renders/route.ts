import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  createProject,
  ensureDemoProject,
  getProject,
  listRenderArtifacts,
  touchProject,
} from "@/lib/db/repositories";
import { ingestScenePng, syncRenderRowToMemory } from "@/lib/rendering/ingest-scene-png";
import { readFile } from "node:fs/promises";

export const runtime = "nodejs";

function ensureProject(projectId: string) {
  if (projectId === "demo") ensureDemoProject();
  else if (!getProject(projectId)) createProject({ id: projectId, name: `项目 ${projectId.slice(0, 8)}` });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  getDb();
  ensureProject(id);
  const url = new URL(request.url);
  const sceneId = url.searchParams.get("sceneId");
  const raw = url.searchParams.get("raw") === "1";

  if (sceneId && raw) {
    const rows = listRenderArtifacts(id);
    const match = rows.find((item) => item.scene_id === sceneId && item.image_uri);
    if (!match?.image_uri) {
      return NextResponse.json({ error: "RENDER_NOT_FOUND" }, { status: 404 });
    }
    try {
      const bytes = await readFile(match.image_uri);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch {
      return NextResponse.json({ error: "RENDER_FILE_MISSING" }, { status: 404 });
    }
  }

  const rows = listRenderArtifacts(id);
  rows.forEach(syncRenderRowToMemory);
  return NextResponse.json({ projectId: id, renders: rows });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  getDb();
  ensureProject(projectId);

  const contentType = request.headers.get("content-type") ?? "";
  let sceneId = "living";
  let sceneVersion = `sv-${Date.now().toString(36)}`;
  let renderer = "upload";
  let bytes: Buffer | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    sceneId = String(form.get("sceneId") ?? "living");
    sceneVersion = String(form.get("sceneVersion") ?? sceneVersion);
    renderer = String(form.get("renderer") ?? "upload");
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
    }
    bytes = Buffer.from(await file.arrayBuffer());
  } else {
    const body = (await request.json().catch(() => null)) as {
      sceneId?: string;
      sceneVersion?: string;
      renderer?: string;
      dataBase64?: string;
    } | null;
    if (!body?.dataBase64) {
      return NextResponse.json({ error: "DATA_REQUIRED" }, { status: 400 });
    }
    sceneId = body.sceneId ?? "living";
    sceneVersion = body.sceneVersion ?? sceneVersion;
    renderer = body.renderer ?? "sketchup-png";
    bytes = Buffer.from(body.dataBase64, "base64");
  }

  const ingested = await ingestScenePng({
    projectId,
    sceneId,
    sceneVersion,
    renderer,
    bytes,
  });
  touchProject(projectId);

  return NextResponse.json({
    ok: true,
    ...ingested,
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return POST(request, context);
}
