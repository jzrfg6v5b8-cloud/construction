import { randomBytes } from "node:crypto";
import { getDb } from "./client";

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function sqlite() {
  return getDb().sqlite;
}

export type ProjectRecord = {
  id: string;
  user_id: string | null;
  name: string;
  address: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  asset_count?: number;
};

export function createProject(input: {
  name: string;
  address?: string;
  notes?: string;
  userId?: string | null;
  id?: string;
}): ProjectRecord {
  const projectId = input.id ?? id("prj");
  const stamp = nowIso();
  const name = input.name.trim();
  if (!name) throw new Error("PROJECT_NAME_REQUIRED");
  sqlite()
    .prepare(
      `INSERT INTO projects (id, user_id, name, address, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(
      projectId,
      input.userId ?? null,
      name,
      input.address?.trim() || null,
      input.notes?.trim() || null,
      stamp,
      stamp,
    );
  return getProject(projectId)!;
}

export function getProject(projectId: string): ProjectRecord | undefined {
  return sqlite().prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRecord | undefined;
}

export function listProjects(userId?: string | null): ProjectRecord[] {
  const db = sqlite();
  if (userId) {
    return db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count
         FROM projects p
         WHERE p.user_id = ?
         ORDER BY p.updated_at DESC`,
      )
      .all(userId) as ProjectRecord[];
  }
  return [];
}

