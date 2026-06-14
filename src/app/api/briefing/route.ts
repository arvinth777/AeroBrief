import { NextRequest, NextResponse } from "next/server";
import { getBriefing } from "@/lib/briefingService";
import { getAIBriefing } from "@/lib/geminiService";
import { demoData } from "@/lib/demoData";

// IP-based rate limiter: 10 requests per 60 seconds
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (timestamps.length >= 10) return false;
  rateLimitMap.set(ip, [...timestamps, now]);
  return true;
}

const ICAO_PATTERN = /^[A-Z]{2,4}$/;

export async function POST(req: NextRequest) {
  // Rate limiting
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Try again in 60 seconds." },
      { status: 429 }
    );
  }

  let body: { airports?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.airports) || body.airports.length === 0) {
    return NextResponse.json(
      { error: "airports must be a non-empty array." },
      { status: 400 }
    );
  }

  // Validate & deduplicate ICAO codes
  const rawAirports = body.airports as unknown[];
  const airports: string[] = [];
  for (const a of rawAirports) {
    if (typeof a !== "string") continue;
    const icao = a.trim().toUpperCase();
    if (!ICAO_PATTERN.test(icao)) {
      return NextResponse.json(
        { error: `Invalid ICAO: '${a}'. Expected 2–4 alpha characters.` },
        { status: 400 }
      );
    }
    if (!airports.includes(icao)) airports.push(icao);
  }

  if (airports.length === 0) {
    return NextResponse.json({ error: "No valid ICAO codes provided." }, { status: 400 });
  }

  // Demo Mode
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(demoData, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Fetch real weather data
  let briefing;
  try {
    briefing = await getBriefing(airports);
  } catch (err) {
    console.error("[briefingService] Fatal error:", err);
    return NextResponse.json(
      { error: "AWC API unavailable. Enable DEMO_MODE in settings." },
      { status: 503 }
    );
  }

  // Get AI summary (never blocks the briefing — returns fallback on failure)
  const ai = await getAIBriefing(
    briefing.airports as Parameters<typeof getAIBriefing>[0],
    briefing.hazards,
    briefing.pireps
  );

  return NextResponse.json(
    { briefing, ai },
    { headers: { "Cache-Control": "no-store" } }
  );
}
