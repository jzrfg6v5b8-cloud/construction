import { AuthError, registerWithEmail, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { cookies } from "next/headers";

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
    const name = typeof body.name === "string" ? body.name : undefined;

    const result = registerWithEmail({ email, password, name });
    const jar = await cookies();
    jar.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));

    if (wantsJson(request)) {
      return Response.json({ user: result.user }, { status: 201 });
    }
    return Response.redirect(`${trustedOrigin(request)}/pricing`, 303);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Registration failed";
    if (wantsJson(request)) {
      return Response.json({ error: message }, { status });
    }
    return Response.redirect(
      `${trustedOrigin(request)}/auth?error=${encodeURIComponent(message)}`,
      303,
    );
  }
}
