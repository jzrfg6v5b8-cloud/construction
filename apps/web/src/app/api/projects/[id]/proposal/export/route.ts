import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { CJKPdfService } from "@/lib/proposal/cjk-pdf-service";
import { resolveCjkFontPath } from "@/lib/proposal/cjk-font";
import { FinalApprovalService } from "@/lib/proposal/approval-service";
import { createQuoteSignatureProvider } from "@/lib/proposal/quote-signature-provider";
import { getDb } from "@/lib/db/client";
import { getFloorPlan, getSketchUpResult, listRenderArtifacts } from "@/lib/db/repositories";
import { PROPOSAL_SCENE_IDS, syncRenderRowToMemory } from "@/lib/rendering/ingest-scene-png";
import { renderStore } from "@/lib/rendering/render-store";
import type { SceneScreenshotManifest } from "@/lib/rendering";

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

function hydrateRenders(projectId: string) {
  const rows = listRenderArtifacts(projectId);
  rows.forEach(syncRenderRowToMemory);
  return renderStore.list(projectId).filter((item) => item.status === "ready" && item.imageUri);
}

function demoApprovalInput(projectId: string, forceFinal: boolean) {
  const approvals = listApprovals(projectId).map((row) => ({
    id: row.id,
    role: row.role,
    decision: row.decision as "approved" | "rejected",
    actorId: row.actor_id,
    at: row.created_at,
  }));
  if (forceFinal && approvals.length === 0) {
    approvals.push({
      id: "apr_demo_force",
      role: "designer",
      decision: "approved",
      actorId: "demo-approver",
      at: new Date().toISOString(),
    });
  }

  const floor = getFloorPlan(projectId);
  const sketch = getSketchUpResult(projectId);
  const dimensionsVerified = forceFinal || Boolean(floor?.dimensions_verified);
  const sceneVersion = floor?.geometry_version ?? sketch?.geometryVersion ?? "demo-v3";

  const renderArtifacts = hydrateRenders(projectId);
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
      : forceFinal
        ? {
            manifestId: `rman_${projectId}_force`,
            projectId,
            sceneVersion,
            createdAt: new Date().toISOString(),
            screenshots: REQUIRED_SCENES.map((sceneId) => ({
              renderId: `force_${sceneId}`,
              sceneId,
              sceneVersion,
              imageUri: `memory://${sceneId}`,
              width: 1280,
              height: 720,
              sha256: "0".repeat(64),
              capturedAt: new Date().toISOString(),
            })),
          }
        : null;

  const sketchUp =
    sketch?.status === "COMPLETED" || forceFinal
      ? {
          status: "COMPLETED" as const,
          geometryVersion: sketch?.geometryVersion ?? sceneVersion,
          skuCounts: { "SF-SOFA-001": 1, "SF-LAMP-009": 2 },
        }
      : null;

  return {
    projectId,
    sceneVersion,
    dimensionsVerified,
    unverifiedDimensionIds: dimensionsVerified ? [] : ["dim_wall_a"],
    coverage: [
      { assetId: "ast_material_07", required: true, status: forceFinal || dimensionsVerified ? ("covered" as const) : ("missing" as const) },
      { assetId: "ast_floorplan_01", required: true, status: "covered" as const },
    ],
    bom: [
      { sku: "SF-SOFA-001", quantity: 1, unitPrice: 12800, name: "三人沙发", materialCode: "MAT-FAB-01" },
      { sku: "SF-LAMP-009", quantity: 2, unitPrice: forceFinal || sketchUp ? 680 : undefined, name: "落地灯" },
    ],
    quote: [
      { sku: "SF-SOFA-001", quantity: 1, unitPrice: 12800 },
      { sku: "SF-LAMP-009", quantity: 2, unitPrice: 680 },
    ],
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
  const forceDemoFinal = url.searchParams.get("forceDemoFinal") === "1" && process.env.NODE_ENV !== "production";

  getDb();
  const approval = new FinalApprovalService().checkFinal(demoApprovalInput(id, forceDemoFinal));
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
  const hydrated = hydrateRenders(id);
  const scenes = [];
  for (const sceneId of REQUIRED_SCENES) {
    const artifact = hydrated.find((item) => item.sceneId === sceneId && item.imageUri);
    let image: Buffer;
    let caption = "非照片级渲染占位；请在方案页上传 SketchUp 场景 PNG。";
    if (artifact?.imageUri) {
      try {
        image = await readFile(artifact.imageUri);
        caption = `Scene ${sceneId} · ${artifact.renderer} · ${artifact.sceneVersion}`;
      } catch {
        image = await placeholderPng(sceneId);
      }
    } else {
      image = await placeholderPng(sceneId);
    }
    scenes.push({ title: sceneId, image: new Uint8Array(image), caption });
  }

  const bom = [
    { sku: "SF-SOFA-001", name: "三人沙发", quantity: 1, unitPrice: 12800, materialCode: "MAT-FAB-01" },
    { sku: "SF-LAMP-009", name: "落地灯", quantity: 2, unitPrice: 680 },
  ];
  const subtotal = bom.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const tax = Math.round(subtotal * 0.06 * 100) / 100;
  const quote = { currency: "CNY", subtotal, tax, total: subtotal + tax };

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

  const pdfService = new CJKPdfService({ fontPath });
  const approvalRows = listApprovals(id);
  let bytes = await pdfService.generate({
    projectId: id,
    title: `Sharkflows 方案 ${id}`,
    status,
    sceneVersion: "demo-v3",
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
      sceneVersion: "demo-v3",
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
}
