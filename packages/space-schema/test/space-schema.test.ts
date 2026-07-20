import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOMSchema,
  ModelExportResultSchema,
  SpaceConfigurationSchema,
  validateSpaceConfiguration,
  validateSpaceConfigurationUpdate,
  type SpaceConfiguration,
} from "../src/index.js";

const example = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../examples/A03023.json"), "utf8"),
) as unknown;

function cloneExample(): SpaceConfiguration {
  return structuredClone(SpaceConfigurationSchema.parse(example));
}

describe("SpaceConfiguration", () => {
  it("accepts the complete A03023 two-bedroom example", () => {
    const result = validateSpaceConfiguration(example);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.floorPlanCode).toBe("A03023-2BR");
      expect(
        result.data.rooms.filter(({ code }) => code.includes("BEDROOM")),
      ).toHaveLength(2);
      expect(result.data.coordinateSystem.unit).toBe("mm");
    }
  });

  it("requires valid, globally unique stable UUIDs", () => {
    const invalid = cloneExample();
    invalid.products[0]!.objectId = "not-a-uuid";
    expect(SpaceConfigurationSchema.safeParse(invalid).success).toBe(false);

    const duplicated = cloneExample();
    duplicated.doors[0]!.objectId = duplicated.walls[0]!.objectId;
    const result = SpaceConfigurationSchema.safeParse(duplicated);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(({ message }) =>
          message.includes("globally unique"),
        ),
      ).toBe(true);
    }
  });

  it("rejects fractional, negative, and falsely verified dimensions", () => {
    const fractional = cloneExample();
    fractional.ceilingHeightMm = 2800.5;
    expect(SpaceConfigurationSchema.safeParse(fractional).success).toBe(false);

    const negative = cloneExample();
    negative.walls[0]!.thicknessMm = -1;
    expect(SpaceConfigurationSchema.safeParse(negative).success).toBe(false);

    const falselyVerified = cloneExample();
    falselyVerified.walls[0]!.verificationStatus = "LOW_CONFIDENCE";
    falselyVerified.walls[0]!.confidence = 0.4;
    expect(SpaceConfigurationSchema.safeParse(falselyVerified).success).toBe(
      false,
    );
  });

  it("does not allow low-confidence geometry to overwrite verified dimensions", () => {
    const previous = cloneExample();
    const next = cloneExample();
    next.geometryVersion = "gv-0004";
    next.walls[0]!.end.xMm = 6500;
    next.walls[0]!.verificationStatus = "LOW_CONFIDENCE";
    next.walls[0]!.confidence = 0.4;
    delete next.walls[0]!.reviewedBy;
    next.dimensionsVerified = false;

    const result = validateSpaceConfigurationUpdate(previous, next);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.map(({ code }) => code)).toContain(
        "VERIFIED_DIMENSIONS_PROTECTED",
      );
    }
  });

  it("requires geometry versions to change for dimensional edits", () => {
    const previous = cloneExample();
    const next = cloneExample();
    next.ceilingHeightMm = 2900;

    const result = validateSpaceConfigurationUpdate(previous, next);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.map(({ code }) => code)).toContain(
        "GEOMETRY_VERSION_NOT_INCREMENTED",
      );
    }
  });
});

describe("model export and quantity contracts", () => {
  const stats = {
    instanceCount: 3,
    uniqueSkuCount: 2,
    unboundInstanceCount: 1,
    excludedInstanceCount: 0,
    quantitiesBySku: { "SF-SOFA-2200": 1, "SF-BED-1500": 1 },
    quantitiesByRoom: { living: 1, bedroom: 1 },
    componentDefinitionCount: 2,
    groupCount: 3,
    faceCount: 180,
    edgeCount: 420,
    materialCount: 3,
    warningCount: 1,
  };

  it("accepts complete model export statistics", () => {
    const result = ModelExportResultSchema.safeParse({
      taskId: "e0000000-0000-4000-8000-000000000001",
      projectId: "A03023",
      geometryVersion: "gv-0003",
      status: "SUCCEEDED",
      format: "SKP",
      outputUri: "https://assets.sharkflows.com/exports/A03023.skp",
      inputSha256: "b".repeat(64),
      outputSha256: "a".repeat(64),
      byteSize: 1200345,
      componentStats: stats,
      warnings: ["One unbound instance"],
      startedAt: "2026-07-20T06:00:00Z",
      completedAt: "2026-07-20T06:01:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid product, component, and BOM quantities", () => {
    const invalidProduct = cloneExample();
    invalidProduct.products[0]!.quantity = 0;
    expect(SpaceConfigurationSchema.safeParse(invalidProduct).success).toBe(
      false,
    );

    expect(
      ModelExportResultSchema.safeParse({
        taskId: "e0000000-0000-4000-8000-000000000001",
        projectId: "A03023",
        geometryVersion: "gv-0003",
        status: "PROCESSING",
        format: "GLB",
        inputSha256: "b".repeat(64),
        componentStats: {
          ...stats,
          instanceCount: 1,
          unboundInstanceCount: 2,
        },
        warnings: [],
        startedAt: "2026-07-20T06:00:00Z",
      }).success,
    ).toBe(false);

    expect(
      BOMSchema.safeParse({
        projectId: "A03023",
        geometryVersion: "gv-0003",
        generatedAt: "2026-07-20T06:00:00Z",
        lines: [
          {
            sku: "SF-SOFA-2200",
            description: "Sofa",
            quantity: 0,
            unit: "EACH",
          },
        ],
        instanceCount: 1,
        uniqueSkuCount: 1,
        unboundInstanceCount: 0,
      }).success,
    ).toBe(false);
  });
});
