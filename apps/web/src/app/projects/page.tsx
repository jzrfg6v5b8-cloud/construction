"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderPlus, LoaderCircle, Play, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { buttonPrimary, buttonSecondary } from "@/components/ui";

type ProjectItem = {
  id: string;
  name: string;
  address: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  asset_count?: number;
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [bootstrapping, setBootstrapping] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  async function loadProjects() {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) throw new Error("LOAD_FAILED");
    const payload = (await response.json()) as { projects?: ProjectItem[] };
    setProjects(payload.projects ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("LOAD_FAILED");
        const payload = (await response.json()) as { projects?: ProjectItem[] };
        if (!cancelled) setProjects(payload.projects ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setError("无法加载项目列表");
          setProjects([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function create() {
    if (!name.trim()) {
      setError("请输入项目名称");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, address }),
      });
      const payload = (await response.json()) as { project?: ProjectItem; error?: string };
      if (!response.ok || !payload.project) {
        setError(payload.error ?? "创建失败");
        return;
      }
      const projectId = payload.project.id;
      try {
        localStorage.setItem("sharkflows.lastProjectId", projectId);
      } catch {
        /* ignore */
      }
      setName("");
      setAddress("");
      setHint("项目已创建。请上传户型图并一键生成。");
      await loadProjects();
      router.push(`/projects/${projectId}/calibration`);
    } catch {
      setError("网络错误");
    } finally {
      setCreating(false);
    }
  }

  async function bootstrap(projectId: string) {
    setBootstrapping(projectId);
    setError(null);
    setHint(null);
    router.push(`/projects/${projectId}/calibration`);
    setBootstrapping(null);
  }

  async function remove(projectId: string) {
    if (projectId === "demo") return;
    if (!window.confirm("删除项目及其素材记录？")) return;
    await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    await loadProjects();
  }

  const loading = projects === null;
  const activeId = projects?.[0]?.id;

  return (
    <AppShell
      current="project"
      projectId={activeId}
      projectName="全部项目"
      title="项目工作区"
      description="创建项目 → 上传户型图 → 一键生成墙体与概念图 → 场景页调试材质与商品。"
    >
      <section className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 text-xs leading-5 text-teal-950">
        <strong>最短跑通：</strong>
        创建项目 → 校准页上传平面图 →「一键生成户型+概念图」→ 场景页调材质 → 方案页导出 PDF。
        {hint && <p className="mt-2 font-medium text-teal-800">{hint}</p>}
      </section>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold">新建项目</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1fr_auto]">
          <input
            className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"
            placeholder="项目名称，如 滨江壹号 · A户型"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"
            placeholder="地址（可选）"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <button className={buttonPrimary} onClick={() => void create()} disabled={creating}>
            {creating ? <LoaderCircle className="animate-spin" size={14} /> : <FolderPlus size={14} />}
            创建并进入
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      </section>

      <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold">我的项目</h2>
          <button
            className={buttonSecondary}
            onClick={() => {
              setError(null);
              void loadProjects().catch(() => setError("无法加载项目列表"));
            }}
          >
            刷新
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
            <LoaderCircle className="animate-spin" size={16} /> 加载中…
          </div>
        ) : projects.length === 0 ? (
          <p className="p-12 text-center text-sm text-slate-500">还没有项目，先创建一个。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {projects.map((project) => (
              <li key={project.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/projects/${project.id}/calibration`}
                    className="text-sm font-semibold text-slate-900 hover:text-teal-700"
                    onClick={() => {
                      try {
                        localStorage.setItem("sharkflows.lastProjectId", project.id);
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    {project.name}
                  </Link>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {project.address || "未填写地址"} · 素材 {project.asset_count ?? 0} ·{" "}
                    {formatTime(project.updated_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={buttonPrimary}
                    disabled={bootstrapping === project.id}
                    onClick={() => void bootstrap(project.id)}
                  >
                    {bootstrapping === project.id ? (
                      <LoaderCircle className="animate-spin" size={14} />
                    ) : (
                      <Play size={14} />
                    )}
                    去校准生成
                  </button>
                  <Link href={`/projects/${project.id}/calibration`} className={buttonSecondary}>
                    校准
                  </Link>
                  <Link href={`/projects/${project.id}/proposal`} className={buttonSecondary}>
                    方案
                  </Link>
                  {project.id !== "demo" && (
                    <button
                      className={buttonSecondary}
                      onClick={() => void remove(project.id)}
                      aria-label={`删除 ${project.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
