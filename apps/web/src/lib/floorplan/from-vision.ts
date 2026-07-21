import {
  boundsOf,
  createStarterFloorPlan,
  newWallId,
  type EditableWall,
  type FloorPlanDocument,
  type FloorPointMm,
} from "@/lib/floorplan/document";

type BBox = { x: number; y: number; width: number; height: number };

export type VisionCandidate = {
  candidateType?: string;
  candidate_type?: string;
  value?: string | null;
  bbox?: BBox;
  confidence?: number;
  metadata?: {
    endpoints?: [number, number][];
    lengthPixels?: number;
  };
};

export type VisionPage = {
  pageIndex?: number;
  width?: number;
  height?: number;
  candidates?: VisionCandidate[];
};

function candidateType(c: VisionCandidate) {
  return c.candidateType ?? c.candidate_type ?? "";
}

function parseDimensionMm(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/(\d{3,5})\s*(?:mm|毫米)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 800 || value > 50000) return null;
  return value;
}

function collectDimensions(candidates: VisionCandidate[]) {
  const values: number[] = [];
  for (const c of candidates) {
    if (candidateType(c) !== "text") continue;
    const parsed = parseDimensionMm(c.value);
    if (parsed) values.push(parsed);
  }
  values.sort((a, b) => b - a);
  return values;
}

function mergeLines(
  walls: Array<{ start: FloorPointMm; end: FloorPointMm; thicknessMm: number }>,
  tolerance = 80,
): EditableWall[] {
  const merged: EditableWall[] = [];
  for (const wall of walls) {
    const length = Math.hypot(wall.end.xMm - wall.start.xMm, wall.end.yMm - wall.start.yMm);
    if (length < 400) continue;
    const isExterior =
      Math.abs(wall.start.xMm - wall.end.xMm) < tolerance || Math.abs(wall.start.yMm - wall.end.yMm) < tolerance;
    merged.push({
      objectId: newWallId(),
      start: wall.start,
      end: wall.end,
      thicknessMm: wall.thicknessMm,
      heightMm: 2800,
      wallType: isExterior && length > 2000 ? "EXTERIOR" : "INTERIOR",
      verificationStatus: "CANDIDATE",
    });
  }
  return merged.slice(0, 48);
}

function wallsFromCandidates(
  candidates: VisionCandidate[],
  pageWidth: number,
  pageHeight: number,
  widthMm: number,
  depthMm: number,
): EditableWall[] {
  const scaleX = widthMm / Math.max(1, pageWidth);
  const scaleY = depthMm / Math.max(1, pageHeight);
  const walls: Array<{ start: FloorPointMm; end: FloorPointMm; thicknessMm: number }> = [];

  for (const c of candidates) {
    if (candidateType(c) !== "wall") continue;
    const endpoints = c.metadata?.endpoints;
    if (!endpoints || endpoints.length < 2) continue;
    const [a, b] = endpoints;
    walls.push({
      start: { xMm: Math.round(a[0] * scaleX), yMm: Math.round(a[1] * scaleY) },
      end: { xMm: Math.round(b[0] * scaleX), yMm: Math.round(b[1] * scaleY) },
      thicknessMm: Math.max(100, Math.round((c.metadata?.lengthPixels ?? 8) * Math.min(scaleX, scaleY) * 0.15)),
    });
  }

  if (walls.length >= 4) return mergeLines(walls);

  // Bounding-box exterior fallback from detected wall spread
  const points = walls.flatMap((w) => [w.start, w.end]);
  if (points.length >= 2) {
    const xs = points.map((p) => p.xMm);
    const ys = points.map((p) => p.yMm);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return mergeLines([
      { start: { xMm: minX, yMm: minY }, end: { xMm: maxX, yMm: minY }, thicknessMm: 200 },
      { start: { xMm: maxX, yMm: minY }, end: { xMm: maxX, yMm: maxY }, thicknessMm: 200 },
      { start: { xMm: maxX, yMm: maxY }, end: { xMm: minX, yMm: maxY }, thicknessMm: 200 },
      { start: { xMm: minX, yMm: maxY }, end: { xMm: minX, yMm: minY }, thicknessMm: 200 },
    ]);
  }

  return [];
}

