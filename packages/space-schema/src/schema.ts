import { z } from "zod";

export const SPACE_PROTOCOL_VERSION = "1.0.0" as const;
export const PROTOCOL_VERSION = SPACE_PROTOCOL_VERSION;
export const SCHEMA_VERSION = SPACE_PROTOCOL_VERSION;
export const LOW_CONFIDENCE_THRESHOLD = 0.8 as const;
export const LENGTH_UNIT = "mm" as const;

export const UUIDSchema = z.string().uuid();
export const MillimetersSchema = z.number().int().nonnegative();
export const PositiveMillimetersSchema = z.number().int().positive();
export const SignedMillimetersSchema = z.number().int();
export const TimestampSchema = z.string().datetime({ offset: true });
const CountSchema = z.number().int().nonnegative();

export const VerificationStatusSchema = z.enum([
  "UNVERIFIED",
  "LOW_CONFIDENCE",
  "REVIEWED",
  "VERIFIED",
  "REJECTED",
]);

export const VerificationSchema = z
  .strictObject({
    verificationStatus: VerificationStatusSchema,
    confidence: z.number().min(0).max(1).optional(),
    reviewedBy: z.string().min(1).optional(),
    reviewedAt: TimestampSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.verificationStatus === "VERIFIED") {
      if (
        value.confidence === undefined ||
        value.confidence < LOW_CONFIDENCE_THRESHOLD
      ) {
        context.addIssue({
          code: "custom",
          path: ["confidence"],
          message: `VERIFIED data requires confidence >= ${LOW_CONFIDENCE_THRESHOLD}`,
        });
      }
      if (!value.reviewedBy) {
        context.addIssue({
          code: "custom",
          path: ["reviewedBy"],
          message: "VERIFIED data requires reviewedBy",
        });
      }
    }
    if (
      value.verificationStatus === "LOW_CONFIDENCE" &&
      (value.confidence === undefined ||
        value.confidence >= LOW_CONFIDENCE_THRESHOLD)
    ) {
      context.addIssue({
        code: "custom",
        path: ["confidence"],
        message: `LOW_CONFIDENCE data requires confidence < ${LOW_CONFIDENCE_THRESHOLD}`,
      });
    }
  });

export const Point2DSchema = z.strictObject({
  xMm: SignedMillimetersSchema,
  yMm: SignedMillimetersSchema,
});
export const Point3DSchema = Point2DSchema.extend({
  zMm: SignedMillimetersSchema,
});
export const Dimensions3DSchema = z.strictObject({
  widthMm: PositiveMillimetersSchema,
  depthMm: PositiveMillimetersSchema,
  heightMm: PositiveMillimetersSchema,
});
export const CoordinateSystemSchema = z.strictObject({
  unit: z.literal(LENGTH_UNIT),
  upAxis: z.literal("Z"),
  origin: z.enum(["south-west", "project", "model"]),
});

const VerifiedObjectFields = {
  verificationStatus: VerificationStatusSchema,
  confidence: z.number().min(0).max(1).optional(),
  reviewedBy: z.string().min(1).optional(),
  reviewedAt: TimestampSchema.optional(),
} as const;

function withVerificationProtection<T extends z.ZodRawShape>(
  shape: T,
): z.ZodObject<T & typeof VerifiedObjectFields> {
  return z.strictObject({ ...shape, ...VerifiedObjectFields }).superRefine(
    (rawValue, context) => {
      const value = rawValue as {
        verificationStatus: z.infer<typeof VerificationStatusSchema>;
        confidence?: number;
        reviewedBy?: string;
        reviewedAt?: string;
      };
      const verification = VerificationSchema.safeParse({
        verificationStatus: value.verificationStatus,
        confidence: value.confidence,
        reviewedBy: value.reviewedBy,
        reviewedAt: value.reviewedAt,
      });
      if (!verification.success) {
        verification.error.issues.forEach((issue) =>
          context.addIssue({ ...issue, path: issue.path }),
        );
      }
    },
  );
}

export const WallSchema = withVerificationProtection({
  objectId: UUIDSchema,
  start: Point3DSchema,
  end: Point3DSchema,
  thicknessMm: PositiveMillimetersSchema,
  heightMm: PositiveMillimetersSchema,
  wallType: z.enum(["EXTERIOR", "INTERIOR", "LOAD_BEARING"]),
  locked: z.boolean(),
});

