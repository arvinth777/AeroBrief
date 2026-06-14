/**
 * mapboxInit.ts
 *
 * Overrides the mapbox-gl worker URL set during module evaluation.
 * Must be imported before react-map-gl/mapbox creates any Map instances.
 *
 * The actual URL is set as a global by the layout.tsx beforeInteractive script
 * so it's available before React hydration begins.
 */
import mapboxgl from "mapbox-gl";

if (typeof window !== "undefined") {
  // Use the global set by the beforeInteractive script, or fall back directly
  const workerUrl =
    (window as unknown as Record<string, string>).__mapboxWorkerUrl ??
    "/mapbox-gl-csp-worker.js";
  mapboxgl.workerUrl = workerUrl;
}

export {};
