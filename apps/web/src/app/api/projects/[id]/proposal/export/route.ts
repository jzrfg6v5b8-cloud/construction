import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { CJKPdfService } from "@/lib/proposal/cjk-pdf-service";
import { resolveCjkFontPath } from "@/lib/proposal/cjk-font";
import { FinalApprovalService } from "@/lib/proposal/approval-service";
import { createQuoteSignatureProvider } from "@/lib/proposal/quote-signature-provider";
import { getDb } from "@/lib/db/client";
import { cloudListRenders, useCloudDb } from "@/lib/db/cloud-store";
import { getFloorPlan, getFloorPlanAsync, getSketchUpResult, listRenderArtifacts } from "@/lib/db/repositories";
import { PROPOSAL_SCENE_IDS, readScenePng, syncRenderRowToMemory } from "@/lib/rendering/ingest-scene-png";
import { renderStore } from "@/lib/rendering/render-store";
import type { SceneScreenshotManifest } from "@/lib/rendering";
import { getLatestQuote, listBom } from "@/lib/commerce/repository";
import { accessErrorResponse, requireOwnedProject } from "@/lib/auth/project-access";

export const runtime = "nodejs";

const REQUIRED_SCENES = PROPOSAL_SCENE_IDS;

function listApprovals(projectId: string) {
  return getDb().sqlite
    .prepare("SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Array<{
    id: string;
    role: string;
    actor_id: string;
    decision: string;
    created_at: string;
  }>;
}

