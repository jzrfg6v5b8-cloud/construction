import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import {
  createProject,
  ensureDemoProject,
  getProject,
  getSketchUpResult,
  saveSketchUpResult,
  touchProject,
} from "@/lib/db/repositories";
import { sketchUpResultStore, type SketchUpModelResult } from "@/lib/sketchup/result-store";
import { ingestScenePng, normalizeSceneId } from "@/lib/rendering/ingest-scene-png";

export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.SKETCHUP_RESULT_WEBHOOK_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  // Dev convenience: allow when secret unset (local only)
  if (!expected) return process.env.NODE_ENV !== "production";
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function ensureProject(projectId: string) {
  if (projectId === "demo" || projectId === "A03023") ensureDemoProject();
  else if (!getProject(projectId)) createProject({ id: projectId, name: `项目 ${projectId.slice(0, 8)}` });
}

type ExportItem = {
  kind?: string;
  sceneId?: string;
  sceneCode?: string;
  filename?: string;
  dataBase64?: string;
  contentType?: string;
};

async function ingestExports(projectId: string, geometryVersion: string, exports: unknown[]) {
  const ingested: string[] = [];
  for (const raw of exports) {
    const item = raw as ExportItem;
    if (!item?.dataBase64) continue;
    const looksPng =
      item.contentType?.includes("png") ||
      item.filename?.toLowerCase().endsWith(".png") ||
      String(item.kind ?? "").toUpperCase().includes("PNG") ||
      String(item.kind ?? "").toUpperCase().includes("SCENE");
    if (!looksPng && !item.sceneId && !item.sceneCode) continue;
    const sceneRaw = item.sceneId ?? item.sceneCode ?? item.filename?.replace(/\.png$/i, "") ?? "living";
    const result = await ingestScenePng({
      projectId,
      sceneId: normalizeSceneId(sceneRaw),
      sceneVersion: geometryVersion,
      renderer: "sketchup-png",
      bytes: Buffer.from(item.dataBase64, "base64"),
    });
    ingested.push(result.sceneId);
  }
  return ingested;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  getDb();
  ensureProject(id);
  const projectId = id === "demo" ? "A03023" : id;
  const fromDb = getSketchUpResult(projectId) ?? getSketchUpResult(id);
  if (fromDb) {
    sketchUpResultStore.set(projectId, fromDb as SketchUpModelResult);
    return Response.json(fromDb);
  }
  const result = sketchUpResultStore.get(projectId) ?? sketchUpResultStore.get(id);
  return result ? Response.json(result) : Response.json({ error: "NO_MODEL_RESULT" }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!authorized(request)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await context.params;
  getDb();
  ensureProject(id);
  const projectId = id === "demo" ? "A03023" : id;
  const payload = (await request.json()) as Partial<SketchUpModelResult> & { exports?: ExportItem[] };
  if (payload.projectId && payload.projectId !== projectId && payload.projectId !== id) {
    return Response.json({ error: "INVALID_MODEL_RESULT" }, { status: 400 });
  }
  if (typeof payload.geometryVersion !== "string" || typeof payload.modelVersion !== "string") {
    return Response.json({ error: "INVALID_MODEL_RESULT" }, { status: 400 });
  }
  const exports = Array.isArray(payload.exports) ? payload.exports : [];
  const result: SketchUpModelResult = {
    projectId,
    geometryVersion: payload.geometryVersion,
    modelVersion: payload.modelVersion,
    status: typeof payload.status === "string" ? payload.status : "COMPLETED",
    componentStats: Array.isArray(payload.componentStats) ? payload.componentStats : [],
    exports,
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
  const ingestedScenes = await ingestExports(projectId, result.geometryVersion, exports);
  // Also mirror under route id if different
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
  return Response.json({ accepted: true, result, ingestedScenes });
}
