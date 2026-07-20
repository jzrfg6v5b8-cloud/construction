import sharp from "sharp";
import { getDb } from "@/lib/db/client";
import {
  createProject,
  ensureDemoProject,
  getFloorPlan,
  getProject,
  saveFloorPlan,
  touchProject,
} from "@/lib/db/repositories";
import {
  createStarterFloorPlan,
  type FloorPlanDocument,
} from "@/lib/floorplan/document";
import { ingestScenePng, PROPOSAL_SCENE_IDS } from "@/lib/rendering/ingest-scene-png";

export const runtime = "nodejs";

function ensureProject(projectId: string) {
  if (projectId === "demo") ensureDemoProject();
  else if (!getProject(projectId)) createProject({ id: projectId, name: `项目 ${projectId.slice(0, 8)}` });
}

async function scenePng(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1a3c34"/>
        <stop offset="100%" stop-color="#0f766e"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="48" y="48" width="1184" height="624" fill="#f8faf9" opacity="0.92"/>
    <text x="640" y="330" text-anchor="middle" font-size="42" fill="#134e4a" font-family="Arial,sans-serif">${label}</text>
    <text x="640" y="390" text-anchor="middle" font-size="20" fill="#5b716c" font-family="Arial,sans-serif">bootstrap scene · replace with SketchUp PNG</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * One-shot bootstrap so a new project can run: verified floorplan + 8 scene PNGs.
 * Real SketchUp PNGs can overwrite later via /renders.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  getDb();
  ensureProject(id);

  const body = (await request.json().catch(() => ({}))) as {
    verifyFloorplan?: boolean;
    seedRenders?: boolean;
  };
  const verifyFloorplan = body.verifyFloorplan !== false;
  const seedRenders = body.seedRenders !== false;

  let document: FloorPlanDocument;
  const existing = getFloorPlan(id);
  if (existing) {
    document = JSON.parse(existing.document_json) as FloorPlanDocument;
  } else {
    document = createStarterFloorPlan(id);
  }

  if (verifyFloorplan) {
    document = {
      ...document,
      projectId: id,
      dimensionsVerified: true,
      geometryVersion: `gv-boot-${Date.now().toString(36)}`,
      walls: document.walls.map((wall) => ({
        ...wall,
        verificationStatus: "VERIFIED" as const,
      })),
    };
    saveFloorPlan({
      projectId: id,
      geometryVersion: document.geometryVersion,
      dimensionsVerified: true,
      ceilingHeightMm: document.ceilingHeightMm,
      document,
    });
  }

  const seededScenes: string[] = [];
  if (seedRenders) {
    for (const sceneId of PROPOSAL_SCENE_IDS) {
      const bytes = await scenePng(sceneId);
      await ingestScenePng({
        projectId: id,
        sceneId,
        sceneVersion: document.geometryVersion,
        renderer: "bootstrap",
        bytes,
      });
      seededScenes.push(sceneId);
    }
  }

  touchProject(id);
  return Response.json({
    ok: true,
    projectId: id,
    floorplanVerified: Boolean(verifyFloorplan && document.dimensionsVerified),
    geometryVersion: document.geometryVersion,
    seededScenes,
    next: {
      calibration: `/projects/${id}/calibration`,
      sketchup: `/projects/${id}/sketchup`,
      proposal: `/projects/${id}/proposal`,
      exportDraft: `/api/projects/${id}/proposal/export?status=DRAFT`,
    },
  });
}
