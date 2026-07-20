import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { getUserBySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
  await requireOwnedProject(id);
  const approvals = getDb().sqlite
    .prepare("SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at ASC")
    .all(id);
  return NextResponse.json({ projectId: id, approvals });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
  const { user } = await requireOwnedProject(id);
  const jar = await cookies();
  const user = getUserBySessionToken(jar.get(SESSION_COOKIE)?.value);
  const body = await request.json().catch(() => ({})) as {
    role?: string;
    decision?: "approved" | "rejected";
    notes?: string;
    actorId?: string;
    sceneVersion?: string;
  };
  if (!body.role || (body.decision !== "approved" && body.decision !== "rejected")) {
    return NextResponse.json({ error: "INVALID_APPROVAL" }, { status: 400 });
  }
  const reviewers = new Set((process.env.DESIGN_REVIEWER_EMAILS ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (body.role === "designer" && !reviewers.has(user.email.toLowerCase())) {
    return NextResponse.json({ error: "DESIGN_REVIEWER_REQUIRED" }, { status: 403 });
  }
  const row = {
    id: `apr_${randomBytes(8).toString("hex")}`,
    project_id: id,
    role: body.role,
    decision: body.decision,
    actor_id: user.id,
    scene_version: body.sceneVersion ?? null,
    payload_json: body.notes ? JSON.stringify({ notes: body.notes }) : null,
    created_at: new Date().toISOString(),
  };
  getDb().sqlite.prepare(
    `INSERT INTO approvals (id, project_id, role, decision, actor_id, scene_version, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.project_id,
    row.role,
    row.decision,
    row.actor_id,
    row.scene_version,
    row.payload_json,
    row.created_at,
  );
  return NextResponse.json({ ok: true, approval: row });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
