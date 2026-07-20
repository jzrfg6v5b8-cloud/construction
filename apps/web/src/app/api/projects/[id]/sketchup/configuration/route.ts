import { SpaceConfigurationSchema } from "@sharkflows/space-schema";
import a03023SpaceConfiguration from "@sharkflows/space-schema/examples/A03023.json";
import { getDb } from "@/lib/db/client";
import {
  createProject,
  ensureDemoProject,
  getFloorPlan,
  getProject,
} from "@/lib/db/repositories";
import {
  createStarterFloorPlan,
  type FloorPlanDocument,
  toSpaceConfigurationDraft,
} from "@/lib/floorplan/document";

export const runtime = "nodejs";

function ensureProject(projectId: string) {
  if (projectId === "demo" || projectId === "A03023") ensureDemoProject();
  else if (!getProject(projectId)) createProject({ id: projectId, name: `项目 ${projectId.slice(0, 8)}` });
}

function resolveDocument(projectId: string): FloorPlanDocument | null {
  const row = getFloorPlan(projectId);
  if (!row) return null;
  return JSON.parse(row.document_json) as FloorPlanDocument;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  getDb();
  ensureProject(id);

  const download = new URL(request.url).searchParams.get("download") === "1";
  const saved = resolveDocument(id);

  // Prefer verified floor-plan editor geometry for any project.
  if (saved?.dimensionsVerified) {
    const draft = toSpaceConfigurationDraft(saved);
    const validation = SpaceConfigurationSchema.safeParse(draft);
    if (!validation.success) {
      return Response.json(
        {
          error: "SPACE_CONFIGURATION_INVALID",
          issues: validation.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }
    return new Response(JSON.stringify(validation.data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        ...(download
          ? {
              "Content-Disposition": `attachment; filename="${id}-${validation.data.geometryVersion}.space.json"`,
            }
          : {}),
      },
    });
  }

  // Demo fallback: canonical A03023 fixture
  if (id === "demo" || id === "A03023") {
    const validation = SpaceConfigurationSchema.safeParse(a03023SpaceConfiguration);
    if (!validation.success) {
      return Response.json(
        {
          error: "SPACE_CONFIGURATION_INVALID",
          issues: validation.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }
    if (!validation.data.dimensionsVerified) {
      return Response.json({ error: "DIMENSIONS_NOT_VERIFIED" }, { status: 409 });
    }
    return new Response(JSON.stringify(validation.data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        ...(download
          ? {
              "Content-Disposition": `attachment; filename="A03023-${a03023SpaceConfiguration.geometryVersion}.space.json"`,
            }
          : {}),
      },
    });
  }

  // Unverified or missing plan
  const hint = saved ?? createStarterFloorPlan(id);
  return Response.json(
    {
      error: "DIMENSIONS_NOT_VERIFIED",
      message: "请先在「户型校准」编辑并确认尺寸 VERIFIED，再导出 SketchUp 配置。",
      spaceConfigurationPreview: toSpaceConfigurationDraft(hint),
    },
    { status: 409 },
  );
}
