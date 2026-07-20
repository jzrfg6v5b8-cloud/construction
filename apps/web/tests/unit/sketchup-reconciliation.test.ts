import { describe, expect, it } from "vitest";
import { reconcileSkuQuantities } from "@/lib/sketchup/reconciliation";

describe("SketchUp SKU reconciliation", () => {
  it("passes when BOM, model and quote quantities agree", () => {
    const result = reconcileSkuQuantities(
      [{ sku: "SF-BED-1000", quantity: 1 }],
      { "SF-BED-1000": 1 },
      [{ sku: "SF-BED-1000", quantity: 1 }],
    );
    expect(result).toEqual({ valid: true, blocksFinal: false, mismatches: [] });
  });

  it("blocks FINAL when model or quote differs", () => {
    const result = reconcileSkuQuantities(
      [{ sku: "SF-WARDROBE-1800", quantity: 2 }],
      { "SF-WARDROBE-1800": 1 },
      [{ sku: "SF-WARDROBE-1800", quantity: 3 }],
    );
    expect(result.blocksFinal).toBe(true);
    expect(result.mismatches.map((item) => item.code)).toEqual([
      "BOM_MODEL_MISMATCH",
      "BOM_QUOTE_MISMATCH",
    ]);
  });
});
