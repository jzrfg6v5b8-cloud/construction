import { NextRequest, NextResponse } from "next/server";
import { getUserBySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { getProjectAsync } from "@/lib/db/repositories";

function projectIdFrom(pathname: string): string | null {
  const match = pathname.match(/^\/(?:api\/)?projects\/([^/]+)/);
  if (!match) return null;
  if (match[1] === "demo") return "demo";
  return decodeURIComponent(match[1]);
}

export async function proxy(request: NextRequest) {
  const user = getUserBySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  if (!user) {
    if (isApi) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    const login = new URL("/auth", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  // /projects list and /api/projects collection — no project ownership check
  const projectId = projectIdFrom(request.nextUrl.pathname);
  if (!projectId || request.nextUrl.pathname === "/projects" || request.nextUrl.pathname === "/api/projects") {
    return NextResponse.next();
  }

  try {
    const project = await getProjectAsync(projectId);
    if (!project || project.user_id !== user.id) {
      if (isApi) return NextResponse.json({ error: "PROJECT_NOT_FOUND" }, { status: 404 });
      return NextResponse.redirect(new URL("/projects", request.url));
    }
  } catch {
    if (isApi) return NextResponse.json({ error: "PROJECT_LOOKUP_FAILED" }, { status: 503 });
    return NextResponse.redirect(new URL("/projects", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/projects/:path*", "/api/projects/:path*", "/settings/:path*"],
};
