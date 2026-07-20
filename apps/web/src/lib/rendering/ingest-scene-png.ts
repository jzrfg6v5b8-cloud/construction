import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { upsertRenderArtifactByScene } from "@/lib/db/repositories";
import { renderStore } from "@/lib/rendering/render-store";
import type { RenderArtifact } from "@/lib/rendering/types";

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
  return path.resolve(process.cwd(), process.env.RENDERS_PATH ?? ".data/renders", projectId);
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
  const dir = rendersRoot(input.projectId);
  await mkdir(dir, { recursive: true });
  const png = await sharp(input.bytes).png().toBuffer();
  const meta = await sharp(png).metadata();
  const absolute = path.join(dir, `${sceneId}.png`);
  await writeFile(absolute, png);
  const row = upsertRenderArtifactByScene({
    projectId: input.projectId,
    sceneId,
    sceneVersion,
    renderer,
    status: "ready",
    width: meta.width ?? 1280,
    height: meta.height ?? 720,
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
