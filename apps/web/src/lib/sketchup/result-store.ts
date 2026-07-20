export type SketchUpModelResult = {
  projectId: string;
  geometryVersion: string;
  modelVersion: string;
  status: string;
  componentStats: unknown[];
  exports: unknown[];
  receivedAt: string;
};

const globalStore = globalThis as typeof globalThis & {
  __sharkflowsSketchUpResults?: Map<string, SketchUpModelResult>;
};

export const sketchUpResultStore = globalStore.__sharkflowsSketchUpResults
  ?? (globalStore.__sharkflowsSketchUpResults = new Map<string, SketchUpModelResult>());