export const PartitionSchema = withVerificationProtection({
  objectId: UUIDSchema,
  start: Point3DSchema,
  end: Point3DSchema,
  thicknessMm: PositiveMillimetersSchema,
  heightMm: PositiveMillimetersSchema,
  partitionType: z.enum(["LIGHTWEIGHT", "GLASS", "MOVABLE", "OTHER"]),
  locked: z.boolean(),
});

export const OpeningSchema = withVerificationProtection({
  objectId: UUIDSchema,
  hostObjectId: UUIDSchema,
  openingType: z.enum(["ENTRY", "DOOR", "WINDOW", "PASSAGE", "UTILITY"]),
  offsetMm: MillimetersSchema,
  widthMm: PositiveMillimetersSchema,
  heightMm: PositiveMillimetersSchema,
  sillHeightMm: MillimetersSchema,
});

export const DoorSchema = withVerificationProtection({
  objectId: UUIDSchema,
  hostObjectId: UUIDSchema,
  openingObjectId: UUIDSchema,
  componentDefinition: z.string().min(1),
  widthMm: PositiveMillimetersSchema,
  depthMm: PositiveMillimetersSchema,
  heightMm: PositiveMillimetersSchema,
  offsetMm: MillimetersSchema,
  swing: z.enum(["LEFT", "RIGHT", "DOUBLE", "SLIDING", "NONE"]),
  locked: z.boolean(),
});

export const WindowSchema = withVerificationProtection({
  objectId: UUIDSchema,
  hostObjectId: UUIDSchema,
  widthMm: PositiveMillimetersSchema,
  heightMm: PositiveMillimetersSchema,
  sillHeightMm: MillimetersSchema,
  offsetMm: MillimetersSchema,
});

export const FixedZoneSchema = z.strictObject({
  objectId: UUIDSchema,
  zoneType: z.enum([
    "KITCHEN",
    "BATHROOM",
    "COLUMN",
    "SHAFT",
    "EQUIPMENT",
    "BUILT_IN",
    "RESTRICTED",
  ]),
  roomId: UUIDSchema,
  locked: z.literal(true),
  polygon: z.array(Point2DSchema).min(3),
});

export const RoomSchema = z.strictObject({
  objectId: UUIDSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  netWidthMm: PositiveMillimetersSchema,
  netDepthMm: PositiveMillimetersSchema,
  floorElevationMm: SignedMillimetersSchema,
});

export const ProductSchema = z.strictObject({
  objectId: UUIDSchema,
  sku: z.string().min(1),
  componentDefinition: z.string().min(1),
  widthMm: PositiveMillimetersSchema,
  depthMm: PositiveMillimetersSchema,
  heightMm: PositiveMillimetersSchema,
  xMm: SignedMillimetersSchema,
  yMm: SignedMillimetersSchema,
  zMm: SignedMillimetersSchema,
  rotationDegrees: z.number().finite(),
  materialCode: z.string().min(1),
  quantity: z.number().int().positive(),
  quantityUnit: z.enum(["EACH", "SET", "PACK", "M", "M2"]).default("EACH"),
  roomId: UUIDSchema,
  verificationStatus: VerificationStatusSchema,
});

export const MaterialSchema = z.strictObject({
  materialCode: z.string().min(1),
  name: z.string().min(1),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  textureAssetId: z.string().min(1).nullable(),
  realWidthMm: PositiveMillimetersSchema,
  realHeightMm: PositiveMillimetersSchema,
});

export const CameraSchema = z.strictObject({
  objectId: UUIDSchema,
  sceneCode: z.string().min(1),
  projection: z.enum(["ORTHOGRAPHIC", "PERSPECTIVE"]),
  eye: Point3DSchema,
  target: Point3DSchema,
  up: z.strictObject({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  }),
});

export const DimensionAnnotationSchema = withVerificationProtection({
  objectId: UUIDSchema,
  dimensionType: z.string().min(1),
  valueMm: PositiveMillimetersSchema,
  start: Point3DSchema,
  end: Point3DSchema,
});

