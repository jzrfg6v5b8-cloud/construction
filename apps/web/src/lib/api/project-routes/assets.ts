import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import {
  cloudListAssets,
  cloudUploadObject,
  cloudUpsertAsset,
  useCloudDb,
} from "@/lib/db/cloud-store";
import { listAssets, touchProjectAsync } from "@/lib/db/repositories";
import { createObjectStorage } from "@/lib/storage";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";

export const runtime = "nodejs";
export const maxDuration = 60;

function objectKeyForAsset(projectId: string, filename: string) {
  const safe = filename.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80);
  return `projects/${projectId}/originals/${randomUUID()}_${safe}`;
}

const MAX_FILES = 10;
/** Vercel serverless request body hard limit is ~4.5MB; stay under it. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function sniffMime(file: File): string {
  if (file.type && ALLOWED_MIME_TYPES.has(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return file.type || "";
}

async function imageMeta(bytes: Buffer, mimeType: string) {
  if (!mimeType.startsWith("image/")) return { widthPx: null as number | null, heightPx: null as number | null };
  try {
    const sharp = (await import("sharp")).default;
    const info = await sharp(bytes, { failOn: "none" }).metadata();
    return { widthPx: info.width ?? null, heightPx: info.height ?? null };
  } catch {
    return { widthPx: null, heightPx: null };
  }
}

/** Compress large images so they fit under the Vercel body limit after re-upload paths. */
async function maybeDownscale(bytes: Buffer, mimeType: string): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!mimeType.startsWith("image/") || bytes.byteLength <= MAX_FILE_BYTES) {
    return { bytes, mimeType };
  }
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { bytes: out, mimeType: "image/jpeg" };
  } catch {
    return { bytes, mimeType };
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  try {
    if (!useCloudDb()) getDb();
    const { user } = await requireOwnedProject(projectId);

    let form: FormData;
    try {
      form = await request.formData();
    } catch (error) {
      return NextResponse.json(
        {
          error: "BODY_TOO_LARGE_OR_INVALID",
          hint: "单张图片请小于 4MB（Vercel 限制）。可先压缩再上传。",
          detail: error instanceof Error ? error.message : "formData_failed",
        },
        { status: 413 },
      );
    }

    const files = form.getAll("files").filter((value): value is File => value instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "至少需要一个文件", code: "FILES_REQUIRED" }, { status: 400 });
    }
    if (files.length > MAX_FILES) return NextResponse.json({ error: "TOO_MANY_FILES" }, { status: 413 });

    const stamp = new Date().toISOString();
    const cloud = useCloudDb();
    const storage = cloud ? null : createObjectStorage();

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const sniffed = sniffMime(file);
          if (!ALLOWED_MIME_TYPES.has(sniffed) && !sniffed.startsWith("image/")) {
            return { filename: file.name, ok: false as const, error: `UNSUPPORTED_TYPE:${sniffed || "unknown"}` };
          }
          if (file.size <= 0) {
            return { filename: file.name, ok: false as const, error: "EMPTY_FILE" };
          }
          if (file.size > MAX_FILE_BYTES) {
            return {
              filename: file.name,
              ok: false as const,
              error: `FILE_TOO_LARGE:${Math.round(file.size / 1024 / 1024)}MB_MAX_4MB`,
            };
          }

          let bytes = Buffer.from(await file.arrayBuffer());
          let mimeType = sniffed || "application/octet-stream";
          const scaled = await maybeDownscale(bytes, mimeType);
          bytes = Buffer.from(scaled.bytes);
          mimeType = scaled.mimeType;

          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const assetId = `ast_${createHash("sha256").update(`${projectId}:${sha256}`).digest("hex").slice(0, 20)}`;
          const key = objectKeyForAsset(projectId, file.name);
          const { widthPx, heightPx } = await imageMeta(bytes, mimeType);
          const assetType = mimeType.startsWith("image/") ? "image" : "document";

          if (cloud) {
            await cloudUploadObject({ key, body: bytes, contentType: mimeType, upsert: true });
            await cloudUpsertAsset({
              id: assetId,
              project_id: projectId,
              user_id: user.id,
              original_filename: file.name,
              mime_type: mimeType,
              size_bytes: bytes.byteLength,
              width_px: widthPx,
              height_px: heightPx,
              sha256,
              storage_key: key,
              thumbnail_key: null,
              processing_status: "QUEUED",
              asset_type: assetType,
              created_at: stamp,
              updated_at: stamp,
            });
            return {
              filename: file.name,
              ok: true as const,
              asset: {
                id: assetId,
                projectId,
                sha256,
                storageKey: key,
                processingStatus: "QUEUED",
                mimeType,
                sizeBytes: bytes.byteLength,
                assetType,
              },
            };
          }

          await storage!.put({ key, body: bytes, contentType: mimeType });
          getDb()
            .sqlite.prepare(
              `INSERT INTO assets (
            id, project_id, original_filename, mime_type, size_bytes, width_px, height_px,
            sha256, storage_key, thumbnail_key, processing_status, asset_type, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
            )
            .run(
              assetId,
              projectId,
              file.name,
              mimeType,
              bytes.byteLength,
              widthPx,
              heightPx,
              sha256,
              key,
              null,
              assetType,
              user.id,
              stamp,
              stamp,
            );

          return {
            filename: file.name,
            ok: true as const,
            asset: {
              id: assetId,
              projectId,
              sha256,
              storageKey: key,
              processingStatus: "QUEUED",
              mimeType,
              sizeBytes: bytes.byteLength,
              assetType,
            },
          };
        } catch (error) {
          return {
            filename: file.name,
            ok: false as const,
            error: error instanceof Error ? error.message : "UPLOAD_FAILED",
          };
        }
      }),
    );

    try {
      await touchProjectAsync(projectId);
    } catch (touchError) {
      console.warn("touchProjectAsync failed after asset upload", touchError);
    }

    return NextResponse.json(
      {
        projectId,
        accepted: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
        results,
      },
      { status: 207 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UPLOAD_FAILED";
    const hint =
      message.includes("ENV_PLACEHOLDER") || message.includes("INVALID_SUPABASE")
        ? "Vercel 环境变量未正确配置，请检查 NEXT_PUBLIC_SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY"
        : message.includes("STORAGE_")
          ? "云存储上传失败，请稍后重试或联系管理员检查 Supabase Storage"
          : undefined;
    return (
      accessErrorResponse(error) ??
      NextResponse.json({ error: message, hint }, { status: 500 })
    );
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  try {
    if (!useCloudDb()) getDb();
    await requireOwnedProject(projectId);
    if (useCloudDb()) {
      return NextResponse.json({ projectId, assets: await cloudListAssets(projectId) });
    }
    return NextResponse.json({ projectId, assets: listAssets(projectId) });
  } catch (error) {
    return (
      accessErrorResponse(error) ??
      NextResponse.json({ error: error instanceof Error ? error.message : "INTERNAL_ERROR" }, { status: 500 })
    );
  }
}
