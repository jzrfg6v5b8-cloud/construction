import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  distDir: ".next",
  outputFileTracingRoot: monorepoRoot,
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@sharkflows/space-schema", "@sharkflows/processing-queue"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
