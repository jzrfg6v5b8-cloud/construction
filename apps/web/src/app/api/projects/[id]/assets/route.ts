import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { getDb } from "@/lib/db/client";
import {
  cloudListAssets,
  cloudUploadObject,
  cloudUpsertAsset,
  useCloudDb,
} from "@/lib/db/cloud-store";
import { listAssets, touchProjectAsync } from "@/lib/db/repositories";
import { ensureProcessingWorker } from "@/lib/queue/processing";
import { createObjectStorage } from "@/lib/storage";
import { storeAssetFile } from "@/lib/storage/local-private-storage";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";

export const runtime = "nodejs";

function objectKeyForAsset(projectId: string, filename: string) {
  const safe = filename.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80);
  return `projects/${projectId}/originals/${randomUUID()}_${safe}`;
}

const MAX_FILES = 20;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
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
    const info = await sharp(bytes, { failOn: "none" }).metadata();
    return { widthPx: info.width ?? null, heightPx: info.height ?? null };
  } catch {
    return { widthPx: null, heightPx: null };
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  try {
    if (!useCloudDb()) getDb();
    const { user } = await requireOwnedProject(projectId);
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "至少需要一个文件", code: "FILES_REQUIRED" }, { status: 400 });
    }
    if (files.length > MAX_FILES) return NextResponse.json({ error: "TOO_MANY_FILES" }, { status: 413 });
    const invalid = files.find((file) => {
      const mime = sniffMime(file);
      return !ALLOWED_MIME_TYPES.has(mime) || file.size <= 0 || file.size > MAX_FILE_BYTES;
    });
    if (invalid) {
      return NextResponse.json(
        {
          error: "INVALID_FILE",
          filename: invalid.name,
          hint: sniffMime(invalid) || "unknown_type",
        },
        { status: 415 },
      );
    }

    const stamp = new Date().toISOString();
    const cloud = useCloudDb();
    const storage = cloud ? null : createObjectStorage();
    const queue = cloud ? null : await ensureProcessingWorker().catch(() => null);

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const bytes = Buffer.from(await file.arrayBuffer());
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const assetId = `ast_${createHash("sha256").update(`${projectId}:${sha256}`).digest("hex").slice(0, 20)}`;
          const key = objectKeyForAsset(projectId, file.name);
          const mimeType = sniffMime(file) || "application/octet-stream";
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

          await storage!.put({
            key,
            body: bytes,
            contentType: mimeType,
          });
          const legacy = await storeAssetFile(projectId, file);

          getDb()
            .sqlite.prepare(
              `INSERT INTO assets (
            id, project_id, original_filename, mime_type, size_bytes, width_px, height_px,
            sha256, storage_key, thumbnail_key, processing_status, asset_type, user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            updated_at = excluded.updated_at,
            thumbnail_key = COALESCE(excluded.thumbnail_key, assets.thumbnail_key),
            processing_status = excluded.processing_status`,
            )
            .run(
              assetId,
              projectId,
              file.name,
              mimeType,
              bytes.byteLength,
              legacy?.widthPx ?? widthPx,
              legacy?.heightPx ?? heightPx,
              sha256,
              key,
              legacy?.thumbnailPath ?? null,
              assetType,
              user.id,
              stamp,
              stamp,
            );

          let job = null;
          if (queue) {
            job = await queue.enqueue({
              fileId: assetId,
              batchId: projectId,
              sourceUrl: legacy?.storagePath ?? key,
              mimeType,
              metadata: { filename: file.name, objectKey: key },
            });
            if (job) {
              getDb()
                .sqlite.prepare(
                  `INSERT INTO processing_jobs (
                id, job_id, batch_id, file_id, idempotency_key, status, progress,
                attempts_made, max_attempts, source_url, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, progress = excluded.progress, updated_at = excluded.updated_at`,
                )
                .run(
                  `pj_${job.jobId}`,
                  job.jobId,
                  projectId,
                  assetId,
                  job.idempotencyKey,
                  job.status,
                  job.progress,
                  job.attemptsMade,
                  job.maxAttempts,
                  legacy?.storagePath ?? key,
                  stamp,
                  stamp,
                );
            }
          }

          return {
            filename: file.name,
            ok: true as const,
            asset: {
              id: assetId,
              projectId,
              sha256,
              storageKey: key,
              thumbnailPath: legacy?.thumbnailPath ?? null,
              processingStatus: job?.status ?? "QUEUED",
              jobId: job?.jobId,
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

    await touchProjectAsync(projectId);

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
    return (
      accessErrorResponse(error) ??
      NextResponse.json({ error: error instanceof Error ? error.message : "UPLOAD_FAILED" }, { status: 500 })
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
