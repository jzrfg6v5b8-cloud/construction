import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@sharkflows/space-schema": fileURLToPath(
        new URL("../space-schema/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
  },
});
