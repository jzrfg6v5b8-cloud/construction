import type { RenderArtifact } from "./types";

const state = globalThis as typeof globalThis & {
  __sharkflowsRenderStore?: Map<string, RenderArtifact>;
};

const renders = state.__sharkflowsRenderStore ?? (state.__sharkflowsRenderStore = new Map());

export const renderStore = {
  set(artifact: RenderArtifact) {
    renders.set(`${artifact.projectId}:${artifact.renderId}`, artifact);
  },
  get(projectId: string, renderId: string) {
    return renders.get(`${projectId}:${renderId}`);
  },
  list(projectId: string) {
    return [...renders.values()].filter((item) => item.projectId === projectId);
  },
};
