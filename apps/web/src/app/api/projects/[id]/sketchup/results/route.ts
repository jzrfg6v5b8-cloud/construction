import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { useCloudDb } from "@/lib/db/cloud-store";
import {
  createProjectAsync,
  ensureDemoProject,
  getProjectAsync,
  touchProjectAsync,
} from "@/lib/db/repositories";
import { sketchUpResultStore, type SketchUpModelResult } from "@/lib/sketchup/result-store";
import { ingestScenePng, normalizeSceneId } from "@/lib/rendering/ingest-scene-png";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";
import {
  attachSketchUpResultFile,
  claimSketchUpTask,
  getSketchUpTaskPublic,
  listSketchUpTasksPublic,
  loadSketchUpCompletion,
  patchSketchUpTask,
  persistSketchUpCompletion,
} from "@/lib/sketchup/cloud-queue";

export const runtime = "nodejs";
export const maxDuration = 60;

function bridgeAuthorized(request: Request) {
  const expected =
    process.env.SKETCHUP_BRIDGE_SECRET?.trim() ||
    process.env.SKETCHUP_RESULT_WEBHOOK_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")?.trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ensureProject(projectId: string) {
  if (useCloudDb()) {
    const existing = await getProjectAsync(projectId);
    if (!existing) throw new Error("PROJECT_NOT_FOUND");
    return;
  }
  getDb();
  if (projectId === "demo" || projectId === "A03023") ensureDemoProject();
  else if (!(await getProjectAsync(projectId))) {
    await createProjectAsync({ id: projectId, name: `项目 ${projectId.slice(0, 8)}` });
  }
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

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!useCloudDb()) getDb();
    await requireOwnedProject(id);
    await ensureProject(id);
    const projectId = id === "demo" ? "A03023" : id;
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId");
    const list = url.searchParams.get("list") === "1";

    if (useCloudDb() && taskId) {
      const task = await getSketchUpTaskPublic(projectId, taskId);
      if (!task) return Response.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
      return Response.json({ task });
    }
    if (useCloudDb() && list) {
      return Response.json({ tasks: await listSketchUpTasksPublic(projectId) });
    }

    const fromStore = await loadSketchUpCompletion(projectId);
    if (fromStore) {
      sketchUpResultStore.set(projectId, fromStore as SketchUpModelResult);
      return Response.json(fromStore);
    }
    const result = sketchUpResultStore.get(projectId) ?? sketchUpResultStore.get(id);
    return result ? Response.json(result) : Response.json({ error: "NO_MODEL_RESULT" }, { status: 404 });
  } catch (error) {
    return accessErrorResponse(error) ?? Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!useCloudDb()) getDb();
    await ensureProject(id);
    const projectId = id === "demo" ? "A03023" : id;
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const op = typeof payload.op === "string" ? payload.op : "complete";

    // Bridge / webhook ops
    if (op === "claim" || op === "update" || op === "result" || op === "heartbeat") {
      if (!bridgeAuthorized(request)) {
        return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
      }
      if (!useCloudDb()) {
        return Response.json({ error: "CLOUD_QUEUE_UNAVAILABLE" }, { status: 503 });
      }

      if (op === "claim") {
        const claimedBy =
          typeof payload.claimedBy === "string" && payload.claimedBy
            ? payload.claimedBy
            : `bridge_${Date.now().toString(36)}`;
        const claimed = await claimSketchUpTask(projectId, claimedBy);
        if (!claimed) return Response.json({ claimed: false });
        return Response.json({ claimed: true, ...claimed });
      }

      if (op === "heartbeat") {
        return Response.json({
          ok: true,
          projectId,
          at: new Date().toISOString(),
          pending: (await listSketchUpTasksPublic(projectId)).filter(
            (t) => t.status !== "COMPLETED" && t.status !== "FAILED",
          ).length,
        });
      }

      const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
      if (!taskId) return Response.json({ error: "TASK_ID_REQUIRED" }, { status: 400 });

      if (op === "update") {
        const task = await patchSketchUpTask(projectId, taskId, {
          status: typeof payload.status === "string" ? payload.status : undefined,
          progress: typeof payload.progress === "number" ? payload.progress : undefined,
          error: payload.error === undefined ? undefined : payload.error,
          versions: payload.versions,
          components: payload.components,
        });
        return Response.json({ ok: true, task });
      }

      if (op === "result") {
        const filename = String(payload.filename ?? "");
        const contentType = String(payload.contentType ?? "application/octet-stream");
        const dataBase64 = String(payload.dataBase64 ?? "");
        if (!filename || !dataBase64) {
          return Response.json({ error: "RESULT_FIELDS_REQUIRED" }, { status: 400 });
        }
        const attached = await attachSketchUpResultFile({
          projectId,
          taskId,
          filename,
          contentType,
          dataBase64,
          final: payload.final === false ? false : true,
          sceneId: typeof payload.sceneId === "string" ? payload.sceneId : undefined,
          geometryVersion:
            typeof payload.geometryVersion === "string" ? payload.geometryVersion : undefined,
        });
        if (attached.task?.status === "COMPLETED") {
          await persistSketchUpCompletion({
            projectId,
            geometryVersion:
              typeof payload.geometryVersion === "string"
                ? payload.geometryVersion
                : `gv-${taskId}`,
            modelVersion:
              typeof payload.modelVersion === "string" ? payload.modelVersion : `mv-${taskId}`,
            status: "COMPLETED",
            componentStats: Array.isArray(payload.componentStats)
              ? (payload.componentStats as unknown[])
              : [],
            exports: attached.task.results,
          });
        }
        await touchProjectAsync(projectId);
        return Response.json({ ok: true, ...attached });
      }
    }

    // Legacy webhook / browser complete path
    if (!bridgeAuthorized(request)) {
      // Allow session owner for complete without bridge secret when not using op
      try {
        await requireOwnedProject(id);
      } catch {
        return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
      }
    }

    if (typeof payload.geometryVersion !== "string" || typeof payload.modelVersion !== "string") {
      return Response.json({ error: "INVALID_MODEL_RESULT" }, { status: 400 });
    }
    if (payload.projectId && payload.projectId !== projectId && payload.projectId !== id) {
      return Response.json({ error: "INVALID_MODEL_RESULT" }, { status: 400 });
    }
    const exports = Array.isArray(payload.exports) ? (payload.exports as ExportItem[]) : [];
    const result = await persistSketchUpCompletion({
      projectId,
      geometryVersion: payload.geometryVersion,
      modelVersion: payload.modelVersion,
      status: typeof payload.status === "string" ? payload.status : "COMPLETED",
      componentStats: Array.isArray(payload.componentStats)
        ? (payload.componentStats as unknown[])
        : [],
      exports,
    });
    sketchUpResultStore.set(projectId, result as SketchUpModelResult);
    const ingestedScenes = await ingestExports(projectId, payload.geometryVersion, exports);
    await touchProjectAsync(id);
    return Response.json({ accepted: true, result, ingestedScenes });
  } catch (error) {
    return (
      accessErrorResponse(error) ??
      Response.json(
        { error: error instanceof Error ? error.message : "RESULTS_FAILED" },
        { status: 500 },
      )
    );
  }
}
