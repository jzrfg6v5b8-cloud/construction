import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; slug: string[] }> };
type HandlerModule = {
  GET?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response;
  POST?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response;
  PUT?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response;
  PATCH?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response;
  DELETE?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response;
};

const LOADERS: Record<string, () => Promise<HandlerModule>> = {
  assets: () => import("@/lib/api/project-routes/assets"),
  bootstrap: () => import("@/lib/api/project-routes/bootstrap"),
  floorplan: () => import("@/lib/api/project-routes/floorplan"),
  renders: () => import("@/lib/api/project-routes/renders"),
  commerce: () => import("@/lib/api/project-routes/commerce"),
  approvals: () => import("@/lib/api/project-routes/approvals"),
  "layout-checklist": () => import("@/lib/api/project-routes/layout-checklist"),
  "vision/jobs": () => import("@/lib/api/project-routes/vision-jobs"),
  "sketchup/configuration": () => import("@/lib/api/project-routes/sketchup-configuration"),
  "sketchup/results": () => import("@/lib/api/project-routes/sketchup-results"),
  "sketchup/sync-complete": () => import("@/lib/api/project-routes/sketchup-sync-complete"),
  "ai/reconcile": () => import("@/lib/api/project-routes/ai-reconcile"),
  "proposal/export": () => import("@/lib/api/project-routes/proposal-export"),
};

async function dispatch(method: keyof HandlerModule, request: NextRequest, context: Ctx) {
  const { id, slug } = await context.params;
  const key = (slug ?? []).join("/");
  const loader = LOADERS[key];
  if (!loader) {
    return Response.json({ error: "NOT_FOUND", path: key }, { status: 404 });
  }
  const mod = await loader();
  const handler = mod[method];
  if (!handler) {
    return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }
  return handler(request, { params: Promise.resolve({ id }) });
}

export async function GET(request: NextRequest, context: Ctx) {
  return dispatch("GET", request, context);
}
export async function POST(request: NextRequest, context: Ctx) {
  return dispatch("POST", request, context);
}
export async function PUT(request: NextRequest, context: Ctx) {
  return dispatch("PUT", request, context);
}
export async function PATCH(request: NextRequest, context: Ctx) {
  return dispatch("PATCH", request, context);
}
export async function DELETE(request: NextRequest, context: Ctx) {
  return dispatch("DELETE", request, context);
}
