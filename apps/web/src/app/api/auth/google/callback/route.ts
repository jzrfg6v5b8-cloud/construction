import {
  completeGoogleOAuth,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyOAuthState,
} from "@/lib/auth";
import { NextResponse } from "next/server";

function trustedOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

function redirect(origin: string, path: string) {
  return NextResponse.redirect(new URL(path, origin), 303);
}

export async function GET(request: Request) {
  const origin = trustedOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirect(origin, `/auth?error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !verifyOAuthState(state)) {
    return redirect(origin, `/auth?error=${encodeURIComponent("Invalid OAuth state")}`);
  }

  try {
    const result = await completeGoogleOAuth({ code, origin });
    const response = redirect(origin, "/projects");
    response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sign-in failed";
    return redirect(origin, `/auth?error=${encodeURIComponent(message)}`);
  }
}
