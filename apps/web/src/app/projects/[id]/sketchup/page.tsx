import { AppShell } from "@/components/app-shell";
import { LayoutChecklistPanel } from "@/components/layout/layout-checklist-panel";
import { SketchUpSyncPanel } from "@/components/sketchup-sync-panel";
import { getProject, ensureDemoProject } from "@/lib/db/repositories";
import { getDb } from "@/lib/db/client";

export default async function ProjectSketchUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  getDb();
  if (id === "demo") ensureDemoProject();
  const project = getProject(id);
  const name = project?.name ?? (id === "demo" ? "A03023 两房方案" : id);

  return (
    <AppShell
      current="sketchup"
      projectId={id}
      projectName={name}
      title={`${name} · SketchUp / LayOut`}
      description="导出统一空间协议 → 本机桥接建模 → 回传 SKU/PNG。LayOut PDF 仍须人工三步。"
    >
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-950">
        网页不会用 Three.js 假装 SKP/照片级结果。先在「户型校准」点 VERIFIED，再发桥接任务；场景 PNG 可在「方案输出」上传或经结果 webhook 入库。
      </div>
      <div className="space-y-5">
        <SketchUpSyncPanel projectId={id} />
        <LayoutChecklistPanel projectId={id} />
      </div>
    </AppShell>
  );
}
