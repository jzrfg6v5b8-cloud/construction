import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { useCloudDb, cloudListRenders } from "@/lib/db/cloud-store";
import {
  ensureDemoProject,
  getProject,
  listRenderArtifacts,
  touchProjectAsync,
} from "@/lib/db/repositories";
import { ingestScenePng, readScenePng, syncRenderRowToMemory } from "@/lib/rendering/ingest-scene-png";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";
import { readFile } from "node:fs/promises";

export const runtime = "nodejs";

function ensureProject(projectId: string) {
  if (useCloudDb()) return;
  if (projectId === "demo") ensureDemoProject();
  else if (!getProject(projectId)) {
    throw new Error("PROJECT_NOT_FOUND");
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!useCloudDb()) {
      getDb();
      ensureProject(id);
    } else {
      await requireOwnedProject(id);
    }

    const url = new URL(request.url);
    const sceneId = url.searchParams.get("sceneId");
    const raw = url.searchParams.get("raw") === "1";

    if (sceneId && raw) {
      const bytes = await readScenePng(id, sceneId);
      if (!bytes) {
        return NextResponse.json({ error: "RENDER_NOT_FOUND" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, max-age=60",
        },
      });
    }

    if (useCloudDb()) {
      const rows = await cloudListRenders(id);
      const seen = new Set<string>();
      const deduped = rows.filter((row) => {
        if (seen.has(row.scene_id)) return false;
        seen.add(row.scene_id);
        return true;
      });
      return NextResponse.json({
        projectId: id,
        renders: deduped.map((row) => ({
          id: row.id,
          render_id: row.id,
          project_id: row.project_id,
          scene_id: row.scene_id,
          scene_version: row.scene_version,
          renderer: row.renderer,
          status: row.status,
          width: row.width,
          height: row.height,
          image_uri: row.storage_key,
          created_at: row.created_at,
          completed_at: row.updated_at,
        })),
      });
    }

    const rows = listRenderArtifacts(id);
    rows.forEach(syncRenderRowToMemory);
    return NextResponse.json({ projectId: id, renders: rows });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  try {
    if (!useCloudDb()) {
      getDb();
      ensureProject(projectId);
    } else {
      await requireOwnedProject(projectId);
    }

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
      renderer = body.renderer ?? "scene-canvas";
      bytes = Buffer.from(body.dataBase64, "base64");
    }

    const ingested = await ingestScenePng({
      projectId,
      sceneId,
      sceneVersion,
      renderer,
      bytes: bytes!,
    });
    await touchProjectAsync(projectId);

    return NextResponse.json({ ok: true, ...ingested });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "UPLOAD_FAILED" }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return POST(request, context);
}
