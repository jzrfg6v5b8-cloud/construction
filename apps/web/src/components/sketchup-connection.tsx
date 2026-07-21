"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, LoaderCircle, PlugZap, ShieldCheck, Unplug } from "lucide-react";
import { buttonPrimary, buttonSecondary, StatusPill } from "./ui";

type Connection = {
  connected: boolean;
  bridgeVersion?: string;
  extensionVersion?: string;
  sketchupVersion?: string;
  componentLibraryPath?: string;
  layoutTemplatePath?: string;
  outputPath?: string;
  pendingTasks?: number;
  error?: string;
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
  const [cloudProjectId, setCloudProjectId] = useState("");
  const onLocalWeb = isLocalWebApp();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setBridgeUrl(localStorage.getItem("sharkflows.bridgeUrl") ?? DEFAULT_URL);
      setToken(localStorage.getItem("sharkflows.bridgeToken") ?? "");
      setCloudProjectId(localStorage.getItem("sharkflows.lastProjectId") ?? "");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

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
      if (!cloudProjectId) throw new Error("请填写要轮询的项目 ID（prj_…）");
      const response = await fetch(`/api/projects/${encodeURIComponent(cloudProjectId)}/sketchup/results?list=1`);
      if (!response.ok) throw new Error(`云队列不可用 HTTP ${response.status}`);
      const payload = (await response.json()) as { tasks?: Array<{ status: string }> };
      const pending = (payload.tasks ?? []).filter(
        (t) => t.status !== "COMPLETED" && t.status !== "FAILED",
      ).length;
      setConnection({
        connected: true,
        bridgeVersion: "cloud-queue",
        pendingTasks: pending,
      });
      localStorage.setItem("sharkflows.lastProjectId", cloudProjectId);
    } catch (error) {
      setConnection({
        connected: false,
        error: error instanceof Error ? error.message : "云队列检测失败",
      });
    } finally {
      setChecking(false);
    }
  }

  const cloudCmd = `SKETCHUP_CLOUD_URL=https://construction-web-murex.vercel.app \\
SKETCHUP_BRIDGE_SECRET=<与 Vercel 的 SKETCHUP_RESULT_WEBHOOK_SECRET 相同> \\
SKETCHUP_PROJECT_ID=${cloudProjectId || "prj_你的项目ID"} \\
npm run dev:bridge`;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="xl:col-span-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-xs leading-5 text-teal-950">
        <strong>推荐（线上站）：云队列 + 本机桥接轮询</strong>
        <p className="mt-1">
          浏览器只访问 Vercel；本机桥接出站拉任务，再交给 SketchUp 插件。不再要求网页直连 127.0.0.1。
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Vercel 已配置 <code className="rounded bg-teal-100 px-1">SKETCHUP_RESULT_WEBHOOK_SECRET</code></li>
          <li>本机启动桥接时带上云 URL、同一 Secret、项目 ID</li>
          <li>在线上站 SketchUp 页点「发送到SketchUp」</li>
        </ol>
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
            <h2 className="font-semibold">云队列健康检查</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              在线上站验证任务表可读；真正「连接 SketchUp」靠本机桥接进程。
            </p>
          </div>
          <StatusPill tone={connection.connected ? "green" : "slate"}>
            {connection.connected ? "队列可读" : "未检测"}
          </StatusPill>
        </div>
        <label className="block text-xs font-semibold text-slate-600">项目 ID</label>
        <input
          value={cloudProjectId}
          onChange={(event) => setCloudProjectId(event.target.value)}
          placeholder="prj_…"
          className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
        />
        <button
          className={`${buttonPrimary} mt-5`}
          disabled={checking}
          onClick={() => void checkCloudHeartbeat()}
        >
          {checking ? <LoaderCircle className="animate-spin" size={15} /> : <PlugZap size={15} />}
          检测云队列
        </button>
        {connection.error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{connection.error}</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">运行信息</h2>
        <dl className="mt-4 space-y-3 text-xs">
          <Row label="模式" value={onLocalWeb ? "本机网页" : "线上站（云队列）"} />
          <Row label="桥接/队列" value={connection.bridgeVersion ?? "—"} />
          <Row label="待处理任务" value={connection.pendingTasks != null ? String(connection.pendingTasks) : "—"} />
          <Row label="插件版本" value={connection.extensionVersion ?? "等待插件心跳"} />
        </dl>
        <div className="mt-5 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">
          <ShieldCheck className="mt-0.5 shrink-0" size={15} />
          插件仍只连本机 127.0.0.1；云队列只给 Node 桥接进程用。
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          {connection.connected ? (
            <CheckCircle2 size={14} className="text-emerald-600" />
          ) : (
            <Unplug size={14} />
          )}
          {connection.connected ? "可以在项目页发送建模任务" : "先检测云队列或本机桥接"}
        </div>
      </section>

      {onLocalWeb && (
        <section className="xl:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">本机直连（仅 localhost 开发）</h2>
          <p className="mt-1 text-xs text-slate-500">可选。线上站请用上面的云队列，不要依赖这一段。</p>
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
