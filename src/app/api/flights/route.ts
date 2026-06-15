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
    // 1. Fire parallel fetches for OpenSky and AirLabs
    const openSkyUrl = `https://opensky-network.org/api/states/all?lamin=${minLat}&lomin=${minLon}&lamax=${maxLat}&lomax=${maxLon}`;
    
    const osHeaders: Record<string, string> = {};
    if (process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD) {
      const auth = Buffer.from(`${process.env.OPENSKY_USERNAME}:${process.env.OPENSKY_PASSWORD}`).toString('base64');
      osHeaders['Authorization'] = `Basic ${auth}`;
    }

    const airLabsKey = process.env.AIRLABS_API_KEY || "e51e1ae1-c20c-43ce-9343-da0113a40d00";
    const airLabsUrl = `https://airlabs.co/api/v9/flights?api_key=${airLabsKey}&bbox=${minLat},${minLon},${maxLat},${maxLon}`;

    const osPromise = fetch(openSkyUrl, { headers: osHeaders, signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : Promise.reject(`OpenSky HTTP ${r.status}`));
      
    const alPromise = fetch(airLabsUrl, { signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : Promise.reject(`AirLabs HTTP ${r.status}`));

    const [osResult, alResult] = await Promise.allSettled([osPromise, alPromise]);

    const states = osResult.status === "fulfilled" ? (osResult.value.states || []) : [];
    const airLabsFlights = alResult.status === "fulfilled" ? (alResult.value.response || []) : [];

    if (osResult.status === "rejected" && alResult.status === "rejected") {
      console.error("Both OpenSky and AirLabs failed:", osResult.reason, alResult.reason);
      return NextResponse.json({ flights: [], error: "Telemetry unavailable" });
    }

    // Map AirLabs data by hex for fast lookup
    const alMap = new Map();
    for (const f of airLabsFlights) {
      if (f.hex) alMap.set(f.hex.toLowerCase(), f);
    }
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
      let aircraftInfo: AircraftInfo | null = null;

      const alFlight = alMap.get(icao24?.toLowerCase());

      if (alFlight) {
        // Enriched by AirLabs
        metadata = {
          airline: alFlight.airline_icao || alFlight.airline_iata || "Unknown Airline",
          departure_airport: alFlight.dep_icao || alFlight.dep_iata || "Unknown",
          arrival_airport: alFlight.arr_icao || alFlight.arr_iata || "Unknown",
          scheduled_departure: "",
          scheduled_arrival: "",
          cached_at: Date.now(),
        };
        aircraftInfo = {
          registration: alFlight.reg_number || "",
          typeCode: alFlight.aircraft_icao || "",
          model: "",
          manufacturer: "",
          owner: alFlight.airline_icao || alFlight.airline_iata || "",
          cached_at: Date.now(),
        };
        // Remove from map so we know it was processed
        alMap.delete(icao24?.toLowerCase());
      } else {
        // Fallback to Aviationstack & HexDB
        if (callsign) {
          const cached = cache.metadata[callsign];
          if (cached && (Date.now() - cached.cached_at) < 7 * 24 * 60 * 60 * 1000) {
            metadata = cached;
          } else if (
            AVIATIONSTACK_KEY && 
            aviationStackCallsThisRun < MAX_CALLS_PER_RUN && 
            cache.apiCallsThisMonth < MAX_CALLS_PER_MONTH
          ) {
            try {
              const asRes = await fetch(`http://api.aviationstack.com/v1/flights?access_key=${AVIATIONSTACK_KEY}&flight_icao=${callsign}`);
              if (asRes.ok) {
                const asData = await asRes.json();
                if (asData.data && asData.data.length > 0) {
                  const flight = asData.data[0];
                  metadata = {
                    airline: flight.airline?.name || flight.airline?.icao || "Unknown Airline",
                    departure_airport: flight.departure?.iata || flight.departure?.icao || "Unknown",
                    arrival_airport: flight.arrival?.iata || flight.arrival?.icao || "Unknown",
                    scheduled_departure: flight.departure?.scheduled || "",
                    scheduled_arrival: flight.arrival?.scheduled || "",
                    cached_at: Date.now(),
                  };
                } else {
                  // Cache the miss so we don't keep hitting the API
                  metadata = {
                    airline: "Unknown Airline",
                    departure_airport: "Unknown",
                    arrival_airport: "Unknown",
                    scheduled_departure: "",
                    scheduled_arrival: "",
                    cached_at: Date.now(),
                  };
                }
                cache.metadata[callsign] = metadata;
              }
            } catch (err) { /* ignore */ }
            aviationStackCallsThisRun++;
            cache.apiCallsThisMonth++;
          } else if (cached) {
            metadata = cached;
          }
        }

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
                if (hexData && (hexData.Registration || hexData.Type)) {
                  aircraftInfo = {
                    registration: hexData.Registration || "",
                    typeCode: hexData.ICAOTypeCode || "",
                    model: hexData.Type || "",
                    manufacturer: hexData.Manufacturer || "",
                    owner: hexData.RegisteredOwners || hexData.Operator || "",
                    cached_at: Date.now(),
                  };
                } else {
                  // Cache the miss so we don't repeatedly query HexDB for unknown hex codes
                  aircraftInfo = {
                    registration: "N/A",
                    typeCode: "Unknown Type",
                    model: "Unknown",
                    manufacturer: "Unknown",
                    owner: "Unknown Operator",
                    cached_at: Date.now(),
                  };
                }
                cache.aircraft[icao24] = aircraftInfo;
              }
            } catch (err) { /* ignore */ }
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
        last_contact: _lastContact,
        metadata,
        aircraftInfo,
      });
    }

    // 4. Add remaining AirLabs flights that OpenSky missed
    for (const alFlight of alMap.values()) {
      if (!alFlight.lat || !alFlight.lng) continue;
      liveFlights.push({
        icao24: alFlight.hex?.toLowerCase() || "",
        callsign: alFlight.flight_icao || alFlight.flight_iata || "UNKNOWN",
        latitude: alFlight.lat,
        longitude: alFlight.lng,
        altitude: alFlight.alt != null ? alFlight.alt : null,
        velocity: alFlight.speed != null ? alFlight.speed : null,
        heading: alFlight.dir != null ? alFlight.dir : null,
        verticalRate: alFlight.v_speed != null ? alFlight.v_speed : null,
        squawk: alFlight.squawk || null,
        last_contact: alFlight.updated,
        metadata: {
          airline: alFlight.airline_icao || alFlight.airline_iata || "Unknown Airline",
          departure_airport: alFlight.dep_icao || alFlight.dep_iata || "Unknown",
          arrival_airport: alFlight.arr_icao || alFlight.arr_iata || "Unknown",
          scheduled_departure: "",
          scheduled_arrival: "",
          cached_at: Date.now(),
        },
        aircraftInfo: {
          registration: alFlight.reg_number || "",
          typeCode: alFlight.aircraft_icao || "",
          model: "",
          manufacturer: "",
          owner: alFlight.airline_icao || alFlight.airline_iata || "",
          cached_at: Date.now(),
        }
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