export const OutputRequirementsSchema = z.strictObject({
  scenes: z.array(z.string().min(1)).min(1),
  formats: z
    .array(
      z.enum([
        "SKP",
        "PNG",
        "PDF",
        "GLB",
        "GLTF",
        "OBJ",
        "IFC",
        "COMPONENT_STATS_JSON",
        "LAYOUT_HANDOFF_JSON",
      ]),
    )
    .min(1),
  layoutTemplateCode: z.string().min(1).optional(),
  layoutScales: z.record(z.string(), z.string().min(1)).default({}),
  requireSkuReconciliation: z.boolean(),
});

export const SpaceConfigurationSchema = z
  .strictObject({
    schemaVersion: z.literal(SPACE_PROTOCOL_VERSION),
    projectId: z.string().min(1),
    floorPlanCode: z.string().min(1),
    geometryVersion: z.string().min(1),
    dimensionsVerified: z.boolean(),
    ceilingHeightMm: PositiveMillimetersSchema,
    coordinateSystem: CoordinateSystemSchema,
    walls: z.array(WallSchema).min(1),
    openings: z.array(OpeningSchema),
    windows: z.array(WindowSchema),
    doors: z.array(DoorSchema),
    fixedZones: z.array(FixedZoneSchema),
    partitions: z.array(PartitionSchema),
    rooms: z.array(RoomSchema).min(1),
    products: z.array(ProductSchema),
    materials: z.array(MaterialSchema),
    cameras: z.array(CameraSchema),
    dimensionAnnotations: z.array(DimensionAnnotationSchema),
    outputRequirements: OutputRequirementsSchema,
  })
  .superRefine((space, context) => {
    const stableObjects = [
      ...space.walls,
      ...space.openings,
      ...space.windows,
      ...space.doors,
      ...space.partitions,
      ...space.products,
    ];
    const stableIds = stableObjects.map(({ objectId }) => objectId);
    if (new Set(stableIds).size !== stableIds.length) {
      context.addIssue({
        code: "custom",
        path: ["walls"],
        message:
          "Wall, opening, window, door, partition, and product stable UUIDs must be globally unique",
      });
    }

    const wallIds = new Set(space.walls.map(({ objectId }) => objectId));
    const openingIds = new Set(
      space.openings.map(({ objectId }) => objectId),
    );
    const roomIds = new Set(space.rooms.map(({ objectId }) => objectId));
    const materialCodes = new Set(
      space.materials.map(({ materialCode }) => materialCode),
    );
    space.openings.forEach((opening, index) => {
      if (!wallIds.has(opening.hostObjectId)) {
        context.addIssue({
          code: "custom",
          path: ["openings", index, "hostObjectId"],
          message: "Opening must reference an existing wall",
        });
      }
    });
    space.windows.forEach((window, index) => {
      if (!wallIds.has(window.hostObjectId)) {
        context.addIssue({
          code: "custom",
          path: ["windows", index, "hostObjectId"],
          message: "Window must reference an existing wall",
        });
      }
    });
    space.doors.forEach((door, index) => {
      if (
        !wallIds.has(door.hostObjectId) ||
        !openingIds.has(door.openingObjectId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["doors", index],
          message: "Door must reference an existing wall and opening",
        });
      }
    });
    space.fixedZones.forEach((zone, index) => {
      if (!roomIds.has(zone.roomId)) {
        context.addIssue({
          code: "custom",
          path: ["fixedZones", index, "roomId"],
          message: "Fixed zone must reference an existing room",
        });
      }
    });
    space.products.forEach((product, index) => {
      if (!roomIds.has(product.roomId)) {
        context.addIssue({
          code: "custom",
          path: ["products", index, "roomId"],
          message: "Product must reference an existing room",
        });
      }
      if (!materialCodes.has(product.materialCode)) {
        context.addIssue({
          code: "custom",
          path: ["products", index, "materialCode"],
          message: "Product must reference an existing material",
        });
      }
    });

    const verifiedGeometry = [
      ...space.walls,
      ...space.openings,
      ...space.windows,
      ...space.doors,
      ...space.partitions,
      ...space.products,
      ...space.dimensionAnnotations,
    ].every(({ verificationStatus }) => verificationStatus === "VERIFIED");
    if (space.dimensionsVerified && !verifiedGeometry) {
      context.addIssue({
        code: "custom",
        path: ["dimensionsVerified"],
        message:
          "dimensionsVerified cannot be true while dimensional objects remain unverified",
      });
    }
  });

