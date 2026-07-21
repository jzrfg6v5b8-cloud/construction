"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileImage, LoaderCircle, RefreshCw } from "lucide-react";
import { AssetUploader } from "@/components/asset-uploader";
import { MetricCard, StatusPill, buttonSecondary } from "@/components/ui";

export type AssetListItem = {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  processing_status: string;
  asset_type: string;
  created_at: string;
  width_px?: number | null;
  height_px?: number | null;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusTone(status: string): "green" | "amber" | "blue" | "red" | "slate" {
  if (status === "COMPLETED") return "green";
  if (status === "HUMAN_REVIEW_REQUIRED") return "amber";
  if (status === "FAILED") return "red";
  if (status === "QUEUED" || status.includes("RUNNING") || status === "PREPROCESSING") return "blue";
  return "slate";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    QUEUED: "排队中",
    PREPROCESSING: "预处理",
    OCR_RUNNING: "OCR 中",
    VISION_RUNNING: "视觉识别",
    LLM_RECONCILING: "结构化整理",
    HUMAN_REVIEW_REQUIRED: "待人工审核",
    COMPLETED: "已完成",
    FAILED: "失败",
  };
  return map[status] ?? status;
}

export function ProjectAssetsPanel({
  projectId,
  accept,
  emptyHint = "还没有素材。上传户型图、现场照片、商品图或采购表开始。",
  onAssetsChange,
}: {
  projectId: string;
  accept?: string;
  emptyHint?: string;
  onAssetsChange?: (assets: AssetListItem[]) => void;
}) {
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!projectId?.startsWith("prj_")) {
      setError("无效的项目，请从「项目工作区」重新进入");
      setLoading(false);
      return;
    }
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store" });
      const raw = await response.text();
      const payload = (JSON.parse(raw || "{}") || {}) as { assets?: AssetListItem[]; error?: string; hint?: string };
      if (!response.ok) {
        throw new Error(payload.hint ? `${payload.error}: ${payload.hint}` : (payload.error ?? `HTTP_${response.status}`));
      }
      const next = payload.assets ?? [];
      setAssets(next);
      onAssetsChange?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/assets`, { cache: "no-store" })
      .then(async (response) => {
        const raw = await response.text();
        const payload = (JSON.parse(raw || "{}") || {}) as { assets?: AssetListItem[]; error?: string; hint?: string };
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(payload.hint ? `${payload.error}: ${payload.hint}` : (payload.error ?? "LOAD_FAILED"));
        }
        const next = payload.assets ?? [];
        setAssets(next);
        onAssetsChange?.(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "LOAD_FAILED");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const stats = useMemo(() => {
    const totalBytes = assets.reduce((sum, item) => sum + item.size_bytes, 0);
    return {
      total: assets.length,
      images: assets.filter((item) => item.asset_type === "image" || item.mime_type.startsWith("image/")).length,
      review: assets.filter((item) => item.processing_status === "HUMAN_REVIEW_REQUIRED").length,
      done: assets.filter((item) => item.processing_status === "COMPLETED").length,
      totalBytes,
    };
  }, [assets]);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="素材总数" value={String(stats.total)} hint={formatBytes(stats.totalBytes)} />
        <MetricCard label="图片" value={String(stats.images)} hint="含现场与产品图" tone="blue" />
        <MetricCard label="待审核" value={String(stats.review)} hint="需人工确认" tone="amber" />
        <MetricCard label="已处理完成" value={String(stats.done)} hint="处理管线完成" tone="violet" />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <AssetUploader projectId={projectId} onUploaded={() => void load({ silent: true })} accept={accept} />
        <button className={buttonSecondary} onClick={() => void load()} disabled={loading}>
          {loading ? <LoaderCircle className="animate-spin" size={14} /> : <RefreshCw size={14} />}
          刷新
        </button>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading && assets.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-16 text-sm text-slate-500">
            <LoaderCircle className="animate-spin" size={16} /> 加载素材…
          </div>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-16 text-center">
            <FileImage className="text-slate-300" size={36} />
            <p className="max-w-md text-sm text-slate-500">{emptyHint}</p>
            <p className="text-[11px] text-slate-400">
              OCR 需另开 Vision Worker（npm run dev:vision）；未启动时文件仍会安全保存。
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">素材</th>
                  <th className="px-3 py-3">类型</th>
                  <th className="px-3 py-3">大小</th>
                  <th className="px-3 py-3">处理状态</th>
                  <th className="px-3 py-3">上传时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-lg bg-slate-100 text-slate-500">
                          <FileImage size={16} />
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{asset.original_filename}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{asset.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {asset.asset_type}
                      {asset.width_px && asset.height_px ? (
                        <span className="block text-[10px] text-slate-400">
                          {asset.width_px}×{asset.height_px}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">{formatBytes(asset.size_bytes)}</td>
                    <td className="px-3 py-3">
                      <StatusPill tone={statusTone(asset.processing_status)}>
                        {statusLabel(asset.processing_status)}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-3 text-[11px] text-slate-500">
                      {new Date(asset.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
