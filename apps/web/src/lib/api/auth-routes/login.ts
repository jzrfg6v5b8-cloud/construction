import { AuthError, loginWithEmail, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  return Object.fromEntries(await request.formData());
}

function wantsJson(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") || (request.headers.get("content-type") ?? "").includes("application/json");
}

function trustedOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";

    const result = loginWithEmail({ email, password });

    if (wantsJson(request)) {
      const response = NextResponse.json({ user: result.user });
      response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
      return response;
    }

    const response = NextResponse.redirect(new URL("/projects", trustedOrigin(request)), 303);
    response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return response;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Login failed";
    if (wantsJson(request)) {
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.redirect(
      new URL(`/auth?error=${encodeURIComponent(message)}`, trustedOrigin(request)),
      303,
    );
  }
}
