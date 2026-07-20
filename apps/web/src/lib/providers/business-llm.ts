import { z } from "zod";

const BoxSchema = z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() });
const EvidenceSchema = z.object({
  sourceAssetId: z.string().min(1),
  sourceBoundingBox: BoxSchema.optional(),
  confidence: z.number().min(0).max(1),
  extractionMethod: z.string().min(1),
});

export const StructuredVisionResultSchema = z.object({
  assetId: z.string().min(1),
  assetType: z.string().min(1),
  texts: z.array(z.object({ text: z.string(), evidence: EvidenceSchema })),
  detections: z.array(z.object({ label: z.string(), attributes: z.record(z.string(), z.unknown()), evidence: EvidenceSchema })),
});
export const LLMExtractionResultSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  missingFields: z.array(z.string()),
  conflicts: z.array(z.string()),
  questions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export const FloorPlanOCRResultSchema = z.object({
  assetId: z.string(),
  measurements: z.array(z.object({ value: z.number().positive(), unit: z.string(), label: z.string(), evidence: EvidenceSchema })),
  rooms: z.array(z.string()),
  scaleText: z.string().optional(),
});
export const MeasurementReconciliationSchema = z.object({
  acceptedCandidateIds: z.array(z.string()),
  conflicts: z.array(z.object({ candidateIds: z.array(z.string()), explanation: z.string(), blocking: z.boolean() })),
  closureErrorMm: z.number().nonnegative().nullable(),
  questions: z.array(z.string()),
  requiresHumanReview: z.literal(true),
});
export const ProductOCRResultSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  rawText: z.string(),
  candidateFields: z.record(z.string(), z.unknown()),
});
export const ProductClassificationSchema = z.object({
  category: z.enum(["家具", "柜体", "门", "地板", "墙面", "瓷砖", "灯具", "五金", "洁具", "电器", "窗帘", "装饰", "施工材料", "其他"]),
  confidence: z.number().min(0).max(1),
  missingFields: z.array(z.string()),
  conflicts: z.array(z.string()),
  questions: z.array(z.string()),
});
export const ProductSceneInputSchema = z.object({
  productId: z.string(),
  sku: z.string().nullable(),
  category: z.string(),
  dimensionsMm: z.object({ width: z.number(), depth: z.number(), height: z.number() }).nullable(),
  candidateRooms: z.array(z.string()),
});
export const ProductSceneMatchSchema = z.object({
  roomId: z.string(),
  score: z.number().min(0).max(1),
  rationale: z.string(),
  requiresDimensions: z.boolean(),
});
export const LayoutRecommendationInputSchema = z.object({
  floorPlanId: z.string(),
  versionId: z.string(),
  rooms: z.array(z.object({ id: z.string(), name: z.string(), widthMm: z.number().positive(), depthMm: z.number().positive() })),
  verifiedOnly: z.literal(true),
});
export const LayoutRecommendationSchema = z.object({
  templateId: z.string(),
  placements: z.array(z.object({ roomId: z.string(), productTemplate: z.string(), xMm: z.number(), yMm: z.number(), rotationDeg: z.number() })),
  warnings: z.array(z.string()),
  requiresDesigner: z.boolean(),
});
export const ProposalContextSchema = z.object({
  projectId: z.string(),
  sceneSetId: z.string(),
  verifiedFacts: z.record(z.string(), z.unknown()),
  validationIssues: z.array(z.string()),
});
export const ProposalCopySchema = z.object({
  title: z.string(),
  summary: z.string(),
  roomCopy: z.record(z.string(), z.string()),
  disclaimers: z.array(z.string()),
});
export const ValidationIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["INFO", "WARNING", "BLOCKING"]),
  message: z.string(),
  entityId: z.string().optional(),
});

export type StructuredVisionResult = z.infer<typeof StructuredVisionResultSchema>;
export type LLMExtractionResult = z.infer<typeof LLMExtractionResultSchema>;
export type FloorPlanOCRResult = z.infer<typeof FloorPlanOCRResultSchema>;
export type MeasurementReconciliation = z.infer<typeof MeasurementReconciliationSchema>;
export type ProductOCRResult = z.infer<typeof ProductOCRResultSchema>;
export type ProductClassification = z.infer<typeof ProductClassificationSchema>;
export type ProductSceneInput = z.infer<typeof ProductSceneInputSchema>;
export type ProductSceneMatch = z.infer<typeof ProductSceneMatchSchema>;
export type LayoutRecommendationInput = z.infer<typeof LayoutRecommendationInputSchema>;
export type LayoutRecommendation = z.infer<typeof LayoutRecommendationSchema>;
export type ProposalContext = z.infer<typeof ProposalContextSchema>;
export type ProposalCopy = z.infer<typeof ProposalCopySchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export interface LLMProvider {
  extractStructuredBusinessData(input: StructuredVisionResult): Promise<LLMExtractionResult>;
  reconcileFloorPlanMeasurements(input: FloorPlanOCRResult): Promise<MeasurementReconciliation>;
  classifyProcurementItem(input: ProductOCRResult): Promise<ProductClassification>;
  matchProductToScene(input: ProductSceneInput): Promise<ProductSceneMatch[]>;
  recommendLayout(input: LayoutRecommendationInput): Promise<LayoutRecommendation>;
  generateProposalCopy(input: ProposalContext): Promise<ProposalCopy>;
  summarizeValidationIssues(input: ValidationIssue[]): Promise<string>;
}

export type BusinessLLMProvider = LLMProvider;
