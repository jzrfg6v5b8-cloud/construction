import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";
import {
  cloudDownloadObject,
  cloudListAssets,
  useCloudDb,
} from "@/lib/db/cloud-store";
import { getDb } from "@/lib/db/client";
import {
  floorPlanFromImageHeuristic,
  floorPlanFromVisionPages,
  type VisionPage,
} from "@/lib/floorplan/from-vision";
import { saveFloorPlanAsync, touchProjectAsync } from "@/lib/db/repositories";
import { generateConceptPngs } from "@/lib/rendering/generate-concept-renders";
import { ingestScenePng } from "@/lib/rendering/ingest-scene-png";
import {
  createVisionWorkerClient,
  VisionWorkerUnavailableError,
} from "@/lib/providers/vision-worker-client";
import { listAssets } from "@/lib/db/repositories";
import { readFile } from "node:fs/promises";

export const runtime = "nodejs";
export const maxDuration = 120;

async function loadImageBytes(projectId: string, input: { assetId?: string; dataBase64?: string }) {
  if (input.dataBase64) {
    return Buffer.from(input.dataBase64, "base64");
  }
  if (!input.assetId) throw new Error("ASSET_OR_IMAGE_REQUIRED");

  if (useCloudDb()) {
    const assets = await cloudListAssets(projectId);
    const asset = assets.find((a) => a.id === input.assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    return cloudDownloadObject(asset.storage_key);
  }

  getDb();
  const assets = listAssets(projectId);
  const asset = assets.find((a) => a.id === input.assetId);
  if (!asset?.storage_key) throw new Error("ASSET_NOT_FOUND");
  return readFile(asset.storage_key);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  try {
    await requireOwnedProject(projectId);
    const body = (await request.json().catch(() => ({}))) as {
      assetId?: string;
      dataBase64?: string;
      filename?: string;
      generateRenders?: boolean;
    };

    const bytes = await loadImageBytes(projectId, body);
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    const imageWidth = meta.width ?? 1200;
    const imageHeight = meta.height ?? 900;
    const filename = body.filename ?? "floorplan.png";

    let visionUsed = false;
    let visionWarnings: string[] = [];
    let pages: VisionPage[] = [];

    try {
      const client = createVisionWorkerClient();
      await client.health();
      const result = await client.createJob({
        jobId: `analyze_${projectId}_${randomUUID().slice(0, 8)}`,
        source: {
          filename,
          mediaType: meta.format ? `image/${meta.format}` : "image/png",
          dataBase64: bytes.toString("base64"),
        },
        options: { ocrMode: "auto", saveDerivedFiles: false },
      });
      visionUsed = true;
      visionWarnings = result.warnings ?? [];
      pages = (result.pages ?? []) as VisionPage[];
    } catch (error) {
      if (!(error instanceof VisionWorkerUnavailableError)) {
        visionWarnings.push(error instanceof Error ? error.message : "vision_failed");
      } else {
        visionWarnings.push("VISION_WORKER_OFFLINE_USING_HEURISTIC");
      }
    }

    const document = visionUsed && pages.length
      ? floorPlanFromVisionPages(projectId, pages)
      : floorPlanFromImageHeuristic(projectId, imageWidth, imageHeight);

    const saved = await saveFloorPlanAsync({
      projectId,
      geometryVersion: document.geometryVersion,
      dimensionsVerified: false,
      ceilingHeightMm: document.ceilingHeightMm,
      document,
    });

    const seededScenes: string[] = [];
    if (body.generateRenders !== false) {
      const concepts = await generateConceptPngs(document, undefined, bytes);
      for (const item of concepts) {
        await ingestScenePng({
          projectId,
          sceneId: item.sceneId,
          sceneVersion: document.geometryVersion,
          renderer: visionUsed ? "vision-concept" : "heuristic-concept",
          bytes: item.bytes,
        });
        seededScenes.push(item.sceneId);
      }
    }

    await touchProjectAsync(projectId);

    return NextResponse.json({
      ok: true,
      projectId,
      visionUsed,
      visionWarnings,
      floorplan: {
        geometryVersion: document.geometryVersion,
        wallCount: document.walls.length,
        dimensionsVerified: document.dimensionsVerified,
        meta: saved,
      },
      seededScenes,
      next: {
        calibration: `/projects/${projectId}/calibration`,
        sceneBuilder: `/projects/${projectId}/scene-builder`,
        proposal: `/projects/${projectId}/proposal`,
      },
    });
  } catch (error) {
    return (
      accessErrorResponse(error) ??
      NextResponse.json(
        {
          error: error instanceof Error ? error.message : "ANALYZE_FAILED",
          hint:
            error instanceof Error && error.message.includes("ASSET")
              ? "请先上传户型图，再点一键生成"
              : undefined,
        },
        { status: 500 },
      )
    );
  }
}
