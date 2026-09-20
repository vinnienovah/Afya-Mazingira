import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // data/*.csv (Conduit archive, read via a computed fs path) and
  // public/geo/*.geojson (county boundaries) are read with fs.readFileSync
  // at runtime rather than imported, so Next's static file tracer can miss
  // them when bundling serverless functions for deployment. Force-include
  // them so the Conduit CSV fallback and regional outlook work in production.
  outputFileTracingIncludes: {
    "/**": ["./data/**/*", "./public/geo/**/*"],
  },
};

export default nextConfig;
