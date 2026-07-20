import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import {
  listAssets,
  touchProject,
} from "@/lib/db/repositories";
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
  "image/jpeg", "image/png", "image/webp", "application/pdf", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  try {
  getDb();
  const { user } = await requireOwnedProject(projectId);
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: "至少需要一个文件", code: "FILES_REQUIRED" }, { status: 400 });
  }
  if (files.length > MAX_FILES) return NextResponse.json({ error: "TOO_MANY_FILES" }, { status: 413 });
  const invalid = files.find((file) => !ALLOWED_MIME_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_FILE_BYTES);
  if (invalid) return NextResponse.json({ error: "INVALID_FILE", filename: invalid.name }, { status: 415 });

  const storage = createObjectStorage();
  const queue = await ensureProcessingWorker().catch(() => null);
  const stamp = new Date().toISOString();

  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const bytes = Buffer.from(await file.arrayBuffer());
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const assetId = `ast_${createHash("sha256").update(`${projectId}:${sha256}`).digest("hex").slice(0, 20)}`;
        const key = objectKeyForAsset(projectId, file.name);
        await storage.put({
          key,
          body: bytes,
          contentType: file.type || "application/octet-stream",
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
            file.type || "application/octet-stream",
            bytes.byteLength,
            legacy?.widthPx ?? null,
            legacy?.heightPx ?? null,
            sha256,
            key,
            legacy?.thumbnailPath ?? null,
            file.type.startsWith("image/") ? "image" : "document",
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
            mimeType: file.type,
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
            mimeType: file.type || "application/octet-stream",
            sizeBytes: bytes.byteLength,
            assetType: file.type.startsWith("image/") ? "image" : "document",
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

  touchProject(projectId);

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
    return accessErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : "UPLOAD_FAILED" }, { status: 500 });
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  try {
    getDb();
    await requireOwnedProject(projectId);
    return NextResponse.json({ projectId, assets: listAssets(projectId) });
  } catch (error) {
    return accessErrorResponse(error) ?? NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
