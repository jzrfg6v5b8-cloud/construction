import type { ProjectRecord } from "@/lib/db/repositories";

type FloorPlanRow = {
  id: string;
  project_id: string;
  geometry_version: string;
  dimensions_verified: number;
  ceiling_height_mm: number;
  document_json: string;
  created_at: string;
  updated_at: string;
};

function cleanEnv(value: string | undefined) {
  const cleaned = (value ?? "").trim().replace(/^["']|["']$/g, "");
  if (cleaned === "[SENSITIVE]") {
    throw new Error("ENV_PLACEHOLDER_NOT_CONFIGURED");
  }
  return cleaned;
}

function storageObjectPath(key: string) {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function supabaseConfigured() {
  return Boolean(cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL) && cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY));
}

/** Prefer durable Supabase on Vercel/serverless; local SQLite otherwise. */
export function useCloudDb() {
  return (
    supabaseConfigured() &&
    Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SF_FORCE_CLOUD_DB === "1")
  );
}

function supabaseOrigin() {
  const raw = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!raw) throw new Error("MISSING_SUPABASE_URL");
  // Reject postgres URLs / placeholders that break fetch() with "pattern" errors.
  if (raw === "[SENSITIVE]" || raw.toLowerCase().startsWith("postgres")) {
    throw new Error("INVALID_SUPABASE_URL_USE_HTTPS_PROJECT_URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.endsWith("/rest/v1") ? raw.slice(0, -"/rest/v1".length) : raw);
  } catch {
    throw new Error(`INVALID_SUPABASE_URL:${raw.slice(0, 32)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`INVALID_SUPABASE_URL_PROTOCOL:${parsed.protocol}`);
  }
  return parsed.origin;
}

function serviceRoleKey() {
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key || key === "[SENSITIVE]") throw new Error("MISSING_SUPABASE_SERVICE_ROLE_KEY");
  if (/[\r\n\t]/.test(key)) throw new Error("SUPABASE_SERVICE_ROLE_KEY_HAS_WHITESPACE");
  return key;
}

function restBase() {
  return `${supabaseOrigin()}/rest/v1`;
}

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = serviceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${restBase()}/${path}`, {
    ...init,
    headers: restHeaders(init?.headers as Record<string, string> | undefined),
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`SUPABASE_${response.status}:${text.slice(0, 200)}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function mapProject(row: {
  id: string;
  user_id: string;
  name: string;
  address: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  asset_count?: number;
}): ProjectRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    address: row.address,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    asset_count: row.asset_count ?? 0,
  };
}

export async function cloudListProjects(userId: string): Promise<ProjectRecord[]> {
  const rows = await rest<
    Array<{
      id: string;
      user_id: string;
      name: string;
      address: string | null;
      status: string;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>
  >(`sf_projects?user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&select=*`);
  return (rows ?? []).map(mapProject);
}

export async function cloudGetProject(projectId: string): Promise<ProjectRecord | undefined> {
  const rows = await rest<
    Array<{
      id: string;
      user_id: string;
      name: string;
      address: string | null;
      status: string;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>
  >(`sf_projects?id=eq.${encodeURIComponent(projectId)}&select=*&limit=1`);
  return rows?.[0] ? mapProject(rows[0]) : undefined;
}

export async function cloudCreateProject(input: {
  id: string;
  userId: string;
  name: string;
  address?: string | null;
  notes?: string | null;
}): Promise<ProjectRecord> {
  const stamp = new Date().toISOString();
  const rows = await rest<
    Array<{
      id: string;
      user_id: string;
      name: string;
      address: string | null;
      status: string;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>
  >("sf_projects", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      id: input.id,
      user_id: input.userId,
      name: input.name,
      address: input.address ?? null,
      status: "active",
      notes: input.notes ?? null,
      created_at: stamp,
      updated_at: stamp,
    }),
  });
  if (!rows?.[0]) throw new Error("CLOUD_CREATE_PROJECT_FAILED");
  return mapProject(rows[0]);
}

export async function cloudTouchProject(projectId: string) {
  await rest(`sf_projects?id=eq.${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
}

export async function cloudDeleteProject(projectId: string) {
  await rest(`sf_projects?id=eq.${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function cloudGetFloorPlan(projectId: string): Promise<FloorPlanRow | undefined> {
  const rows = await rest<Array<{ id: string; payload: FloorPlanRow; updated_at: string }>>(
    `sf_docs?project_id=eq.${encodeURIComponent(projectId)}&kind=eq.floorplan&select=id,payload,updated_at&limit=1`,
  );
  const payload = rows?.[0]?.payload;
  if (!payload) return undefined;
  return payload;
}

export async function cloudSaveFloorPlan(row: FloorPlanRow) {
  const docId = `fp_${row.project_id}`;
  await rest(`sf_docs?on_conflict=id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      id: docId,
      project_id: row.project_id,
      kind: "floorplan",
      payload: row,
      updated_at: row.updated_at,
    }),
  });
  return row;
}

export type CloudAssetRow = {
  id: string;
  project_id: string;
  user_id: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  width_px: number | null;
  height_px: number | null;
  sha256: string;
  storage_key: string;
  thumbnail_key: string | null;
  processing_status: string;
  asset_type: string;
  created_at: string;
  updated_at: string;
};

function storageBase() {
  return `${supabaseOrigin()}/storage/v1`;
}

export async function cloudUploadObject(input: {
  key: string;
  body: Buffer;
  contentType: string;
  upsert?: boolean;
}) {
  const token = serviceRoleKey();
  const objectPath = storageObjectPath(input.key);
  const uploadUrl = `${storageBase()}/object/project-assets/${objectPath}`;
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`,
        "Content-Type": input.contentType,
        "x-upsert": input.upsert ? "true" : "false",
      },
      body: new Uint8Array(input.body),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "fetch_failed";
    throw new Error(`STORAGE_UPLOAD_URL_INVALID:${reason}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`STORAGE_${response.status}:${text.slice(0, 200)}`);
  }
}

