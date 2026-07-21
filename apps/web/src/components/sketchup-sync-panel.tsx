"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Download,
  ExternalLink,
  FileJson2,
  FileText,
  LoaderCircle,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { buttonPrimary, buttonSecondary, ProgressBar, StatusPill } from "./ui";

type TaskStatus =
  | "QUEUED"
  | "DOWNLOADED"
  | "MODEL_BUILDING"
  | "MODEL_VALIDATING"
  | "LAYOUT_REFRESH_REQUIRED"
  | "EXPORTING"
  | "COMPLETED"
  | "FAILED";

type ModelTask = {
  id: string;
  status: TaskStatus;
  progress: number;
  modelVersion?: string;
  error?: { code?: string; message?: string } | string | null;
  missingComponents?: string[];
  exports?: Array<{ kind: string; filename: string; sizeBytes?: number }>;
  results?: Array<{ id?: string; filename: string; contentType?: string; sizeBytes?: number; storageKey?: string }>;
  components?: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    skuCounts: Record<string, number>;
  };
  componentStats?: Array<{
    sku: string;
    name: string;
    quantity: number;
  }>;
};

const stages: TaskStatus[] = [
  "QUEUED",
  "DOWNLOADED",
  "MODEL_BUILDING",
  "MODEL_VALIDATING",
  "LAYOUT_REFRESH_REQUIRED",
  "EXPORTING",
  "COMPLETED",
];

