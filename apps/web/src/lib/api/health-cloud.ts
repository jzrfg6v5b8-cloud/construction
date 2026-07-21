import { NextResponse } from "next/server";

export const runtime = "nodejs";

function clean(value: string | undefined) {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}

/** Non-secret diagnostics for cloud upload/auth configuration. */
export async function GET() {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const urlOk = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url);
  const serviceKeyOk = serviceKey.startsWith("eyJ") && serviceKey.split(".").length === 3 && serviceKey.length > 80;
  const anonKeyOk = anonKey.startsWith("eyJ") && anonKey.split(".").length === 3;

  let restReachable: string = "skipped";
  let storageReachable: string = "skipped";
  let storageUploadProbe: string = "skipped";

  if (urlOk && serviceKeyOk) {
    const base = url.replace(/\/$/, "");
    try {
      const response = await fetch(`${base}/rest/v1/sf_projects?select=id&limit=1`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
      });
      const text = await response.text();
      restReachable = `${response.status}:${text.slice(0, 80)}`;
    } catch (error) {
      restReachable = `throw:${error instanceof Error ? error.message : "unknown"}`;
    }

    try {
      const response = await fetch(`${base}/storage/v1/bucket/project-assets`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
      });
      const text = await response.text();
      storageReachable = `${response.status}:${text.slice(0, 80)}`;
    } catch (error) {
      storageReachable = `throw:${error instanceof Error ? error.message : "unknown"}`;
    }

    try {
      const probeKey = `health/probe-${Date.now()}.png`;
      const probeBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      const encodedKey = probeKey.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`${base}/storage/v1/object/project-assets/${encodedKey}`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "image/png",
          "x-upsert": "true",
        },
        body: probeBytes,
        cache: "no-store",
      });
      const text = await response.text();
      storageUploadProbe = `${response.status}:${text.slice(0, 80)}`;
    } catch (error) {
      storageUploadProbe = `throw:${error instanceof Error ? error.message : "unknown"}`;
    }
  }

  const placeholderEnv =
    url === "[SENSITIVE]" ||
    serviceKey === "[SENSITIVE]" ||
    anonKey === "[SENSITIVE]";

  return NextResponse.json({
    vercel: Boolean(process.env.VERCEL),
    placeholderEnv,
    urlOk,
    urlHost: urlOk ? new URL(url).host : url.slice(0, 24) || null,
    serviceKeyOk,
    serviceKeyLen: serviceKey.length,
    anonKeyOk,
    restReachable,
    storageReachable,
    storageUploadProbe,
  });
}
