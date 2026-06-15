import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CACHE_FILE = path.join(os.tmpdir(), 'aerobrief_flight_cache.json');
const AVIATIONSTACK_KEY = process.env.AVIATIONSTACK_API_KEY;

// Interfaces
interface FlightMetadata {
  airline: string;
  departure_airport: string;
  arrival_airport: string;
  scheduled_departure: string;
  scheduled_arrival: string;
  cached_at: number;
}

interface AircraftInfo {
  registration: string;
  typeCode: string;
  model: string;
  manufacturer: string;
  owner: string;
  cached_at: number;
}

interface CacheData {
  metadata: Record<string, FlightMetadata>;
  aircraft: Record<string, AircraftInfo>;
  apiCallsThisMonth: number;
  currentMonthStr: string;
}

function loadCache(): CacheData {
  const currentMonthStr = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheData;
      
      // Initialize missing properties for backward compatibility with older cache files
      if (!data.metadata) data.metadata = {};
      if (!data.aircraft) data.aircraft = {};

      // Reset counter if month changed
      if (data.currentMonthStr !== currentMonthStr) {
        data.apiCallsThisMonth = 0;
        data.currentMonthStr = currentMonthStr;
      }
      return data;
    }
  } catch (e) {
    console.warn("Failed to load flight cache", e);
  }
  return { metadata: {}, aircraft: {}, apiCallsThisMonth: 0, currentMonthStr };
}

