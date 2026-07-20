import { z } from "zod";
import {
  ClassificationRequestSchema,
  ClassificationResultSchema,
  LLMRequestSchema,
  ProviderHealthSchema,
  TextGenerationResultSchema,
  ToolRequestSchema,
  ToolResultSchema,
  type ClassificationRequest,
  type ClassificationResult,
  type LLMTransportProvider,
  type LLMRequest,
  type ProviderHealth,
  type TextGenerationResult,
  type ToolRequest,
  type ToolResult,
} from "./llm";
import {
  FloorPlanOCRResultSchema,
  LayoutRecommendationInputSchema,
  LayoutRecommendationSchema,
  LLMExtractionResultSchema,
  MeasurementReconciliationSchema,
  ProductClassificationSchema,
  ProductOCRResultSchema,
  ProductSceneInputSchema,
  ProductSceneMatchSchema,
  ProposalContextSchema,
  ProposalCopySchema,
  StructuredVisionResultSchema,
  ValidationIssueSchema,
  type BusinessLLMProvider,
  type FloorPlanOCRResult,
  type LayoutRecommendation,
  type LayoutRecommendationInput,
  type LLMExtractionResult,
  type MeasurementReconciliation,
  type ProductClassification,
  type ProductOCRResult,
  type ProductSceneInput,
  type ProductSceneMatch,
  type ProposalContext,
  type ProposalCopy,
  type StructuredVisionResult,
  type ValidationIssue,
} from "./business-llm";

