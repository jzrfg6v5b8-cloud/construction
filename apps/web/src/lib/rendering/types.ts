import type { Scene } from "@/lib/domain/schemas";

export type RenderSize = { width: number; height: number };

export type RenderRequest = {
  projectId: string;
  scene: Scene;
  sceneVersion: string;
  size: RenderSize;
  skuCodes: string[];
  materialCodes: string[];
  camera?: string;
};

export type RenderArtifact = {
  renderId: string;
  projectId: string;
  sceneId: string;
  sceneVersion: string;
  renderer: string;
  status: "queued" | "rendering" | "ready" | "failed";
  width: number;
  height: number;
  html?: string;
  imageUri?: string;
  skuCodes: string[];
  materialCodes: string[];
  createdAt: string;
  completedAt?: string;
  error?: string;
};

export interface Renderer {
  readonly name: string;
  render(request: RenderRequest): Promise<RenderArtifact>;
}
