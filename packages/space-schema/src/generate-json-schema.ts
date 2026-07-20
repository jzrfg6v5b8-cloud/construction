import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { SpaceConfigurationSchema } from "./schema.js";

const outputDirectory = resolve(process.cwd(), "schema");
const outputPath = resolve(
  outputDirectory,
  "space-configuration.schema.json",
);
const jsonSchema = z.toJSONSchema(SpaceConfigurationSchema, {
  target: "draft-2020-12",
  reused: "ref",
});

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      $id: "https://schemas.sharkflows.com/space-configuration/1.0.0.json",
      title: "Sharkflows Space Configuration",
      ...jsonSchema,
    },
    null,
    2,
  )}\n`,
);
