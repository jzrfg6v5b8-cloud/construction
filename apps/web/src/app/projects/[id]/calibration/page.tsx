"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FloorPlanEditor } from "@/components/floorplan/floor-plan-editor";
import { ProjectAssetsPanel } from "@/components/project-assets-panel";
import { useProjectMeta } from "@/lib/projects/use-project-meta";

export default function CalibrationPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { projectName } = useProjectMeta(projectId);

  return (
    <AppShell
      current="calibration"
      projectId={projectId}
      projectName={projectName}
      title="户型校准"
      description="编辑墙体几何并确认尺寸 VERIFIED 后，才能导出 SketchUp SpaceConfiguration。可同时上传户型图作对照。"
    >
      <div className="space-y-6">
        <FloorPlanEditor projectId={projectId} />
        <section>
          <h2 className="mb-3 text-sm font-bold text-slate-800">参考素材</h2>
          <ProjectAssetsPanel
            projectId={projectId}
            accept=".jpg,.jpeg,.png,.webp,.pdf,.heic"
            emptyHint="上传户型平面图或标注尺寸的现场照片，作人工核对参考。"
          />
        </section>
      </div>
    </AppShell>
  );
}
