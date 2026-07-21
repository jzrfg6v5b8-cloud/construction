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
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");

  // Local SketchUp bridge poller authenticates with webhook/bridge secret, not session cookie.
  const isBridgeResults =
    request.method === "POST" &&
    /^\/api\/projects\/[^/]+\/sketchup\/results\/?$/.test(pathname) &&
    Boolean(request.headers.get("authorization")?.match(/^Bearer\s+\S+/i));
  if (isBridgeResults) {
    return NextResponse.next();
  }

  const user = getUserBySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    if (isApi) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    const login = new URL("/auth", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // /projects list and /api/projects collection — no project ownership check
  const projectId = projectIdFrom(pathname);
  if (!projectId || pathname === "/projects" || pathname === "/api/projects") {
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
