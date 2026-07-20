import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export type StoredAsset = {
  id: string;
  projectId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  sha256: string;
  storagePath: string;
  thumbnailPath: string | null;
  duplicate: boolean;
  processingStatus: "QUEUED";
};

function privateRoot() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return "/tmp/sharkflows-private";
  }
  const configured = process.env.PRIVATE_STORAGE_PATH ?? ".data/private";
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function safeName(value: string) {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
}

export async function storeAssetFile(projectId: string, file: File): Promise<StoredAsset> {
  if (!allowedMimeTypes.has(file.type)) throw new Error(`UNSUPPORTED_TYPE:${file.type || "unknown"}`);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error("INVALID_FILE_SIZE");

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = `ast_${sha256.slice(0, 16)}`;
  const projectDir = path.join(privateRoot(), safeName(projectId), "originals");
  const derivedDir = path.join(privateRoot(), safeName(projectId), "derived", id);
  await Promise.all([mkdir(projectDir, { recursive: true }), mkdir(derivedDir, { recursive: true })]);

  const originalPath = path.join(projectDir, `${id}.blob`);
  let duplicate = false;
  try {
    await readFile(originalPath);
    duplicate = true;
  } catch {
    try {
      await writeFile(originalPath, bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") duplicate = true;
      else throw error;
    }
  }

  let widthPx: number | null = null;
  let heightPx: number | null = null;
  let thumbnailPath: string | null = null;
  if (file.type.startsWith("image/")) {
    const image = sharp(bytes, { failOn: "none" }).rotate();
    const normalized = await image.clone().toBuffer({ resolveWithObject: true });
    widthPx = normalized.info.width;
    heightPx = normalized.info.height;
    thumbnailPath = path.join(derivedDir, "thumbnail.webp");
    await image
      .clone()
      .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(thumbnailPath);
  }

  return {
    id,
    projectId,
    originalFilename: file.name,
    mimeType: file.type,
    sizeBytes: bytes.byteLength,
    widthPx,
    heightPx,
    sha256,
    storagePath: originalPath,
    thumbnailPath,
    duplicate,
    processingStatus: "QUEUED",
  };
}

export function createSignedAssetToken(assetPath: string, expiresAt: number) {
  const secret = process.env.SIGNED_URL_SECRET;
  if (!secret) throw new Error("SIGNED_URL_SECRET_NOT_CONFIGURED");
  const payload = Buffer.from(JSON.stringify({ assetPath, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySignedAssetToken(token: string) {
  const secret = process.env.SIGNED_URL_SECRET;
  if (!secret) return null;
  const [payload, provided] = token.split(".");
  if (!payload || !provided) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { assetPath: string; expiresAt: number };
  if (parsed.expiresAt < Date.now() || !path.resolve(parsed.assetPath).startsWith(privateRoot())) return null;
  return parsed;
}

export async function readPrivateAsset(assetPath: string) {
  if (!path.resolve(assetPath).startsWith(privateRoot())) throw new Error("INVALID_STORAGE_PATH");
  return readFile(assetPath);
}

export async function deletePrivateProjectFiles(projectId: string) {
  const root = privateRoot();
  const target = path.join(root, safeName(projectId));
  if (!target.startsWith(root + path.sep)) throw new Error("INVALID_PROJECT_STORAGE_PATH");
  await rm(target, { recursive: true, force: true });
}
