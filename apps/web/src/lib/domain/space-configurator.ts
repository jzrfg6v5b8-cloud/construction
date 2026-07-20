import { z } from "zod";

const Id = z.string().min(1);
const DateTime = z.string().datetime();
const Box = z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() });
export const ReviewStatus = z.enum(["PENDING", "IN_REVIEW", "APPROVED", "REJECTED"]);
export const AssetType = z.enum([
  "FLOOR_PLAN", "SITE_PHOTO", "PRODUCT_PHOTO", "MATERIAL_SAMPLE", "MATERIAL_TEXTURE",
  "PRODUCT_DIMENSION_DRAWING", "PROCUREMENT_LIST", "SUPPLIER_SCREENSHOT", "REFERENCE_RENDER",
  "LOGO", "CERTIFICATE", "UNKNOWN",
]);
export const JobStatus = z.enum([
  "QUEUED", "PREPROCESSING", "OCR_RUNNING", "VISION_RUNNING", "LLM_RECONCILING",
  "HUMAN_REVIEW_REQUIRED", "COMPLETED", "FAILED",
]);
export const RepresentationType = z.enum([
  "PARAMETRIC_3D", "IMPORTED_3D", "MATERIAL_TEXTURE", "IMAGE_BILLBOARD", "DECAL",
  "MATERIAL_BOARD_ONLY", "PROCUREMENT_ONLY",
]);
export const SceneType = z.enum([
  "ORIGINAL_PLAN", "RECOGNIZED_PLAN", "DIMENSIONED_PLAN", "FURNISHED_PLAN", "AXONOMETRIC",
  "LIVING_ROOM", "MASTER_BEDROOM", "SECOND_BEDROOM", "KITCHEN", "BATHROOM", "STORAGE_DETAIL",
  "MATERIAL_BOARD", "PRODUCT_CALLOUT", "PROCUREMENT_SHEET", "BOM_SHEET",
]);

export const AssetSchemaV2 = z.object({
  id: Id,
  projectId: Id,
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  widthPx: z.number().int().positive().nullable(),
  heightPx: z.number().int().positive().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storagePath: z.string().min(1),
  thumbnailPath: z.string().nullable(),
  assetType: AssetType,
  sourceType: z.enum(["UPLOAD", "PDF_PAGE", "CAMERA", "IMPORT", "GENERATED"]),
  uploadBatchId: Id,
  ocrStatus: JobStatus,
  visionStatus: JobStatus,
  reviewStatus: ReviewStatus,
  confidence: z.number().min(0).max(1).nullable(),
  linkedEntityType: z.string().nullable(),
  linkedEntityId: z.string().nullable(),
  sceneUsage: z.array(Id),
  proposalUsage: z.array(Id),
  requiredInProposal: z.boolean().default(false),
  createdAt: DateTime,
  updatedAt: DateTime,
});

