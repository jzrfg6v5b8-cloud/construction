"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, LoaderCircle, PlugZap, ShieldCheck, Unplug } from "lucide-react";
import { buttonPrimary, buttonSecondary, StatusPill } from "./ui";

type Connection = {
  connected: boolean;
  bridgeVersion?: string;
  extensionVersion?: string;
  sketchupVersion?: string;
  pendingTasks?: number;
  error?: string;
};

type ProjectItem = {
  id: string;
  name: string;
};

const DEFAULT_URL = "http://127.0.0.1:43821";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isLocalWebApp() {
  if (typeof window === "undefined") return true;
  return LOCAL_HOSTS.has(window.location.hostname);
}

export function SketchUpConnection() {
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_URL);
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [connection, setConnection] = useState<Connection>({ connected: false });
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const onLocalWeb = isLocalWebApp();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setBridgeUrl(localStorage.getItem("sharkflows.bridgeUrl") ?? DEFAULT_URL);
      setToken(localStorage.getItem("sharkflows.bridgeToken") ?? "");
      const saved = localStorage.getItem("sharkflows.bridgeProjectIds");
      const last = localStorage.getItem("sharkflows.lastProjectId");
      if (saved) {
        setSelectedIds(saved.split(",").map((s) => s.trim()).filter(Boolean));
      } else if (last) {
        setSelectedIds([last]);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload: { projects?: ProjectItem[] }) => {
        if (cancelled) return;
        const list = payload.projects ?? [];
        setProjects(list);
        setSelectedIds((prev) => {
          if (prev.length) return prev.filter((id) => list.some((p) => p.id === id));
          return list.map((p) => p.id);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleProject(id: string) {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem("sharkflows.bridgeProjectIds", next.join(","));
      if (next[0]) localStorage.setItem("sharkflows.lastProjectId", next[0]);
      return next;
    });
  }

  async function checkLocal() {
    setChecking(true);
    try {
      const trimmedToken = token.trim();
      if (!trimmedToken) throw new Error("请先粘贴桥接 Token");
      const response = await fetch(`${bridgeUrl}/v1/status`, {
        headers: { Authorization: `Bearer ${trimmedToken}` },
      });
      if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}`);
      const status = (await response.json()) as Omit<Connection, "connected">;
      localStorage.setItem("sharkflows.bridgeUrl", bridgeUrl);
      localStorage.setItem("sharkflows.bridgeToken", trimmedToken);
      setToken(trimmedToken);
      setConnection({ connected: true, ...status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接失败";
      setConnection({
        connected: false,
        error: /load failed|failed to fetch/i.test(message)
          ? `无法访问 ${bridgeUrl}。线上站请改用云队列；本机请用 localhost:3000。`
          : message,
      });
    } finally {
      setChecking(false);
    }
  }

  async function checkCloudHeartbeat() {
    setChecking(true);
    try {
      if (!selectedIds.length) throw new Error("请至少勾选一个项目");
      let pending = 0;
      for (const projectId of selectedIds) {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/sketchup/results?list=1`,
        );
        const payload = (await response.json().catch(() => ({}))) as {
          tasks?: Array<{ status: string }>;
          detail?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.detail
              ? `${projectId}: ${payload.detail}`
              : `${projectId}: HTTP ${response.status}`,
          );
        }
        pending += (payload.tasks ?? []).filter(
          (t) => t.status !== "COMPLETED" && t.status !== "FAILED",
        ).length;
      }
      setConnection({
        connected: true,
        bridgeVersion: "cloud-queue",
        pendingTasks: pending,
      });
      localStorage.setItem("sharkflows.bridgeProjectIds", selectedIds.join(","));
    } catch (error) {
      setConnection({
        connected: false,
        error: error instanceof Error ? error.message : "云队列检测失败",
      });
    } finally {
      setChecking(false);
    }
  }

  const idsEnv = useMemo(
    () => (selectedIds.length ? selectedIds.join(",") : "prj_a,prj_b"),
    [selectedIds],
  );

  const cloudCmd = `SKETCHUP_CLOUD_URL=https://construction-web-murex.vercel.app \\
SKETCHUP_BRIDGE_SECRET=<与 Vercel 的 SKETCHUP_RESULT_WEBHOOK_SECRET 相同> \\
SKETCHUP_PROJECT_IDS=${idsEnv} \\
npm run dev:bridge`;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="xl:col-span-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-xs leading-5 text-teal-950">
        <strong>多项目也没关系</strong>
        <p className="mt-1">
          下方勾选你要本机桥接监听的项目（可多选）。启动命令里的{" "}
          <code className="rounded bg-teal-100 px-1">SKETCHUP_PROJECT_IDS</code>{" "}
          会写成逗号分隔列表；一个桥接进程会轮询所有这些项目。在哪个项目页点「发送到SketchUp」，就处理哪个。
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-[#0b2230] p-3 text-[11px] text-teal-50">{cloudCmd}</pre>
        <button
          className={`${buttonSecondary} mt-2`}
          onClick={() => void navigator.clipboard.writeText(cloudCmd)}
        >
          <Copy size={14} />
          复制启动命令
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="font-semibold">云队列 · 选择项目</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              勾选后点检测；真正连 SketchUp 仍靠本机桥接进程。
            </p>
          </div>
          <StatusPill tone={connection.connected ? "green" : "slate"}>
            {connection.connected ? "队列可读" : "未检测"}
          </StatusPill>
        </div>

        {projects.length === 0 ? (
          <p className="text-xs text-slate-500">暂无项目，请先到「项目工作区」创建。</p>
        ) : (
          <ul className="max-h-56 space-y-2 overflow-auto">
            {projects.map((project) => {
              const checked = selectedIds.includes(project.id);
              return (
                <li key={project.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs hover:bg-slate-100">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggleProject(project.id)}
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-800">{project.name}</span>
                      <span className="mt-0.5 block break-all font-mono text-[10px] text-slate-400">
                        {project.id}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <button
          className={`${buttonPrimary} mt-5`}
          disabled={checking || !selectedIds.length}
          onClick={() => void checkCloudHeartbeat()}
        >
          {checking ? <LoaderCircle className="animate-spin" size={15} /> : <PlugZap size={15} />}
          检测已选项目云队列
        </button>
        {connection.error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{connection.error}</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">运行信息</h2>
        <dl className="mt-4 space-y-3 text-xs">
          <Row label="模式" value={onLocalWeb ? "本机网页" : "线上站（云队列）"} />
          <Row label="已选项目" value={String(selectedIds.length)} />
          <Row label="桥接/队列" value={connection.bridgeVersion ?? "—"} />
          <Row
            label="待处理任务"
            value={connection.pendingTasks != null ? String(connection.pendingTasks) : "—"}
          />
        </dl>
        <div className="mt-5 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">
          <ShieldCheck className="mt-0.5 shrink-0" size={15} />
          每个项目地址栏里的 <code className="rounded bg-emerald-100 px-1">/projects/prj_…/</code>{" "}
          就是该项目 ID；也可在左侧勾选，不必手抄。
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          {connection.connected ? (
            <CheckCircle2 size={14} className="text-emerald-600" />
          ) : (
            <Unplug size={14} />
          )}
          {connection.connected ? "可以在任意已选项目页发送建模任务" : "先勾选项目并检测"}
        </div>
      </section>

      {onLocalWeb && (
        <section className="xl:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">本机直连（仅 localhost 开发）</h2>
          <label className="mt-4 block text-xs font-semibold text-slate-600">桥接地址</label>
          <input
            value={bridgeUrl}
            onChange={(event) => setBridgeUrl(event.target.value)}
            className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
          />
          <label className="mt-4 block text-xs font-semibold text-slate-600">本地 Token</label>
          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm"
            />
            <button className={buttonSecondary} onClick={() => void navigator.clipboard.writeText(token)}>
              <Copy size={14} />
              复制
            </button>
          </div>
          <button
            className={`${buttonPrimary} mt-5`}
            disabled={checking || !token}
            onClick={() => void checkLocal()}
          >
            {checking ? <LoaderCircle className="animate-spin" size={15} /> : <PlugZap size={15} />}
            检测本机桥接
          </button>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[90px_1fr] gap-3 border-b border-slate-100 pb-3 last:border-0">
      <dt className="text-slate-400">{label}</dt>
      <dd className="break-all font-medium text-slate-700">{value}</dd>
    </div>
  );
}
