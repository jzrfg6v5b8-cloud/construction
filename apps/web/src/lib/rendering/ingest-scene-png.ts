import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cloudDownloadObject,
  cloudUploadObject,
  cloudUpsertRender,
  useCloudDb,
} from "@/lib/db/cloud-store";
import { upsertRenderArtifactByScene } from "@/lib/db/repositories";
import { renderStore } from "@/lib/rendering/render-store";
import type { RenderArtifact } from "@/lib/rendering/types";

async function loadSharp() {
  const mod = await import("sharp");
  return mod.default;
}

export const PROPOSAL_SCENE_IDS = [
  "plan",
  "dimensioned-plan",
  "aerial",
  "living",
  "master",
  "second",
  "kitchen",
  "bath",
] as const;

const SCENE_ALIASES: Record<string, string> = {
  PLAN: "plan",
  DIMENSIONED_PLAN: "dimensioned-plan",
  AXONOMETRIC: "aerial",
  AERIAL: "aerial",
  LIVING: "living",
  MASTER: "master",
  MASTER_BEDROOM: "master",
  SECOND: "second",
  SECOND_BEDROOM: "second",
  KITCHEN: "kitchen",
  BATH: "bath",
  BATHROOM: "bath",
  bathroom: "bath",
  "floor-plan": "plan",
  axonometric: "aerial",
};

export function normalizeSceneId(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "living";
  return SCENE_ALIASES[trimmed] ?? SCENE_ALIASES[trimmed.toUpperCase()] ?? trimmed.toLowerCase();
}

export function rendersRoot(projectId: string) {
  const base =
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
      ? "/tmp/sharkflows-renders"
      : process.env.RENDERS_PATH ?? ".data/renders";
  return path.isAbsolute(base) ? path.join(base, projectId) : path.resolve(process.cwd(), base, projectId);
}

export function syncRenderRowToMemory(row: {
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
}) {
  const artifact: RenderArtifact = {
    renderId: row.render_id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    sceneVersion: row.scene_version,
    renderer: row.renderer,
    status: row.status as RenderArtifact["status"],
    width: row.width,
    height: row.height,
    imageUri: row.image_uri ?? undefined,
    skuCodes: [],
    materialCodes: [],
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
  renderStore.set(artifact);
  return artifact;
}

export async function ingestScenePng(input: {
  projectId: string;
  sceneId: string;
  sceneVersion?: string;
  renderer?: string;
  bytes: Buffer;
}) {
  const sceneId = normalizeSceneId(input.sceneId);
  const sceneVersion = input.sceneVersion ?? `sv-${Date.now().toString(36)}`;
  const renderer = input.renderer ?? "upload";
  const sharp = await loadSharp();
  const png = await sharp(input.bytes).png().toBuffer();
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 1280;
  const height = meta.height ?? 720;
  const stamp = new Date().toISOString();

  if (useCloudDb()) {
    const storageKey = `projects/${input.projectId}/renders/${sceneId}.png`;
    await cloudUploadObject({ key: storageKey, body: png, contentType: "image/png", upsert: true });
    const existing = await import("@/lib/db/cloud-store").then((m) => m.cloudGetRender(input.projectId, sceneId));
    const rowId = existing?.id ?? `rnd_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await cloudUpsertRender({
      id: rowId,
      project_id: input.projectId,
      scene_id: sceneId,
      scene_version: sceneVersion,
      renderer,
      status: "ready",
      width,
      height,
      storage_key: storageKey,
      created_at: existing?.created_at ?? stamp,
      updated_at: stamp,
    });
    return {
      sceneId,
      path: storageKey,
      url: `/api/projects/${input.projectId}/renders?sceneId=${encodeURIComponent(sceneId)}&raw=1`,
      render: { render_id: rowId, scene_id: sceneId },
    };
  }

  const dir = rendersRoot(input.projectId);
  await mkdir(dir, { recursive: true });
  const absolute = path.join(dir, `${sceneId}.png`);
  await writeFile(absolute, png);
  const row = upsertRenderArtifactByScene({
    projectId: input.projectId,
    sceneId,
    sceneVersion,
    renderer,
    status: "ready",
    width,
    height,
    imageUri: absolute,
  });
  if (row) syncRenderRowToMemory(row as Parameters<typeof syncRenderRowToMemory>[0]);
  return {
    sceneId,
    path: absolute,
    url: `/api/projects/${input.projectId}/renders?sceneId=${encodeURIComponent(sceneId)}&raw=1`,
    render: row,
  };
}

export async function readScenePng(projectId: string, sceneId: string): Promise<Buffer | null> {
  if (useCloudDb()) {
    const row = await import("@/lib/db/cloud-store").then((m) => m.cloudGetRender(projectId, sceneId));
    if (!row) return null;
    return cloudDownloadObject(row.storage_key);
  }
  const absolute = path.join(rendersRoot(projectId), `${sceneId}.png`);
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(absolute);
  } catch {
    return null;
  }
}
