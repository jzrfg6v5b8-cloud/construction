"use client";

import { useEffect, useState } from "react";
import { CheckSquare, LoaderCircle, Square } from "lucide-react";
import { buttonSecondary, StatusPill } from "@/components/ui";

type Step = {
  key: string;
  done: boolean;
  title: string;
  detail: string;
};

type ChecklistPayload = {
  checklist: {
    open_template: number;
    refresh_and_check: number;
    export_pdf: number;
    template_code: string | null;
    notes: string | null;
  };
  steps: Step[];
  layoutAutomation: boolean;
};

export function LayoutChecklistPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ChecklistPayload | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/projects/${projectId}/layout-checklist`);
    const payload = (await response.json()) as ChecklistPayload;
    setData(payload);
    setNotes(payload.checklist.notes ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/layout-checklist`)
      .then((response) => response.json())
      .then((payload: ChecklistPayload) => {
        if (cancelled) return;
        setData(payload);
        setNotes(payload.checklist.notes ?? "");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function toggle(key: string, done: boolean) {
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, boolean | string> = { updatedBy: "designer" };
      if (key === "open_template") body.openTemplate = !done;
      if (key === "refresh_and_check") body.refreshAndCheck = !done;
      if (key === "export_pdf") body.exportPdf = !done;
      const response = await fetch(`/api/projects/${projectId}/layout-checklist`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setMessage("保存失败");
        return;
      }
      await refresh();
      setMessage("清单已更新");
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/layout-checklist`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes, updatedBy: "designer" }),
      });
      await refresh();
      setMessage("备注已保存");
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <LoaderCircle className="animate-spin" size={16} /> 加载 LayOut 清单…
      </div>
    );
  }

  const doneCount = data.steps.filter((s) => s.done).length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold">LayOut 人工三步清单</h2>
        <StatusPill tone={doneCount === 3 ? "green" : "amber"}>
          {doneCount}/3 · 非全自动
        </StatusPill>
        {message && <span className="text-xs text-teal-700">{message}</span>}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        SketchUp Ruby 无法可靠全自动控制独立 LayOut。模板：
        <code className="mx-1 rounded bg-slate-100 px-1">{data.checklist.template_code ?? "SHARKFLOWS-A3-V1"}</code>
        。勾选表示本机已完成该步。
      </p>
      <ul className="mt-4 space-y-3">
        {data.steps.map((step) => (
          <li key={step.key} className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <button
              type="button"
              className="shrink-0 text-teal-800 disabled:opacity-50"
              disabled={saving}
              onClick={() => void toggle(step.key, step.done)}
              aria-pressed={step.done}
            >
              {step.done ? <CheckSquare size={20} /> : <Square size={20} />}
            </button>
            <div>
              <p className="text-sm font-semibold text-slate-800">{step.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{step.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <label className="mt-4 block text-xs font-medium text-slate-600">
        备注
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例如：模板路径、尺寸黄标已处理…"
        />
      </label>
      <button type="button" className={`${buttonSecondary} mt-2`} disabled={saving} onClick={() => void saveNotes()}>
        保存备注
      </button>
    </section>
  );
}
