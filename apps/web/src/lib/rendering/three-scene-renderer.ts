import { createHash } from "node:crypto";
import type { SceneObject } from "@/lib/domain/schemas";
import type { Renderer, RenderArtifact, RenderRequest } from "./types";

function escapeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function colorFor(object: SceneObject) {
  if (object.kind === "wall") return "#355d52";
  if (object.kind === "product") return "#be835b";
  if (object.kind === "opening") return "#9fc8bd";
  return "#9b9b8d";
}

/**
 * Deterministic browser renderer. It intentionally produces an auditable,
 * non-photorealistic scene document that Playwright can screenshot.
 */
export class ThreeSceneRenderer implements Renderer {
  readonly name = "three-scene-browser";

  async render(request: RenderRequest): Promise<RenderArtifact> {
    if (!request.sceneVersion.trim()) throw new Error("SCENE_VERSION_REQUIRED");
    if (request.size.width < 320 || request.size.height < 240) throw new Error("RENDER_SIZE_TOO_SMALL");
    const payload = {
      projectId: request.projectId,
      sceneId: request.scene.id,
      sceneRevision: request.scene.revision,
      sceneVersion: request.sceneVersion,
      camera: request.camera ?? "isometric",
      objects: request.scene.objects.filter((item) => item.visible).map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        positionMm: item.transform.positionMm,
        rotationDeg: item.transform.rotationDeg,
        dimensions: item.dimensions,
        color: colorFor(item),
      })),
    };
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const renderId = `rnd_${digest.slice(0, 20)}`;
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${renderId}</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#eeede8}
canvas{display:block}#meta{position:fixed;left:16px;bottom:14px;padding:8px 10px;background:#ffffffd9;
font:12px system-ui;color:#17342d;border:1px solid #cad2ce;border-radius:4px}
</style></head><body><canvas id="scene" width="${request.size.width}" height="${request.size.height}"></canvas>
<div id="meta">Scene ${request.scene.id} · ${request.sceneVersion} · NON-PHOTOREALISTIC</div>
<script id="scene-data" type="application/json">${escapeJson(payload)}</script><script>
const d=JSON.parse(document.getElementById("scene-data").textContent),c=document.getElementById("scene"),x=c.getContext("2d");
x.fillStyle="#eeede8";x.fillRect(0,0,c.width,c.height);x.translate(c.width/2,c.height*.72);
const iso=(p)=>[(p[0]-p[1])*.055,(p[0]+p[1])*.028-p[2]*.045];
for(const o of d.objects){const p=iso(o.positionMm),w=Math.max(18,(o.dimensions?.widthMm||500)*.045),
h=Math.max(14,(o.dimensions?.depthMm||500)*.025),z=Math.max(10,(o.dimensions?.heightMm||300)*.025);
x.fillStyle=o.color;x.strokeStyle="#17342d";x.lineWidth=1.2;x.beginPath();x.rect(p[0]-w/2,p[1]-z,w,h+z);x.fill();x.stroke();
x.fillStyle="#17342d";x.font="11px system-ui";x.fillText(o.name,p[0]-w/2,p[1]+h+15)}
</script></body></html>`;
    const now = new Date().toISOString();
    return {
      renderId,
      projectId: request.projectId,
      sceneId: request.scene.id,
      sceneVersion: request.sceneVersion,
      renderer: this.name,
      status: "ready",
      width: request.size.width,
      height: request.size.height,
      html,
      imageUri: `/api/projects/${encodeURIComponent(request.projectId)}/renders/${renderId}`,
      skuCodes: [...new Set(request.skuCodes)].sort(),
      materialCodes: [...new Set(request.materialCodes)].sort(),
      createdAt: now,
      completedAt: now,
    };
  }
}
