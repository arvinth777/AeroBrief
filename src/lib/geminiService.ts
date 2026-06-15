// geminiService.ts — Structured AI briefing via Google Gemini SDK
// Uses two-attempt strategy: structured schema first, plain JSON fallback

import { GoogleGenAI } from "@google/genai";
import { AIRCRAFT_PROFILES } from "./aircraftProfiles";
import type { Notam } from "./notamClient";

export interface AIBriefing {
  summary: string;
  altitudeRisks: { altitude: string; risk: string }[];
  recommendation: "GO" | "NO-GO" | "MARGINAL";
  recommendationReason: string;
}

const FALLBACK: AIBriefing = {
  summary: "AI summary unavailable.",
  altitudeRisks: [],
  recommendation: "MARGINAL",
  recommendationReason: "Could not generate AI analysis. Review raw weather data manually.",
};

let genAI: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (!genAI && process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return genAI;
}

type AirportInput = Record<string, {
  icao: string;
  metar: {
    raw?: string;
    flightCategory?: string;
    wind?: { degrees?: number | null; speed?: number | null; gust?: number | null };
    visibility?: number | null;
    ceiling?: number | null;
  } | null;
  parsedTaf?: {
    blocks?: {
      flightCategory?: string;
      wind?: string;
      visibility?: string;
      clouds?: string;
      period?: string;
    }[]
  } | null;
  windsAloft?: {
    levels: { altitude: number; direction: number | null; speed: number; temp: number | null }[];
  } | null;
  notams?: Notam[];
}>;

function condenseBriefing(airports: AirportInput, hazards: unknown[], pireps: unknown[]): string {
  const condensed = {
    airports: Object.fromEntries(
      Object.entries(airports).map(([icao, apt]) => [
        icao,
        {
          flightCategory: apt.metar?.flightCategory,
          wind: apt.metar?.wind,
          visibility: apt.metar?.visibility,
          ceiling: apt.metar?.ceiling,
          tafBlocks: (apt.parsedTaf?.blocks ?? []).slice(0, 4).map((b) => ({
            period: b.period,
            flightCategory: b.flightCategory,
            wind: b.wind,
            visibility: b.visibility,
            clouds: b.clouds,
          })),
          windsAloft: apt.windsAloft?.levels,
          notams: (apt.notams ?? []).slice(0, 10).map(n => n.message),
        },
      ])
    ),
    sigmetCount: Array.isArray(hazards) ? hazards.length : 0,
    pirepCount: Array.isArray(pireps) ? pireps.length : 0,
  };

  const str = JSON.stringify(condensed);
  return str.length > 6000 ? str.slice(0, 6000) + "..." : str;
}

function buildPrompt(icaos: string[], payload: string, aircraftId?: string): string {
  const profile = aircraftId ? AIRCRAFT_PROFILES[aircraftId] : null;
  
  const aircraftContext = profile 
    ? `\nAIRCRAFT LIMITATIONS (${profile.name}):
- Max Wind: ${profile.maxWindKt} kt
- Max Crosswind: ${profile.maxCrosswindKt} kt
- IFR Capable: ${profile.ifrCapable}
- FIKI (Flight Into Known Icing): ${profile.fikiCapable}
- Max Altitude: ${profile.maxAltitude} ft\n` 
    : "";

  return `You are an aviation weather dispatcher. Analyze this aviation weather data and NOTAMs for the route: ${icaos.join(" → ")}.
${aircraftContext}
Weather & NOTAM data:
${payload}

Use the winds aloft data to identify freezing levels (temperatures below 0°C) which indicate icing risk, and note significant headwinds or tailwinds.
Review NOTAMs for critical closures (runways, airspace, NAVAIDs) that could prevent dispatch.
Provide a safety-focused briefing in plain English (no ICAO jargon). Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence plain English overview of route weather conditions and critical NOTAMs",
  "altitudeRisks": [
    {"altitude": "SFC-FL080", "risk": "description of risk or smooth"},
    {"altitude": "FL080-FL180", "risk": "description"}
  ],
  "recommendation": "GO" or "NO-GO" or "MARGINAL",
  "recommendationReason": "one sentence reason for the recommendation, explicitly referencing aircraft limitations or critical NOTAMs if NO-GO"
}`;
}

function parseJsonSafely(text: string): AIBriefing | null {
  try {
    // Try direct parse
    const parsed = JSON.parse(text);
    if (parsed.recommendation && parsed.summary) return parsed as AIBriefing;
  } catch {
    // Try extracting JSON from markdown code block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.recommendation && parsed.summary) return parsed as AIBriefing;
      } catch { /* fall through */ }
    }
    // Try extracting raw JSON object
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        if (parsed.recommendation && parsed.summary) return parsed as AIBriefing;
      } catch { /* fall through */ }
    }
  }
  return null;
}

export async function getAIBriefing(
  airports: AirportInput,
  hazards: unknown[],
  pireps: unknown[],
  aircraftId?: string
): Promise<AIBriefing> {
  const client = getClient();
  if (!client) {
    console.error("[Gemini] No API key configured.");
    return FALLBACK;
  }

  const icaos = Object.keys(airports);
  const payload = condenseBriefing(airports, hazards, pireps);
  const prompt = buildPrompt(icaos, payload, aircraftId);

  // Attempt 1: With structured JSON output
  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    });

    const text = response.text;
    if (text && text.trim().length > 0) {
      const parsed = parseJsonSafely(text);
      if (parsed) return parsed;
    }
  } catch (err: unknown) {
    console.error("[Gemini] Attempt 1 failed:", (err as Error).message?.slice(0, 120));
  }

  // Attempt 2: Plain text with JSON extraction
  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt + "\n\nIMPORTANT: Your entire response must be valid JSON only, no other text.",
      config: {
        temperature: 0.2,
      },
    });

    const text = response.text;
    if (text && text.trim().length > 0) {
      const parsed = parseJsonSafely(text);
      if (parsed) return parsed;
    }
  } catch (err: unknown) {
    console.error("[Gemini] Attempt 2 failed:", (err as Error).message?.slice(0, 120));
  }

  return FALLBACK;
}
