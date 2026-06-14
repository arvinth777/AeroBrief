// briefingService.ts — Orchestrates all weather data fetching
// Uses AWC JSON API fields directly (icaoId, fltCat, wdir, wspd, rawOb, rawTAF, fcsts)

import { awcGet } from "./awcClient";
import { getBoundingBox, getAirportCoords } from "./airports";

/* ── Types ─────────────────────────────────────────────────────────── */
export interface MetarData {
  raw: string;
  flightCategory: "VFR" | "MVFR" | "IFR" | "LIFR";
  wind: { degrees: number | null; speed: number | null; gust: number | null };
  visibility: number | null; // SM
  ceiling: number | null;    // feet (lowest BKN/OVC/VV)
  temp: number | null;
  dewpoint: number | null;
  altimeter: number | null;
}

export interface TafBlock {
  period: string;
  from: string;
  to: string;
  flightCategory: "VFR" | "MVFR" | "IFR" | "LIFR";
  wind: string;
  visibility: string;
  clouds: string;
}

export interface ParsedTaf {
  raw: string;
  blocks: TafBlock[];
}

export interface AirportBriefing {
  icao: string;
  name: string;
  coordinates: [number, number];
  metar: MetarData | null;
  parsedTaf: ParsedTaf | null;
}

export interface BriefingResponse {
  airports: Record<string, AirportBriefing>;
  hazards: unknown[];
  pireps: unknown[];
  meta: {
    generatedAt: string;
    partialFailures: string[];
    demoMode: boolean;
  };
}

/* ── AWC Response Types ─────────────────────────────────────────────── */
interface AwcMetar {
  icaoId: string;
  rawOb: string;
  fltCat: string;
  wdir: number | string | null;
  wspd: number | null;
  wgst: number | null;
  visib: string | number | null;
  temp: number | null;
  dewp: number | null;
  altim: number | null;
  clouds: { cover: string; base: number }[];
  lat: number;
  lon: number;
  name: string;
}

interface AwcFcst {
  timeFrom: number;
  timeTo: number;
  fcstChange: string | null;
  wdir: number | string | null;
  wspd: number | null;
  wgst: number | null;
  visib: string | number | null;
  vertVis: number | null;
  clouds: { cover: string; base: number; type: string | null }[];
}

interface AwcTaf {
  icaoId: string;
  rawTAF: string;
  name: string;
  lat: number;
  lon: number;
  fcsts: AwcFcst[];
}

/* ── Flight Category Logic (PRD §6.5) ─────────────────────────────── */
function getFlightCategory(
  ceiling: number | null,
  visSm: number | null,
  isVVLow: boolean
): "VFR" | "MVFR" | "IFR" | "LIFR" {
  const c = ceiling ?? 99999;
  const v = visSm ?? 99;
  if (c < 500 || v < 1 || isVVLow) return "LIFR";
  if (c < 1000 || v < 3) return "IFR";
  if (c < 3000 || v < 5) return "MVFR";
  return "VFR";
}

