"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Box, Download, ExternalLink, FileJson2, FileText, LoaderCircle, RefreshCw, Send, XCircle } from "lucide-react";
import { buttonPrimary, buttonSecondary, ProgressBar, StatusPill } from "./ui";

type TaskStatus = "QUEUED" | "DOWNLOADED" | "MODEL_BUILDING" | "MODEL_VALIDATING" | "LAYOUT_REFRESH_REQUIRED" | "EXPORTING" | "COMPLETED" | "FAILED";
type ModelTask = {
  id: string;
  status: TaskStatus;
  progress: number;
  modelVersion?: string;
  error?: { code?: string; message?: string } | string;
  missingComponents?: string[];
  exports?: Array<{ kind: string; filename: string; sizeBytes?: number }>;
  result?: { filename: string; contentType: string; sizeBytes: number } | null;
  results?: Array<{ id: string; filename: string; contentType: string; sizeBytes: number }>;
  components?: { total: number; succeeded: number; failed: number; skipped: number; skuCounts: Record<string, number> };
  componentStats?: Array<{ sku: string; name: string; quantity: number; widthMm: number; depthMm: number; heightMm: number; materialCode?: string; roomCode?: string; objectIds: string[] }>;
};

const stages: TaskStatus[] = ["QUEUED", "DOWNLOADED", "MODEL_BUILDING", "MODEL_VALIDATING", "LAYOUT_REFRESH_REQUIRED", "EXPORTING", "COMPLETED"];

