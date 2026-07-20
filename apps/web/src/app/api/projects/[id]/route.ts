import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  deleteProject,
  listAssets,
  updateProject,
} from "@/lib/db/repositories";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";
import { createObjectStorage } from "@/lib/storage";
import { deletePrivateProjectFiles } from "@/lib/storage/local-private-storage";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
  getDb();
  const { project } = await requireOwnedProject(id);
  const assets = listAssets(id);
  const totalBytes = assets.reduce((sum, item) => sum + item.size_bytes, 0);
  return NextResponse.json({
    project,
    stats: {
      assetCount: assets.length,
      totalBytes,
      queued: assets.filter((item) => item.processing_status === "QUEUED").length,
      completed: assets.filter((item) => item.processing_status === "COMPLETED").length,
      review: assets.filter((item) => item.processing_status === "HUMAN_REVIEW_REQUIRED").length,
    },
  });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
  getDb();
  await requireOwnedProject(id);
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    address?: string | null;
    notes?: string | null;
    status?: string;
  };
  const project = updateProject(id, body);
  if (!project) {
    return NextResponse.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ project });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    getDb();
    await requireOwnedProject(id);
    const assets = listAssets(id);
    const storage = createObjectStorage();
    await Promise.all(assets.map((asset) => storage.delete(asset.storage_key).catch(() => undefined)));
    await deletePrivateProjectFiles(id);
    deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "DELETE_FAILED" }, { status: 500 });
  }
}
