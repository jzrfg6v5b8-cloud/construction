import { NextResponse } from "next/server";
import { createObjectStorage } from "@/lib/storage";
import { readPrivateAsset, verifySignedAssetToken } from "@/lib/storage/local-private-storage";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "链接无效或已过期" }, { status: 403 });

  const verified = verifySignedAssetToken(token);
  if (verified) {
    try {
    const bytes = await readPrivateAsset(verified.assetPath);
    return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Cache-Control": "private, max-age=60",
          "Content-Type": "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
  }

  // Optional object-storage key token: base64url({key,expiresAt}).hmac
  try {
    const [payload, provided] = token.split(".");
    if (!payload || !provided) throw new Error("bad");
    const secret = process.env.SIGNED_URL_SECRET;
    if (!secret) throw new Error("no secret");
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const expected = createHmac("sha256", secret).update(payload).digest("base64url");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad sig");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      key?: string;
      expiresAt: number;
    };
    if (!parsed.key || parsed.expiresAt < Date.now()) throw new Error("expired");
    if (parsed.key.includes("..") || path.isAbsolute(parsed.key)) throw new Error("bad key");
    const bytes = await createObjectStorage().get(parsed.key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, max-age=60",
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "链接无效或已过期" }, { status: 403 });
  }
}
