// awcClient.ts — Axios instance for Aviation Weather Center API
// - Injects required User-Agent header (AWC returns 403 without it)
// - In-memory 90-second response cache
// - Up to 2 retries with 1s backoff on 5xx
// - 8-second AbortController timeout per request

import axios from "axios";

const AWC_BASE = "https://aviationweather.gov/api/data";
const USER_AGENT = "AeroBrief/1.1 (aviation-weather-briefing; contact@aerobrief.app)";
const TTL_MS = (parseInt(process.env.AWC_CACHE_TTL_SECONDS || "90")) * 1000;

const cache = new Map<string, { data: unknown; expiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();
const MAX_CACHE_SIZE = 100;

const client = axios.create({
  baseURL: AWC_BASE,
  timeout: 8000,
  headers: {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
  },
});

export async function awcGet(path: string, params: Record<string, string> = {}, options?: { accept?: string }): Promise<unknown> {
  const key = path + JSON.stringify(params) + (options?.accept || "");

  // Return cached response if still fresh
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Deduplicate concurrent identical requests
  if (inFlight.has(key)) {
    return inFlight.get(key)!;
  }

  const fetchPromise = (async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const headers: Record<string, string> = { "User-Agent": USER_AGENT };
        if (options?.accept) headers["Accept"] = options.accept;
        else headers["Accept"] = "application/json";

        const response = await client.get(path, {
          params,
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const data = response.data;
        cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
        // Evict oldest entries if cache grows too large
        if (cache.size > MAX_CACHE_SIZE) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
        return data;
      } catch (err: unknown) {
        lastErr = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    throw lastErr;
  })();

  inFlight.set(key, fetchPromise);
  try {
    const result = await fetchPromise;
    return result;
  } finally {
    inFlight.delete(key);
  }
}
