import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { FinalApprovalInput } from "./approval-service";
import { renderStore } from "@/lib/rendering";
import { sketchUpResultStore } from "@/lib/sketchup/result-store";

export const DEMO_SCENE_VERSION = "demo-v3";

export const REQUIRED_SCENE_PAGES = [
  { sceneId: "cover", title: "封面" },
  { sceneId: "floor-plan", title: "带尺寸平面" },
  { sceneId: "axonometric", title: "3D 鸟瞰" },
  { sceneId: "living", title: "客厅" },
  { sceneId: "master", title: "主卧" },
  { sceneId: "second", title: "次卧" },
  { sceneId: "kitchen", title: "厨房" },
  { sceneId: "bathroom", title: "浴室" },
  { sceneId: "materials", title: "材料板" },
] as const;

export function buildDemoFinalApprovalInput(projectId: string): FinalApprovalInput {
  const sketchUp = sketchUpResultStore.get(projectId) ?? null;
  const artifacts = renderStore.list(projectId);
  const renderManifest =
    artifacts.length > 0
      ? {
          manifestId: `rman_demo_${projectId}`,
          projectId,
          sceneVersion: DEMO_SCENE_VERSION,
          screenshots: artifacts
            .filter((item) => item.status === "ready" && item.imageUri)
            .map((item) => ({
              renderId: item.renderId,
              sceneId: item.sceneId,
              sceneVersion: item.sceneVersion,
              imageUri: item.imageUri!,
              width: item.width,
              height: item.height,
              sha256: item.renderId,
              capturedAt: item.completedAt ?? item.createdAt,
            })),
          createdAt: new Date().toISOString(),
        }
      : null;

  return {
    projectId,
    sceneVersion: DEMO_SCENE_VERSION,
    dimensionsVerified: false,
    unverifiedDimensionIds: ["dim_blocking_01"],
    coverage: [
      { assetId: "ast_material_07", required: true, status: "missing" },
      { assetId: "ast_floor_01", required: true, status: "covered" },
    ],
    bom: [
      { sku: "SF-SOFA-001", quantity: 1, unitPrice: 4200, name: "三人沙发" },
      { sku: "SF-LAMP-009", quantity: 2, unitPrice: 380, name: "壁灯" },
    ],
    quote: [
      { sku: "SF-SOFA-001", quantity: 1, unitPrice: 4200 },
      { sku: "SF-LAMP-009", quantity: 2, unitPrice: 380 },
    ],
    sketchUp: sketchUp
      ? {
          status: sketchUp.status,
          geometryVersion: sketchUp.geometryVersion,
          skuCounts: Object.fromEntries(
            (Array.isArray(sketchUp.componentStats) ? sketchUp.componentStats : []).map((row) => {
              const item = row as { sku?: string; quantity?: number };
              return [item.sku ?? "UNKNOWN", Number(item.quantity ?? 0)];
            }),
          ),
        }
      : null,
    renderManifest,
    requiredSceneIds: REQUIRED_SCENE_PAGES.map((item) => item.sceneId),
    approvals: [],
  };
}

export async function createScenePlaceholderPng(title: string): Promise<Uint8Array> {
  const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#eeede8"/>
  <rect x="48" y="48" width="1184" height="624" fill="#ffffff" stroke="#c5cdc8" stroke-width="2"/>
  <text x="640" y="320" text-anchor="middle" font-size="36" font-family="sans-serif" fill="#17342d">${escapeXml(title)}</text>
  <text x="640" y="380" text-anchor="middle" font-size="22" font-family="sans-serif" fill="#7a6a3a">NON-PHOTOREALISTIC PLACEHOLDER</text>
  <text x="640" y="430" text-anchor="middle" font-size="18" font-family="sans-serif" fill="#8a8070">非照片级场景占位 · 不代表照片级渲染</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function resolveProposalSceneImages(projectId: string) {
  const artifacts = renderStore.list(projectId).filter((item) => item.status === "ready");
  const byScene = new Map(artifacts.map((item) => [item.sceneId, item]));
  const scenes: Array<{ title: string; image: Uint8Array; caption?: string; isPlaceholder?: boolean }> = [];

  for (const page of REQUIRED_SCENE_PAGES) {
    const artifact = byScene.get(page.sceneId);
    if (artifact?.imageUri?.startsWith("file:") || artifact?.imageUri?.startsWith("/")) {
      const localPath = artifact.imageUri.startsWith("file:")
        ? artifact.imageUri.slice("file:".length)
        : path.join(process.cwd(), ".data", "renders", projectId, `${artifact.renderId}.png`);
      try {
        const image = new Uint8Array(await readFile(localPath));
        scenes.push({
          title: page.title,
          image,
          caption: "非照片级场景截图 · NON-PHOTOREALISTIC SCENE CAPTURE",
          isPlaceholder: false,
        });
        continue;
      } catch {
        // Fall through to placeholder when the capture file is missing.
      }
    }
    scenes.push({
      title: page.title,
      image: await createScenePlaceholderPng(page.title),
      caption: "非照片级场景占位 · NON-PHOTOREALISTIC PLACEHOLDER",
      isPlaceholder: true,
    });
  }

  return scenes;
}
