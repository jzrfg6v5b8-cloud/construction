"use client";

import { useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { buttonPrimary } from "@/components/ui";

type FloorPlanImportPanelProps = {
  projectId: string;
  lastAssetId?: string | null;
  onDone?: () => void;
};

export function FloorPlanImportPanel({ projectId, lastAssetId, onDone }: FloorPlanImportPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze(assetId?: string | null) {
    if (!assetId) {
      setError("请先上传一张户型平面图");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/bootstrap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId, generateRenders: true, analyze: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        hint?: string;
        visionUsed?: boolean;
        seededScenes?: string[];
        visionWarnings?: string[];
      };
      if (!response.ok || !payload.ok) {
        setError(payload.hint ? `${payload.error}: ${payload.hint}` : (payload.error ?? `HTTP_${response.status}`));
        return;
      }
      const mode = payload.visionUsed ? "OCR+结构识别" : "离线启发式";
      setMessage(`已生成户型草稿 + ${payload.seededScenes?.length ?? 0} 张概念图（${mode}）`);
      onDone?.();
      router.push(`/projects/${projectId}/scene-builder`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ANALYZE_FAILED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-teal-200 bg-teal-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-teal-950">从户型图一键生成</h3>
          <p className="mt-1 text-xs leading-5 text-teal-900/80">
            上传平面图后点这里：自动识别墙体 → 生成 8 张概念图 → 进入场景编辑调材质/摆商品。
          </p>
        </div>
        <button className={buttonPrimary} disabled={busy} onClick={() => void analyze(lastAssetId)}>
          {busy ? <LoaderCircle className="animate-spin" size={14} /> : <Sparkles size={14} />}
          {busy ? "识别生成中…" : "一键生成户型+概念图"}
        </button>
      </div>
      {message && <p className="mt-3 text-xs font-medium text-emerald-800">{message}</p>}
      {error && <p className="mt-3 text-xs text-rose-700">{error}</p>}
      {!lastAssetId && (
        <p className="mt-3 text-xs text-amber-800">提示：先在下方「参考素材」上传户型图，再点一键生成。</p>
      )}
    </section>
  );
}
