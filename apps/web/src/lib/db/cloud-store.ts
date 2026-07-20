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

function supabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Prefer durable Supabase on Vercel/serverless; local SQLite otherwise. */
export function useCloudDb() {
  return (
    supabaseConfigured() &&
    Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SF_FORCE_CLOUD_DB === "1")
  );
}

function restBase() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  // Allow either project origin or a URL that already ends with /rest/v1
  return raw.endsWith("/rest/v1") ? raw : `${raw}/rest/v1`;
}

function restHeaders(extra?: HeadersInit): HeadersInit {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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
    headers: restHeaders(init?.headers),
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
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  const origin = raw.endsWith("/rest/v1") ? raw.slice(0, -"/rest/v1".length) : raw;
  return `${origin}/storage/v1`;
}

export async function cloudUploadObject(input: {
  key: string;
  body: Buffer;
  contentType: string;
  upsert?: boolean;
}) {
  const response = await fetch(`${storageBase()}/object/project-assets/${input.key}`, {
    method: "POST",
    headers: {
      ...restHeaders({
        "Content-Type": input.contentType,
        "x-upsert": input.upsert ? "true" : "false",
      }),
    },
    body: new Uint8Array(input.body),
    cache: "no-store",
  });
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
