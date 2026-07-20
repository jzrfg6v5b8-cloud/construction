import { describe, expect, it } from "vitest";
import {
  AssetSchema,
  MeasurementCandidateSchema,
  MeasurementSchema,
  ProcurementSchema,
  ProposalSchema,
  checkAssetCoverage,
  classifyAsset,
  detectDuplicateAssets,
  finalExportGate,
  sha256,
  validateDimensionClosure,
  validateRepresentation,
  type Proposal,
} from "../../src/lib";

const now = "2026-07-20T06:00:00.000Z";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  const base = {
    id: "proposal-1",
    title: "Test proposal",
    status: "final" as const,
    sceneSet: {
      id: "set-1",
      name: "Main",
      activeSceneId: "scene-1",
      scenes: [{
        id: "scene-1",
        name: "Room",
        revision: 1,
        sourceAssetIds: ["asset-1"],
        objects: [{
          id: "object-1",
          sceneId: "scene-1",
          kind: "product" as const,
          name: "AC",
          transform: { positionMm: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
          representationId: "rep-1",
          sourceAssetIds: ["asset-1"],
          visible: true,
        }],
      }],
    },
    procurement: {
      id: "proc-1",
      items: [{
        id: "line-1",
        sku: "AC-1",
        name: "AC",
        quantity: 1,
        unit: "set",
        unitPrice: 1000,
        currency: "CNY",
        productRepresentationId: "rep-1",
        sceneObjectIds: ["object-1"],
        status: "confirmed" as const,
        evidence: [],
      }],
      subtotal: 1000,
      tax: 130,
      total: 1130,
      currency: "CNY",
    },
    representations: [{
      id: "rep-1",
      productId: "product-1",
      kind: "catalog" as const,
      dimensions: { widthMm: 800, depthMm: 300, heightMm: 250 },
      modelUri: "/models/ac.glb",
      materialIds: [],
      sourceAssetIds: ["asset-1"],
      isDimensionallyVerified: true,
      lod: 2,
    }],
    coverage: [{
      assetId: "asset-1",
      status: "covered" as const,
      sceneIds: ["scene-1"],
      representationIds: ["rep-1"],
      notes: [],
    }],
    issues: [],
    approvedBy: "user-1",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  return ProposalSchema.parse({ ...base, ...overrides });
}

describe("domain schemas", () => {
  it("keeps AI candidates separate from verified measurements", () => {
    const candidate = MeasurementCandidateSchema.parse({
      id: "candidate-1",
      processingId: "processing-1",
      kind: "length",
      value: 1200,
      unit: "mm",
      label: "wall",
      confidence: 0.82,
      evidence: { assetId: "asset-1", excerpt: "1200" },
    });
    expect(candidate.status).toBe("suggested");
    expect(() => MeasurementSchema.parse(candidate)).toThrow();
  });

  it("validates assets and procurement arithmetic", () => {
    expect(AssetSchema.parse({
      id: "a",
      name: "plan.pdf",
      mimeType: "application/pdf",
      byteSize: 10,
      sha256: "a".repeat(64),
      kind: "floor_plan",
      status: "ready",
      uri: "/plan.pdf",
      createdAt: now,
    }).metadata).toEqual({});
    expect(() => ProcurementSchema.parse({
      id: "p",
      items: [{ id: "i", sku: "1", name: "x", quantity: 2, unit: "piece", unitPrice: 3, currency: "cny", status: "draft" }],
      subtotal: 5,
      tax: 0,
      total: 5,
      currency: "CNY",
    })).toThrow(/Subtotal/);
  });

  it("requires approval for final proposals", () => {
    const final = proposal();
    expect(final.status).toBe("final");
    expect(() => ProposalSchema.parse({ ...final, approvedBy: undefined })).toThrow(/approval/i);
  });
});

describe("domain rules", () => {
  it("classifies known filenames conservatively", () => {
    expect(classifyAsset({ name: "一层平面图.png", mimeType: "image/png" })).toBe("floor_plan");
    expect(classifyAsset({ name: "random.png", mimeType: "image/png" })).toBe("unknown");
  });

  it("hashes and detects duplicate assets", () => {
    const hash = sha256("same");
    expect(hash).toHaveLength(64);
    expect(detectDuplicateAssets([{ id: "a", sha256: hash }, { id: "b", sha256: hash }])).toEqual([
      { sha256: hash, assetIds: ["a", "b"] },
    ]);
  });

  it("checks dimension closure within tolerance", () => {
    expect(validateDimensionClosure(
      [{ axis: "x", lengthMm: 400 }, { axis: "x", lengthMm: 599 }, { axis: "y", lengthMm: 500 }],
      { widthMm: 1000, depthMm: 500 },
      1,
    ).valid).toBe(true);
    expect(validateDimensionClosure([{ axis: "x", lengthMm: 900 }], { widthMm: 1000, depthMm: 500 }).errors)
      .toEqual(["WIDTH_NOT_CLOSED", "DEPTH_NOT_CLOSED"]);
  });

  it("enforces representation rules and calculates coverage", () => {
    const invalid = {
      id: "r",
      productId: "p",
      kind: "catalog" as const,
      dimensions: { widthMm: 1, depthMm: 1, heightMm: 1 },
      materialIds: [],
      sourceAssetIds: [],
      isDimensionallyVerified: false,
      lod: 2,
    };
    expect(validateRepresentation(invalid).errors).toEqual([
      "CATALOG_MODEL_REQUIRED",
      "LOD_MODEL_REQUIRED",
      "DIMENSIONS_UNVERIFIED",
    ]);
    expect(checkAssetCoverage(
      [{ id: "asset-1", kind: "floor_plan" }],
      proposal().sceneSet.scenes[0]!.objects,
      proposal().representations,
    )[0]?.status).toBe("covered");
  });

  it("blocks inconsistent or incomplete final exports", () => {
    expect(finalExportGate(proposal()).allowed).toBe(true);
    const blocked = proposal({
      status: "draft",
      approvedBy: undefined,
      approvedAt: undefined,
      coverage: [{ assetId: "asset-1", status: "missing", sceneIds: [], representationIds: [], notes: [] }],
    });
    expect(finalExportGate(blocked).reasons).toEqual([
      "PROPOSAL_NOT_FINAL",
      "APPROVAL_REQUIRED",
      "ASSET_COVERAGE_INCOMPLETE",
    ]);
  });
});
