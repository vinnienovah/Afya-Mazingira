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
  // The offline fallback is a plain document in public/ rather than a route:
  // the service worker has to be able to render it with none of the app's
  // bundles present. The rewrite only makes it reachable under a tidy path.
  async rewrites() {
    return [{ source: "/offline", destination: "/offline.html" }];
  },
};

export default nextConfig;
