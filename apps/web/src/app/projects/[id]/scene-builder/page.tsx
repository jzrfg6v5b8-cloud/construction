"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Box } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SceneRendersPanel } from "@/components/rendering/scene-renders-panel";
import { buttonSecondary } from "@/components/ui";
import { useProjectMeta } from "@/lib/projects/use-project-meta";

export default function SceneBuilderPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { projectName } = useProjectMeta(projectId);

  return (
    <AppShell
      current="scene"
      projectId={projectId}
      projectName={projectName}
      title="场景截图"
      description="照片级结果来自 SketchUp/外部渲染器 PNG，不是浏览器 3D。在此上传或查看 8 张必选场景，再去方案页导出 PDF。"
      actions={
        <>
          <Link href={`/projects/${projectId}/sketchup`} className={buttonSecondary}>
            <Box size={14} /> SketchUp 同步
          </Link>
          <Link href={`/projects/${projectId}/proposal`} className={buttonSecondary}>
            去导出 PDF
          </Link>
        </>
      }
    >
      <SceneRendersPanel projectId={projectId} />
    </AppShell>
  );
}
