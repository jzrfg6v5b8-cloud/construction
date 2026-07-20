import { detectExpiredScreenshots, type SceneScreenshotManifest } from "@/lib/rendering";
import { reconcileSkuQuantities, type QuantityLine } from "@/lib/sketchup/reconciliation";

export type ApprovalBlock = {
  code: string;
  message: string;
  entityIds: string[];
};

export type FinalApprovalInput = {
  projectId: string;
  sceneVersion: string;
  dimensionsVerified: boolean;
  unverifiedDimensionIds?: string[];
  coverage: Array<{ assetId: string; required: boolean; status: "covered" | "partial" | "missing" | "not_required" }>;
  bom: Array<QuantityLine & { name?: string; unitPrice?: number; materialCode?: string }>;
  quote: Array<QuantityLine & { unitPrice?: number }>;
  sketchUp: {
    status: string;
    geometryVersion: string;
    skuCounts: Record<string, number>;
  } | null;
  renderManifest: SceneScreenshotManifest | null;
  requiredSceneIds: string[];
  approvals: Array<{
    id: string;
    role: string;
    decision: "approved" | "rejected";
    actorId: string;
    at: string;
  }>;
};

export type ApprovalResult = {
  approved: boolean;
  blocks: ApprovalBlock[];
  checkedAt: string;
};

export interface ApprovalService {
  checkFinal(input: FinalApprovalInput): ApprovalResult;
}

function block(code: string, message: string, entityIds: string[] = []): ApprovalBlock {
  return { code, message, entityIds };
}

export class FinalApprovalService implements ApprovalService {
  checkFinal(input: FinalApprovalInput): ApprovalResult {
    const blocks: ApprovalBlock[] = [];
    if (!input.dimensionsVerified || (input.unverifiedDimensionIds?.length ?? 0) > 0) {
      blocks.push(block("DIMENSIONS_UNVERIFIED", "存在未核验尺寸", input.unverifiedDimensionIds ?? []));
    }
    for (const coverage of input.coverage) {
      if (coverage.required && coverage.status !== "covered") {
        blocks.push(block("ASSET_COVERAGE_INCOMPLETE", `必需资产 ${coverage.assetId} 未完整覆盖`, [coverage.assetId]));
      }
    }
    if (input.bom.length === 0) blocks.push(block("BOM_EMPTY", "BOM 不能为空"));
    for (const line of input.bom) {
      if (!line.sku.trim() || !Number.isFinite(line.quantity) || line.quantity <= 0) {
        blocks.push(block("BOM_LINE_INVALID", `BOM 条目无效: ${line.sku || "(empty)"}`, [line.sku]));
      }
      if (line.unitPrice === undefined || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
        blocks.push(block("BOM_PRICE_INVALID", `SKU ${line.sku} 缺少有效单价`, [line.sku]));
      }
    }
    if (!input.sketchUp) {
      blocks.push(block("SKETCHUP_RESULT_MISSING", "缺少 SketchUp 数量结果"));
    } else {
      if (input.sketchUp.status !== "COMPLETED") blocks.push(block("SKETCHUP_NOT_COMPLETED", "SketchUp 结果尚未完成"));
      if (input.sketchUp.geometryVersion !== input.sceneVersion) {
        blocks.push(block("SKETCHUP_SCENE_VERSION_MISMATCH", "SketchUp 与 Scene 版本不一致"));
      }
      for (const mismatch of reconcileSkuQuantities(input.bom, input.sketchUp.skuCounts, input.quote).mismatches) {
        blocks.push(block(mismatch.code, `SKU ${mismatch.sku} 的 BOM/模型/报价数量不一致`, [mismatch.sku]));
      }
    }
    if (!input.renderManifest) {
      blocks.push(block("RENDER_MANIFEST_MISSING", "缺少场景截图 manifest"));
    } else {
      const expiry = detectExpiredScreenshots(input.renderManifest, input.sceneVersion, input.requiredSceneIds);
      for (const reason of expiry.reasons) blocks.push(block("RENDER_EXPIRED", reason));
    }
    const approved = input.approvals.filter((item) => item.decision === "approved");
    if (approved.length === 0) blocks.push(block("APPROVAL_RECORD_MISSING", "缺少签字审批记录"));
    if (input.approvals.some((item) => item.decision === "rejected")) {
      blocks.push(block("APPROVAL_REJECTED", "审批记录包含拒绝决定"));
    }
    return { approved: blocks.length === 0, blocks, checkedAt: new Date().toISOString() };
  }
}
