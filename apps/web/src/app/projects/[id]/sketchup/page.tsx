import { AppShell } from "@/components/app-shell";
import { LayoutChecklistPanel } from "@/components/layout/layout-checklist-panel";
import { SketchUpSyncPanel } from "@/components/sketchup-sync-panel";
import { getProjectAsync, ensureDemoProject } from "@/lib/db/repositories";
import { getDb } from "@/lib/db/client";
import { useCloudDb } from "@/lib/db/cloud-store";

export default async function ProjectSketchUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!useCloudDb()) {
    getDb();
    if (id === "demo") ensureDemoProject();
  }
  const project = await getProjectAsync(id);
  const name = project?.name ?? (id === "demo" ? "A03023 两房方案" : id);

  return (
    <AppShell
      current="sketchup"
      projectId={id}
      projectName={name}
      title={`${name} · SketchUp / LayOut`}
      description="线上站用云队列发任务；本机桥接轮询后交给 SketchUp 插件。LayOut PDF 仍须人工三步。"
    >
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-950">
        浏览器不再直连 127.0.0.1。请在本机用 SKETCHUP_CLOUD_URL + SECRET + PROJECT_ID 启动桥接，再在本页点「发送到SketchUp」。
      </div>
      <div className="space-y-5">
        <SketchUpSyncPanel projectId={id} />
        <LayoutChecklistPanel projectId={id} />
      </div>
    </AppShell>
  );
}
