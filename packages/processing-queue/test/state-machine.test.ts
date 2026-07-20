import { describe, expect, it } from "vitest";
import {
  InvalidJobProgressError,
  InvalidJobTransitionError,
  assertJobUpdate,
  nextJobUpdate,
} from "../src/state-machine.js";

describe("processing status machine", () => {
  it("allows the happy-path transitions with valid progress", () => {
    let current = { status: "QUEUED" as const, progress: 0 };
    current = nextJobUpdate(current, { status: "PREPROCESSING", progress: 10 });
    current = nextJobUpdate(current, { status: "OCR_RUNNING", progress: 30 });
    current = nextJobUpdate(current, { status: "VISION_RUNNING", progress: 55 });
    current = nextJobUpdate(current, { status: "LLM_RECONCILING", progress: 80 });
    current = nextJobUpdate(current, { status: "COMPLETED", progress: 100 });
    expect(current).toEqual({ status: "COMPLETED", progress: 100 });
  });

  it("rejects illegal transitions and progress regressions", () => {
    expect(() => assertJobUpdate(
      { status: "QUEUED", progress: 0 },
      { status: "VISION_RUNNING", progress: 50 },
    )).toThrow(InvalidJobTransitionError);

    expect(() => assertJobUpdate(
      { status: "OCR_RUNNING", progress: 30 },
      { status: "OCR_RUNNING", progress: 20 },
    )).toThrow(InvalidJobProgressError);
  });
});
