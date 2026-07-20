import type { z } from "zod";
import {
  SpaceConfigurationSchema,
  type SpaceConfiguration,
} from "./schema.js";

export type SpaceValidationResult =
  | { success: true; data: SpaceConfiguration }
  | { success: false; errors: z.core.$ZodIssue[] };

export interface UpdateValidationError {
  code:
    | "INVALID_CONFIGURATION"
    | "GEOMETRY_VERSION_NOT_INCREMENTED"
    | "VERIFIED_DIMENSIONS_PROTECTED";
  message: string;
  path?: PropertyKey[];
}

export type SpaceUpdateValidationResult =
  | { success: true; data: SpaceConfiguration }
  | { success: false; errors: UpdateValidationError[] };

export function validateSpaceConfiguration(
  input: unknown,
): SpaceValidationResult {
  const result = SpaceConfigurationSchema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, errors: result.error.issues };
}

export function assertSpaceConfiguration(
  input: unknown,
): asserts input is SpaceConfiguration {
  SpaceConfigurationSchema.parse(input);
}

export function parseSpaceConfiguration(
  input: unknown,
): SpaceConfiguration {
  return SpaceConfigurationSchema.parse(input);
}

function dimensionalSnapshot(space: SpaceConfiguration): string {
  return JSON.stringify({
    ceilingHeightMm: space.ceilingHeightMm,
    walls: space.walls,
    openings: space.openings,
    windows: space.windows,
    doors: space.doors,
    fixedZones: space.fixedZones,
    partitions: space.partitions,
    rooms: space.rooms,
    products: space.products,
    dimensionAnnotations: space.dimensionAnnotations,
  });
}

function hasOnlyVerifiedDimensionalObjects(
  space: SpaceConfiguration,
): boolean {
  return [
    ...space.walls,
    ...space.openings,
    ...space.windows,
    ...space.doors,
    ...space.partitions,
    ...space.products,
    ...space.dimensionAnnotations,
  ].every(({ verificationStatus }) => verificationStatus === "VERIFIED");
}

/**
 * Validates an update and prevents inferred or low-confidence geometry from
 * replacing human-verified dimensions. A dimensional edit to verified data
 * must be a new geometry version and must itself carry a verified review.
 */
export function validateSpaceConfigurationUpdate(
  previousInput: unknown,
  nextInput: unknown,
): SpaceUpdateValidationResult {
  const previousResult = SpaceConfigurationSchema.safeParse(previousInput);
  const nextResult = SpaceConfigurationSchema.safeParse(nextInput);
  const errors: UpdateValidationError[] = [];

  if (!previousResult.success || !nextResult.success) {
    for (const result of [previousResult, nextResult]) {
      if (!result.success) {
        errors.push(
          ...result.error.issues.map((issue) => ({
            code: "INVALID_CONFIGURATION" as const,
            message: issue.message,
            path: issue.path,
          })),
        );
      }
    }
    return { success: false, errors };
  }

  const previous = previousResult.data;
  const next = nextResult.data;
  const dimensionsChanged =
    dimensionalSnapshot(previous) !== dimensionalSnapshot(next);

  if (
    dimensionsChanged &&
    next.geometryVersion === previous.geometryVersion
  ) {
    errors.push({
      code: "GEOMETRY_VERSION_NOT_INCREMENTED",
      message: "Dimensional changes require an incremented geometryVersion",
      path: ["geometryVersion"],
    });
  }

  if (
    previous.dimensionsVerified &&
    dimensionsChanged &&
    (!next.dimensionsVerified ||
      !hasOnlyVerifiedDimensionalObjects(next))
  ) {
    errors.push({
      code: "VERIFIED_DIMENSIONS_PROTECTED",
      message:
        "Low-confidence or unreviewed geometry cannot overwrite verified dimensions",
      path: ["dimensionsVerified"],
    });
  }

  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: next };
}
