import { expect, test } from "vitest";
import {
  DEFAULT_VISION_WORKER_URL,
  VisionWorkerClient,
  VisionWorkerUnavailableError,
} from "../../src/lib/providers/vision-worker-client";
import { FinalApprovalService } from "../../src/lib/proposal/approval-service";
import { buildDemoFinalApprovalInput } from "../../src/lib/proposal/export-context";
import { resolveCjkFontPath } from "../../src/lib/proposal/cjk-font";

test("vision worker defaults to local 8091 and does not invent OCR on failure", async () => {
  expect(DEFAULT_VISION_WORKER_URL).toBe("http://127.0.0.1:8091");
  const client = new VisionWorkerClient("http://127.0.0.1:9", async () => {
    throw new TypeError("fetch failed");
  });
  await expect(client.health()).rejects.toBeInstanceOf(VisionWorkerUnavailableError);
});

test("demo final approval blocks FINAL until gates pass", () => {
  const result = new FinalApprovalService().checkFinal(buildDemoFinalApprovalInput("demo"));
  expect(result.approved).toBe(false);
  expect(result.blocks.some((block) => block.code === "ASSET_COVERAGE_INCOMPLETE")).toBe(true);
  expect(result.blocks.some((block) => block.code === "DIMENSIONS_UNVERIFIED")).toBe(true);
});

test("resolves a CJK font from system fallbacks when env is empty", async () => {
  const previous = process.env.NOTO_CJK_FONT_PATH;
  delete process.env.NOTO_CJK_FONT_PATH;
  try {
    const fontPath = await resolveCjkFontPath();
    expect(fontPath.length).toBeGreaterThan(0);
  } catch (error) {
    expect(error).toMatchObject({ message: "NOTO_CJK_FONT_PATH_NOT_CONFIGURED" });
  } finally {
    if (previous === undefined) delete process.env.NOTO_CJK_FONT_PATH;
    else process.env.NOTO_CJK_FONT_PATH = previous;
  }
});
