"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Box } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { SceneRendersPanel } from "@/components/rendering/scene-renders-panel";
import { buttonSecondary } from "@/components/ui";
import { useProjectMeta } from "@/lib/projects/use-project-meta";
import { SpaceSceneCanvas } from "@/components/rendering/space-scene-canvas";
import type { FloorPlanDocument } from "@/lib/floorplan/document";

export default function SceneBuilderPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { projectName } = useProjectMeta(projectId);
  const [floorPlan,setFloorPlan]=useState<FloorPlanDocument|null>(null);
  const [products,setProducts]=useState<Array<{id:string;sku:string;name:string;width_mm:number|null;depth_mm:number|null;height_mm:number|null;material_code:string|null}>>([]);
  useEffect(()=>{let active=true;Promise.all([fetch(`/api/projects/${projectId}/floorplan`).then((r)=>r.ok?r.json():null),fetch(`/api/projects/${projectId}/commerce`).then((r)=>r.ok?r.json():null)]).then(([floor,commerce])=>{if(active){setFloorPlan(floor?.document??null);setProducts(commerce?.products??[])}});return()=>{active=false}},[projectId]);

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
      {floorPlan && <section className="mb-6"><div className="mb-2 flex items-center justify-between"><h2 className="font-bold">实时3D空间</h2><span className="text-xs text-slate-500">几何版本 {floorPlan.geometryVersion}</span></div><SpaceSceneCanvas document={floorPlan} products={products} projectId={projectId} geometryVersion={floorPlan.geometryVersion}/></section>}
      <SceneRendersPanel projectId={projectId} />
    </AppShell>
  );
}