export function SketchUpSyncPanel({ projectId }: { projectId: string }) {
  const [task, setTask] = useState<ModelTask | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  const ingestedRef = useRef<string | null>(null);

  function bridgeSettings() {
    return {
      url: localStorage.getItem("sharkflows.bridgeUrl") ?? "http://127.0.0.1:43821",
      token: localStorage.getItem("sharkflows.bridgeToken") ?? "",
    };
  }

  async function pullTask(taskId: string) {
    const bridge = bridgeSettings();
    const response = await fetch(`${bridge.url}/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${bridge.token}` } });
    if (!response.ok) throw new Error(`读取任务失败（HTTP ${response.status}）`);
    const current = await response.json() as ModelTask;
    setTask(current);
    if (current.status === "COMPLETED" || current.status === "FAILED") {
      if (polling.current) clearInterval(polling.current);
      polling.current = null;
    }
    if (current.status === "COMPLETED") {
      if (ingestedRef.current === current.id) return;
      ingestedRef.current = current.id;
      void ingestCompletedOutputs(current).catch((error) =>
        setMessage(error instanceof Error ? error.message : "回传入库失败"),
      );
    }
  }

  async function ingestCompletedOutputs(current: ModelTask) {
    const bridge = bridgeSettings();
    const files = current.results?.length
      ? current.results
      : current.result
        ? [{ id: undefined as string | undefined, filename: current.result.filename, contentType: current.result.contentType }]
        : [];
    const pngFiles = files.filter(
      (file) =>
        file.contentType?.includes("png") ||
        file.filename.toLowerCase().endsWith(".png") ||
        /plan|living|master|kitchen|bath|aerial|dimension/i.test(file.filename),
    );
    let uploaded = 0;
    for (const file of pngFiles) {
      const path = file.id ? `/v1/tasks/${current.id}/results/${file.id}` : `/v1/tasks/${current.id}/result`;
      const blobRes = await fetch(`${bridge.url}${path}`, {
        headers: { Authorization: `Bearer ${bridge.token}` },
      });
      if (!blobRes.ok) continue;
      const blob = await blobRes.blob();
      const form = new FormData();
      const sceneGuess = file.filename.replace(/\.png$/i, "").toLowerCase().replace(/_/g, "-");
      form.set("sceneId", sceneGuess);
      form.set("renderer", "sketchup-png");
      form.set("sceneVersion", current.modelVersion ?? "sketchup");
      form.set("file", new File([blob], file.filename, { type: "image/png" }));
      const up = await fetch(`/api/projects/${projectId}/renders`, { method: "POST", body: form });
      if (up.ok) uploaded += 1;
    }
    await fetch(`/api/projects/${projectId}/sketchup/sync-complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        geometryVersion: current.modelVersion ?? `gv-${Date.now()}`,
        modelVersion: current.modelVersion ?? `mv-${Date.now()}`,
        status: "COMPLETED",
        componentStats: current.componentStats ?? [],
        exports: (current.exports ?? []).map((item) => ({
          kind: item.kind,
          filename: item.filename,
          sizeBytes: item.sizeBytes,
        })),
      }),
    });
    if (uploaded > 0) setMessage(`已入库 ${uploaded} 张场景 PNG，可在方案输出页查看`);
  }

  async function send() {
    setSending(true);
    setMessage(null);
    try {
      const configResponse = await fetch(`/api/projects/${projectId}/sketchup/configuration`);
      if (!configResponse.ok) {
        const payload = (await configResponse.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        if (configResponse.status === 409 || payload.error === "DIMENSIONS_NOT_VERIFIED") {
          throw new Error(payload.message ?? "请先到「户型校准」确认尺寸 VERIFIED（或在项目列表点「一键跑通」）");
        }
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
        body: JSON.stringify({ configuration, requestedOutputs: ["SKP", "SCENE_PNG", "COMPONENT_STATS", "LAYOUT_HANDOFF"] }),
      });
      if (!response.ok) throw new Error(`桥接拒绝任务（HTTP ${response.status}）`);
      const created = await response.json() as ModelTask;
      setTask(created);
      polling.current = setInterval(() => void pullTask(created.id).catch((error) => setMessage(error.message)), 1500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  async function downloadResult(result: { id?: string; filename: string }) {
    if (!task) return;
    const bridge = bridgeSettings();
    const path = result.id
      ? `/v1/tasks/${task.id}/results/${result.id}`
      : `/v1/tasks/${task.id}/result`;
    const response = await fetch(`${bridge.url}${path}`, {
      headers: { Authorization: `Bearer ${bridge.token}` },
    });
    if (!response.ok) {
      setMessage(`下载失败（HTTP ${response.status}）`);
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => () => {
    if (polling.current) clearInterval(polling.current);
  }, []);

  const bom = [
    { sku: "SF-BED-1500", name: "小双人床", expected: 1 },
    { sku: "SF-BED-1000", name: "单人床", expected: 1 },
    { sku: "SF-WARDROBE-1800", name: "衣柜", expected: 2 },
    { sku: "SF-SOFA-2200", name: "三座沙发", expected: 1 },
    { sku: "SF-DESK-1200", name: "书桌", expected: 1 },
  ];
  const availableOutputs = task?.results?.length
    ? task.results.map((file) => ({ ...file, kind: file.contentType }))
    : task?.exports?.length
      ? task.exports
      : task?.result
        ? [{ kind: task.result.contentType, ...task.result }]
        : [];

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="方案版本" value="A03023 · gv-0003" hint="已审核尺寸 6400 × 7000 mm" />
        <Card label="模型版本" value={task?.modelVersion ?? "尚未同步"} hint={task ? `任务 ${task.id}` : "等待SketchUp回传"} />
        <Card label="组件统计" value={task?.components ? `${Object.keys(task.components.skuCounts ?? {}).length} SKU` : "—"} hint="模型/BOM/报价三方对比" />
        <Card label="LayOut" value={task?.status === "LAYOUT_REFRESH_REQUIRED" ? "需要刷新" : "半自动交接"} hint="打开模板 · 刷新引用 · 导出" />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2"><h2 className="font-semibold">建模任务</h2>{task && <StatusPill tone={task.status === "FAILED" ? "red" : task.status === "COMPLETED" ? "green" : "blue"}>{task.status}</StatusPill>}</div>
            <p className="mt-1 text-xs text-slate-500">按稳定UUID更新；重复同步不会重复创建模型对象。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className={buttonSecondary} href={`/api/projects/${projectId}/sketchup/configuration?download=1`}><FileJson2 size={14}/>导出SpaceConfiguration</a>
            <button className={buttonPrimary} onClick={() => void send()} disabled={sending}>{sending ? <LoaderCircle className="animate-spin" size={14}/> : <Send size={14}/>}发送到SketchUp</button>
          </div>
        </div>
        {message && <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><XCircle size={14}/>{message}</div>}
        <div className="mt-6">
          <ProgressBar value={task?.progress ?? 0} tone={task?.status === "FAILED" ? "red" : "teal"} />
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            {stages.map((stage) => {
              const current = task ? stages.indexOf(task.status) : -1;
              const index = stages.indexOf(stage);
              return <div key={stage} className={`rounded-lg border px-2 py-2 text-[10px] font-semibold ${index <= current ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-100 bg-slate-50 text-slate-400"}`}>{stage}</div>;
            })}
          </div>
        </div>
        {task?.missingComponents?.length ? <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle size={15}/><span>缺失组件：{task.missingComponents.join("、")}。插件将使用明确标记的参数化占位组件，不会冒充真实产品。</span></div> : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-semibold">SKU数量对比</h2><p className="mt-1 text-xs text-slate-500">任何差异都会阻止FINAL。</p></div><button className={buttonSecondary} onClick={() => task && void pullTask(task.id)}><RefreshCw size={14}/>刷新</button></div>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-400"><tr><th className="px-5 py-3">SKU</th><th>组件</th><th>BOM</th><th>SketchUp</th><th>报价</th><th>状态</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {bom.map((item) => {
                const modeled = task?.componentStats?.find((entry) => entry.sku === item.sku)?.quantity ?? task?.components?.skuCounts?.[item.sku];
                const mismatch = modeled !== undefined && modeled !== item.expected;
                return <tr key={item.sku}><td className="px-5 py-3 font-mono">{item.sku}</td><td>{item.name}</td><td>{item.expected}</td><td>{modeled ?? "—"}</td><td>{item.expected}</td><td>{modeled === undefined ? <StatusPill>未同步</StatusPill> : mismatch ? <StatusPill tone="red">不一致</StatusPill> : <StatusPill tone="green">一致</StatusPill>}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">输出结果</h2>
          <div className="mt-4 space-y-2">
            {availableOutputs.map((file) => <div key={file.filename} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3"><FileText size={16} className="text-slate-400"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{file.filename}</p><p className="text-[10px] text-slate-400">{file.kind} {file.sizeBytes ? `· ${Math.round(file.sizeBytes / 1024)} KB` : ""}</p></div><button aria-label={`下载 ${file.filename}`} onClick={() => void downloadResult(file)}><Download size={14}/></button></div>)}
            {!availableOutputs.length && <div className="grid h-28 place-items-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400"><span className="text-center"><Box className="mx-auto mb-2" size={20}/>等待插件回传SKP、PNG与交接清单</span></div>}
          </div>
          <a href="/settings/sketchup" className="mt-4 flex items-center gap-1 text-xs font-semibold text-teal-700">桥接与输出目录设置 <ExternalLink size={12}/></a>
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
        <strong>LayOut真实边界：</strong>插件准备标准场景、SKP和handoff manifest；用户仍需打开指定.layout模板、刷新SketchUp模型引用、检查关联尺寸并点击导出PDF/PNG。当前SketchUp Ruby API不被描述为可全自动操控LayOut。
      </section>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-2 text-lg font-bold">{value}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div>;
}
