import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DeepSeekConfigurationError,
  DeepSeekProvider,
  LocalVisionProvider,
  MockDeepSeekProvider,
  MockProvider,
} from "../../src/lib";

const originalKey = process.env.DEEPSEEK_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});

const request = {
  messages: [{ role: "user" as const, content: "hello" }],
  complexity: "default" as const,
  temperature: 0,
};

function apiResponse(content: string, model = "v4-flash", toolCalls?: unknown[]): Response {
  return new Response(JSON.stringify({
    model,
    choices: [{ finish_reason: "stop", message: { content, tool_calls: toolCalls } }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("LLM providers", () => {
  it("offers a deterministic mock with schema validation", async () => {
    const provider = new MockProvider({ text: "ok", json: { count: 2 } });
    expect((await provider.generateText(request)).text).toBe("ok");
    expect(await provider.generateJSON(request, z.object({ count: z.number().int() }))).toEqual({ count: 2 });
    expect(provider.calls.map((call) => call.method)).toEqual(["generateText", "generateJSON"]);
  });

  it("reads the DeepSeek key only at request time from the environment", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const provider = new DeepSeekProvider({ fetch: async () => apiResponse("unused") });
    await expect(provider.generateText(request)).rejects.toBeInstanceOf(DeepSeekConfigurationError);
    expect((await provider.healthCheck()).ok).toBe(false);
  });

  it("uses default and complex models and validates JSON output", async () => {
    process.env.DEEPSEEK_API_KEY = "test-only";
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return apiResponse('```json\n{"value":7}\n```', String((bodies.at(-1)?.model)));
    };
    const provider = new DeepSeekProvider({ fetch: fetcher, maxRetries: 0 });
    expect(await provider.generateJSON(
      { ...request, complexity: "complex" },
      z.object({ value: z.number() }),
    )).toEqual({ value: 7 });
    expect(bodies[0]?.model).toBe("deepseek-v4-pro");
  });

  it("rejects invalid DeepSeek JSON", async () => {
    process.env.DEEPSEEK_API_KEY = "test-only";
    const provider = new DeepSeekProvider({ maxRetries: 0, fetch: async () => apiResponse("not-json") });
    await expect(provider.generateJSON(request, z.object({ value: z.number() }))).rejects.toThrow(/invalid JSON/);
  });

  it("uses MockDeepSeekProvider without an API key", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const result = await new MockDeepSeekProvider().classifyProcurementItem({
      assetIds: ["asset-1"],
      rawText: "吊灯",
      candidateFields: {},
    });
    expect(result.category).toBe("其他");
    expect(result.missingFields).toContain("尺寸");
  });

  it("parses basic tool calls", async () => {
    process.env.DEEPSEEK_API_KEY = "test-only";
    const provider = new DeepSeekProvider({
      maxRetries: 0,
      fetch: async () => apiResponse("", "v4-flash", [{
        id: "call-1",
        function: { name: "lookup", arguments: '{"sku":"A1"}' },
      }]),
    });
    const result = await provider.callTools({
      ...request,
      tools: [{ name: "lookup", description: "Find product", parameters: { type: "object" } }],
    });
    expect(result.toolCalls).toEqual([{ id: "call-1", name: "lookup", arguments: { sku: "A1" } }]);
  });
});

describe("local vision provider", () => {
  it("clearly reports metadata-only heuristic mode without OCR", async () => {
    const result = await new LocalVisionProvider().analyze({
      assetId: "asset-1",
      processingId: "processing-1",
      name: "客厅平面图.png",
      mimeType: "image/png",
    });
    expect(result).toMatchObject({
      provider: "local-heuristic",
      mode: "heuristic",
      assetKind: "floor_plan",
      isRealOcr: false,
      ocrCandidates: [],
      detections: [],
    });
    expect(result.warnings).toContain("PaddleOCR adapter not configured; no OCR performed");
  });

  it("runs injected OpenCV/Paddle adapters", async () => {
    const provider = new LocalVisionProvider({
      openCV: { name: "opencv-test", detect: async () => [] },
      paddleOCR: { name: "paddle-test", recognize: async () => [] },
    });
    const result = await provider.analyze({
      assetId: "asset-1",
      processingId: "processing-1",
      name: "site.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1]),
    });
    expect(result.mode).toBe("adapter");
    expect(result.isRealOcr).toBe(true);
    expect(result.provider).toBe("opencv-test+paddle-test");
  });
});
