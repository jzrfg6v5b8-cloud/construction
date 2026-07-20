import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: ".next-sharkflows",
  outputFileTracingRoot: process.cwd(),
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@sharkflows/space-schema"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