const ApiToolCallSchema = z.object({
  id: z.string(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
const ApiResponseSchema = z.object({
  model: z.string(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable(),
    message: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(ApiToolCallSchema).optional(),
    }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }).optional(),
});

interface ApiResponse {
  model: string;
  choices: Array<{
    finish_reason: string | null;
    message: { content?: string | null; tool_calls?: Array<z.infer<typeof ApiToolCallSchema>> };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface DeepSeekProviderOptions {
  timeoutMs?: number;
  maxRetries?: number;
  defaultModel?: string;
  complexModel?: string;
  fetch?: typeof globalThis.fetch;
}

export class DeepSeekProvider implements LLMTransportProvider, BusinessLLMProvider {
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly complexModel: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: DeepSeekProviderOptions = {}) {
    this.baseUrl = process.env.DEEPSEEK_API_BASE_URL ?? "https://api.deepseek.com";
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.defaultModel = options.defaultModel ?? process.env.DEEPSEEK_DEFAULT_MODEL ?? "deepseek-v4-flash";
    this.complexModel = options.complexModel ?? process.env.DEEPSEEK_COMPLEX_MODEL ?? "deepseek-v4-pro";
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async generateText(input: LLMRequest): Promise<TextGenerationResult> {
    const parsed = LLMRequestSchema.parse(input);
    return this.toTextResult(await this.complete(parsed));
  }

  async generateJSON<T>(input: LLMRequest, schema: z.ZodType<T>): Promise<T> {
    const parsed = LLMRequestSchema.parse(input);
    const response = await this.complete(parsed, { response_format: { type: "json_object" } });
    const text = response.choices[0]?.message.content ?? "";
    let decoded: unknown;
    try {
      decoded = JSON.parse(stripJsonFence(text));
    } catch (error) {
      throw new DeepSeekResponseError("Provider returned invalid JSON", { cause: error });
    }
    const validated = schema.safeParse(decoded);
    if (!validated.success) {
      throw new DeepSeekResponseError(`Provider JSON failed validation: ${validated.error.message}`);
    }
    return validated.data;
  }

  async chat(input: LLMRequest): Promise<TextGenerationResult> {
    return this.generateText(input);
  }

  async *streamText(input: LLMRequest): AsyncIterable<string> {
    // This fallback remains deterministic and works in runtimes without incremental fetch streams.
    yield (await this.generateText(input)).text;
  }

  async callTools(input: ToolRequest): Promise<ToolResult> {
    const parsed = ToolRequestSchema.parse(input);
    const response = await this.complete(parsed, {
      tools: parsed.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
      tool_choice: "auto",
    });
    const text = this.toTextResult(response);
    const toolCalls = (response.choices[0]?.message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseToolArguments(call.function.arguments, call.function.name),
    }));
    return ToolResultSchema.parse({ ...text, toolCalls });
  }

  async classifyText(input: ClassificationRequest): Promise<ClassificationResult> {
    const parsed = ClassificationRequestSchema.parse(input);
    const result = await this.generateJSON(
      {
        complexity: parsed.complexity,
        temperature: 0,
        messages: [
          { role: "system", content: "Classify the text. Return only JSON with label, confidence, and optional reasoning." },
          { role: "user", content: JSON.stringify({ text: parsed.text, allowedLabels: parsed.labels }) },
        ],
      },
      ClassificationResultSchema,
    );
    if (!parsed.labels.includes(result.label)) {
      throw new DeepSeekResponseError(`Provider returned disallowed label: ${result.label}`);
    }
    return result;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const configured = Boolean(process.env.DEEPSEEK_API_KEY);
    return ProviderHealthSchema.parse({
      ok: configured,
      provider: "deepseek",
      model: this.defaultModel,
      detail: configured ? "Configured" : "DEEPSEEK_API_KEY is not set",
    });
  }

  extractStructuredBusinessData(input: StructuredVisionResult): Promise<LLMExtractionResult> {
    return this.businessJSON("整理视觉候选字段。不得补造尺寸、SKU或价格，列出缺失、冲突与人工确认问题。", StructuredVisionResultSchema.parse(input), LLMExtractionResultSchema);
  }

  reconcileFloorPlanMeasurements(input: FloorPlanOCRResult): Promise<MeasurementReconciliation> {
    return this.businessJSON("协调户型尺寸候选并解释冲突。不得选择性隐藏矛盾；结果始终需要人工审核。", FloorPlanOCRResultSchema.parse(input), MeasurementReconciliationSchema, "complex");
  }

  classifyProcurementItem(input: ProductOCRResult): Promise<ProductClassification> {
    return this.businessJSON("基于OCR文字给出采购候选分类。照片不能证明准确尺寸。", ProductOCRResultSchema.parse(input), ProductClassificationSchema);
  }

  matchProductToScene(input: ProductSceneInput): Promise<ProductSceneMatch[]> {
    return this.businessJSON("给出商品与空间的候选匹配，不得绕过缺尺寸门禁。", ProductSceneInputSchema.parse(input), z.array(ProductSceneMatchSchema));
  }

  recommendLayout(input: LayoutRecommendationInput): Promise<LayoutRecommendation> {
    return this.businessJSON("仅根据已审核户型推荐标准布局；不确认施工或合规。", LayoutRecommendationInputSchema.parse(input), LayoutRecommendationSchema, "complex");
  }

  generateProposalCopy(input: ProposalContext): Promise<ProposalCopy> {
    return this.businessJSON("只使用已确认事实生成克制、可追溯的方案文案和免责声明。", ProposalContextSchema.parse(input), ProposalCopySchema);
  }

  async summarizeValidationIssues(input: ValidationIssue[]): Promise<string> {
    const issues = z.array(ValidationIssueSchema).parse(input);
    return (await this.generateText({
      messages: [
        { role: "system", content: "用简洁中文总结验证问题。不得降低严重级别或声称问题已解决。" },
        { role: "user", content: JSON.stringify(issues) },
      ],
      temperature: 0,
      complexity: "default",
    })).text;
  }

  private businessJSON<T>(
    instruction: string,
    input: unknown,
    schema: z.ZodType<T>,
    complexity: "default" | "complex" = "default",
  ): Promise<T> {
    return this.generateJSON(
      {
        messages: [
          { role: "system", content: `${instruction} 只返回符合指定结构的JSON。` },
          { role: "user", content: JSON.stringify(input) },
        ],
        temperature: 0,
        complexity,
      },
      schema,
    );
  }

  private async complete(input: LLMRequest, additions: Record<string, unknown> = {}): Promise<ApiResponse> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new DeepSeekConfigurationError("DEEPSEEK_API_KEY is required");
    const body = {
      model: input.complexity === "complex" ? this.complexModel : this.defaultModel,
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.name ? { name: message.name } : {}),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      })),
      temperature: input.temperature,
      ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      ...additions,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.text();
          const error = new DeepSeekHttpError(response.status, detail);
          if (!isRetryable(response.status) || attempt === this.maxRetries) throw error;
          lastError = error;
        } else {
          const decoded: unknown = await response.json();
          const parsed = ApiResponseSchema.safeParse(decoded);
          if (!parsed.success) throw new DeepSeekResponseError(`Unexpected provider response: ${parsed.error.message}`);
          return parsed.data;
        }
      } catch (error) {
        if (error instanceof DeepSeekHttpError && !isRetryable(error.status)) throw error;
        lastError = error;
        if (attempt === this.maxRetries) break;
      } finally {
        clearTimeout(timeout);
      }
      await delay(Math.min(250 * 2 ** attempt, 2_000));
    }
    throw new DeepSeekResponseError("DeepSeek request failed after retries", { cause: lastError });
  }

  private toTextResult(response: ApiResponse): TextGenerationResult {
    const choice = response.choices[0];
    return TextGenerationResultSchema.parse({
      text: choice?.message.content ?? "",
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: response.usage && {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
    });
  }
}

function parseToolArguments(value: string, toolName: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return z.record(z.string(), z.unknown()).parse(parsed);
  } catch (error) {
    throw new DeepSeekResponseError(`Invalid arguments for tool ${toolName}`, { cause: error });
  }
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DeepSeekConfigurationError extends Error {
  override readonly name = "DeepSeekConfigurationError";
}

export class DeepSeekResponseError extends Error {
  override readonly name = "DeepSeekResponseError";
}

export class DeepSeekHttpError extends Error {
  override readonly name = "DeepSeekHttpError";
  constructor(readonly status: number, readonly responseBody: string) {
    super(`DeepSeek responded with HTTP ${status}`);
  }
}
