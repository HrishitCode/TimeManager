import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native/WASM DB drivers must be loaded by Node at runtime, not bundled.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  // Migrations are read from disk on first DB access; ship them with every API function.
  outputFileTracingIncludes: { "/api/**": ["./db/migrations/**"] }
};

export default nextConfig;