function recordQuoteSignature(input: {
  projectId: string;
  documentSha256: string;
  signatureId: string;
  signedBy: string;
  signedAt: string;
  verified: boolean;
  provider: string;
  stampText?: string;
}) {
  getDb().sqlite.prepare(
    `INSERT INTO quote_signatures (
      id, project_id, provider, document_sha256, signature_id, signed_by, signed_at, verified, stamp_text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `qsig_${randomBytes(8).toString("hex")}`,
    input.projectId,
    input.provider,
    input.documentSha256,
    input.signatureId,
    input.signedBy,
    input.signedAt,
    input.verified ? 1 : 0,
    input.stampText ?? null,
    new Date().toISOString(),
  );
}

async function placeholderPng(label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <rect width="100%" height="100%" fill="#e8ebe8"/>
    <rect x="48" y="48" width="1184" height="624" fill="#ffffff" stroke="#c5ccc6" stroke-width="2"/>
    <text x="640" y="340" text-anchor="middle" font-size="36" fill="#3d4a43" font-family="sans-serif">${label}</text>
    <text x="640" y="390" text-anchor="middle" font-size="18" fill="#7a857e" font-family="sans-serif">非照片级占位 · non-photoreal placeholder</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function hydrateRenders(projectId: string) {
  if (useCloudDb()) {
    const rows = await cloudListRenders(projectId);
    const seen = new Set<string>();
    const artifacts = [];
    for (const row of rows) {
      if (seen.has(row.scene_id)) continue;
      seen.add(row.scene_id);
      artifacts.push(
        syncRenderRowToMemory({
          render_id: row.id,
          project_id: row.project_id,
          scene_id: row.scene_id,
          scene_version: row.scene_version,
          renderer: row.renderer,
          status: row.status,
          width: row.width,
          height: row.height,
          image_uri: row.storage_key,
          created_at: row.created_at,
          completed_at: row.updated_at,
        }),
      );
    }
    return artifacts.filter((item) => item.status === "ready" && item.imageUri);
  }
  const rows = listRenderArtifacts(projectId);
  rows.forEach(syncRenderRowToMemory);
  return renderStore.list(projectId).filter((item) => item.status === "ready" && item.imageUri);
}

async function approvalInput(projectId: string) {
  const approvals = listApprovals(projectId).map((row) => ({
    id: row.id,
    role: row.role,
    decision: row.decision as "approved" | "rejected",
    actorId: row.actor_id,
    at: row.created_at,
  }));
  const floor = (await getFloorPlanAsync(projectId)) ?? getFloorPlan(projectId);
  const sketch = getSketchUpResult(projectId);
  const dimensionsVerified = Boolean(floor?.dimensions_verified);
  const sceneVersion = floor?.geometry_version ?? sketch?.geometryVersion ?? "unversioned";

  const renderArtifacts = await hydrateRenders(projectId);
  const allScenesReady = REQUIRED_SCENES.every((sceneId) =>
    renderArtifacts.some((item) => item.sceneId === sceneId),
  );
  const renderManifest: SceneScreenshotManifest | null =
    allScenesReady
      ? {
          manifestId: `rman_${projectId}`,
          projectId,
          sceneVersion,
          createdAt: new Date().toISOString(),
          screenshots: REQUIRED_SCENES.map((sceneId) => {
            const match = renderArtifacts.find((item) => item.sceneId === sceneId)!;
            return {
              renderId: match.renderId,
              sceneId,
              sceneVersion: match.sceneVersion,
              imageUri: match.imageUri ?? "",
              width: match.width,
              height: match.height,
              sha256: "0".repeat(64),
              capturedAt: match.completedAt ?? match.createdAt,
            };
          }),
        }
      : null;

  const storedBom = listBom(projectId);
  const latestQuote = getLatestQuote(projectId);
  const skuCounts = sketch ? Object.fromEntries((sketch.componentStats as Array<{sku:string;quantity:number}>).map((row)=>[row.sku,row.quantity])) : {};
  const sketchUp =
    sketch?.status === "COMPLETED"
      ? {
          status: "COMPLETED" as const,
          geometryVersion: sketch.geometryVersion,
          skuCounts,
        }
      : null;

  return {
    projectId,
    sceneVersion,
    dimensionsVerified,
    unverifiedDimensionIds: dimensionsVerified ? [] : ["dim_wall_a"],
    coverage: [],
    bom: storedBom.map((row)=>({sku:String(row.sku),quantity:Number(row.quantity),unitPrice:Number(row.unit_price),name:String(row.name),materialCode:row.material_code?String(row.material_code):undefined})),
    quote: latestQuote ? storedBom.map((row)=>({sku:String(row.sku),quantity:Number(row.quantity),unitPrice:Number(row.unit_price)})) : [],
    sketchUp,
    renderManifest,
    requiredSceneIds: [...REQUIRED_SCENES],
    approvals,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const requestedFinal = url.searchParams.get("status") === "FINAL";
  try {
  if (!useCloudDb()) getDb();
  await requireOwnedProject(id);
  const approval = new FinalApprovalService().checkFinal(await approvalInput(id));
  if (requestedFinal && !approval.approved) {
    return Response.json(
      {
        error: "FINAL_EXPORT_BLOCKED",
        issues: approval.blocks.map((block) => block.message),
        blocks: approval.blocks,
        checkedAt: approval.checkedAt,
      },
      { status: 409 },
    );
  }

  const status = requestedFinal && approval.approved ? "FINAL" : "DRAFT";
  const hydrated = await hydrateRenders(id);
  const scenes = [];
  for (const sceneId of REQUIRED_SCENES) {
    const artifact = hydrated.find((item) => item.sceneId === sceneId && item.imageUri);
    let image: Buffer;
    let caption = "非照片级渲染占位；请在方案页上传 SketchUp 场景 PNG。";
    if (artifact?.imageUri) {
      try {
        image = useCloudDb()
          ? ((await readScenePng(id, sceneId)) ?? (await placeholderPng(sceneId)))
          : await readFile(artifact.imageUri);
        caption = `Scene ${sceneId} · ${artifact.renderer} · ${artifact.sceneVersion}`;
      } catch {
        image = await placeholderPng(sceneId);
      }
    } else {
      image = await placeholderPng(sceneId);
    }
    scenes.push({ title: sceneId, image: new Uint8Array(image), caption });
  }

  const bomRows = listBom(id);
  const bom =
    bomRows.length > 0
      ? bomRows.map((row) => ({
          sku: String(row.sku),
          name: String(row.name),
          quantity: Number(row.quantity),
          unitPrice: Number(row.unit_price),
          materialCode: row.material_code ? String(row.material_code) : undefined,
        }))
      : [
          {
            sku: "DRAFT-PLACEHOLDER",
            name: "方案草案（请在采购页导入 BOM）",
            quantity: 1,
            unitPrice: 0,
            materialCode: undefined,
          },
        ];
  if (bomRows.length === 0 && requestedFinal) {
    return Response.json({ error: "BOM_EMPTY" }, { status: 409 });
  }
  const subtotal = bom.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const storedQuote=getLatestQuote(id);
  const tax=Number(storedQuote?.tax??0),designFee=Number(storedQuote?.design_fee??0),discount=Number(storedQuote?.discount??0);
  const quote = { currency: "HKD", subtotal, tax, total: subtotal + tax + designFee - discount };

  let fontPath: string;
  try {
    fontPath = await resolveCjkFontPath(process.env.NOTO_CJK_FONT_PATH);
  } catch {
    return Response.json(
      {
        error: "CJK_FONT_NOT_CONFIGURED",
        message: "设置 NOTO_CJK_FONT_PATH 或安装系统 CJK 字体后才能生成生产级 PDF。",
      },
      { status: 503 },
    );
  }

  const floorRow = (await getFloorPlanAsync(id)) ?? getFloorPlan(id);
  const pdfService = new CJKPdfService({ fontPath });
  const approvalRows = listApprovals(id);
  let bytes = await pdfService.generate({
    projectId: id,
    title: `Sharkflows 方案 ${id}`,
    status,
    sceneVersion: floorRow?.geometry_version ?? "unversioned",
    scenes,
    bom,
    quote,
    approvals: approvalRows.length
      ? approvalRows.map((row) => ({
          role: row.role,
          actorId: row.actor_id,
          decision: row.decision,
          at: row.created_at,
        }))
      : [{ role: "system", actorId: "draft", decision: "pending", at: new Date().toISOString() }],
  });

  if (status === "FINAL") {
    const signature = await createQuoteSignatureProvider().sign(bytes, {
      projectId: id,
      approvedBy: "final-export",
    });
    recordQuoteSignature({
      projectId: id,
      documentSha256: signature.documentSha256,
      signatureId: signature.signatureId,
      signedBy: signature.signedBy,
      signedAt: signature.signedAt,
      verified: signature.verified,
      provider: signature.provider,
      stampText: signature.stampText,
    });
    bytes = await pdfService.generate({
      projectId: id,
      title: `Sharkflows 方案 ${id}`,
      status,
      sceneVersion: floorRow?.geometry_version ?? "unversioned",
      scenes,
      bom,
      quote,
      approvals: approvalRows.map((row) => ({
        role: row.role,
        actorId: row.actor_id,
        decision: row.decision,
        at: row.created_at,
      })),
      signature,
    });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="sharkflows-${id}-${status.toLowerCase()}.pdf"`,
      "Cache-Control": "no-store",
      "X-Proposal-Status": status,
    },
  });
  } catch (error) {
    return accessErrorResponse(error) ?? Response.json({error:error instanceof Error?error.message:"EXPORT_FAILED"},{status:500});
  }
}
