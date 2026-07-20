import { clearSessionCookieOptions, destroySession, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

  if (wantsJson(request)) {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", clearSessionCookieOptions());
    return response;
  }

  const response = NextResponse.redirect(new URL("/auth", trustedOrigin(request)), 303);
  response.cookies.set(SESSION_COOKIE, "", clearSessionCookieOptions());
  return response;
}

export async function POST(request: Request) {
  return clear(request);
}

export async function GET(request: Request) {
  return clear(request);
}
