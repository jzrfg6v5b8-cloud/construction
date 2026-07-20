export type QuantityLine = { sku: string; quantity: number };
export type QuantityMismatch = {
  sku: string;
  bomQuantity: number;
  sketchUpQuantity: number;
  quoteQuantity: number;
  code: "BOM_MODEL_MISMATCH" | "BOM_QUOTE_MISMATCH";
};

export function reconcileSkuQuantities(
  bom: readonly QuantityLine[],
  sketchUpSkuCounts: Readonly<Record<string, number>>,
  quote: readonly QuantityLine[],
): { valid: boolean; blocksFinal: boolean; mismatches: QuantityMismatch[] } {
  const bomMap = aggregate(bom);
  const quoteMap = aggregate(quote);
  const skus = new Set([...bomMap.keys(), ...quoteMap.keys(), ...Object.keys(sketchUpSkuCounts)]);
  const mismatches: QuantityMismatch[] = [];

  for (const sku of skus) {
    const bomQuantity = bomMap.get(sku) ?? 0;
    const sketchUpQuantity = sketchUpSkuCounts[sku] ?? 0;
    const quoteQuantity = quoteMap.get(sku) ?? 0;
    if (bomQuantity !== sketchUpQuantity) {
      mismatches.push({ sku, bomQuantity, sketchUpQuantity, quoteQuantity, code: "BOM_MODEL_MISMATCH" });
    }
    if (bomQuantity !== quoteQuantity) {
      mismatches.push({ sku, bomQuantity, sketchUpQuantity, quoteQuantity, code: "BOM_QUOTE_MISMATCH" });
    }
  }
  return { valid: mismatches.length === 0, blocksFinal: mismatches.length > 0, mismatches };
}

function aggregate(lines: readonly QuantityLine[]) {
  const result = new Map<string, number>();
  for (const line of lines) {
    if (!line.sku || !Number.isFinite(line.quantity) || line.quantity < 0) throw new Error("INVALID_QUANTITY_LINE");
    result.set(line.sku, (result.get(line.sku) ?? 0) + line.quantity);
  }
  return result;
}
