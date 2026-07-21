"use client";

import { useRef, useState } from "react";
import { CloudUpload, LoaderCircle } from "lucide-react";
import { buttonPrimary } from "./ui";

type UploadResult = {
  filename: string;
  ok: boolean;
  error?: string;
  asset?: { id?: string; duplicate?: boolean };
};

type AssetUploaderProps = {
  projectId: string;
  onUploaded?: () => void;
  label?: string;
  accept?: string;
};

export function AssetUploader({
  projectId,
  onUploaded,
  label = "批量上传",
  accept = ".jpg,.jpeg,.png,.webp,.pdf,.csv,.xlsx,.heic",
}: AssetUploaderProps) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (!projectId?.startsWith("prj_")) {
      setResults([{ filename: "—", ok: false, error: "无效的项目 ID" }]);
      return;
    }
    setUploading(true);
    const body = new FormData();
    const prepared: File[] = [];
    for (const file of Array.from(files)) {
      // Vercel request body ~4.5MB — compress big images in the browser first.
      if (file.type.startsWith("image/") && file.size > 3.5 * 1024 * 1024) {
        try {
          const bitmap = await createImageBitmap(file);
          const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
          const width = Math.max(1, Math.round(bitmap.width * scale));
          const height = Math.max(1, Math.round(bitmap.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("CANVAS_UNSUPPORTED");
          ctx.drawImage(bitmap, 0, 0, width, height);
          bitmap.close();
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.82),
          );
          if (!blob) throw new Error("COMPRESS_FAILED");
          prepared.push(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
        } catch {
          prepared.push(file);
        }
      } else {
        prepared.push(file);
      }
    }
    prepared.forEach((file) => body.append("files", file));
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { method: "POST", body });
      const raw = await response.text();
      let payload: { results?: UploadResult[]; error?: string; hint?: string } = {};
      try {
        payload = JSON.parse(raw || "{}") as typeof payload;
      } catch {
        payload = { error: raw.slice(0, 160) || `HTTP_${response.status}` };
      }
      if (!response.ok && !payload.results?.length) {
        setResults(
          prepared.map((file) => ({
            filename: file.name,
            ok: false,
            error: payload.hint ? `${payload.error}: ${payload.hint}` : (payload.error ?? `HTTP_${response.status}`),
          })),
        );
        return;
      }
      setResults(payload.results ?? []);
      if (payload.results?.some((item) => item.ok)) onUploaded?.();
    } catch (error) {
      setResults(
        prepared.map((file) => ({
          filename: file.name,
          ok: false,
          error: error instanceof Error ? error.message : "NETWORK_ERROR",
        })),
      );
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="relative">
      <input
        ref={input}
        className="sr-only"
        type="file"
        multiple
        accept={accept}
        onChange={(event) => void upload(event.target.files)}
      />
      <button className={buttonPrimary} onClick={() => input.current?.click()} disabled={uploading}>
        {uploading ? <LoaderCircle className="animate-spin" size={14} /> : <CloudUpload size={14} />}
        {uploading ? "处理中…" : label}
      </button>
      {results.length > 0 && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl">
          <p className="mb-2 font-semibold">上传结果</p>
          <div className="max-h-48 space-y-1 overflow-auto">
            {results.map((result) => (
              <p key={result.filename} className={result.ok ? "text-emerald-700" : "text-red-700"}>
                {result.ok ? "✓" : "×"} {result.filename}
                {result.asset?.duplicate ? " · 重复文件" : result.error ? ` · ${result.error}` : ""}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
