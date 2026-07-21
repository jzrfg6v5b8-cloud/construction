import { getDb } from "@/lib/db/client";
import {
  createProject,
  ensureDemoProject,
  getProject,
  saveSketchUpResult,
  touchProject,
} from "@/lib/db/repositories";
import { sketchUpResultStore, type SketchUpModelResult } from "@/lib/sketchup/result-store";

export const runtime = "nodejs";

function ensureProject(projectId: string) {
  if (projectId === "demo" || projectId === "A03023") ensureDemoProject();
  else if (!getProject(projectId)) createProject({ id: projectId, name: `项目 ${projectId.slice(0, 8)}` });
}

/** Browser-side completion ingest (no webhook secret). PNG files go via /renders. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  getDb();
  ensureProject(id);
  const projectId = id === "demo" ? "A03023" : id;
  const body = (await request.json().catch(() => null)) as {
    geometryVersion?: string;
    modelVersion?: string;
    status?: string;
    componentStats?: unknown[];
    exports?: unknown[];
  } | null;
  if (!body?.geometryVersion || !body?.modelVersion) {
    return Response.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
  }
  const result: SketchUpModelResult = {
    projectId,
    geometryVersion: body.geometryVersion,
    modelVersion: body.modelVersion,
    status: body.status ?? "COMPLETED",
    componentStats: Array.isArray(body.componentStats) ? body.componentStats : [],
    exports: Array.isArray(body.exports) ? body.exports : [],
    receivedAt: new Date().toISOString(),
  };
  sketchUpResultStore.set(projectId, result);
  saveSketchUpResult({
    projectId,
    geometryVersion: result.geometryVersion,
    modelVersion: result.modelVersion,
    status: result.status,
    componentStats: result.componentStats,
    exports: result.exports,
  });
  if (id !== projectId) {
    saveSketchUpResult({
      projectId: id,
      geometryVersion: result.geometryVersion,
      modelVersion: result.modelVersion,
      status: result.status,
      componentStats: result.componentStats,
      exports: result.exports,
    });
  }
  touchProject(id);
  return Response.json({ ok: true, result });
}
