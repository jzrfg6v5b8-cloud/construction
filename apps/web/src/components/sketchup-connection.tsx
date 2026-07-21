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
  error?: string;
};

const DEFAULT_URL = "http://127.0.0.1:43821";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isLocalWebApp() {
  if (typeof window === "undefined") return true;
  return LOCAL_HOSTS.has(window.location.hostname);
}

function explainBridgeError(error: unknown, bridgeUrl: string) {
  const message = error instanceof Error ? error.message : "连接失败";
  if (!isLocalWebApp()) {
    return "线上网站无法连接本机桥接。请在本机运行 npm run dev，用 http://localhost:3000 打开此页再检测。";
  }
  if (/load failed|failed to fetch|networkerror/i.test(message)) {
    return `无法访问 ${bridgeUrl}。请确认终端里 npm run dev:bridge 正在运行，且 Token 完整粘贴（无空格换行）。`;
  }
  if (/403|ORIGIN/i.test(message)) {
    return "来源未授权：请用 http://localhost:3000 或 http://127.0.0.1:3000 打开网页，不要用其他端口或线上域名。";
  }
  return message;
}

export function SketchUpConnection() {
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_URL);
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [connection, setConnection] = useState<Connection>({ connected: false });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setBridgeUrl(localStorage.getItem("sharkflows.bridgeUrl") ?? DEFAULT_URL);
      setToken(localStorage.getItem("sharkflows.bridgeToken") ?? "");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function check() {
    setChecking(true);
    try {
      const trimmedToken = token.trim();
      if (!trimmedToken) throw new Error("请先粘贴桥接 Token");
      const response = await fetch(`${bridgeUrl}/v1/status`, {
        headers: { Authorization: `Bearer ${trimmedToken}` },
      });
      if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}`);
      const status = await response.json() as Omit<Connection, "connected">;
      localStorage.setItem("sharkflows.bridgeUrl", bridgeUrl);
      localStorage.setItem("sharkflows.bridgeToken", trimmedToken);
      setToken(trimmedToken);
      setConnection({ connected: true, ...status });
    } catch (error) {
      setConnection({ connected: false, error: explainBridgeError(error, bridgeUrl) });
    } finally {
      setChecking(false);
    }
  }

  const onLocalWeb = isLocalWebApp();

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      {!onLocalWeb && (
        <section className="xl:col-span-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
          <strong>当前是线上站点，不能连本机桥接。</strong>
          桥接只监听 127.0.0.1，浏览器从 Vercel 域名无法访问你电脑上的服务。请在本机项目目录执行{" "}
          <code className="rounded bg-amber-100 px-1">npm run dev</code>，用{" "}
          <code className="rounded bg-amber-100 px-1">http://localhost:3000/settings/sketchup</code>{" "}
          打开此页，并保持 <code className="rounded bg-amber-100 px-1">npm run dev:bridge</code> 运行。
        </section>
      )}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="font-semibold">本地桥接</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              连接只允许回环地址；Token 由本地桥接启动时随机生成，仅保存在当前浏览器。允许的网页来源：
              localhost:3000 / 127.0.0.1:3000。
            </p>
          </div>
          <StatusPill tone={connection.connected ? "green" : "slate"}>
            {connection.connected ? "已连接" : "未连接"}
          </StatusPill>
        </div>
        <label className="block text-xs font-semibold text-slate-600">桥接地址</label>
        <input value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
        <label className="mt-4 block text-xs font-semibold text-slate-600">随机授权 Token</label>
        <div className="mt-2 flex gap-2">
          <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="粘贴 bridge 启动时显示的 token" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm" />
          <button className={buttonSecondary} onClick={() => void navigator.clipboard.writeText(token)}><Copy size={14}/>复制</button>
        </div>
        <button className={`${buttonPrimary} mt-5`} disabled={checking || !token} onClick={() => void check()}>
          {checking ? <LoaderCircle className="animate-spin" size={15}/> : <PlugZap size={15}/>}检测连接
        </button>
        {connection.error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{connection.error}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">运行信息</h2>
        <dl className="mt-4 space-y-3 text-xs">
          <Row label="桥接版本" value={connection.bridgeVersion ?? "—"} />
          <Row label="插件版本" value={connection.extensionVersion ?? "等待插件心跳"} />
          <Row label="SketchUp版本" value={connection.sketchupVersion ?? "—"} />
          <Row label="组件库" value={connection.componentLibraryPath ?? "未报告"} />
          <Row label="LayOut模板" value={connection.layoutTemplatePath ?? "未报告"} />
          <Row label="输出目录" value={connection.outputPath ?? "未报告"} />
        </dl>
        <div className="mt-5 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">
          <ShieldCheck className="mt-0.5 shrink-0" size={15}/>桥接服务拒绝非回环绑定、无 Token 请求和未授权网页 Origin。
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          {connection.connected ? <CheckCircle2 size={14} className="text-emerald-600"/> : <Unplug size={14}/>}
          {connection.connected ? "可以发送建模任务" : "先启动 npm run dev:bridge，再启动 SketchUp 插件"}
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[90px_1fr] gap-3 border-b border-slate-100 pb-3 last:border-0"><dt className="text-slate-400">{label}</dt><dd className="break-all font-medium text-slate-700">{value}</dd></div>;
}
