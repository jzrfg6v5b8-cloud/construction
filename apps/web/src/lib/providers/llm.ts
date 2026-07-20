import { z } from "zod";

export const LLMRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export const LLMMessageSchema = z.object({
  role: LLMRoleSchema,
  content: z.string(),
  name: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
});
export const LLMComplexitySchema = z.enum(["default", "complex"]);
export const LLMRequestSchema = z.object({
  messages: z.array(LLMMessageSchema).min(1),
  complexity: LLMComplexitySchema.default("default"),
  temperature: z.number().min(0).max(2).default(0),
  maxTokens: z.number().int().positive().max(32_768).optional(),
});
export const TextGenerationResultSchema = z.object({
  text: z.string(),
  model: z.string().min(1),
  finishReason: z.string().nullable(),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }).optional(),
});
export const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
});
export const ToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});
export const ToolRequestSchema = LLMRequestSchema.extend({
  tools: z.array(ToolDefinitionSchema).min(1),
});
export const ToolResultSchema = TextGenerationResultSchema.extend({
  toolCalls: z.array(ToolCallSchema),
});
export const ClassificationRequestSchema = z.object({
  text: z.string().min(1),
  labels: z.array(z.string().min(1)).min(2),
  complexity: LLMComplexitySchema.default("default"),
});
export const ClassificationResultSchema = z.object({
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});
export const ProviderHealthSchema = z.object({
  ok: z.boolean(),
  provider: z.string().min(1),
  model: z.string().min(1),
  detail: z.string().optional(),
});

export type LLMRequest = z.infer<typeof LLMRequestSchema>;
export type TextGenerationResult = z.infer<typeof TextGenerationResultSchema>;
export type ToolRequest = z.infer<typeof ToolRequestSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ClassificationRequest = z.infer<typeof ClassificationRequestSchema>;
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

/** Seven stable methods used by the domain layer; transport details stay provider-specific. */
export interface LLMTransportProvider {
  generateText(input: LLMRequest): Promise<TextGenerationResult>;
  generateJSON<T>(input: LLMRequest, schema: z.ZodType<T>): Promise<T>;
  chat(input: LLMRequest): Promise<TextGenerationResult>;
  streamText(input: LLMRequest): AsyncIterable<string>;
  callTools(input: ToolRequest): Promise<ToolResult>;
  classifyText(input: ClassificationRequest): Promise<ClassificationResult>;
  healthCheck(): Promise<ProviderHealth>;
}

export interface MockProviderOptions {
  text?: string;
  json?: unknown;
  classification?: ClassificationResult;
  toolCalls?: ToolResult["toolCalls"];
  fail?: Error;
}

export class MockProvider implements LLMTransportProvider {
  public readonly calls: Array<{ method: string; input?: unknown }> = [];

  public constructor(private readonly options: MockProviderOptions = {}) {}

  async generateText(input: LLMRequest): Promise<TextGenerationResult> {
    this.calls.push({ method: "generateText", input: LLMRequestSchema.parse(input) });
    this.throwIfConfigured();
    return this.textResult();
  }

  async generateJSON<T>(input: LLMRequest, schema: z.ZodType<T>): Promise<T> {
    this.calls.push({ method: "generateJSON", input: LLMRequestSchema.parse(input) });
    this.throwIfConfigured();
    return schema.parse(this.options.json);
  }

  async chat(input: LLMRequest): Promise<TextGenerationResult> {
    this.calls.push({ method: "chat", input: LLMRequestSchema.parse(input) });
    this.throwIfConfigured();
    return this.textResult();
  }

  async *streamText(input: LLMRequest): AsyncIterable<string> {
    this.calls.push({ method: "streamText", input: LLMRequestSchema.parse(input) });
    this.throwIfConfigured();
    yield this.options.text ?? "mock";
  }

  async callTools(input: ToolRequest): Promise<ToolResult> {
    this.calls.push({ method: "callTools", input: ToolRequestSchema.parse(input) });
    this.throwIfConfigured();
    return { ...this.textResult(), toolCalls: this.options.toolCalls ?? [] };
  }

  async classifyText(input: ClassificationRequest): Promise<ClassificationResult> {
    const parsed = ClassificationRequestSchema.parse(input);
    this.calls.push({ method: "classifyText", input: parsed });
    this.throwIfConfigured();
    return ClassificationResultSchema.parse(
      this.options.classification ?? { label: parsed.labels[0], confidence: 1, reasoning: "Mock result" },
    );
  }

  async healthCheck(): Promise<ProviderHealth> {
    this.calls.push({ method: "healthCheck" });
    return { ok: !this.options.fail, provider: "mock", model: "mock", detail: this.options.fail?.message };
  }

  private textResult(): TextGenerationResult {
    return { text: this.options.text ?? "mock", model: "mock", finishReason: "stop" };
  }

  private throwIfConfigured(): void {
    if (this.options.fail) throw this.options.fail;
  }
}
