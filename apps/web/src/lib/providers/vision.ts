import { z } from "zod";
import { classifyAsset } from "../domain/rules";
import {
  AssetKindSchema,
  MeasurementCandidateSchema,
  OCRCandidateSchema,
  VisionDetectionSchema,
} from "../domain/schemas";

export const VisionInputSchema = z.object({
  assetId: z.string().min(1),
  processingId: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  bytes: z.instanceof(Uint8Array).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const VisionAnalysisSchema = z.object({
  provider: z.string().min(1),
  mode: z.enum(["heuristic", "mock", "adapter"]),
  assetKind: AssetKindSchema,
  isRealOcr: z.boolean(),
  detections: z.array(VisionDetectionSchema),
  ocrCandidates: z.array(OCRCandidateSchema),
  measurementCandidates: z.array(MeasurementCandidateSchema),
  warnings: z.array(z.string()),
});

export type VisionInput = z.infer<typeof VisionInputSchema>;
export type VisionAnalysis = z.infer<typeof VisionAnalysisSchema>;

export type AssetFile = VisionInput;
export type FloorPlanVisionResult = VisionAnalysis & { analysisType: "floor-plan" };
export type ProductVisionResult = VisionAnalysis & { analysisType: "product" };
export type MaterialVisionResult = VisionAnalysis & { analysisType: "material" };
export type SitePhotoVisionResult = VisionAnalysis & { analysisType: "site-photo" };
export type ProcurementVisionResult = VisionAnalysis & { analysisType: "procurement-list" };

export interface VisionProvider {
  analyze(input: VisionInput): Promise<VisionAnalysis>;
  analyzeFloorPlan(image: AssetFile): Promise<FloorPlanVisionResult>;
  analyzeProductImage(image: AssetFile): Promise<ProductVisionResult>;
  analyzeMaterialImage(image: AssetFile): Promise<MaterialVisionResult>;
  analyzeSitePhoto(image: AssetFile): Promise<SitePhotoVisionResult>;
  analyzeProcurementList(image: AssetFile): Promise<ProcurementVisionResult>;
}

export interface OpenCVAdapter {
  readonly name: string;
  detect(input: VisionInput): Promise<z.infer<typeof VisionDetectionSchema>[]>;
}

export interface PaddleOCRAdapter {
  readonly name: string;
  recognize(input: VisionInput): Promise<z.infer<typeof OCRCandidateSchema>[]>;
}

export interface LocalVisionProviderOptions {
  openCV?: OpenCVAdapter;
  paddleOCR?: PaddleOCRAdapter;
  mockResult?: VisionAnalysis;
}

/**
 * Runnable local baseline. Without injected adapters it only applies file-name
 * and metadata heuristics; it deliberately returns no OCR text.
 */
export class LocalVisionProvider implements VisionProvider {
  constructor(private readonly options: LocalVisionProviderOptions = {}) {}

  async analyze(input: VisionInput): Promise<VisionAnalysis> {
    const parsed = VisionInputSchema.parse(input);
    if (this.options.mockResult) {
      return VisionAnalysisSchema.parse({ ...this.options.mockResult, mode: "mock" });
    }

    const [detections, ocrCandidates] = await Promise.all([
      this.options.openCV?.detect(parsed) ?? Promise.resolve([]),
      this.options.paddleOCR?.recognize(parsed) ?? Promise.resolve([]),
    ]);
    const hasAdapter = Boolean(this.options.openCV || this.options.paddleOCR);
    const warnings: string[] = [];
    if (!this.options.openCV) warnings.push("OpenCV adapter not configured; no pixel-level detection performed");
    if (!this.options.paddleOCR) warnings.push("PaddleOCR adapter not configured; no OCR performed");
    if (!parsed.bytes) warnings.push("No image bytes supplied; metadata-only classification used");

    return VisionAnalysisSchema.parse({
      provider: hasAdapter
        ? [this.options.openCV?.name, this.options.paddleOCR?.name].filter(Boolean).join("+")
        : "local-heuristic",
      mode: hasAdapter ? "adapter" : "heuristic",
      assetKind: classifyAsset(parsed),
      isRealOcr: Boolean(this.options.paddleOCR),
      detections,
      ocrCandidates,
      measurementCandidates: [],
      warnings,
    });
  }

  async analyzeFloorPlan(image: AssetFile): Promise<FloorPlanVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "floor-plan" };
  }
  async analyzeProductImage(image: AssetFile): Promise<ProductVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "product" };
  }
  async analyzeMaterialImage(image: AssetFile): Promise<MaterialVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "material" };
  }
  async analyzeSitePhoto(image: AssetFile): Promise<SitePhotoVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "site-photo" };
  }
  async analyzeProcurementList(image: AssetFile): Promise<ProcurementVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "procurement-list" };
  }
}

export class MockVisionProvider implements VisionProvider {
  constructor(private readonly result: VisionAnalysis) {}

  async analyze(input: VisionInput): Promise<VisionAnalysis> {
    VisionInputSchema.parse(input);
    return VisionAnalysisSchema.parse({ ...this.result, mode: "mock" });
  }
  async analyzeFloorPlan(image: AssetFile): Promise<FloorPlanVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "floor-plan" };
  }
  async analyzeProductImage(image: AssetFile): Promise<ProductVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "product" };
  }
  async analyzeMaterialImage(image: AssetFile): Promise<MaterialVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "material" };
  }
  async analyzeSitePhoto(image: AssetFile): Promise<SitePhotoVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "site-photo" };
  }
  async analyzeProcurementList(image: AssetFile): Promise<ProcurementVisionResult> {
    return { ...(await this.analyze(image)), analysisType: "procurement-list" };
  }
}
