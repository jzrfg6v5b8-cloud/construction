import { createHash, randomUUID } from "node:crypto";
import type { RenderArtifact } from "./types";

export type SceneScreenshotEntry = {
  renderId: string;
  sceneId: string;
  sceneVersion: string;
  imageUri: string;
  width: number;
  height: number;
  sha256: string;
  capturedAt: string;
};

export type SceneScreenshotManifest = {
  manifestId: string;
  projectId: string;
  sceneVersion: string;
  screenshots: SceneScreenshotEntry[];
  createdAt: string;
};

export function createScreenshotManifest(
  projectId: string,
  sceneVersion: string,
  artifacts: readonly RenderArtifact[],
): SceneScreenshotManifest {
  const screenshots = artifacts.map((artifact) => {
    if (artifact.status !== "ready" || !artifact.imageUri) {
      throw new Error(`RENDER_NOT_READY:${artifact.renderId}`);
    }
    if (artifact.projectId !== projectId || artifact.sceneVersion !== sceneVersion) {
      throw new Error(`RENDER_VERSION_MISMATCH:${artifact.renderId}`);
    }
    return {
      renderId: artifact.renderId,
      sceneId: artifact.sceneId,
      sceneVersion: artifact.sceneVersion,
      imageUri: artifact.imageUri,
      width: artifact.width,
      height: artifact.height,
      sha256: createHash("sha256")
        .update([artifact.sceneVersion, artifact.imageUri, artifact.width, artifact.height].join("|"))
        .digest("hex"),
      capturedAt: artifact.completedAt ?? artifact.createdAt,
    };
  });
  return {
    manifestId: `rman_${randomUUID()}`,
    projectId,
    sceneVersion,
    screenshots,
    createdAt: new Date().toISOString(),
  };
}

export function detectExpiredScreenshots(
  manifest: SceneScreenshotManifest,
  currentSceneVersion: string,
  requiredSceneIds: readonly string[] = [],
) {
  const reasons: string[] = [];
  if (manifest.sceneVersion !== currentSceneVersion) {
    reasons.push(`SCENE_VERSION_CHANGED:${manifest.sceneVersion}->${currentSceneVersion}`);
  }
  const available = new Set(manifest.screenshots.map((item) => item.sceneId));
  for (const sceneId of requiredSceneIds) {
    if (!available.has(sceneId)) reasons.push(`MISSING_SCENE_SCREENSHOT:${sceneId}`);
  }
  for (const item of manifest.screenshots) {
    if (item.sceneVersion !== manifest.sceneVersion) reasons.push(`MIXED_SCENE_VERSION:${item.renderId}`);
  }
  return { expired: reasons.length > 0, reasons };
}
