export type FloorPointMm = { xMm: number; yMm: number };

export type EditableWall = {
  objectId: string;
  start: FloorPointMm;
  end: FloorPointMm;
  thicknessMm: number;
  heightMm: number;
  wallType: "EXTERIOR" | "INTERIOR" | "LOAD_BEARING";
  verificationStatus: "CANDIDATE" | "REVIEWED" | "VERIFIED";
};

export type EditableRoom = {
  objectId: string;
  code: string;
  name: string;
  polygon: FloorPointMm[];
};
export type EditableOpening = { objectId:string; wallId:string; kind:"DOOR"|"WINDOW"; offsetMm:number; widthMm:number; heightMm:number; sillHeightMm:number; verificationStatus:"CANDIDATE"|"REVIEWED"|"VERIFIED" };

export type FloorPlanDocument = {
  schemaVersion: "floorplan-editor-1";
  projectId: string;
  floorPlanCode: string;
  geometryVersion: string;
  dimensionsVerified: boolean;
  ceilingHeightMm: number;
  walls: EditableWall[];
  rooms: EditableRoom[];
  openings?: EditableOpening[];
  scalePxPerMeter: number;
};

export function newWallId() {
  return crypto.randomUUID();
}

export function createEmptyFloorPlan(projectId: string): FloorPlanDocument {
  return {
    schemaVersion: "floorplan-editor-1",
    projectId,
    floorPlanCode: `${projectId}-PLAN`,
    geometryVersion: `gv-${Date.now().toString(36)}`,
    dimensionsVerified: false,
    ceilingHeightMm: 2800,
    walls: [],
    rooms: [],
    openings: [],
    scalePxPerMeter: 40,
  };
}

/** Minimal rectangular unit: 6400 x 7000 mm exterior box (A03023-like). */
export function createStarterFloorPlan(projectId: string): FloorPlanDocument {
  const height = 2800;
  const walls: EditableWall[] = [
    { objectId: newWallId(), start: { xMm: 0, yMm: 0 }, end: { xMm: 6400, yMm: 0 }, thicknessMm: 200, heightMm: height, wallType: "EXTERIOR", verificationStatus: "CANDIDATE" },
    { objectId: newWallId(), start: { xMm: 6400, yMm: 0 }, end: { xMm: 6400, yMm: 7000 }, thicknessMm: 200, heightMm: height, wallType: "EXTERIOR", verificationStatus: "CANDIDATE" },
    { objectId: newWallId(), start: { xMm: 6400, yMm: 7000 }, end: { xMm: 0, yMm: 7000 }, thicknessMm: 200, heightMm: height, wallType: "EXTERIOR", verificationStatus: "CANDIDATE" },
    { objectId: newWallId(), start: { xMm: 0, yMm: 7000 }, end: { xMm: 0, yMm: 0 }, thicknessMm: 200, heightMm: height, wallType: "EXTERIOR", verificationStatus: "CANDIDATE" },
    { objectId: newWallId(), start: { xMm: 3200, yMm: 0 }, end: { xMm: 3200, yMm: 4000 }, thicknessMm: 120, heightMm: height, wallType: "INTERIOR", verificationStatus: "CANDIDATE" },
  ];
  return {
    ...createEmptyFloorPlan(projectId),
    floorPlanCode: `${projectId}-2BR`,
    walls,
    rooms: [
      {
        objectId: newWallId(),
        code: "LIVING",
        name: "客厅",
        polygon: [
          { xMm: 200, yMm: 200 },
          { xMm: 3000, yMm: 200 },
          { xMm: 3000, yMm: 3800 },
          { xMm: 200, yMm: 3800 },
        ],
      },
    ],
  };
}

export function boundsOf(doc: FloorPlanDocument) {
  const points = doc.walls.flatMap((wall) => [wall.start, wall.end]);
  if (!points.length) return { minX: 0, minY: 0, maxX: 8000, maxY: 8000 };
  return {
    minX: Math.min(...points.map((p) => p.xMm)),
    minY: Math.min(...points.map((p) => p.yMm)),
    maxX: Math.max(...points.map((p) => p.xMm)),
    maxY: Math.max(...points.map((p) => p.yMm)),
  };
}

function mapVerification(status: EditableWall["verificationStatus"], verified: boolean) {
  if (verified || status === "VERIFIED") {
    return {
      verificationStatus: "VERIFIED" as const,
      confidence: 1,
      reviewedBy: "floorplan-editor",
    };
  }
  if (status === "REVIEWED") {
    return { verificationStatus: "REVIEWED" as const, confidence: 0.7 };
  }
  return { verificationStatus: "UNVERIFIED" as const, confidence: 0.5 };
}

