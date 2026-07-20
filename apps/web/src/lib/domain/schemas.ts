import { z } from "zod";

const Id = z.string().min(1);
const Timestamp = z.string().datetime({ offset: true });
const Confidence = z.number().min(0).max(1);
const Positive = z.number().finite().positive();
const NonNegative = z.number().finite().nonnegative();

export const AssetKindSchema = z.enum([
  "floor_plan",
  "elevation",
  "section",
  "product_image",
  "site_photo",
  "specification",
  "spreadsheet",
  "document",
  "unknown",
]);
export const AssetStatusSchema = z.enum(["uploaded", "classified", "processing", "ready", "failed"]);
export const ProcessingKindSchema = z.enum(["classify", "ocr", "vision", "measure", "render"]);
export const ProcessingStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export const CandidateStatusSchema = z.enum(["suggested", "accepted", "rejected"]);
export const MeasurementKindSchema = z.enum([
  "length",
  "width",
  "height",
  "area",
  "quantity",
  "diameter",
  "angle",
]);
export const MeasurementUnitSchema = z.enum(["mm", "cm", "m", "m2", "count", "degree"]);
export const ProcurementStatusSchema = z.enum(["draft", "confirmed", "ordered", "cancelled"]);
export const RepresentationKindSchema = z.enum(["catalog", "parametric", "proxy", "custom"]);
export const SceneObjectKindSchema = z.enum(["space", "wall", "opening", "product", "fixture", "annotation"]);
export const RenderStatusSchema = z.enum(["queued", "rendering", "ready", "failed"]);
export const ProposalStatusSchema = z.enum(["draft", "review", "approved", "final", "rejected"]);
export const CoverageStatusSchema = z.enum(["covered", "partial", "missing", "not_required"]);
export const SeveritySchema = z.enum(["info", "warning", "error"]);

export type AssetKind = z.infer<typeof AssetKindSchema>;
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>;

export const SourceEvidenceSchema = z.object({
  assetId: Id,
  page: z.number().int().positive().optional(),
  region: z
    .object({ x: NonNegative, y: NonNegative, width: Positive, height: Positive })
    .optional(),
  excerpt: z.string().min(1).optional(),
});

export const AssetSchema = z.object({
  id: Id,
  name: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  kind: AssetKindSchema,
  status: AssetStatusSchema,
  uri: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  pageCount: z.number().int().positive().optional(),
  createdAt: Timestamp,
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ProcessingSchema = z.object({
  id: Id,
  assetId: Id,
  kind: ProcessingKindSchema,
  status: ProcessingStatusSchema,
  attempt: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1),
  provider: z.string().min(1),
  startedAt: Timestamp.optional(),
  completedAt: Timestamp.optional(),
  error: z.string().min(1).optional(),
  outputRef: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.status === "failed" && !value.error) {
    ctx.addIssue({ code: "custom", path: ["error"], message: "Failed processing requires an error" });
  }
});

/** AI/OCR suggestions. Never use directly as approved business measurements. */
export const OCRCandidateSchema = z.object({
  id: Id,
  processingId: Id,
  text: z.string(),
  confidence: Confidence,
  evidence: SourceEvidenceSchema,
  status: CandidateStatusSchema.default("suggested"),
});

export const OCRSchema = z.object({
  processingId: Id,
  engine: z.string().min(1),
  isHeuristic: z.boolean(),
  candidates: z.array(OCRCandidateSchema),
  warnings: z.array(z.string()).default([]),
});

export const VisionDetectionSchema = z.object({
  id: Id,
  label: z.string().min(1),
  confidence: Confidence,
  evidence: SourceEvidenceSchema,
  attributes: z.record(z.string(), z.unknown()).default({}),
  status: CandidateStatusSchema.default("suggested"),
});

export const VisionSchema = z.object({
  processingId: Id,
  engine: z.string().min(1),
  isHeuristic: z.boolean(),
  detections: z.array(VisionDetectionSchema),
  warnings: z.array(z.string()).default([]),
});

/** Candidate only; acceptance must create a separate formal domain measurement. */
export const MeasurementCandidateSchema = z.object({
  id: Id,
  processingId: Id,
  kind: MeasurementKindSchema,
  value: Positive,
  unit: MeasurementUnitSchema,
  label: z.string().min(1),
  confidence: Confidence,
  evidence: SourceEvidenceSchema,
  status: CandidateStatusSchema.default("suggested"),
});

export const MeasurementSchema = z.object({
  id: Id,
  kind: MeasurementKindSchema,
  value: Positive,
  unit: MeasurementUnitSchema,
  label: z.string().min(1),
  sourceCandidateId: Id.optional(),
  verifiedBy: Id,
  verifiedAt: Timestamp,
});

export const DimensionsSchema = z.object({
  widthMm: Positive,
  depthMm: Positive,
  heightMm: Positive,
});