function isLocalHost() {
  if (typeof window === "undefined") return true;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export function SketchUpSyncPanel({ projectId }: { projectId: string }) {
  const [task, setTask] = useState<ModelTask | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"cloud" | "local">("cloud");
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMode(isLocalHost() ? "local" : "cloud");
  }, []);

  function bridgeSettings() {
    return {
      url: localStorage.getItem("sharkflows.bridgeUrl") ?? "http://127.0.0.1:43821",
      token: localStorage.getItem("sharkflows.bridgeToken") ?? "",
    };
  }

  function stopPolling() {
    if (polling.current) {
      clearInterval(polling.current);
      polling.current = null;
    }
  }

  async function pullCloudTask(taskId: string) {
    const response = await fetch(
      `/api/projects/${projectId}/sketchup/results?taskId=${encodeURIComponent(taskId)}`,
    );
    if (!response.ok) throw new Error(`读取云任务失败（HTTP ${response.status}）`);
    const payload = (await response.json()) as { task?: ModelTask };
    if (!payload.task) throw new Error("TASK_NOT_FOUND");
    setTask(payload.task);
    if (payload.task.status === "COMPLETED" || payload.task.status === "FAILED") {
      stopPolling();
      if (payload.task.status === "COMPLETED") {
        setMessage("云队列任务已完成；PNG 已入库时可在场景页查看");
      }
    }
  }

  async function pullLocalTask(taskId: string) {
    const bridge = bridgeSettings();
    const response = await fetch(`${bridge.url}/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${bridge.token}` },
    });
    if (!response.ok) throw new Error(`读取任务失败（HTTP ${response.status}）`);
    const current = (await response.json()) as ModelTask;
    setTask(current);
    if (current.status === "COMPLETED" || current.status === "FAILED") {
      stopPolling();
    }
  }

  async function send() {
    setSending(true);
    setMessage(null);
    stopPolling();
    try {
      if (mode === "cloud" || !isLocalHost()) {
        const response = await fetch(`/api/projects/${projectId}/sketchup/configuration`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enqueue: true }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          task?: ModelTask;
          mode?: string;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? payload.error ?? `HTTP_${response.status}`);
        }
        if (!payload.task) {
          throw new Error("云队列未返回任务（请确认本机桥接已配置 SKETCHUP_CLOUD_URL）");
        }
        setTask(payload.task);
        setMode("cloud");
        setMessage(
          "已写入云队列。请保持本机 npm run dev:bridge（带云环境变量）运行，SketchUp 插件会自动领取。",
        );
        polling.current = setInterval(
          () => void pullCloudTask(payload.task!.id).catch((error) => setMessage(error.message)),
          2000,
        );
        return;
      }

      const configResponse = await fetch(`/api/projects/${projectId}/sketchup/configuration`);
      if (!configResponse.ok) {
        const payload = (await configResponse.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(payload.message ?? payload.error ?? "方案尚未通过SketchUp导出预检");
      }
      const configuration = await configResponse.json();
      const bridge = bridgeSettings();
      if (!bridge.token) throw new Error("请先在SketchUp集成设置中保存本地桥接Token");
      const response = await fetch(`${bridge.url}/v1/tasks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bridge.token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `${configuration.projectId}:${configuration.geometryVersion}`,
        },
        body: JSON.stringify({
          configuration,
          requestedOutputs: ["SKP", "SCENE_PNG", "COMPONENT_STATS", "LAYOUT_HANDOFF"],
        }),
      });
      if (!response.ok) throw new Error(`桥接拒绝任务（HTTP ${response.status}）`);
      const created = (await response.json()) as ModelTask;
      setTask(created);
      polling.current = setInterval(
        () => void pullLocalTask(created.id).catch((error) => setMessage(error.message)),
        1500,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => () => stopPolling(), []);

  const errorText =
    typeof task?.error === "string"
      ? task.error
      : task?.error && typeof task.error === "object"
        ? task.error.message
        : null;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-xs leading-5 text-teal-950">
        <strong>当前模式：{mode === "cloud" ? "云队列（可在线上站使用）" : "本机直连桥接"}</strong>
        <p className="mt-1">
          线上 Vercel：点「发送到SketchUp」写入云端任务；本机运行{" "}
          <code className="rounded bg-teal-100 px-1">npm run dev:bridge</code>（配置{" "}
          <code className="rounded bg-teal-100 px-1">SKETCHUP_CLOUD_URL</code> +{" "}
          <code className="rounded bg-teal-100 px-1">SKETCHUP_BRIDGE_SECRET</code> +{" "}
          <code className="rounded bg-teal-100 px-1">SKETCHUP_PROJECT_ID</code>
          ）领取任务。浏览器不再直连 127.0.0.1。
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="队列模式" value={mode === "cloud" ? "Cloud" : "Local"} hint={mode === "cloud" ? "Vercel ↔ 本机桥接" : "浏览器 ↔ 127.0.0.1"} />
        <Card label="任务状态" value={task?.status ?? "尚未同步"} hint={task ? `任务 ${task.id}` : "等待发送"} />
        <Card
          label="进度"
          value={task ? `${Math.round(task.progress)}%` : "—"}
          hint="插件建模与导出"
        />
        <Card label="LayOut" value="半自动交接" hint="打开模板 · 刷新引用 · 导出" />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">建模任务</h2>
              {task && (
                <StatusPill
                  tone={task.status === "FAILED" ? "red" : task.status === "COMPLETED" ? "green" : "blue"}
                >
                  {task.status}
                </StatusPill>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">按几何版本幂等入队；重复发送不会重复建模。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className={buttonSecondary} href={`/api/projects/${projectId}/sketchup/configuration?download=1`}>
              <FileJson2 size={14} />
              导出SpaceConfiguration
            </a>
            <button className={buttonPrimary} onClick={() => void send()} disabled={sending}>
              {sending ? <LoaderCircle className="animate-spin" size={14} /> : <Send size={14} />}
              发送到SketchUp
            </button>
          </div>
        </div>
        {message && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <Box size={14} className="mt-0.5 shrink-0" />
            {message}
          </div>
        )}
        {errorText && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <XCircle size={14} />
            {errorText}
          </div>
        )}
        <div className="mt-6">
          <ProgressBar value={task?.progress ?? 0} tone={task?.status === "FAILED" ? "red" : "teal"} />
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            {stages.map((stage) => {
              const current = task ? stages.indexOf(task.status) : -1;
              const index = stages.indexOf(stage);
              return (
                <div
                  key={stage}
                  className={`rounded-lg border px-2 py-2 text-[10px] font-semibold ${
                    index <= current
                      ? "border-teal-200 bg-teal-50 text-teal-700"
                      : "border-slate-100 bg-slate-50 text-slate-400"
                  }`}
                >
                  {stage}
                </div>
              );
            })}
          </div>
        </div>
        {task?.missingComponents?.length ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle size={15} />
            <span>缺失组件：{task.missingComponents.join("、")}</span>
          </div>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button
            className={buttonSecondary}
            onClick={() => task && void (mode === "cloud" ? pullCloudTask(task.id) : pullLocalTask(task.id))}
            disabled={!task}
          >
            <RefreshCw size={14} />
            刷新状态
          </button>
          <a href="/settings/sketchup" className={`${buttonSecondary} inline-flex items-center gap-1`}>
            桥接设置 <ExternalLink size={12} />
          </a>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">输出结果</h2>
        <div className="mt-4 space-y-2">
          {(task?.results ?? []).map((file) => (
            <div key={file.filename} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3">
              <FileText size={16} className="text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{file.filename}</p>
                <p className="text-[10px] text-slate-400">
                  {file.contentType}
                  {file.sizeBytes ? ` · ${Math.round(file.sizeBytes / 1024)} KB` : ""}
                </p>
              </div>
              {file.storageKey ? (
                <span className="text-[10px] text-emerald-700">已入库</span>
              ) : (
                <Download size={14} className="text-slate-300" />
              )}
            </div>
          ))}
          {!task?.results?.length && (
            <div className="grid h-28 place-items-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
              <span className="text-center">
                <Box className="mx-auto mb-2" size={20} />
                等待插件回传 SKP / PNG
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-bold">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}
