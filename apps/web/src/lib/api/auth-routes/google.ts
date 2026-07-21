import { buildGoogleAuthorizationUrl, getGoogleProviderStatus } from "@/lib/auth";

function trustedOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const status = getGoogleProviderStatus();
  if (!status.available) {
    return Response.json(
      { error: "unavailable", reason: status.reason },
      { status: 503 },
    );
  }

  try {
    const { url } = buildGoogleAuthorizationUrl(trustedOrigin(request));
    return Response.redirect(url, 302);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Google OAuth unavailable" },
      { status: 503 },
    );
  }
}
