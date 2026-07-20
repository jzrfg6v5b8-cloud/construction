import { getSessionUser, type AuthUser } from "@/lib/auth/session";
import { getProject, type ProjectRecord } from "@/lib/db/repositories";

export class AccessError extends Error {
  constructor(
    public readonly code: "AUTH_REQUIRED" | "PROJECT_NOT_FOUND",
    public readonly status: 401 | 404,
  ) {
    super(code);
  }
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) throw new AccessError("AUTH_REQUIRED", 401);
  return user;
}

export async function requireOwnedProject(projectId: string): Promise<{
  user: AuthUser;
  project: ProjectRecord;
}> {
  const user = await requireUser();
  const project = getProject(projectId);
  if (!project || project.user_id !== user.id) {
    // Deliberately hide whether another user's project exists.
    throw new AccessError("PROJECT_NOT_FOUND", 404);
  }
  return { user, project };
}

export function accessErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AccessError)) return null;
  return Response.json({ error: error.code }, { status: error.status });
}
