import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import {
  createProject,
  listProjects,
} from "@/lib/db/repositories";
import { accessErrorResponse, requireUser } from "@/lib/auth/project-access";

export const runtime = "nodejs";

export async function GET() {
  try {
    getDb();
    const user = await requireUser();
    return NextResponse.json({ projects: listProjects(user.id) });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    getDb();
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    address?: string;
    notes?: string;
  };
    if (!body.name?.trim()) return NextResponse.json({ error: "PROJECT_NAME_REQUIRED" }, { status: 400 });
    const project = createProject({ name: body.name, address: body.address, notes: body.notes, userId: user.id });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