/* ── Visibility Parser ─────────────────────────────────────────────── */
function parseVisSm(visib: string | number | null): number | null {
  if (visib == null) return null;
  const s = String(visib);
  if (s === "6+" || s === "10+" || s === "P6SM") return 10;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/* ── METAR → MetarData ─────────────────────────────────────────────── */
function parseMetarFromAwc(m: AwcMetar): MetarData {
  // Determine ceiling: lowest BKN or OVC cloud base
  let ceiling: number | null = null;
  let isVVLow = false;

  for (const cloud of m.clouds ?? []) {
    if (cloud.cover === "OVC" || cloud.cover === "BKN") {
      const h = cloud.base; // already in feet
      ceiling = ceiling === null ? h : Math.min(ceiling, h);
    }
    if (cloud.cover === "VV") {
      isVVLow = cloud.base < 500;
      ceiling = ceiling === null ? cloud.base : Math.min(ceiling, cloud.base);
    }
  }

  const visSm = parseVisSm(m.visib);
  const wdir = m.wdir != null && m.wdir !== "VRB" ? Number(m.wdir) : null;

  // Map AWC fltCat to our type, with fallback calculation
  const cat = (["VFR", "MVFR", "IFR", "LIFR"].includes(m.fltCat)
    ? m.fltCat
    : getFlightCategory(ceiling, visSm, isVVLow)) as "VFR" | "MVFR" | "IFR" | "LIFR";

  return {
    raw: m.rawOb,
    flightCategory: cat,
    wind: { degrees: wdir, speed: m.wspd, gust: m.wgst },
    visibility: visSm,
    ceiling,
    temp: m.temp,
    dewpoint: m.dewp,
    altimeter: m.altim ? m.altim / 33.8639 : null, // hPa → inHg
  };
}

/* ── TAF fcsts → TafBlocks ─────────────────────────────────────────── */
function parseTafFromAwc(t: AwcTaf): ParsedTaf {
  const blocks: TafBlock[] = (t.fcsts ?? []).slice(0, 6).map((f) => {
    const from = new Date(f.timeFrom * 1000).toISOString();
    const to = new Date(f.timeTo * 1000).toISOString();
    const period = f.fcstChange
      ? `${f.fcstChange} ${new Date(f.timeFrom * 1000).toISOString().slice(11, 16)}Z`
      : new Date(f.timeFrom * 1000).toISOString().slice(11, 16) + "Z";

    let ceiling: number | null = null;
    let isVVLow = false;
    const cloudStrs: string[] = [];

    for (const cloud of f.clouds ?? []) {
      const baseStr = cloud.base != null ? String(Math.round(cloud.base / 100)).padStart(3, "0") : "///";
      cloudStrs.push(`${cloud.cover}${baseStr}`);
      if (cloud.cover === "OVC" || cloud.cover === "BKN") {
        const h = cloud.base ?? 99999;
        ceiling = ceiling === null ? h : Math.min(ceiling, h);
      }
      if (cloud.cover === "VV") {
        isVVLow = (cloud.base ?? 9999) < 500;
      }
    }

    if (f.vertVis != null) {
      isVVLow = f.vertVis < 500;
    }

    const visSm = parseVisSm(f.visib);
    const fc = getFlightCategory(ceiling, visSm, isVVLow);

    const wdir = f.wdir != null ? (f.wdir === "VRB" ? "VRB" : String(f.wdir).padStart(3, "0")) : "VRB";
    const wspd = f.wspd != null ? `${f.wspd}KT` : "";
    const wgst = f.wgst ? `G${f.wgst}KT` : "";
    const windStr = `${wdir}${wspd}${wgst}`;

    const visStr = visSm != null
      ? visSm >= 6 ? "P6SM" : `${Math.round(visSm * 10) / 10}SM`
      : "P6SM";

    return {
      period,
      from,
      to,
      flightCategory: fc,
      wind: windStr,
      visibility: visStr,
      clouds: cloudStrs.join(" ") || "SKC",
    };
  });

  return { raw: t.rawTAF, blocks };
}

/* ── Main Briefing Service ─────────────────────────────────────────── */
export async function getBriefing(airports: string[]): Promise<BriefingResponse> {
  const partialFailures: string[] = [];
  const bbox = getBoundingBox(airports);

  // Parallel fan-out
  const [metarResult, tafResult, pirepResult, sigmetResult] = await Promise.allSettled([
    awcGet("/metar", { ids: airports.join(","), format: "json", hours: "3" }),
    awcGet("/taf", { ids: airports.join(","), format: "json", time: "valid" }),
    bbox
      ? awcGet("/pirep", {
          bbox: `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`,
          format: "json",
          age: "3",
        })
      : Promise.resolve([]),
    bbox
      ? awcGet("/isigmet", {
          bbox: `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`,
          format: "json",
        })
      : Promise.resolve([]),
  ]);

  // Index METARs by ICAO
  const metarMap: Record<string, AwcMetar> = {};
  if (metarResult.status === "fulfilled") {
    const metars = metarResult.value as AwcMetar[];
    if (Array.isArray(metars)) {
      for (const m of metars) {
        if (m.icaoId) metarMap[m.icaoId] = m;
      }
    }
  } else {
    partialFailures.push("METAR");
    console.error("[AWC] METAR fetch failed:", metarResult.reason);
  }

  // Index TAFs by ICAO
  const tafMap: Record<string, AwcTaf> = {};
  if (tafResult.status === "fulfilled") {
    const tafs = tafResult.value as AwcTaf[];
    if (Array.isArray(tafs)) {
      for (const t of tafs) {
        if (t.icaoId) tafMap[t.icaoId] = t;
      }
    }
  } else {
    partialFailures.push("TAF");
    console.error("[AWC] TAF fetch failed:", tafResult.reason);
  }

  const pireps =
    pirepResult.status === "fulfilled" && Array.isArray(pirepResult.value)
      ? pirepResult.value : [];
  if (pirepResult.status === "rejected") partialFailures.push("PIREP");

  const hazards =
    sigmetResult.status === "fulfilled" && Array.isArray(sigmetResult.value)
      ? sigmetResult.value : [];
  if (sigmetResult.status === "rejected") partialFailures.push("SIGMET");

  // Assemble per-airport briefings
  const airportBriefings: Record<string, AirportBriefing> = {};

  for (const icao of airports) {
    const awcMetar = metarMap[icao];
    const awcTaf = tafMap[icao];

    // Prefer AWC coordinates, fall back to our lookup
    const coords: [number, number] = awcMetar
      ? [awcMetar.lon, awcMetar.lat]
      : awcTaf
      ? [awcTaf.lon, awcTaf.lat]
      : getAirportCoords(icao) ?? [-98.58, 39.83];

    const name = awcMetar?.name ?? awcTaf?.name ?? `${icao} Airport`;

    airportBriefings[icao] = {
      icao,
      name,
      coordinates: coords,
      metar: awcMetar ? parseMetarFromAwc(awcMetar) : null,
      parsedTaf: awcTaf ? parseTafFromAwc(awcTaf) : null,
    };
  }

  return {
    airports: airportBriefings,
    hazards,
    pireps,
    meta: {
      generatedAt: new Date().toISOString(),
      partialFailures,
      demoMode: false,
    },
  };
}
