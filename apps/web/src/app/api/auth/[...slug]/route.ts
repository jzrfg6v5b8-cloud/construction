import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string[] }> };
type HandlerModule = {
  GET?: (request: Request, context?: unknown) => Promise<Response> | Response;
  POST?: (request: Request, context?: unknown) => Promise<Response> | Response;
};

const LOADERS: Record<string, () => Promise<HandlerModule>> = {
  login: () => import("@/lib/api/auth-routes/login"),
  logout: () => import("@/lib/api/auth-routes/logout"),
  register: () => import("@/lib/api/auth-routes/register"),
  session: () => import("@/lib/api/auth-routes/session"),
  google: () => import("@/lib/api/auth-routes/google"),
  "google/callback": () => import("@/lib/api/auth-routes/google-callback"),
};

async function dispatch(method: keyof HandlerModule, request: NextRequest, context: Ctx) {
  const { slug } = await context.params;
  const key = (slug ?? []).join("/");
  const loader = LOADERS[key];
  if (!loader) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  const mod = await loader();
  const handler = mod[method];
  if (!handler) return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  return handler(request);
}

export async function GET(request: NextRequest, context: Ctx) {
  return dispatch("GET", request, context);
}
export async function POST(request: NextRequest, context: Ctx) {
  return dispatch("POST", request, context);
}
