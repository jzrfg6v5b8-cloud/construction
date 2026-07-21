import { randomUUID } from "node:crypto";
import {
  cloudClaimSketchUpTask,
  cloudCreateSketchUpTask,
  cloudGetSketchUpTask,
  cloudGetSketchUpTaskByIdempotency,
  cloudListSketchUpTasks,
  cloudUpdateSketchUpTask,
  cloudUploadObject,
  cloudSaveSketchUpResultDoc,
  cloudGetSketchUpResultDoc,
  useCloudDb,
  type CloudSketchUpTaskRow,
} from "@/lib/db/cloud-store";
import { saveSketchUpResult, getSketchUpResult } from "@/lib/db/repositories";

// Avoid top-level sharp: only load ingest when attaching PNG results.

export type SketchUpTaskPublic = {
  id: string;
  projectId: string;
  idempotencyKey: string;
  status: string;
  progress: number;
  error: unknown | null;
  versions: unknown;
  components: unknown;
  results: unknown[];
  claimedBy: string | null;
  claimedAt: string | null;
  deadlineAt: string;
  createdAt: string;
  updatedAt: string;
};

function toPublic(row: CloudSketchUpTaskRow): SketchUpTaskPublic {
  return {
    id: row.id,
    projectId: row.project_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    progress: Number(row.progress) || 0,
    error: row.error,
    versions: row.versions ?? {},
    components: row.components ?? {},
    results: Array.isArray(row.results) ? row.results : [],
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    deadlineAt: row.deadline_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function enqueueSketchUpTask(input: {
  projectId: string;
  configuration: unknown;
  idempotencyKey: string;
}) {
  if (!useCloudDb()) {
    throw new Error("CLOUD_QUEUE_REQUIRES_SUPABASE");
  }
  const existing = await cloudGetSketchUpTaskByIdempotency(input.projectId, input.idempotencyKey);
  if (existing) return { task: toPublic(existing), created: false };

  const stamp = new Date().toISOString();
  const row = await cloudCreateSketchUpTask({
    id: `skt_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    project_id: input.projectId,
    idempotency_key: input.idempotencyKey,
    status: "QUEUED",
    progress: 0,
    configuration: input.configuration,
    error: null,
    versions: {},
    components: {},
    results: [],
    claimed_by: null,
    claimed_at: null,
    deadline_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    created_at: stamp,
    updated_at: stamp,
  });
  return { task: toPublic(row), created: true };
}

export async function getSketchUpTaskPublic(projectId: string, taskId: string) {
  const row = await cloudGetSketchUpTask(projectId, taskId);
  return row ? toPublic(row) : null;
}

export async function listSketchUpTasksPublic(projectId: string) {
  const rows = await cloudListSketchUpTasks(projectId);
  return rows.map(toPublic);
}

export async function claimSketchUpTask(projectId: string, claimedBy: string) {
  const row = await cloudClaimSketchUpTask(projectId, claimedBy);
  if (!row) return null;
  return {
    task: toPublic(row),
    configuration: row.configuration,
  };
}

export async function patchSketchUpTask(
  projectId: string,
  taskId: string,
  patch: {
    status?: string;
    progress?: number;
    error?: unknown | null;
    versions?: unknown;
    components?: unknown;
  },
) {
  const row = await cloudUpdateSketchUpTask(projectId, taskId, patch);
  return row ? toPublic(row) : null;
}

export async function attachSketchUpResultFile(input: {
  projectId: string;
  taskId: string;
  filename: string;
  contentType: string;
  dataBase64: string;
  final?: boolean;
  sceneId?: string;
  geometryVersion?: string;
}) {
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error("RESULT_TOO_LARGE_MAX_4MB");
  }
  const storageKey = `projects/${input.projectId}/sketchup/${input.taskId}/${input.filename}`;
  await cloudUploadObject({
    key: storageKey,
    body: bytes,
    contentType: input.contentType,
    upsert: true,
  });

  const meta = {
    id: `res_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: bytes.byteLength,
    storageKey,
    sceneId: input.sceneId ?? null,
    createdAt: new Date().toISOString(),
  };

  const current = await cloudGetSketchUpTask(input.projectId, input.taskId);
  const results = Array.isArray(current?.results) ? [...(current!.results as unknown[])] : [];
  results.push(meta);

  const isPng =
    input.contentType.includes("png") ||
    input.filename.toLowerCase().endsWith(".png") ||
    Boolean(input.sceneId);
  let ingestedScene: string | null = null;
  if (isPng) {
    const { ingestScenePng, normalizeSceneId } = await import("@/lib/rendering/ingest-scene-png");
    const sceneRaw = input.sceneId ?? input.filename.replace(/\.png$/i, "");
    const ingested = await ingestScenePng({
      projectId: input.projectId,
      sceneId: normalizeSceneId(sceneRaw),
      sceneVersion: input.geometryVersion ?? `sketchup-${input.taskId}`,
      renderer: "sketchup-png",
      bytes,
    });
    ingestedScene = ingested.sceneId;
  }

  const status = input.final === false ? current?.status ?? "EXPORTING" : "COMPLETED";
  const progress = input.final === false ? Math.max(Number(current?.progress) || 0, 90) : 100;
  const updated = await cloudUpdateSketchUpTask(input.projectId, input.taskId, {
    results,
    status,
    progress,
  });

  return { meta, ingestedScene, task: updated ? toPublic(updated) : null };
}

export async function persistSketchUpCompletion(input: {
  projectId: string;
  geometryVersion: string;
  modelVersion: string;
  status: string;
  componentStats: unknown[];
  exports: unknown[];
}) {
  if (useCloudDb()) {
    await cloudSaveSketchUpResultDoc(input);
    return {
      projectId: input.projectId,
      geometryVersion: input.geometryVersion,
      modelVersion: input.modelVersion,
      status: input.status,
      componentStats: input.componentStats,
      exports: input.exports,
      receivedAt: new Date().toISOString(),
    };
  }
  return saveSketchUpResult(input);
}

export async function loadSketchUpCompletion(projectId: string) {
  if (useCloudDb()) {
    const payload = await cloudGetSketchUpResultDoc(projectId);
    if (!payload) return null;
    return payload;
  }
  return getSketchUpResult(projectId) ?? null;
}
