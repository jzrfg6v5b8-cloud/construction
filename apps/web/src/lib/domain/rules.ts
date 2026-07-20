import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AssetKindSchema,
  ConsistencyIssueSchema,
} from "./schemas";
import type {
  Asset,
  AssetCoverage,
  AssetKind,
  ConsistencyIssue,
  ProductRepresentation,
  Proposal,
  SceneObject,
} from "./schemas";

export const NamedAssetInputSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1).optional(),
});
export type NamedAssetInput = z.infer<typeof NamedAssetInputSchema>;

const EXTENSION_RULES: ReadonlyArray<[RegExp, AssetKind]> = [
  [/(平面|floor.?plan|户型)/i, "floor_plan"],
  [/(立面|elevation)/i, "elevation"],
  [/(剖面|section)/i, "section"],
  [/(现场|site|工地)/i, "site_photo"],
  [/(产品|product|sku)/i, "product_image"],
  [/\.(xlsx?|csv)$/i, "spreadsheet"],
  [/\.(docx?|pdf|txt)$/i, "document"],
];

export function classifyAsset(input: NamedAssetInput): AssetKind {
  const parsed = NamedAssetInputSchema.parse(input);
  const name = parsed.name.trim();
  const namedRule = EXTENSION_RULES.find(([pattern]) => pattern.test(name));
  if (namedRule) return namedRule[1];
  if (parsed.mimeType?.startsWith("image/")) return AssetKindSchema.parse("unknown");
  if (parsed.mimeType === "application/pdf") return AssetKindSchema.parse("document");
  return AssetKindSchema.parse("unknown");
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export const DuplicateGroupSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  assetIds: z.array(z.string().min(1)).min(2),
});
export type DuplicateGroup = z.infer<typeof DuplicateGroupSchema>;

export function detectDuplicateAssets(assets: readonly Pick<Asset, "id" | "sha256">[]): DuplicateGroup[] {
  const groups = new Map<string, string[]>();
  for (const asset of assets) groups.set(asset.sha256, [...(groups.get(asset.sha256) ?? []), asset.id]);
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, assetIds]) => DuplicateGroupSchema.parse({ sha256: hash, assetIds }));
}

export const DimensionSegmentSchema = z.object({
  axis: z.enum(["x", "y"]),
  lengthMm: z.number().finite().positive(),
});
export const DimensionClosureSchema = z.object({
  valid: z.boolean(),
  expectedWidthMm: z.number().finite().positive(),
  expectedDepthMm: z.number().finite().positive(),
  measuredWidthMm: z.number().finite().nonnegative(),
  measuredDepthMm: z.number().finite().nonnegative(),
  toleranceMm: z.number().finite().nonnegative(),
  errors: z.array(z.enum(["WIDTH_NOT_CLOSED", "DEPTH_NOT_CLOSED"])),
});
export type DimensionSegment = z.infer<typeof DimensionSegmentSchema>;
export type DimensionClosure = z.infer<typeof DimensionClosureSchema>;

export function validateDimensionClosure(
  segments: readonly DimensionSegment[],
  expected: { widthMm: number; depthMm: number },
  toleranceMm = 2,
): DimensionClosure {
  if (toleranceMm < 0) throw new RangeError("Tolerance must be non-negative");
  const parsedSegments = z.array(DimensionSegmentSchema).parse(segments);
  const measuredWidthMm = parsedSegments.filter((item) => item.axis === "x").reduce((sum, item) => sum + item.lengthMm, 0);
  const measuredDepthMm = parsedSegments.filter((item) => item.axis === "y").reduce((sum, item) => sum + item.lengthMm, 0);
  const errors: Array<"WIDTH_NOT_CLOSED" | "DEPTH_NOT_CLOSED"> = [];
  if (Math.abs(measuredWidthMm - expected.widthMm) > toleranceMm) errors.push("WIDTH_NOT_CLOSED");
  if (Math.abs(measuredDepthMm - expected.depthMm) > toleranceMm) errors.push("DEPTH_NOT_CLOSED");
  return DimensionClosureSchema.parse({
    valid: errors.length === 0,
    expectedWidthMm: expected.widthMm,
    expectedDepthMm: expected.depthMm,
    measuredWidthMm,
    measuredDepthMm,
    toleranceMm,
    errors,
  });
}

export const RepresentationRuleResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
});
export type RepresentationRuleResult = z.infer<typeof RepresentationRuleResultSchema>;

