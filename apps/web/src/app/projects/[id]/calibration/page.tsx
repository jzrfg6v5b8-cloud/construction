"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FloorPlanEditor } from "@/components/floorplan/floor-plan-editor";
import { FloorPlanImportPanel } from "@/components/floorplan/floor-plan-import-panel";
import { ProjectAssetsPanel, type AssetListItem } from "@/components/project-assets-panel";
import { useProjectMeta } from "@/lib/projects/use-project-meta";

export default function CalibrationPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { projectName } = useProjectMeta(projectId);
  const [assets, setAssets] = useState<AssetListItem[]>([]);

  const lastFloorplanAssetId = useMemo(() => {
    const images = assets.filter(
      (a) => a.asset_type === "image" || a.mime_type.startsWith("image/"),
    );
    return images[0]?.id ?? null;
  }, [assets]);

  return (
    <AppShell
      current="calibration"
      projectId={projectId}
      projectName={projectName}
      title="户型校准"
      description="上传户型图 → 一键生成墙体与概念图 → 在此微调尺寸与墙体，再去场景页换材质、摆商品。"
    >
      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-sm font-bold text-slate-800">参考素材</h2>
          <ProjectAssetsPanel
            projectId={projectId}
            accept=".jpg,.jpeg,.png,.webp,.pdf,.heic"
            emptyHint="上传户型平面图（如 A03023 6400×7000mm），然后点下方一键生成。"
            onAssetsChange={setAssets}
          />
        </section>

        <FloorPlanImportPanel projectId={projectId} lastAssetId={lastFloorplanAssetId} />

        <FloorPlanEditor projectId={projectId} />
      </div>
    </AppShell>
  );
}
