import { SpaceConfigurationSchema } from "@sharkflows/space-schema";
import a03023SpaceConfiguration from "@sharkflows/space-schema/examples/A03023.json";
import { getDb } from "@/lib/db/client";
import { useCloudDb } from "@/lib/db/cloud-store";
import {
  createProjectAsync,
  ensureDemoProject,
  getFloorPlanAsync,
  getProjectAsync,
  touchProjectAsync,
} from "@/lib/db/repositories";
import {
  createStarterFloorPlan,
  type FloorPlanDocument,
  toSpaceConfigurationDraft,
} from "@/lib/floorplan/document";
import { accessErrorResponse, requireOwnedProject, requireUser } from "@/lib/auth/project-access";
import { enqueueSketchUpTask } from "@/lib/sketchup/cloud-queue";

export const runtime = "nodejs";
export const maxDuration = 60;

async function ensureProject(projectId: string, userId?: string) {
  if (useCloudDb()) {
    const existing = await getProjectAsync(projectId);
    if (!existing && userId) {
      await createProjectAsync({ id: projectId, name: `项目 ${projectId.slice(0, 8)}`, userId });
    }
    return;
  }
  getDb();
  if (projectId === "demo" || projectId === "A03023") ensureDemoProject();
  else if (!(await getProjectAsync(projectId))) {
    await createProjectAsync({ id: projectId, name: `项目 ${projectId.slice(0, 8)}`, userId });
  }
}

async function resolveDocument(projectId: string): Promise<FloorPlanDocument | null> {
  const row = await getFloorPlanAsync(projectId);
  if (!row) return null;
  return JSON.parse(row.document_json) as FloorPlanDocument;
}

async function buildConfiguration(projectId: string) {
  const saved = await resolveDocument(projectId);

  if (saved?.dimensionsVerified) {
    const draft = toSpaceConfigurationDraft(saved);
    const validation = SpaceConfigurationSchema.safeParse(draft);
    if (!validation.success) {
      return {
        error: Response.json(
          {
            error: "SPACE_CONFIGURATION_INVALID",
            issues: validation.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          { status: 422 },
        ),
      };
    }
    return { data: validation.data };
  }

  if (projectId === "demo" || projectId === "A03023") {
    const validation = SpaceConfigurationSchema.safeParse(a03023SpaceConfiguration);
    if (!validation.success) {
      return {
        error: Response.json(
          {
            error: "SPACE_CONFIGURATION_INVALID",
            issues: validation.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
          { status: 422 },
        ),
      };
    }
    if (!validation.data.dimensionsVerified) {
      return { error: Response.json({ error: "DIMENSIONS_NOT_VERIFIED" }, { status: 409 }) };
    }
    return { data: validation.data };
  }

  const hint = saved ?? createStarterFloorPlan(projectId);
  return {
    error: Response.json(
      {
        error: "DIMENSIONS_NOT_VERIFIED",
        message: "请先在「户型校准」编辑并确认尺寸 VERIFIED，再导出 SketchUp 配置。",
        spaceConfigurationPreview: toSpaceConfigurationDraft(hint),
      },
      { status: 409 },
    ),
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!useCloudDb()) getDb();
    await requireOwnedProject(id);
    await ensureProject(id);

    const download = new URL(request.url).searchParams.get("download") === "1";
    const built = await buildConfiguration(id);
    if (built.error) return built.error;

    return new Response(JSON.stringify(built.data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        ...(download
          ? {
              "Content-Disposition": `attachment; filename="${id}-${built.data.geometryVersion}.space.json"`,
            }
          : {}),
      },
    });
  } catch (error) {
    return accessErrorResponse(error) ?? Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/** Enqueue a cloud SketchUp modeling task for the local bridge poller. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!useCloudDb()) getDb();
    const user = await requireUser();
    await ensureProject(id, user.id);
    await requireOwnedProject(id);

    const body = (await request.json().catch(() => ({}))) as {
      enqueue?: boolean;
      idempotencyKey?: string;
    };
    if (body.enqueue === false) {
      return Response.json({ error: "USE_GET_FOR_CONFIGURATION" }, { status: 400 });
    }

    const built = await buildConfiguration(id);
    if (built.error) return built.error;

    if (!useCloudDb()) {
      return Response.json({
        ok: true,
        mode: "local-bridge",
        configuration: built.data,
        hint: "本地开发请用浏览器直连 127.0.0.1 桥接；生产请配置云队列。",
      });
    }

    const geometryVersion = String(
      (built.data as { geometryVersion?: string }).geometryVersion ?? "gv-unknown",
    );
    const idempotencyKey =
      body.idempotencyKey?.trim() || `${id}:${geometryVersion}`;
    const enqueued = await enqueueSketchUpTask({
      projectId: id,
      configuration: built.data,
      idempotencyKey,
    });
    await touchProjectAsync(id);
    return Response.json(
      {
        ok: true,
        mode: "cloud-queue",
        created: enqueued.created,
        task: enqueued.task,
        configuration: built.data,
      },
      { status: enqueued.created ? 201 : 200 },
    );
  } catch (error) {
    return (
      accessErrorResponse(error) ??
      Response.json(
        { error: error instanceof Error ? error.message : "ENQUEUE_FAILED" },
        { status: 500 },
      )
    );
  }
}
