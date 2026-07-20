import {
  completeGoogleOAuth,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyOAuthState,
} from "@/lib/auth";
import { cookies } from "next/headers";

function trustedOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const origin = trustedOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return Response.redirect(`${origin}/auth?error=${encodeURIComponent(oauthError)}`, 303);
  }
  if (!code || !verifyOAuthState(state)) {
    return Response.redirect(`${origin}/auth?error=${encodeURIComponent("Invalid OAuth state")}`, 303);
  }

  try {
    const result = await completeGoogleOAuth({ code, origin });
    const jar = await cookies();
    jar.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
    return Response.redirect(`${origin}/pricing`, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sign-in failed";
    return Response.redirect(`${origin}/auth?error=${encodeURIComponent(message)}`, 303);
  }
}