/** Convert vision-worker page results into an editable floor plan draft. */
export function floorPlanFromVisionPages(
  projectId: string,
  pages: VisionPage[],
  options?: { fallbackWidthMm?: number; fallbackDepthMm?: number; ceilingHeightMm?: number },
): FloorPlanDocument {
  const page = pages[0];
  if (!page?.width || !page?.height) {
    return createStarterFloorPlan(projectId);
  }

  const candidates = page.candidates ?? [];
  const dims = collectDimensions(candidates);
  const widthMm = dims[0] ?? options?.fallbackWidthMm ?? 6400;
  const depthMm = dims[1] ?? dims[0] ?? options?.fallbackDepthMm ?? 7000;
  const ceilingHeightMm = dims.find((d) => d >= 2200 && d <= 3600) ?? options?.ceilingHeightMm ?? 2500;

  let walls = wallsFromCandidates(candidates, page.width, page.height, widthMm, depthMm);
  if (walls.length < 4) {
    const starter = createStarterFloorPlan(projectId);
    walls = starter.walls.map((w) => ({
      ...w,
      verificationStatus: "CANDIDATE" as const,
    }));
  }

  const doc: FloorPlanDocument = {
    schemaVersion: "floorplan-editor-1",
    projectId,
    floorPlanCode: `${projectId}-IMPORT`,
    geometryVersion: `gv-vision-${Date.now().toString(36)}`,
    dimensionsVerified: false,
    ceilingHeightMm,
    walls,
    rooms: [],
    openings: [],
    scalePxPerMeter: Math.round((page.width / widthMm) * 1000 * 10) / 10,
  };

  const bounds = boundsOf(doc);
  doc.rooms = [
    {
      objectId: newWallId(),
      code: "LIVING",
      name: "客饭厅",
      polygon: [
        { xMm: bounds.minX + 200, yMm: bounds.minY + 200 },
        { xMm: bounds.maxX - 200, yMm: bounds.minY + 200 },
        { xMm: bounds.maxX - 200, yMm: bounds.maxY - 200 },
        { xMm: bounds.minX + 200, yMm: bounds.maxY - 200 },
      ],
    },
  ];

  return doc;
}

/** Heuristic import when vision worker is offline — uses image aspect ratio + A03023 defaults. */
export function floorPlanFromImageHeuristic(
  projectId: string,
  imageWidth: number,
  imageHeight: number,
): FloorPlanDocument {
  const aspect = imageWidth / Math.max(1, imageHeight);
  const widthMm = aspect >= 0.85 && aspect <= 1.05 ? 6400 : Math.round(6400 * aspect);
  const depthMm = aspect >= 0.85 && aspect <= 1.05 ? 7000 : 6400;
  const starter = createStarterFloorPlan(projectId);
  const scaleX = widthMm / 6400;
  const scaleY = depthMm / 7000;

  return {
    ...starter,
    floorPlanCode: `${projectId}-HEURISTIC`,
    geometryVersion: `gv-heuristic-${Date.now().toString(36)}`,
    dimensionsVerified: false,
    ceilingHeightMm: 2500,
    scalePxPerMeter: Math.round((imageWidth / widthMm) * 1000 * 10) / 10,
    walls: starter.walls.map((wall) => ({
      ...wall,
      start: { xMm: Math.round(wall.start.xMm * scaleX), yMm: Math.round(wall.start.yMm * scaleY) },
      end: { xMm: Math.round(wall.end.xMm * scaleX), yMm: Math.round(wall.end.yMm * scaleY) },
      verificationStatus: "CANDIDATE" as const,
    })),
    rooms: starter.rooms.map((room) => ({
      ...room,
      polygon: room.polygon.map((p) => ({
        xMm: Math.round(p.xMm * scaleX),
        yMm: Math.round(p.yMm * scaleY),
      })),
    })),
  };
}
