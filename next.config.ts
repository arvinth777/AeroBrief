import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep heavy Node packages server-side only
  serverExternalPackages: ["metar-taf-parser", "axios"],

  // Turbopack works fine with maplibre-gl (proper ESM, no AMD worker issues)
  turbopack: {},
};

export default nextConfig;


