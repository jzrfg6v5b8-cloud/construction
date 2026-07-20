import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  // Vercel expects ".next"; keep a local alias only off-Vercel if needed.
  distDir: process.env.VERCEL ? ".next" : ".next-sharkflows",
  outputFileTracingRoot: monorepoRoot,
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@sharkflows/space-schema", "@sharkflows/processing-queue"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
