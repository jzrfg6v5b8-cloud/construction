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
    setUploading(true);
    const body = new FormData();
    Array.from(files).forEach((file) => body.append("files", file));
    try {
      const response = await fetch(`/api/projects/${projectId}/assets`, { method: "POST", body });
      const payload = (await response.json()) as { results?: UploadResult[] };
      setResults(payload.results ?? []);
      if (payload.results?.some((item) => item.ok)) onUploaded?.();
    } catch {
      setResults(Array.from(files).map((file) => ({ filename: file.name, ok: false, error: "NETWORK_ERROR" })));
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
