"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProjectAssetsPanel } from "@/components/project-assets-panel";
import { useProjectMeta } from "@/lib/projects/use-project-meta";

export default function ProcurementPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { projectName } = useProjectMeta(projectId);

  return (
    <AppShell
      current="procurement"
      projectId={projectId}
      projectName={projectName}
      title="采购清单"
      description="上传采购 Excel / CSV / 商品图。系统保存原始文件并排队处理；SKU 需人工确认后才进 BOM。"
    >
      <ProjectAssetsPanel
        projectId={projectId}
        accept=".csv,.xlsx,.jpg,.jpeg,.png,.webp,.pdf"
        emptyHint="上传采购表或商品资料图，确认后再进入场景与报价。"
      />
    </AppShell>
  );
}
