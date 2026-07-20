import { clearSessionCookieOptions, destroySession, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";

function wantsJson(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") || (request.headers.get("content-type") ?? "").includes("application/json");
}

function trustedOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

async function clear(request: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  destroySession(token);
  jar.set(SESSION_COOKIE, "", clearSessionCookieOptions());

  if (wantsJson(request)) {
    return Response.json({ ok: true });
  }
  return Response.redirect(`${trustedOrigin(request)}/auth`, 303);
}

export async function POST(request: Request) {
  return clear(request);
}

export async function GET(request: Request) {
  return clear(request);
}