export function validateRepresentation(representation: ProductRepresentation): RepresentationRuleResult {
  const errors: string[] = [];
  if (representation.kind === "catalog" && !representation.modelUri) errors.push("CATALOG_MODEL_REQUIRED");
  if (representation.kind === "custom" && representation.sourceAssetIds.length === 0) errors.push("CUSTOM_SOURCE_REQUIRED");
  if (representation.lod >= 2 && !representation.modelUri) errors.push("LOD_MODEL_REQUIRED");
  if (!representation.isDimensionallyVerified && representation.kind !== "proxy") {
    errors.push("DIMENSIONS_UNVERIFIED");
  }
  return RepresentationRuleResultSchema.parse({ valid: errors.length === 0, errors });
}

export function checkAssetCoverage(
  assets: readonly Pick<Asset, "id" | "kind">[],
  sceneObjects: readonly SceneObject[],
  representations: readonly ProductRepresentation[],
): AssetCoverage[] {
  return assets.map((asset) => {
    const sceneIds = [...new Set(sceneObjects.filter((item) => item.sourceAssetIds.includes(asset.id)).map((item) => item.sceneId))];
    const representationIds = representations
      .filter((item) => item.sourceAssetIds.includes(asset.id))
      .map((item) => item.id);
    const required = asset.kind !== "unknown" && asset.kind !== "spreadsheet";
    const productNeedsBoth = asset.kind === "product_image";
    const links = sceneIds.length + representationIds.length;
    return {
      assetId: asset.id,
      status: !required
        ? "not_required"
        : links === 0
          ? "missing"
          : productNeedsBoth && (sceneIds.length === 0 || representationIds.length === 0)
            ? "partial"
            : "covered",
      sceneIds,
      representationIds,
      notes: links === 0 && required ? ["No scene or representation references this asset"] : [],
    };
  });
}

export function checkProposalConsistency(proposal: Proposal): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const representations = new Map(proposal.representations.map((item) => [item.id, item]));
  const scenes = proposal.sceneSet.scenes;
  const objects = scenes.flatMap((scene) => scene.objects);
  const objectIds = new Set(objects.map((item) => item.id));

  for (const object of objects) {
    if (object.representationId && !representations.has(object.representationId)) {
      issues.push(issue("MISSING_REPRESENTATION", "error", `Object ${object.id} references a missing representation`, [object.id]));
    }
    if (object.parentId && !objectIds.has(object.parentId)) {
      issues.push(issue("MISSING_PARENT", "error", `Object ${object.id} references a missing parent`, [object.id]));
    }
  }

  for (const item of proposal.procurement.items) {
    for (const objectId of item.sceneObjectIds) {
      if (!objectIds.has(objectId)) {
        issues.push(issue("MISSING_PROCUREMENT_OBJECT", "error", `Procurement item ${item.id} references a missing object`, [item.id]));
      }
    }
    if (item.productRepresentationId && !representations.has(item.productRepresentationId)) {
      issues.push(issue("MISSING_PROCUREMENT_REPRESENTATION", "error", `Procurement item ${item.id} has no representation`, [item.id]));
    }
  }

  const currencies = new Set(proposal.procurement.items.map((item) => item.currency));
  if (currencies.size > 1 || (currencies.size === 1 && !currencies.has(proposal.procurement.currency))) {
    issues.push(issue("CURRENCY_MISMATCH", "error", "Procurement currencies are inconsistent"));
  }
  for (const representation of proposal.representations) {
    for (const code of validateRepresentation(representation).errors) {
      issues.push(issue(code, code === "DIMENSIONS_UNVERIFIED" ? "warning" : "error", `Representation ${representation.id}: ${code}`, [representation.id]));
    }
  }
  return issues;
}

function issue(code: string, severity: ConsistencyIssue["severity"], message: string, entityIds: string[] = []): ConsistencyIssue {
  return { code, severity, message, entityIds };
}

export const ExportGateResultSchema = z.object({
  allowed: z.boolean(),
  reasons: z.array(z.string()),
  issues: z.array(ConsistencyIssueSchema),
});
export type ExportGateResult = z.infer<typeof ExportGateResultSchema>;

export function finalExportGate(proposal: Proposal): ExportGateResult {
  const issues = checkProposalConsistency(proposal);
  const reasons: string[] = [];
  if (proposal.status !== "final") reasons.push("PROPOSAL_NOT_FINAL");
  if (!proposal.approvedBy || !proposal.approvedAt) reasons.push("APPROVAL_REQUIRED");
  if (proposal.coverage.some((item) => item.status === "missing" || item.status === "partial")) {
    reasons.push("ASSET_COVERAGE_INCOMPLETE");
  }
  if (issues.some((item) => item.severity === "error")) reasons.push("CONSISTENCY_ERRORS");
  if (proposal.sceneSet.scenes.some((scene) => scene.objects.length === 0)) reasons.push("EMPTY_SCENE");
  return ExportGateResultSchema.parse({ allowed: reasons.length === 0, reasons, issues });
}