export function updateProject(
  projectId: string,
  patch: { name?: string; address?: string | null; notes?: string | null; status?: string },
): ProjectRecord | undefined {
  const existing = getProject(projectId);
  if (!existing) return undefined;
  const stamp = nowIso();
  sqlite()
    .prepare(
      `UPDATE projects
       SET name = ?, address = ?, notes = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.name?.trim() || existing.name,
      patch.address === undefined ? existing.address : patch.address,
      patch.notes === undefined ? existing.notes : patch.notes,
      patch.status ?? existing.status,
      stamp,
      projectId,
    );
  return getProject(projectId);
}

export function touchProject(projectId: string) {
  sqlite().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(nowIso(), projectId);
}

export function ensureDemoProject(): ProjectRecord {
  const existing = getProject("demo");
  if (existing) return existing;
  return createProject({
    id: "demo",
    name: "滨江壹号 · A户型",
    address: "演示项目（可删除后自建）",
    notes: "系统预置演示项目，用于体验工作流。",
  });
}

export function deleteProject(projectId: string) {
  const db = sqlite();
  db.prepare("DELETE FROM assets WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM processing_jobs WHERE batch_id = ?").run(projectId);
  db.prepare("DELETE FROM approvals WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM quote_signatures WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM render_artifacts WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM floor_plans WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM layout_checklists WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM sketchup_results WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
}

export type StoredAssetRow = {
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
  /** Compatibility aliases used by API routes */
  storage_path: string;
  thumbnail_path: string | null;
  review_status: string;
};

function mapAsset(row: Record<string, unknown>): StoredAssetRow {
  const storageKey = String(row.storage_key ?? row.storage_path ?? "");
  const thumbnailKey = (row.thumbnail_key ?? row.thumbnail_path ?? null) as string | null;
  const status = String(row.processing_status ?? row.review_status ?? "QUEUED");
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    user_id: (row.user_id as string | null) ?? null,
    original_filename: String(row.original_filename),
    mime_type: String(row.mime_type),
    size_bytes: Number(row.size_bytes),
    width_px: (row.width_px as number | null) ?? null,
    height_px: (row.height_px as number | null) ?? null,
    sha256: String(row.sha256),
    storage_key: storageKey,
    thumbnail_key: thumbnailKey,
    processing_status: status,
    asset_type: String(row.asset_type ?? "document"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    storage_path: storageKey,
    thumbnail_path: thumbnailKey,
    review_status: status,
  };
}

export function upsertAsset(input: {
  id: string;
  project_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  thumbnail_path?: string | null;
  asset_type?: string;
  review_status?: string;
  user_id?: string | null;
  width_px?: number | null;
  height_px?: number | null;
  created_at?: string;
}) {
  const timestamp = nowIso();
  sqlite()
    .prepare(
      `INSERT INTO assets (
        id, project_id, user_id, original_filename, mime_type, size_bytes,
        width_px, height_px, sha256, storage_key, thumbnail_key, processing_status,
        asset_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        thumbnail_key = excluded.thumbnail_key,
        processing_status = excluded.processing_status,
        asset_type = excluded.asset_type,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.id,
      input.project_id,
      input.user_id ?? null,
      input.original_filename,
      input.mime_type,
      input.size_bytes,
      input.width_px ?? null,
      input.height_px ?? null,
      input.sha256,
      input.storage_path,
      input.thumbnail_path ?? null,
      input.review_status ?? "QUEUED",
      input.asset_type ?? "document",
      input.created_at ?? timestamp,
      timestamp,
    );
  return getAsset(input.id)!;
}

export function getAsset(assetId: string) {
  const row = sqlite().prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapAsset(row) : undefined;
}

export function listAssets(projectId: string) {
  return (
    sqlite()
      .prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as Record<string, unknown>[]
  ).map(mapAsset);
}

export function upsertProcessingJob(input: {
  id: string;
  assetId?: string | null;
  batchId: string;
  status: string;
  progress: number;
  idempotencyKey: string;
  errorJson?: string | null;
  resultJson?: string | null;
  sourceUrl?: string;
  jobId?: string;
  attemptsMade?: number;
  maxAttempts?: number;
}) {
  const timestamp = nowIso();
  const jobId = input.jobId ?? input.id;
  const fileId = input.assetId ?? "unknown";
  sqlite()
    .prepare(
      `INSERT INTO processing_jobs (
        id, job_id, batch_id, file_id, idempotency_key, status, progress,
        attempts_made, max_attempts, source_url, error_json, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        status = excluded.status,
        progress = excluded.progress,
        error_json = excluded.error_json,
        result_json = excluded.result_json,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.id,
      jobId,
      input.batchId,
      fileId,
      input.idempotencyKey,
      input.status,
      input.progress,
      input.attemptsMade ?? 0,
      input.maxAttempts ?? 3,
      input.sourceUrl ?? "",
      input.errorJson ?? null,
      input.resultJson ?? null,
      timestamp,
      timestamp,
    );
  return sqlite().prepare("SELECT * FROM processing_jobs WHERE job_id = ?").get(jobId);
}

export function listProcessingJobs(batchId: string) {
  return sqlite()
    .prepare("SELECT * FROM processing_jobs WHERE batch_id = ? ORDER BY created_at ASC")
    .all(batchId);
}

export type StoredApprovalRow = {
  id: string;
  project_id: string;
  role: string;
  decision: string;
  actor_id: string;
  scene_version: string | null;
  payload_json: string | null;
  created_at: string;
};

export function recordApproval(input: {
  projectId: string;
  role: string;
  actorId: string;
  decision: "approved" | "rejected";
  notes?: string;
  sceneVersion?: string;
}) {
  const rowId = id("apr");
  const createdAt = nowIso();
  sqlite()
    .prepare(
      `INSERT INTO approvals (id, project_id, role, decision, actor_id, scene_version, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rowId,
      input.projectId,
      input.role,
      input.decision,
      input.actorId,
      input.sceneVersion ?? null,
      input.notes ? JSON.stringify({ notes: input.notes }) : null,
      createdAt,
    );
  return sqlite().prepare("SELECT * FROM approvals WHERE id = ?").get(rowId) as StoredApprovalRow;
}

export function listApprovals(projectId: string) {
  return sqlite()
    .prepare("SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as StoredApprovalRow[];
}

export function recordQuoteSignature(input: {
  projectId: string;
  provider: string;
  documentSha256: string;
  signatureId: string;
  signedBy: string;
  signedAt: string;
  verified: boolean;
  stampText?: string;
}) {
  const rowId = id("qsig");
  sqlite()
    .prepare(
      `INSERT INTO quote_signatures (
        id, project_id, provider, document_sha256, signature_id, signed_by, signed_at, verified, stamp_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rowId,
      input.projectId,
      input.provider,
      input.documentSha256,
      input.signatureId,
      input.signedBy,
      input.signedAt,
      input.verified ? 1 : 0,
      input.stampText ?? null,
      nowIso(),
    );
  return sqlite().prepare("SELECT * FROM quote_signatures WHERE id = ?").get(rowId);
}

export function saveRenderArtifact(input: {
  renderId: string;
  projectId: string;
  sceneId: string;
  sceneVersion: string;
  renderer: string;
  status: string;
  width: number;
  height: number;
  imageUri?: string | null;
  html?: string | null;
  error?: string | null;
  skuCodes?: string[];
  materialCodes?: string[];
  completedAt?: string | null;
}) {
  const rowId = id("rnd");
  sqlite()
    .prepare(
      `INSERT INTO render_artifacts (
        id, render_id, project_id, scene_id, scene_version, renderer, status, width, height,
        image_uri, html, error, sku_codes_json, material_codes_json, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rowId,
      input.renderId,
      input.projectId,
      input.sceneId,
      input.sceneVersion,
      input.renderer,
      input.status,
      input.width,
      input.height,
      input.imageUri ?? null,
      input.html ?? null,
      input.error ?? null,
      JSON.stringify(input.skuCodes ?? []),
      JSON.stringify(input.materialCodes ?? []),
      nowIso(),
      input.completedAt ?? null,
    );
  return sqlite().prepare("SELECT * FROM render_artifacts WHERE id = ?").get(rowId);
}

export function upsertRenderArtifactByScene(input: {
  projectId: string;
  sceneId: string;
  sceneVersion: string;
  renderer: string;
  status: string;
  width: number;
  height: number;
  imageUri: string;
  renderId?: string;
}) {
  const existing = sqlite()
    .prepare(
      `SELECT id, render_id FROM render_artifacts WHERE project_id = ? AND scene_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(input.projectId, input.sceneId) as { id: string; render_id: string } | undefined;
  const stamp = nowIso();
  const renderId = input.renderId ?? existing?.render_id ?? `rnd_${input.sceneId}_${Date.now().toString(36)}`;
  if (existing) {
    sqlite()
      .prepare(
        `UPDATE render_artifacts
         SET scene_version = ?, renderer = ?, status = ?, width = ?, height = ?, image_uri = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(
        input.sceneVersion,
        input.renderer,
        input.status,
        input.width,
        input.height,
        input.imageUri,
        stamp,
        existing.id,
      );
    return getRenderArtifact(existing.id);
  }
  return saveRenderArtifact({
    renderId,
    projectId: input.projectId,
    sceneId: input.sceneId,
    sceneVersion: input.sceneVersion,
    renderer: input.renderer,
    status: input.status,
    width: input.width,
    height: input.height,
    imageUri: input.imageUri,
    completedAt: stamp,
  });
}

export function getRenderArtifact(id: string) {
  return sqlite().prepare("SELECT * FROM render_artifacts WHERE id = ?").get(id);
}

export function listRenderArtifacts(projectId: string) {
  return sqlite()
    .prepare("SELECT * FROM render_artifacts WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Array<{
    id: string;
    render_id: string;
    project_id: string;
    scene_id: string;
    scene_version: string;
    renderer: string;
    status: string;
    width: number;
    height: number;
    image_uri: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
}

export function saveFloorPlan(input: {
  projectId: string;
  geometryVersion: string;
  dimensionsVerified: boolean;
  ceilingHeightMm: number;
  document: unknown;
}) {
  const stamp = nowIso();
  const existing = sqlite().prepare("SELECT id FROM floor_plans WHERE project_id = ?").get(input.projectId) as
    | { id: string }
    | undefined;
  const rowId = existing?.id ?? id("fp");
  if (existing) {
    sqlite()
      .prepare(
        `UPDATE floor_plans
         SET geometry_version = ?, dimensions_verified = ?, ceiling_height_mm = ?, document_json = ?, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(
        input.geometryVersion,
        input.dimensionsVerified ? 1 : 0,
        input.ceilingHeightMm,
        JSON.stringify(input.document),
        stamp,
        input.projectId,
      );
  } else {
    sqlite()
      .prepare(
        `INSERT INTO floor_plans
          (id, project_id, geometry_version, dimensions_verified, ceiling_height_mm, document_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rowId,
        input.projectId,
        input.geometryVersion,
        input.dimensionsVerified ? 1 : 0,
        input.ceilingHeightMm,
        JSON.stringify(input.document),
        stamp,
        stamp,
      );
  }
  return getFloorPlan(input.projectId);
}

export function getFloorPlan(projectId: string) {
  return sqlite().prepare("SELECT * FROM floor_plans WHERE project_id = ?").get(projectId) as
    | {
        id: string;
        project_id: string;
        geometry_version: string;
        dimensions_verified: number;
        ceiling_height_mm: number;
        document_json: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

export type LayoutChecklist = {
  project_id: string;
  open_template: number;
  refresh_and_check: number;
  export_pdf: number;
  template_code: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
};

export function getLayoutChecklist(projectId: string): LayoutChecklist {
  const row = sqlite().prepare("SELECT * FROM layout_checklists WHERE project_id = ?").get(projectId) as
    | LayoutChecklist
    | undefined;
  if (row) return row;
  return {
    project_id: projectId,
    open_template: 0,
    refresh_and_check: 0,
    export_pdf: 0,
    template_code: "SHARKFLOWS-A3-V1",
    notes: null,
    updated_at: nowIso(),
    updated_by: null,
  };
}

export function saveLayoutChecklist(input: {
  projectId: string;
  openTemplate?: boolean;
  refreshAndCheck?: boolean;
  exportPdf?: boolean;
  templateCode?: string;
  notes?: string;
  updatedBy?: string;
}) {
  const current = getLayoutChecklist(input.projectId);
  const stamp = nowIso();
  sqlite()
    .prepare(
      `INSERT INTO layout_checklists
        (project_id, open_template, refresh_and_check, export_pdf, template_code, notes, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         open_template = excluded.open_template,
         refresh_and_check = excluded.refresh_and_check,
         export_pdf = excluded.export_pdf,
         template_code = excluded.template_code,
         notes = excluded.notes,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .run(
      input.projectId,
      input.openTemplate === undefined ? current.open_template : input.openTemplate ? 1 : 0,
      input.refreshAndCheck === undefined ? current.refresh_and_check : input.refreshAndCheck ? 1 : 0,
      input.exportPdf === undefined ? current.export_pdf : input.exportPdf ? 1 : 0,
      input.templateCode ?? current.template_code,
      input.notes === undefined ? current.notes : input.notes,
      stamp,
      input.updatedBy ?? current.updated_by,
    );
  return getLayoutChecklist(input.projectId);
}

export function saveSketchUpResult(input: {
  projectId: string;
  geometryVersion: string;
  modelVersion: string;
  status: string;
  componentStats: unknown[];
  exports: unknown[];
}) {
  const stamp = nowIso();
  sqlite()
    .prepare(
      `INSERT INTO sketchup_results
        (project_id, geometry_version, model_version, status, component_stats_json, exports_json, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         geometry_version = excluded.geometry_version,
         model_version = excluded.model_version,
         status = excluded.status,
         component_stats_json = excluded.component_stats_json,
         exports_json = excluded.exports_json,
         received_at = excluded.received_at`,
    )
    .run(
      input.projectId,
      input.geometryVersion,
      input.modelVersion,
      input.status,
      JSON.stringify(input.componentStats),
      JSON.stringify(input.exports),
      stamp,
    );
  return getSketchUpResult(input.projectId);
}

export function getSketchUpResult(projectId: string) {
  const row = sqlite().prepare("SELECT * FROM sketchup_results WHERE project_id = ?").get(projectId) as
    | {
        project_id: string;
        geometry_version: string;
        model_version: string;
        status: string;
        component_stats_json: string;
        exports_json: string;
        received_at: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    projectId: row.project_id,
    geometryVersion: row.geometry_version,
    modelVersion: row.model_version,
    status: row.status,
    componentStats: JSON.parse(row.component_stats_json) as unknown[],
    exports: JSON.parse(row.exports_json) as unknown[],
    receivedAt: row.received_at,
  };
}
