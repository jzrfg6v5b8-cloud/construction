"use client";

import { useEffect, useState } from "react";
import { ImagePlus, LoaderCircle, Upload } from "lucide-react";
import { buttonSecondary, StatusPill } from "@/components/ui";

const SCENES = [
  { id: "plan", label: "平面" },
  { id: "dimensioned-plan", label: "尺寸平面" },
  { id: "aerial", label: "鸟瞰" },
  { id: "living", label: "客厅" },
  { id: "master", label: "主卧" },
  { id: "second", label: "次卧" },
  { id: "kitchen", label: "厨房" },
  { id: "bath", label: "浴室" },
] as const;

type RenderRow = {
  scene_id: string;
  status: string;
  renderer: string;
  image_uri: string | null;
};

export function SceneRendersPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<RenderRow[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/projects/${projectId}/renders`);
    const payload = (await response.json()) as { renders?: RenderRow[] };
    setRows(payload.renders ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/renders`)
      .then((response) => response.json())
      .then((payload: { renders?: RenderRow[] }) => {
        if (!cancelled) setRows(payload.renders ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function upload(sceneId: string, file: File) {
    setUploading(sceneId);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("sceneId", sceneId);
      form.set("renderer", "sketchup-png");
      form.set("file", file);
      const response = await fetch(`/api/projects/${projectId}/renders`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        setMessage(`上传失败 HTTP ${response.status}`);
        return;
      }
      setMessage(`${sceneId} 已入库，PDF 导出会优先嵌入`);
      await refresh();
    } finally {
      setUploading(null);
    }
  }

  const ready = new Set(rows.filter((r) => r.status === "ready" && r.image_uri).map((r) => r.scene_id));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold">场景截图（照片级来源）</h2>
        <StatusPill tone={ready.size >= 8 ? "green" : "amber"}>
          {ready.size}/8 已就绪
        </StatusPill>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        浏览器 Three.js 不算照片级。请从 SketchUp 场景导出 PNG，或经桥接回传后上传到此。PDF 会读取磁盘上的真实 PNG。
      </p>
      {message && <p className="mt-2 text-xs text-teal-700">{message}</p>}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {SCENES.map((scene) => {
          const isReady = ready.has(scene.id);
          return (
            <li key={scene.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{scene.label}</p>
                <p className="text-[10px] text-slate-400">{scene.id}</p>
              </div>
              <div className="flex items-center gap-2">
                {isReady ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/projects/${projectId}/renders?sceneId=${scene.id}&raw=1`}
                    alt={scene.id}
                    className="h-10 w-14 rounded object-cover"
                  />
                ) : (
                  <ImagePlus size={16} className="text-slate-300" />
                )}
                <label className={`${buttonSecondary} cursor-pointer !px-2 !py-1 text-[11px]`}>
                  {uploading === scene.id ? <LoaderCircle className="animate-spin" size={12} /> : <Upload size={12} />}
                  上传
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={uploading !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(scene.id, file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
