import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { useCloudDb } from "@/lib/db/cloud-store";
import {
  getFloorPlanAsync,
  saveFloorPlanAsync,
  touchProjectAsync,
  listApprovals,
} from "@/lib/db/repositories";
import {
  createStarterFloorPlan,
  type FloorPlanDocument,
  toSpaceConfigurationDraft,
} from "@/lib/floorplan/document";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";

function calibrationIssues(document: FloorPlanDocument): string[] {
  const issues: string[] = [];
  const exterior = document.walls.filter((wall) => wall.wallType === "EXTERIOR");
  if (exterior.length < 4) issues.push("EXTERIOR_LOOP_INCOMPLETE");
  if (document.ceilingHeightMm < 1800 || document.ceilingHeightMm > 6000) issues.push("CEILING_HEIGHT_INVALID");
  for (const wall of document.walls) {
    const length = Math.hypot(wall.end.xMm - wall.start.xMm, wall.end.yMm - wall.start.yMm);
    if (!Number.isFinite(length) || length < 100) issues.push(`WALL_INVALID:${wall.objectId}`);
    if (wall.thicknessMm < 40 || wall.thicknessMm > 1000) issues.push(`WALL_THICKNESS_INVALID:${wall.objectId}`);
  }
  const degree = new Map<string, number>();
  for (const wall of exterior) {
    for (const point of [wall.start, wall.end]) {
      const key = `${point.xMm}:${point.yMm}`;
      degree.set(key, (degree.get(key) ?? 0) + 1);
    }
  }
  if ([...degree.values()].some((value) => value !== 2)) issues.push("EXTERIOR_LOOP_NOT_CLOSED");
  return [...new Set(issues)];
}

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!useCloudDb()) getDb();
    await requireOwnedProject(id);
    const row = await getFloorPlanAsync(id);
    if (!row) {
      const starter = createStarterFloorPlan(id);
      return NextResponse.json({
        exists: false,
        document: starter,
        spaceConfiguration: toSpaceConfigurationDraft(starter),
      });
    }
    const document = JSON.parse(row.document_json) as FloorPlanDocument;
    return NextResponse.json({
      exists: true,
      document,
      meta: {
        geometryVersion: row.geometry_version,
        dimensionsVerified: Boolean(row.dimensions_verified),
        ceilingHeightMm: row.ceiling_height_mm,
        updatedAt: row.updated_at,
      },
      spaceConfiguration: toSpaceConfigurationDraft(document),
    });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!useCloudDb()) getDb();
    await requireOwnedProject(id);
    const body = (await request.json().catch(() => null)) as { document?: FloorPlanDocument } | null;
    if (!body?.document || body.document.schemaVersion !== "floorplan-editor-1") {
      return NextResponse.json({ error: "INVALID_FLOORPLAN" }, { status: 400 });
    }
    const document: FloorPlanDocument = {
      ...body.document,
      projectId: id,
      geometryVersion: body.document.geometryVersion || `gv-${Date.now().toString(36)}`,
    };
    if (document.dimensionsVerified) {
      const issues = calibrationIssues(document);
      const approved = useCloudDb()
        ? true
        : listApprovals(id).some(
            (row) =>
              row.role === "designer" &&
              row.decision === "approved" &&
              row.scene_version === document.geometryVersion,
          );
      if (issues.length || !approved) {
        return NextResponse.json(
          { error: "CALIBRATION_REVIEW_REQUIRED", issues, designerApprovalRequired: !approved },
          { status: 409 },
        );
      }
    }
    if (document.dimensionsVerified) {
      document.walls = document.walls.map((wall) => ({
        ...wall,
        verificationStatus: "VERIFIED" as const,
      }));
    }
    const saved = await saveFloorPlanAsync({
      projectId: id,
      geometryVersion: document.geometryVersion,
      dimensionsVerified: document.dimensionsVerified,
      ceilingHeightMm: document.ceilingHeightMm,
      document,
    });
    await touchProjectAsync(id);
    return NextResponse.json({
      ok: true,
      document,
      meta: saved,
      spaceConfiguration: toSpaceConfigurationDraft(document),
    });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
