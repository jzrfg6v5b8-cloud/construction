import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string[] }> };
type HandlerModule = {
  GET?: (request: Request, context?: unknown) => Promise<Response> | Response;
  POST?: (request: Request, context?: unknown) => Promise<Response> | Response;
};

const LOADERS: Record<string, () => Promise<HandlerModule>> = {
  checkout: () => import("@/lib/api/billing-routes/checkout"),
  portal: () => import("@/lib/api/billing-routes/portal"),
  status: () => import("@/lib/api/billing-routes/status"),
  webhook: () => import("@/lib/api/billing-routes/webhook"),
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
