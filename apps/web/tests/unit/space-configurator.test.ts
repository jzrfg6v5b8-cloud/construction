import { describe, expect, it } from "vitest";
import {
  AssetCoverageSchemaV2,
  ProductRepresentationSchemaV2,
  ProposalExportSchema,
  SceneSchemaV2,
} from "../../src/lib";

describe("space configurator v2 invariants", () => {
  it("blocks exact collision without verified product dimensions", () => {
    expect(() => ProductRepresentationSchemaV2.parse({
      id: "rep-1",
      productVariantId: "variant-1",
      representationType: "IMAGE_BILLBOARD",
      sourceAssetIds: ["asset-1"],
      modelPath: null,
      dimensionsMm: null,
      dimensionsVerified: false,
      participatesInExactCollision: true,
      disclaimer: "图片示意，不代表准确3D体积",
    })).toThrow(/verified dimensions/);
  });

  it("requires reason for an uncovered required image", () => {
    expect(() => AssetCoverageSchemaV2.parse({
      assetId: "asset-1",
      required: true,
      usageType: [],
      sceneIds: [],
      proposalPageIds: [],
      covered: false,
      exclusionReason: null,
      reviewedBy: null,
    })).toThrow(/exclusion reason/);
  });

  it("keeps scene source version traceable", () => {
    const scene = SceneSchemaV2.parse({
      id: "scene-1",
      projectId: "project-1",
      sceneSetId: "set-1",
      sceneType: "LIVING_ROOM",
      cameraPosition: [1, 2, 3],
      cameraTarget: [0, 0, 0],
      visibleRooms: ["living"],
      visibleProducts: ["sku-1"],
      visibleMaterials: ["mat-1"],
      sourceVersionId: "version-3",
      renderStatus: "COMPLETED",
      imagePath: "/private/render.webp",
      width: 1600,
      height: 900,
      validationStatus: "VALID",
      generatedAt: "2026-07-20T06:00:00.000Z",
    });
    expect(scene.sourceVersionId).toBe("version-3");
  });

  it("blocks FINAL unless coverage and consistency pass", () => {
    expect(() => ProposalExportSchema.parse({
      id: "export-1",
      projectId: "project-1",
      sceneSetId: "set-1",
      status: "FINAL",
      pageIds: [],
      coverageValidated: false,
      consistencyValidated: true,
      pdfPath: null,
      createdAt: "2026-07-20T06:00:00.000Z",
    })).toThrow(/FINAL requires/);
  });
});