export async function cloudListAssets(projectId: string): Promise<CloudAssetRow[]> {
  const rows = await rest<CloudAssetRow[]>(
    `sf_assets?project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc&select=*`,
  );
  return rows ?? [];
}

export async function cloudUpsertAsset(row: CloudAssetRow) {
  await rest("sf_assets?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  return row;
}

export async function cloudDownloadObject(key: string): Promise<Buffer> {
  const token = serviceRoleKey();
  const response = await fetch(`${storageBase()}/object/project-assets/${storageObjectPath(key)}`, {
    headers: { apikey: token, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`STORAGE_DOWNLOAD_${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export type CloudRenderRow = {
  id: string;
  project_id: string;
  scene_id: string;
  scene_version: string;
  renderer: string;
  status: string;
  width: number;
  height: number;
  storage_key: string;
  created_at: string;
  updated_at: string;
};

export async function cloudUpsertRender(row: CloudRenderRow) {
  await rest("sf_renders?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  return row;
}

export async function cloudListRenders(projectId: string): Promise<CloudRenderRow[]> {
  const rows = await rest<CloudRenderRow[]>(
    `sf_renders?project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc&select=*`,
  );
  return rows ?? [];
}

export async function cloudGetRender(projectId: string, sceneId: string): Promise<CloudRenderRow | undefined> {
  const rows = await rest<CloudRenderRow[]>(
    `sf_renders?project_id=eq.${encodeURIComponent(projectId)}&scene_id=eq.${encodeURIComponent(sceneId)}&order=created_at.desc&select=*&limit=1`,
  );
  return rows?.[0];
}

export type CloudSketchUpTaskRow = {
  id: string;
  project_id: string;
  idempotency_key: string;
  status: string;
  progress: number;
  configuration: unknown;
  error: unknown | null;
  versions: unknown;
  components: unknown;
  results: unknown;
  claimed_by: string | null;
  claimed_at: string | null;
  deadline_at: string;
  created_at: string;
  updated_at: string;
};

export async function cloudCreateSketchUpTask(row: CloudSketchUpTaskRow) {
  const rows = await rest<CloudSketchUpTaskRow[]>("sf_sketchup_tasks?on_conflict=project_id,idempotency_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  return rows?.[0] ?? row;
}

export async function cloudGetSketchUpTask(projectId: string, taskId: string) {
  const rows = await rest<CloudSketchUpTaskRow[]>(
    `sf_sketchup_tasks?project_id=eq.${encodeURIComponent(projectId)}&id=eq.${encodeURIComponent(taskId)}&select=*&limit=1`,
  );
  return rows?.[0];
}

export async function cloudGetSketchUpTaskByIdempotency(projectId: string, idempotencyKey: string) {
  const rows = await rest<CloudSketchUpTaskRow[]>(
    `sf_sketchup_tasks?project_id=eq.${encodeURIComponent(projectId)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=*&limit=1`,
  );
  return rows?.[0];
}

export async function cloudListSketchUpTasks(projectId: string, limit = 20) {
  const rows = await rest<CloudSketchUpTaskRow[]>(
    `sf_sketchup_tasks?project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc&select=*&limit=${limit}`,
  );
  return rows ?? [];
}

export async function cloudClaimSketchUpTask(projectId: string, claimedBy: string) {
  const queued = await rest<CloudSketchUpTaskRow[]>(
    `sf_sketchup_tasks?project_id=eq.${encodeURIComponent(projectId)}&status=eq.QUEUED&order=created_at.asc&select=*&limit=1`,
  );
  const task = queued?.[0];
  if (!task) return null;
  const stamp = new Date().toISOString();
  const updated = await rest<CloudSketchUpTaskRow[]>(
    `sf_sketchup_tasks?id=eq.${encodeURIComponent(task.id)}&status=eq.QUEUED`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "DOWNLOADED",
        progress: Math.max(Number(task.progress) || 0, 5),
        claimed_by: claimedBy,
        claimed_at: stamp,
        updated_at: stamp,
      }),
    },
  );
  return updated?.[0] ?? null;
}

export async function cloudUpdateSketchUpTask(
  projectId: string,
  taskId: string,
  patch: Partial<
    Pick<
      CloudSketchUpTaskRow,
      "status" | "progress" | "error" | "versions" | "components" | "results" | "claimed_by" | "claimed_at"
    >
  >,
) {
  const rows = await rest<CloudSketchUpTaskRow[]>(
    `sf_sketchup_tasks?project_id=eq.${encodeURIComponent(projectId)}&id=eq.${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  return rows?.[0];
}

export async function cloudSaveSketchUpResultDoc(input: {
  projectId: string;
  geometryVersion: string;
  modelVersion: string;
  status: string;
  componentStats: unknown[];
  exports: unknown[];
}) {
  const stamp = new Date().toISOString();
  await rest("sf_docs?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: `sketchup_result_${input.projectId}`,
      project_id: input.projectId,
      kind: "sketchup_result",
      payload: {
        projectId: input.projectId,
        geometryVersion: input.geometryVersion,
        modelVersion: input.modelVersion,
        status: input.status,
        componentStats: input.componentStats,
        exports: input.exports,
        receivedAt: stamp,
      },
      updated_at: stamp,
    }),
  });
}

export async function cloudGetSketchUpResultDoc(projectId: string) {
  const rows = await rest<Array<{ payload: Record<string, unknown> }>>(
    `sf_docs?project_id=eq.${encodeURIComponent(projectId)}&kind=eq.sketchup_result&select=payload&limit=1`,
  );
  return rows?.[0]?.payload;
}
