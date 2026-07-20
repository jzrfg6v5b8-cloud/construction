"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProjectAssetsPanel } from "@/components/project-assets-panel";
import { useProjectMeta } from "@/lib/projects/use-project-meta";

export default function ProjectAssetsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { projectName } = useProjectMeta(projectId);

  return (
    <AppShell
      current="assets"
      projectId={projectId}
      projectName={projectName}
      title="素材库"
      description="上传并管理本项目的户型、现场、商品与采购文件。列表来自本地数据库，不是演示假数据。"
    >
      <ProjectAssetsPanel projectId={projectId} />
    </AppShell>
  );
}
