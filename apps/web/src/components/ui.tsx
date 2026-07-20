import { AlertTriangle, Check, CircleDashed, Info } from "lucide-react";

export function DemoNotice({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
      <Info size={14} className="mt-0.5 shrink-0" />
      <span>{children ?? "演示数据 · 用于界面预览，不代表真实识别或生产结果"}</span>
    </div>
  );
}

export function StatusPill({
  tone = "slate",
  children,
}: {
  tone?: "green" | "amber" | "red" | "blue" | "slate" | "violet";
  children: React.ReactNode;
}) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
    amber: "bg-amber-50 text-amber-700 ring-amber-600/15",
    red: "bg-rose-50 text-rose-700 ring-rose-600/15",
    blue: "bg-sky-50 text-sky-700 ring-sky-600/15",
    slate: "bg-slate-100 text-slate-600 ring-slate-600/10",
    violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "teal",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "teal" | "amber" | "blue" | "violet";
}) {
  const dots = {
    teal: "bg-teal-500",
    amber: "bg-amber-500",
    blue: "bg-sky-500",
    violet: "bg-violet-500",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className={`size-2 rounded-full ${dots[tone]}`} />
        {label}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "teal",
}: {
  value: number;
  tone?: "teal" | "amber" | "red" | "blue";
}) {
  const colors = {
    teal: "bg-teal-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
    blue: "bg-sky-500",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function ReviewState({
  state,
}: {
  state: "done" | "warning" | "pending";
}) {
  if (state === "done")
    return <Check size={15} className="text-emerald-600" aria-label="已完成" />;
  if (state === "warning")
    return <AlertTriangle size={15} className="text-amber-600" aria-label="需注意" />;
  return <CircleDashed size={15} className="text-slate-400" aria-label="待处理" />;
}

export const buttonPrimary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#0f766e] px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#115e59]";

export const buttonSecondary =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50";
