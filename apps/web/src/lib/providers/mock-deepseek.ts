import { MockProvider } from "./llm";
import { DeepSeekProvider } from "./deepseek";
import type {
  BusinessLLMProvider,
  FloorPlanOCRResult,
  LayoutRecommendation,
  LayoutRecommendationInput,
  LLMExtractionResult,
  MeasurementReconciliation,
  ProductClassification,
  ProductOCRResult,
  ProductSceneInput,
  ProductSceneMatch,
  ProposalContext,
  ProposalCopy,
  StructuredVisionResult,
  ValidationIssue,
} from "./business-llm";

/** Safe offline provider: deterministic demo candidates, never approved business records. */
export class MockDeepSeekProvider extends MockProvider implements BusinessLLMProvider {
  async extractStructuredBusinessData(input: StructuredVisionResult): Promise<LLMExtractionResult> {
    return {
      fields: { assetType: input.assetType, textCount: input.texts.length },
      missingFields: ["人工确认"],
      conflicts: [],
      questions: ["请核对候选字段后再写入正式数据。"],
      confidence: 0.5,
    };
  }

  async reconcileFloorPlanMeasurements(input: FloorPlanOCRResult): Promise<MeasurementReconciliation> {
    return {
      acceptedCandidateIds: [],
      conflicts: [],
      closureErrorMm: null,
      questions: [`请人工校准 ${input.measurements.length} 个尺寸候选。`],
      requiresHumanReview: true,
    };
  }

  async classifyProcurementItem(input: ProductOCRResult): Promise<ProductClassification> {
    void input;
    return { category: "其他", confidence: 0.4, missingFields: ["SKU", "尺寸"], conflicts: [], questions: ["请确认商品分类与尺寸。"] };
  }

  async matchProductToScene(input: ProductSceneInput): Promise<ProductSceneMatch[]> {
    return input.candidateRooms.map((roomId, index) => ({
      roomId,
      score: Math.max(0.2, 0.7 - index * 0.1),
      rationale: "离线规则候选，需人工确认。",
      requiresDimensions: input.dimensionsMm === null,
    }));
  }

  async recommendLayout(input: LayoutRecommendationInput): Promise<LayoutRecommendation> {
    return { templateId: "two-bedroom-standard", placements: [], warnings: [`离线模式未自动放置 ${input.rooms.length} 个房间。`], requiresDesigner: true };
  }

  async generateProposalCopy(input: ProposalContext): Promise<ProposalCopy> {
    return {
      title: `空间方案 ${input.projectId}`,
      summary: "本稿由离线模板生成，所有尺寸、材料与报价须人工确认。",
      roomCopy: {},
      disclaimers: ["图片不能替代现场复尺。", "效果图颜色不能替代签字确认的实物样板。"],
    };
  }

  async summarizeValidationIssues(input: ValidationIssue[]): Promise<string> {
    return input.length ? `共有 ${input.length} 项验证问题，其中 ${input.filter((issue) => issue.severity === "BLOCKING").length} 项阻止 FINAL 导出。` : "没有验证问题。";
  }
}

export function createDeepSeekBusinessProvider(): BusinessLLMProvider {
  if (!process.env.DEEPSEEK_API_KEY) return new MockDeepSeekProvider();
  return new DeepSeekProvider();
}