function saveCache(data: CacheData) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to save flight cache", e);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bboxStr = searchParams.get('bbox'); // "minLat,minLon,maxLat,maxLon"
  
  if (!bboxStr) {
    return NextResponse.json({ error: "Missing bbox parameter" }, { status: 400 });
  }

  const parts = bboxStr.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return NextResponse.json({ error: "Invalid bbox format" }, { status: 400 });
  }
  const [minLat, minLon, maxLat, maxLon] = parts;

  try {
    // 1. Fetch live telemetry from OpenSky (Anonymous API or Auth if provided)
    const openSkyUrl = `https://opensky-network.org/api/states/all?lamin=${minLat}&lomin=${minLon}&lamax=${maxLat}&lomax=${maxLon}`;
    
    const headers: Record<string, string> = {};
    if (process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD) {
      const auth = Buffer.from(`${process.env.OPENSKY_USERNAME}:${process.env.OPENSKY_PASSWORD}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }
    
    // Set a timeout using AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    
    let openSkyData;
    try {
      const osRes = await fetch(openSkyUrl, { signal: controller.signal, headers });
      clearTimeout(timeout);
      if (!osRes.ok) {
        throw new Error(`OpenSky returned ${osRes.status}`);
      }
      openSkyData = await osRes.json();
    } catch (err) {
      clearTimeout(timeout);
      console.error("OpenSky fetch failed:", err);
      return NextResponse.json({ flights: [], error: "Telemetry unavailable" });
    }

    const states = openSkyData?.states || [];
    const cache = loadCache();
    
    let aviationStackCallsThisRun = 0;
    const MAX_CALLS_PER_RUN = 5;
    const MAX_CALLS_PER_MONTH = 95; // Leave a 5 request safety margin
    
    let hexdbCallsThisRun = 0;
    const MAX_HEXDB_PER_RUN = 20; // Avoid rate-limiting hexdb.io

    const liveFlights = [];

    // 2. Process each aircraft
    for (const state of states) {
      const [
        icao24, callsignRaw, _originCountry, _timePosition, _lastContact, 
        longitude, latitude, baroAltitude, onGround, velocity, 
        trueTrack, verticalRate, _sensors, geoAltitude, squawk, _spi, _positionSource
      ] = state;

      if (!latitude || !longitude || onGround) continue;

      const callsign = (callsignRaw || "").trim();
      let metadata = null;

      if (callsign) {
        // 3. Check Cache (with 7-day staleness check)
        const cached = cache.metadata[callsign];
        if (cached && (Date.now() - cached.cached_at) < 7 * 24 * 60 * 60 * 1000) {
          metadata = cached;
        } else if (
          AVIATIONSTACK_KEY && 
          aviationStackCallsThisRun < MAX_CALLS_PER_RUN && 
          cache.apiCallsThisMonth < MAX_CALLS_PER_MONTH
        ) {
          // 4. Fetch Aviationstack safely
          try {
            console.log(`[Aviationstack] Fetching metadata for ${callsign}...`);
            const asRes = await fetch(`http://api.aviationstack.com/v1/flights?access_key=${AVIATIONSTACK_KEY}&flight_iata=${callsign}`);
            
            if (asRes.ok) {
              const asData = await asRes.json();
              if (asData.data && asData.data.length > 0) {
                const flight = asData.data[0];
                metadata = {
                  airline: flight.airline?.name || "Unknown Airline",
                  departure_airport: flight.departure?.iata || flight.departure?.icao || "Unknown",
                  arrival_airport: flight.arrival?.iata || flight.arrival?.icao || "Unknown",
                  scheduled_departure: flight.departure?.scheduled || "",
                  scheduled_arrival: flight.arrival?.scheduled || "",
                  cached_at: Date.now(),
                };
                cache.metadata[callsign] = metadata;
              }
            } else {
              console.warn(`[Aviationstack] Failed with status ${asRes.status}`);
            }
          } catch (err) {
            console.error(`[Aviationstack] Error for ${callsign}:`, err);
          }
          
          // Only count the API call if we actually attempted the request
          aviationStackCallsThisRun++;
          cache.apiCallsThisMonth++;
        } else if (cached) {
          // Cache entry existed but was stale — still use it as fallback
          metadata = cached;
        }
      }

      let aircraftInfo: AircraftInfo | null = null;

      // 5. Hexdb.io fallback for aircraft registry (GA, cargo, military, etc)
      //    Look up by icao24 — 24h cache, no API key needed
      if (icao24) {
        const cachedAc = cache.aircraft[icao24];
        if (cachedAc && (Date.now() - cachedAc.cached_at) < 24 * 60 * 60 * 1000) {
          aircraftInfo = cachedAc;
        } else if (hexdbCallsThisRun < MAX_HEXDB_PER_RUN) {
          try {
            const hexRes = await fetch(`https://hexdb.io/hex-data?hex=${icao24}`, {
              headers: { "Accept": "application/json" },
              signal: AbortSignal.timeout(3000),
            });
            hexdbCallsThisRun++;
            if (hexRes.ok) {
              const hexData = await hexRes.json();
              if (hexData && hexData.Registration) {
                aircraftInfo = {
                  registration: hexData.Registration || "",
                  typeCode: hexData.ICAOTypeCode || "",
                  model: hexData.Type || "",
                  manufacturer: hexData.Manufacturer || "",
                  owner: hexData.RegisteredOwners || hexData.Operator || "",
                  cached_at: Date.now(),
                };
                cache.aircraft[icao24] = aircraftInfo;
              }
            }
          } catch (err) {
            // hexdb unavailable — silently skip
          }
        }
      }

      liveFlights.push({
        icao24,
        callsign: callsign || "UNKNOWN",
        latitude,
        longitude,
        altitude: geoAltitude !== null ? geoAltitude : (baroAltitude !== null ? baroAltitude : null),
        velocity: velocity !== null ? velocity : null,
        heading: trueTrack !== null ? trueTrack : null,
        verticalRate: verticalRate !== null ? verticalRate : null,
        squawk: squawk || null,
        metadata,
        aircraftInfo,
      });
    }

    // Save cache state (even if we just incremented the monthly counter)
    saveCache(cache);

    return NextResponse.json({ flights: liveFlights });
    
  } catch (err: unknown) {
    console.error("Flight API Error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
