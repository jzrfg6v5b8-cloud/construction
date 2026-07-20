"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Download, LoaderCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SceneRendersPanel } from "@/components/rendering/scene-renders-panel";
import { buttonPrimary, buttonSecondary, StatusPill } from "@/components/ui";

type ApprovalRow = {
  id: string;
  role: string;
  decision: string;
  actor_id: string;
  created_at: string;
};

export default function ProposalPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [projectName, setProjectName] = useState(projectId);
  const [assetCount, setAssetCount] = useState(0);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [busy, setBusy] = useState<"draft" | "final" | "approve" | "bootstrap" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [rendersKey, setRendersKey] = useState(0);

  const refreshApprovals = useCallback(async () => {
    const approvalsRes = await fetch(`/api/projects/${projectId}/approvals`);
    const approvalsPayload = (await approvalsRes.json()) as { approvals?: ApprovalRow[] };
    setApprovals(approvalsPayload.approvals ?? []);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/projects/${projectId}`).then((r) => r.json()),
      fetch(`/api/projects/${projectId}/approvals`).then((r) => r.json()),
    ]).then(([projectPayload, approvalsPayload]: [
      { project?: { name: string }; stats?: { assetCount: number } },
      { approvals?: ApprovalRow[] },
    ]) => {
      if (cancelled) return;
      if (projectPayload.project?.name) setProjectName(projectPayload.project.name);
      setAssetCount(projectPayload.stats?.assetCount ?? 0);
      setApprovals(approvalsPayload.approvals ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function exportPdf(status: "DRAFT" | "FINAL") {
    setBusy(status === "FINAL" ? "final" : "draft");
    setMessage(null);
    setBlocks([]);
    try {
      const response = await fetch(`/api/projects/${projectId}/proposal/export?status=${status}`);
      if (response.status === 409) {
        const payload = (await response.json()) as { issues?: string[]; error?: string };
        setBlocks(payload.issues ?? [payload.error ?? "FINAL blocked"]);
        setMessage("FINAL 被审批门禁拦截（这是预期行为，除非条件齐全）");
        return;
      }
      if (response.status === 503) {
        const payload = (await response.json()) as { message?: string; error?: string };
        setMessage(payload.message ?? payload.error ?? "缺少 CJK 字体");
        return;
      }
      if (!response.ok) {
        setMessage(`导出失败 HTTP ${response.status}`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sharkflows-${projectId}-${status.toLowerCase()}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`${status} PDF 已下载`);
    } catch {
      setMessage("网络错误");
    } finally {
      setBusy(null);
    }
  }

  async function bootstrapThenDraft() {
    setBusy("bootstrap");
    setMessage(null);
    setBlocks([]);
    try {
      const boot = await fetch(`/api/projects/${projectId}/bootstrap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verifyFloorplan: true, seedRenders: true }),
      });
      if (!boot.ok) {
        setMessage("准备演示数据失败");
        return;
      }
      setRendersKey((n) => n + 1);
      setMessage("已写入演示户型与场景图，正在导出 PDF…");
      setBusy("draft");
      await exportPdf("DRAFT");
    } catch {
      setMessage("网络错误");
      setBusy(null);
    }
  }

  async function approve() {
    setBusy("approve");
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "designer", decision: "approved" }),
      });
      if (!response.ok) {
        setMessage("审批写入失败");
        return;
      }
      setMessage("已写入审批记录");
      void refreshApprovals();
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell
      current="proposal"
      projectId={projectId}
      projectName={projectName}
      title="方案输出"
      description="导出真实 PDF。DRAFT 随时可下；FINAL 必须通过尺寸/覆盖/BOM/SketchUp/截图/审批门禁。"
      actions={
        <>
          <button className={buttonSecondary} onClick={() => void bootstrapThenDraft()} disabled={busy !== null}>
            {busy === "bootstrap" ? <LoaderCircle className="animate-spin" size={14} /> : <Download size={14} />}
            一键演示 PDF
          </button>
          <button className={buttonSecondary} onClick={() => void approve()} disabled={busy !== null}>
            {busy === "approve" ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={14} />}
            记录审批
          </button>
          <button className={buttonSecondary} onClick={() => void exportPdf("DRAFT")} disabled={busy !== null}>
            {busy === "draft" ? <LoaderCircle className="animate-spin" size={14} /> : <Download size={14} />}
            导出 DRAFT
          </button>
          <button className={buttonPrimary} onClick={() => void exportPdf("FINAL")} disabled={busy !== null}>
            {busy === "final" ? <LoaderCircle className="animate-spin" size={14} /> : <Download size={14} />}
            尝试 FINAL
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <SceneRendersPanel key={rendersKey} projectId={projectId} />
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold">项目交付状态</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">素材数量</dt>
              <dd className="font-semibold">{assetCount}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">审批记录</dt>
              <dd className="font-semibold">{approvals.length}</dd>
            </div>
          </dl>
          {message && <p className="mt-4 text-xs text-teal-700">{message}</p>}
          {blocks.length > 0 && (
            <ul className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              {blocks.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          )}
        </section>

        <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold">审批流水</h2>
          {approvals.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">尚无审批。点「记录审批」写入一条。</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {approvals.map((row) => (
                <li key={row.id} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{row.role}</span>
                    <StatusPill tone={row.decision === "approved" ? "green" : "red"}>
                      {row.decision}
                    </StatusPill>
                  </div>
                  <p className="mt-1 text-slate-400">
                    {row.actor_id} · {new Date(row.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
        </div>
      </div>
    </AppShell>
  );
}