export const AssetProcessingJobSchema = z.object({
  id: Id, assetId: Id, uploadBatchId: Id, status: JobStatus, progress: z.number().min(0).max(100),
  idempotencyKey: z.string().min(1), attempts: z.number().int().nonnegative(), errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(), processingParameters: z.record(z.string(), z.unknown()),
  createdAt: DateTime, updatedAt: DateTime,
});
const EvidenceFields = {
  confidence: z.number().min(0).max(1), sourceBoundingBox: Box.nullable(), sourceAssetId: Id,
  extractionMethod: z.string().min(1), reviewStatus: ReviewStatus, reviewedBy: z.string().nullable(),
};
export const OCRResultSchemaV2 = z.object({
  id: Id, assetId: Id, jobId: Id, engine: z.string(), language: z.string(),
  blocks: z.array(z.object({ text: z.string(), ...EvidenceFields })), rawText: z.string(), createdAt: DateTime,
});
export const VisionResultSchemaV2 = z.object({
  id: Id, assetId: Id, jobId: Id, provider: z.string(), isHeuristic: z.boolean(),
  detections: z.array(z.object({ label: z.string(), attributes: z.record(z.string(), z.unknown()), ...EvidenceFields })),
  warnings: z.array(z.string()), createdAt: DateTime,
});
export const MeasurementCandidateSchemaV2 = z.object({
  id: Id, floorPlanId: Id, value: z.number().positive(), unit: z.enum(["mm", "cm", "m"]),
  ...EvidenceFields, bindingType: z.enum(["UNBOUND", "WALL", "ENDPOINTS"]), wallId: z.string().nullable(),
  endpointIds: z.tuple([Id, Id]).nullable(), conflictGroupId: z.string().nullable(),
});
export const ProcurementImportSchema = z.object({
  id: Id, projectId: Id, uploadBatchId: Id, status: JobStatus, sourceAssetIds: z.array(Id),
  candidateIds: z.array(Id), createdAt: DateTime, updatedAt: DateTime,
});
export const ProcurementItemCandidateSchema = z.object({
  id: Id, importId: Id, sourceAssetIds: z.array(Id), sku: z.string().nullable(), name: z.string().nullable(),
  brand: z.string().nullable(), category: z.string().nullable(), supplier: z.string().nullable(),
  model: z.string().nullable(), color: z.string().nullable(), material: z.string().nullable(),
  dimensionsMm: z.object({ width: z.number().positive(), depth: z.number().positive(), height: z.number().positive() }).nullable(),
  dimensionsStatus: z.enum(["CONFIRMED", "CANDIDATE", "REQUIRED", "CONFLICT"]),
  unit: z.string().nullable(), quantity: z.number().positive().nullable(), unitPrice: z.number().nonnegative().nullable(),
  totalPrice: z.number().nonnegative().nullable(), leadTime: z.string().nullable(), warranty: z.string().nullable(),
  roomId: z.string().nullable(), reviewStatus: ReviewStatus, conflicts: z.array(z.string()),
});
export const ProductImageSchema = z.object({ id: Id, productId: Id, assetId: Id, role: z.enum(["MAIN", "DIMENSION", "MATERIAL", "PRICE", "REFERENCE"]) });
export const MaterialImageSchema = z.object({ id: Id, materialId: Id, assetId: Id, role: z.enum(["SAMPLE", "TEXTURE", "INSTALLATION", "REFERENCE"]), realWidthMm: z.number().positive().nullable(), realHeightMm: z.number().positive().nullable() });
export const ProductRepresentationSchemaV2 = z.object({
  id: Id, productVariantId: Id, representationType: RepresentationType, sourceAssetIds: z.array(Id),
  modelPath: z.string().nullable(), dimensionsMm: z.object({ width: z.number().positive(), depth: z.number().positive(), height: z.number().positive() }).nullable(),
  dimensionsVerified: z.boolean(), participatesInExactCollision: z.boolean(), disclaimer: z.string().nullable(),
}).superRefine((value, ctx) => {
  if (value.participatesInExactCollision && (!value.dimensionsVerified || !value.dimensionsMm)) {
    ctx.addIssue({ code: "custom", path: ["participatesInExactCollision"], message: "Exact collision requires verified dimensions" });
  }
});
export const SceneSchemaV2 = z.object({
  id: Id, projectId: Id, sceneSetId: Id, sceneType: SceneType,
  cameraPosition: z.tuple([z.number(), z.number(), z.number()]), cameraTarget: z.tuple([z.number(), z.number(), z.number()]),
  visibleRooms: z.array(Id), visibleProducts: z.array(Id), visibleMaterials: z.array(Id), sourceVersionId: Id,
  renderStatus: z.enum(["QUEUED", "RENDERING", "COMPLETED", "FAILED", "STALE"]), imagePath: z.string().nullable(),
  width: z.number().int().positive(), height: z.number().int().positive(),
  validationStatus: z.enum(["PENDING", "VALID", "INVALID"]), generatedAt: DateTime.nullable(),
});
export const SceneSetSchemaV2 = z.object({ id: Id, projectId: Id, sourceVersionId: Id, sceneIds: z.array(Id), status: z.enum(["DRAFT", "READY", "STALE"]), createdAt: DateTime, updatedAt: DateTime });
export const SceneObjectSchemaV2 = z.object({
  id: Id, sceneId: Id, productVariantId: Id.nullable(), sku: z.string().nullable(), materialId: z.string().nullable(),
  representationId: z.string().nullable(), positionMm: z.tuple([z.number(), z.number(), z.number()]),
  rotationDeg: z.tuple([z.number(), z.number(), z.number()]), sourceAssetIds: z.array(Id), requiresRemeasurement: z.boolean(),
});
export const SceneRenderSchemaV2 = z.object({ id: Id, sceneId: Id, sourceVersionId: Id, imagePath: z.string(), renderer: z.string(), usedSkuIds: z.array(Id), usedMaterialIds: z.array(Id), generatedAt: DateTime });
export const AssetCoverageSchemaV2 = z.object({
  assetId: Id, required: z.boolean(), usageType: z.array(z.enum(["MODEL_REFERENCE", "MATERIAL_TEXTURE", "SCENE_CALLOUT", "MATERIAL_BOARD", "PRODUCT_LIST", "PROCUREMENT_ATTACHMENT"])),
  sceneIds: z.array(Id), proposalPageIds: z.array(Id), covered: z.boolean(), exclusionReason: z.string().nullable(), reviewedBy: z.string().nullable(),
}).superRefine((value, ctx) => {
  if (value.required && !value.covered && !value.exclusionReason) ctx.addIssue({ code: "custom", path: ["exclusionReason"], message: "Required uncovered assets need an exclusion reason for review" });
});
export const ProposalPageSchema = z.object({ id: Id, proposalExportId: Id, pageNumber: z.number().int().positive(), sceneId: z.string().nullable(), pageType: z.string(), assetIds: z.array(Id) });
export const ProposalExportSchema = z.object({
  id: Id, projectId: Id, sceneSetId: Id, status: z.enum(["DRAFT", "FINAL", "BLOCKED"]), pageIds: z.array(Id),
  coverageValidated: z.boolean(), consistencyValidated: z.boolean(), pdfPath: z.string().nullable(), createdAt: DateTime,
}).superRefine((value, ctx) => {
  if (value.status === "FINAL" && (!value.coverageValidated || !value.consistencyValidated)) {
    ctx.addIssue({ code: "custom", path: ["status"], message: "FINAL requires coverage and consistency validation" });
  }
});

export type UnifiedAsset = z.infer<typeof AssetSchemaV2>;
export type UnifiedScene = z.infer<typeof SceneSchemaV2>;
export type UnifiedProductRepresentation = z.infer<typeof ProductRepresentationSchemaV2>;
