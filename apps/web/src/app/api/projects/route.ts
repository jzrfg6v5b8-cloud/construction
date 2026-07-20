import { NextResponse } from "next/server";
import {
  createProjectAsync,
  listProjectsAsync,
} from "@/lib/db/repositories";
import { accessErrorResponse, requireUser } from "@/lib/auth/project-access";
import { useCloudDb } from "@/lib/db/cloud-store";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!useCloudDb()) getDb();
    const user = await requireUser();
    return NextResponse.json({ projects: await listProjectsAsync(user.id) });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!useCloudDb()) getDb();
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      address?: string;
      notes?: string;
    };
    if (!body.name?.trim()) return NextResponse.json({ error: "PROJECT_NAME_REQUIRED" }, { status: 400 });
    const project = await createProjectAsync({
      name: body.name,
      address: body.address,
      notes: body.notes,
      userId: user.id,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    return accessErrorResponse(error) ?? NextResponse.json({ error: message }, { status: 500 });
  }
}