/** Export a SpaceConfiguration payload for SketchUp bridge (Zod-validated when verified). */
export function toSpaceConfigurationDraft(doc: FloorPlanDocument) {
  const bounds = boundsOf(doc);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxY - bounds.minY);
  const rooms =
    doc.rooms.length > 0
      ? doc.rooms
      : [
          {
            objectId: newWallId(),
            code: "LIVING",
            name: "客厅",
            polygon: [
              { xMm: bounds.minX, yMm: bounds.minY },
              { xMm: bounds.maxX, yMm: bounds.minY },
              { xMm: bounds.maxX, yMm: bounds.maxY },
              { xMm: bounds.minX, yMm: bounds.maxY },
            ],
          },
        ];

  return {
    schemaVersion: "1.0.0" as const,
    projectId: doc.projectId,
    floorPlanCode: doc.floorPlanCode,
    geometryVersion: doc.geometryVersion,
    dimensionsVerified: doc.dimensionsVerified,
    ceilingHeightMm: doc.ceilingHeightMm,
    coordinateSystem: { unit: "mm" as const, upAxis: "Z" as const, origin: "south-west" as const },
    walls: doc.walls.map((wall) => ({
      objectId: wall.objectId,
      start: { ...wall.start, zMm: 0 },
      end: { ...wall.end, zMm: 0 },
      thicknessMm: wall.thicknessMm,
      heightMm: wall.heightMm,
      wallType: wall.wallType,
      locked: wall.wallType !== "INTERIOR",
      ...mapVerification(wall.verificationStatus, doc.dimensionsVerified),
    })),
    openings: (doc.openings??[]).map((opening)=>({objectId:opening.objectId,wallObjectId:opening.wallId,openingType:opening.kind,offsetMm:opening.offsetMm,widthMm:opening.widthMm,heightMm:opening.heightMm,sillHeightMm:opening.sillHeightMm,...mapVerification(opening.verificationStatus,doc.dimensionsVerified)})),
    windows: (doc.openings??[]).filter((item)=>item.kind==="WINDOW").map((item)=>item.objectId),
    doors: (doc.openings??[]).filter((item)=>item.kind==="DOOR").map((item)=>item.objectId),
    fixedZones: [] as unknown[],
    partitions: [] as unknown[],
    rooms: rooms.map((room) => {
      const xs = room.polygon.map((p) => p.xMm);
      const ys = room.polygon.map((p) => p.yMm);
      return {
        objectId: room.objectId,
        code: room.code,
        name: room.name,
        netWidthMm: Math.max(1, Math.max(...xs) - Math.min(...xs)),
        netDepthMm: Math.max(1, Math.max(...ys) - Math.min(...ys)),
        floorElevationMm: 0,
      };
    }),
    products: [] as unknown[],
    materials: [] as unknown[],
    cameras: [
      {
        objectId: newWallId(),
        sceneCode: "PLAN",
        projection: "ORTHOGRAPHIC" as const,
        eye: { xMm: Math.round((bounds.minX + bounds.maxX) / 2), yMm: Math.round((bounds.minY + bounds.maxY) / 2), zMm: 10000 },
        target: { xMm: Math.round((bounds.minX + bounds.maxX) / 2), yMm: Math.round((bounds.minY + bounds.maxY) / 2), zMm: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
    ],
    dimensionAnnotations: [
      {
        objectId: newWallId(),
        dimensionType: "OVERALL_WIDTH" as const,
        valueMm: width,
        start: { xMm: bounds.minX, yMm: bounds.minY, zMm: 0 },
        end: { xMm: bounds.maxX, yMm: bounds.minY, zMm: 0 },
        ...mapVerification("VERIFIED", doc.dimensionsVerified),
      },
      {
        objectId: newWallId(),
        dimensionType: "OVERALL_DEPTH" as const,
        valueMm: depth,
        start: { xMm: bounds.minX, yMm: bounds.minY, zMm: 0 },
        end: { xMm: bounds.minX, yMm: bounds.maxY, zMm: 0 },
        ...mapVerification("VERIFIED", doc.dimensionsVerified),
      },
    ],
    outputRequirements: {
      scenes: ["PLAN", "DIMENSIONED_PLAN", "AXONOMETRIC", "LIVING", "MASTER", "SECOND", "KITCHEN", "BATH"],
      formats: ["SKP", "PNG", "COMPONENT_STATS_JSON", "LAYOUT_HANDOFF_JSON"],
      layoutTemplateCode: "SHARKFLOWS-A3-V1",
      layoutScales: { plan: "1:50", elevations: "1:30" },
      requireSkuReconciliation: false,
    },
  };
}