export const SKUSchema = z.strictObject({
  sku: z.string().min(1),
  componentId: UUIDSchema,
  componentDefinition: z.string().min(1),
  libraryVersion: z.string().min(1),
  dimensions: Dimensions3DSchema,
  unit: z.literal("EACH"),
  upAxis: z.literal("Z"),
  insertionPoint: Point3DSchema,
  allowUniformScaling: z.boolean(),
  supplier: z.string().min(1),
  assetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  verificationStatus: z.literal("VERIFIED"),
});

export const BOMLineSchema = z.strictObject({
  sku: z.string().min(1),
  componentId: UUIDSchema.optional(),
  description: z.string().min(1),
  roomId: UUIDSchema.optional(),
  quantity: z.number().positive(),
  unit: z.enum(["EACH", "SET", "PACK", "M", "M2"]),
  unitPrice: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
});
export const BOMSchema = z.strictObject({
  projectId: z.string().min(1),
  geometryVersion: z.string().min(1),
  generatedAt: TimestampSchema,
  lines: z.array(BOMLineSchema),
  instanceCount: CountSchema,
  uniqueSkuCount: CountSchema,
  unboundInstanceCount: CountSchema,
});

export const TaskStatusSchema = z.enum([
  "QUEUED",
  "VALIDATING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export const SketchUpComponentStatsSchema = z
  .strictObject({
    instanceCount: CountSchema,
    uniqueSkuCount: CountSchema,
    unboundInstanceCount: CountSchema,
    excludedInstanceCount: CountSchema,
    quantitiesBySku: z.record(z.string(), z.number().positive()),
    quantitiesByRoom: z.record(z.string(), z.number().positive()),
    componentDefinitionCount: CountSchema,
    groupCount: CountSchema,
    faceCount: CountSchema,
    edgeCount: CountSchema,
    materialCount: CountSchema,
    warningCount: CountSchema,
  })
  .superRefine((stats, context) => {
    const skuQuantity = Object.values(stats.quantitiesBySku).reduce(
      (total, quantity) => total + quantity,
      0,
    );
    if (skuQuantity + stats.unboundInstanceCount !== stats.instanceCount) {
      context.addIssue({
        code: "custom",
        path: ["quantitiesBySku"],
        message:
          "Bound SKU quantity plus unbound instances must equal instanceCount",
      });
    }
  });

export const ModelExportResultSchema = z
  .strictObject({
    taskId: UUIDSchema,
    projectId: z.string().min(1),
    geometryVersion: z.string().min(1),
    status: TaskStatusSchema,
    format: z.enum(["SKP", "GLB", "GLTF", "OBJ", "IFC"]),
    outputUri: z.string().url().optional(),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    outputSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    byteSize: CountSchema.optional(),
    componentStats: SketchUpComponentStatsSchema,
    warnings: z.array(z.string()),
    error: z.string().optional(),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema.optional(),
  })
  .superRefine((result, context) => {
    if (
      result.status === "SUCCEEDED" &&
      (!result.outputUri || !result.outputSha256 || !result.completedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "SUCCEEDED export requires outputUri, outputSha256, and completedAt",
      });
    }
    if (result.status === "FAILED" && !result.error) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "FAILED export requires an error message",
      });
    }
  });

export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Window = z.infer<typeof WindowSchema>;
export type Door = z.infer<typeof DoorSchema>;
export type FixedZone = z.infer<typeof FixedZoneSchema>;
export type Partition = z.infer<typeof PartitionSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type SKU = z.infer<typeof SKUSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type BOMLine = z.infer<typeof BOMLineSchema>;
export type BOM = z.infer<typeof BOMSchema>;
export type SpaceConfiguration = z.infer<typeof SpaceConfigurationSchema>;
export type SketchUpComponentStats = z.infer<
  typeof SketchUpComponentStatsSchema
>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ModelExportResult = z.infer<typeof ModelExportResultSchema>;