export const ProcurementItemSchema = z.object({
  id: Id,
  sku: z.string().min(1),
  name: z.string().min(1),
  quantity: Positive,
  unit: z.string().min(1),
  unitPrice: NonNegative,
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  productRepresentationId: Id.optional(),
  sceneObjectIds: z.array(Id).default([]),
  status: ProcurementStatusSchema,
  evidence: z.array(SourceEvidenceSchema).default([]),
});

export const ProcurementSchema = z.object({
  id: Id,
  items: z.array(ProcurementItemSchema),
  subtotal: NonNegative,
  tax: NonNegative,
  total: NonNegative,
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
}).superRefine((value, ctx) => {
  const expectedSubtotal = value.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  if (Math.abs(expectedSubtotal - value.subtotal) > 0.01) {
    ctx.addIssue({ code: "custom", path: ["subtotal"], message: "Subtotal does not match line items" });
  }
  if (Math.abs(value.subtotal + value.tax - value.total) > 0.01) {
    ctx.addIssue({ code: "custom", path: ["total"], message: "Total must equal subtotal plus tax" });
  }
});

export const ProductRepresentationSchema = z.object({
  id: Id,
  productId: Id,
  kind: RepresentationKindSchema,
  dimensions: DimensionsSchema,
  modelUri: z.string().min(1).optional(),
  materialIds: z.array(Id).default([]),
  sourceAssetIds: z.array(Id).default([]),
  isDimensionallyVerified: z.boolean(),
  lod: z.number().int().min(0).max(4),
});

export const TransformSchema = z.object({
  positionMm: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  rotationDeg: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  scale: z.tuple([Positive, Positive, Positive]).default([1, 1, 1]),
});

export const SceneObjectSchema = z.object({
  id: Id,
  sceneId: Id,
  kind: SceneObjectKindSchema,
  name: z.string().min(1),
  transform: TransformSchema,
  dimensions: DimensionsSchema.optional(),
  representationId: Id.optional(),
  parentId: Id.optional(),
  sourceAssetIds: z.array(Id).default([]),
  visible: z.boolean().default(true),
});

export const SceneSchema = z.object({
  id: Id,
  name: z.string().min(1),
  objects: z.array(SceneObjectSchema),
  sourceAssetIds: z.array(Id).default([]),
  revision: z.number().int().positive(),
});

export const SceneSetSchema = z.object({
  id: Id,
  name: z.string().min(1),
  scenes: z.array(SceneSchema).min(1),
  activeSceneId: Id,
}).superRefine((value, ctx) => {
  if (!value.scenes.some((scene) => scene.id === value.activeSceneId)) {
    ctx.addIssue({ code: "custom", path: ["activeSceneId"], message: "Active scene must belong to scene set" });
  }
});

export const SceneRenderSchema = z.object({
  id: Id,
  sceneId: Id,
  status: RenderStatusSchema,
  imageUri: z.string().min(1).optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  renderer: z.string().min(1),
  createdAt: Timestamp,
  error: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.status === "ready" && !value.imageUri) {
    ctx.addIssue({ code: "custom", path: ["imageUri"], message: "Ready render requires an image URI" });
  }
});

export const AssetCoverageSchema = z.object({
  assetId: Id,
  status: CoverageStatusSchema,
  sceneIds: z.array(Id).default([]),
  representationIds: z.array(Id).default([]),
  notes: z.array(z.string()).default([]),
});

export const ConsistencyIssueSchema = z.object({
  code: z.string().min(1),
  severity: SeveritySchema,
  message: z.string().min(1),
  entityIds: z.array(Id).default([]),
});

export const ProposalSchema = z.object({
  id: Id,
  title: z.string().min(1),
  status: ProposalStatusSchema,
  sceneSet: SceneSetSchema,
  procurement: ProcurementSchema,
  representations: z.array(ProductRepresentationSchema),
  coverage: z.array(AssetCoverageSchema),
  issues: z.array(ConsistencyIssueSchema).default([]),
  approvedBy: Id.optional(),
  approvedAt: Timestamp.optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}).superRefine((value, ctx) => {
  if ((value.status === "approved" || value.status === "final") && (!value.approvedBy || !value.approvedAt)) {
    ctx.addIssue({ code: "custom", path: ["approvedBy"], message: "Approved/final proposal requires approval" });
  }
});

export type Asset = z.infer<typeof AssetSchema>;
export type Processing = z.infer<typeof ProcessingSchema>;
export type OCR = z.infer<typeof OCRSchema>;
export type Vision = z.infer<typeof VisionSchema>;
export type MeasurementCandidate = z.infer<typeof MeasurementCandidateSchema>;
export type Measurement = z.infer<typeof MeasurementSchema>;
export type Procurement = z.infer<typeof ProcurementSchema>;
export type ProductRepresentation = z.infer<typeof ProductRepresentationSchema>;
export type SceneObject = z.infer<typeof SceneObjectSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type SceneSet = z.infer<typeof SceneSetSchema>;
export type SceneRender = z.infer<typeof SceneRenderSchema>;
export type AssetCoverage = z.infer<typeof AssetCoverageSchema>;
export type ConsistencyIssue = z.infer<typeof ConsistencyIssueSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
