"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import Map, { Source, Layer, Marker, MapRef, Popup } from "react-map-gl/maplibre";
import { Plane } from "lucide-react";
import { motion } from "framer-motion";
import { springs } from "@/lib/springs";
import greatCircle from "@turf/great-circle";
import { point, lineString } from "@turf/helpers";
import length from "@turf/length";
import along from "@turf/along";
import bearing from "@turf/bearing";
import "maplibre-gl/dist/maplibre-gl.css";

export interface MarkerData {
  icao: string;
  coordinates: [number, number]; // [longitude, latitude]
  flightCategory: "VFR" | "MVFR" | "IFR" | "LIFR";
  isActive: boolean;
  isAlternate?: boolean;
  metar?: any;
}

interface Props {
  markers: MarkerData[];
  hazards: any[];
  pireps: any[];
  showRadar: boolean;
  showSigmets: boolean;
  showPireps: boolean;
  showFlights: boolean;
  activeAirport: string | null;
  onMarkerClick: (icao: string) => void;
}

const CATEGORY_HEX: Record<string, string> = {
  VFR:  "#2ebd6b",
  MVFR: "#4b70db",
  IFR:  "#eb5757",
  LIFR: "#c951e0",
};

function getCategoryColor(cat: string): string {
  return CATEGORY_HEX[cat] ?? "#888888";
}

function buildRouteLine(markers: MarkerData[]) {
  const mainMarkers = markers.filter(m => !m.isAlternate);
  const altMarkers = markers.filter(m => m.isAlternate);
  
  const features: any[] = [];
  const mainCoords: number[][] = [];
  
  if (mainMarkers.length >= 2) {
    for (let i = 0; i < mainMarkers.length - 1; i++) {
      const p1 = point(mainMarkers[i].coordinates);
      const p2 = point(mainMarkers[i+1].coordinates);
      const gc = greatCircle(p1, p2, { npoints: 100 });
      gc.properties = { type: "main" };
      features.push(gc);
      
      const coords = gc.geometry.type === "MultiLineString" 
        ? gc.geometry.coordinates.flat() 
        : gc.geometry.coordinates;
      
      if (i === 0) {
        mainCoords.push(...(coords as number[][]));
      } else {
        mainCoords.push(...(coords as number[][]).slice(1));
      }
    }
  }
  
  if (mainMarkers.length >= 1 && altMarkers.length > 0) {
    const lastMain = mainMarkers[mainMarkers.length - 1];
    altMarkers.forEach(alt => {
      const p1 = point(lastMain.coordinates);
      const p2 = point(alt.coordinates);
      const gc = greatCircle(p1, p2, { npoints: 50 });
      gc.properties = { type: "alternate" };
      features.push(gc);
    });
  }
  
  if (features.length === 0) return { collection: null, mainLine: null };
  return { 
    collection: { type: "FeatureCollection" as const, features },
    mainLine: mainCoords.length >= 2 ? lineString(mainCoords) : null
  };
}

// Free dark map style from CARTO (no token required)
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default function AeroBriefMap({
  markers,
  hazards,
  pireps,
  showRadar,
  showSigmets,
  showPireps,
  showFlights,
  activeAirport,
  onMarkerClick,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [radarPath, setRadarPath] = useState<string | null>(null);
  const [radarOpacity, setRadarOpacity] = useState(0);
  const [liveFlights, setLiveFlights] = useState<any[]>([]);
  const [hoveredFlight, setHoveredFlight] = useState<any | null>(null);
  const [popupAirport, setPopupAirport] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ x: number, y: number, feature: any } | null>(null);
  const [currentZoom, setCurrentZoom] = useState(4);
  const [routeProgress, setRouteProgress] = useState(0);

  // Fetch latest RainViewer radar path
  useEffect(() => {
    fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then((r) => r.json())
      .then((data) => {
        const past = data?.radar?.past;
        if (Array.isArray(past) && past.length > 0) {
          const latest = past[past.length - 1];
          const ageMs = Date.now() - latest.time * 1000;
          // Only use if within 3 hours
          if (ageMs < 3 * 60 * 60 * 1000 && latest.path) {
            setRadarPath(latest.path);
          }
        }
      })
      .catch(() => {/* radar unavailable */});
  }, []);

  // Animate radar opacity
  const radarOpacityRef = useRef(0);
  useEffect(() => {
    radarOpacityRef.current = radarOpacity;
  });

  useEffect(() => {
    if (!mapLoaded) return;
    const target = showRadar ? 0.55 : 0;
    let frame: number;
    let current = radarOpacityRef.current;

    const step = () => {
      const delta = (target - current) * 0.12;
      current += delta;
      if (Math.abs(target - current) < 0.01) {
        setRadarOpacity(target);
      } else {
        setRadarOpacity(current);
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRadar, mapLoaded]);

  // Live Flight Polling
  useEffect(() => {
    if (!showFlights || !mapLoaded) {
      return;
    }

    let cancelled = false;
    const fetchFlights = async () => {
      try {
        const map = mapRef.current;
        if (!map) return;
        const bounds = map.getBounds();
        if (!bounds) return;
        const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
        const res = await fetch(`/api/flights?bbox=${bbox}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.flights) {
            setLiveFlights(data.flights);
          }
        }
      } catch (err) {
        if (!cancelled) console.error("Flight poll error:", err);
      }
    };

    fetchFlights();
    const interval = setInterval(fetchFlights, 10000); // 10s poll
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showFlights, mapLoaded]);

  // Clear flights when layer is toggled off
  const prevShowFlights = useRef(showFlights);
  useEffect(() => {
    if (prevShowFlights.current && !showFlights) {
      setLiveFlights([]);
    }
    prevShowFlights.current = showFlights;
  }, [showFlights]);

  // Fly to fit all markers when they change
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || markers.length === 0) return;
    if (markers.length === 1) {
      mapRef.current.flyTo({
        center: markers[0].coordinates,
        zoom: 9,
        duration: 1200,
        essential: true,
      });
      return;
    }
    const lons = markers.map((m) => m.coordinates[0]);
    const lats = markers.map((m) => m.coordinates[1]);
    mapRef.current.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 80, duration: 1200, essential: true }
    );
  }, [markers, mapLoaded]);

  // Fly to active airport
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !activeAirport) return;
    const marker = markers.find((m) => m.icao === activeAirport);
    if (!marker) return;
    mapRef.current.flyTo({
      center: marker.coordinates,
      zoom: Math.max(mapRef.current.getZoom(), 8),
      duration: 800,
      essential: true,
    });
  }, [activeAirport, mapLoaded, markers]);

  // Radar Zoom Enforcement
  useEffect(() => {
    if (showRadar && mapRef.current && mapLoaded) {
      if (mapRef.current.getZoom() > 8) {
        mapRef.current.flyTo({ zoom: 6, duration: 1000 });
      }
    }
  }, [showRadar, mapLoaded]);

  // Animate Route Point
  useEffect(() => {
    if (markers.length < 2) return;
    let frame: number;
    let lastTime = performance.now();
    const animate = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;
      setRouteProgress(p => (p + (dt * 0.0003)) % 1);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [markers.length]);

  const routeData = React.useMemo(() => buildRouteLine(markers), [markers]);
  const routeLine = routeData.collection;
  const mainLine = routeData.mainLine;

  const movingPoint = React.useMemo(() => {
    if (!mainLine || isNaN(routeProgress)) return null;
    
    try {
      // Calculate position along the continuous great circle
      const totalLength = length(mainLine);
      if (!totalLength || isNaN(totalLength) || totalLength === 0) return null;
      
      const distance = totalLength * routeProgress;
      if (isNaN(distance)) return null;
      
      const pt = along(mainLine, distance);
      
      // Calculate bearing for plane rotation
      // We get a point slightly ahead to find the heading
      const lookAheadDist = Math.min(distance + 1, totalLength);
      const lookAheadPt = along(mainLine, lookAheadDist);
      let planeBearing = bearing(pt, lookAheadPt);
      
      return {
        type: "Feature" as const,
        properties: { bearing: planeBearing },
        geometry: { type: "Point" as const, coordinates: pt.geometry.coordinates },
      };
    } catch (e) {
      console.warn("Turf animation error:", e);
      return null;
    }
  }, [routeProgress, mainLine]);

  const sigmetGeoJSON = React.useMemo(() => {
    if (!hazards || hazards.length === 0) return null;
    const validHazards = hazards.filter(h => Array.isArray(h.coords) && h.coords.length > 0);
    
    const features = validHazards.map((h) => {
      // Filter valid points only
      const coords = h.coords
        .filter((c: any) => c && typeof c.lon === "number" && typeof c.lat === "number")
        .map((c: any) => [c.lon, c.lat]);
        
      if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
        coords.push([...coords[0]]);
      }
      
      // A linear ring requires at least 4 positions (3 distinct + 1 closing) for a valid Mapbox Polygon
      if (coords.length < 4) return null;

      return {
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: [coords] },
        properties: { raw: h.rawSigmet, hazard: h.hazard, qualifier: h.qualifier },
      };
    }).filter(Boolean); // Drop null features
    
    return {
      type: "FeatureCollection" as const,
      features: features as any[],
    };
  }, [hazards]);

  const pirepGeoJSON = React.useMemo(() => {
    if (!pireps || pireps.length === 0) return null;
    const validPireps = pireps.filter(p => p.lon !== undefined && p.lat !== undefined);
    return {
      type: "FeatureCollection" as const,
      features: validPireps.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
        properties: { raw: p.rawOb, type: p.acType, fltLvl: p.fltLvl },
      })),
    };
  }, [pireps]);

  return (
    <div className="w-full h-full relative">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: -98.58, latitude: 39.83, zoom: 4 }}
        mapStyle={MAP_STYLE}
        attributionControl={false}
        maxZoom={14}
        onLoad={() => setMapLoaded(true)}
        onZoom={(e) => setCurrentZoom(e.viewState.zoom)}
        onClick={(e: any) => {
          const feature = e.features && e.features[0];
          if (feature && (feature.layer.id === "sigmets-fill" || feature.layer.id === "pireps-point")) {
            setHoverInfo({ x: e.lngLat.lng, y: e.lngLat.lat, feature: feature.properties });
          } else {
            setHoverInfo(null);
          }
        }}
        interactiveLayerIds={(showSigmets || showPireps) ? ["sigmets-fill", "pireps-point"] : []}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Radar layer */}
        {radarPath && radarOpacity > 0.005 && (
          <Source
            id="radar"
            type="raster"
            tiles={[`https://tilecache.rainviewer.com${radarPath}/256/{z}/{x}/{y}/2/1_1.png`]}
            tileSize={256}
            maxzoom={7}
          >
            <Layer
              id="radar-layer"
              type="raster"
              paint={{
                "raster-opacity": radarOpacity,
                "raster-resampling": "linear",
              }}
            />
          </Source>
        )}

        {/* Route line */}
        {routeLine && (
          <Source id="route" type="geojson" data={routeLine}>
            <Layer
              id="route-line-main"
              type="line"
              filter={["!=", ["get", "type"], "alternate"]}
              paint={{
                "line-color": "#555",
                "line-width": 2,
                "line-opacity": 0.5,
                "line-dasharray": [2, 3],
              }}
            />
            <Layer
              id="route-line-alt"
              type="line"
              filter={["==", ["get", "type"], "alternate"]}
              paint={{
                "line-color": "#eb5757",
                "line-width": 1.5,
                "line-opacity": 0.8,
                "line-dasharray": [4, 4],
              }}
            />
          </Source>
        )}

        {/* Animated plane marker */}
        {movingPoint && (
          <Marker
            longitude={movingPoint.geometry.coordinates[0]}
            latitude={movingPoint.geometry.coordinates[1]}
            rotation={movingPoint.properties.bearing - 45}
            anchor="center"
          >
            <Plane size={18} fill="#fbbc05" color="#fbbc05" strokeWidth={1} />
          </Marker>
        )}

        {/* SIGMETs */}
        {showSigmets && sigmetGeoJSON && (
          <Source id="sigmets" type="geojson" data={sigmetGeoJSON}>
            <Layer
              id="sigmets-fill"
              type="fill"
              paint={{
                "fill-color": "#eb5757",
                "fill-opacity": 0.15,
              }}
            />
            <Layer
              id="sigmets-line"
              type="line"
              paint={{
                "line-color": "#eb5757",
                "line-width": 2,
                "line-opacity": 0.8,
                "line-dasharray": [2, 2],
              }}
            />
          </Source>
        )}

        {/* PIREPs */}
        {showPireps && pirepGeoJSON && (
          <Source id="pireps" type="geojson" data={pirepGeoJSON}>
            <Layer
              id="pireps-point"
              type="circle"
              paint={{
                "circle-color": "#4b8ef5",
                "circle-radius": 4,
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#111",
              }}
            />
          </Source>
        )}

        {/* Airport markers */}
        {markers.map((marker) => {
          const color = getCategoryColor(marker.flightCategory);
          const isActive = marker.isActive;
          return (
            <Marker
              key={marker.icao}
              longitude={marker.coordinates[0]}
              latitude={marker.coordinates[1]}
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                onMarkerClick(marker.icao);
                setPopupAirport(marker.icao === popupAirport ? null : marker.icao);
              }}
            >
              <div className="flex flex-col items-center cursor-pointer group relative" style={{ color }}>
                {/* Pulse ring for active marker */}
                {isActive && (
                  <div
                    className="absolute inset-0 rounded-full pulse-ring"
                    style={{ color }}
                  />
                )}
                <motion.div
                  animate={{ scale: isActive ? 1.3 : 1 }}
                  transition={springs.snappy}
                  className="w-3.5 h-3.5 rounded-full border-2 border-[#111] shadow-lg"
                  style={{ backgroundColor: color }}
                />
                <motion.div
                  animate={{ opacity: isActive ? 1 : 0.7 }}
                  className="mt-1 text-[10px] font-bold tracking-widest bg-[#000]/80 px-1.5 py-0.5 rounded text-[#d1d1d1] backdrop-blur-sm group-hover:opacity-100 transition-opacity"
                >
                  {marker.icao}
                </motion.div>
              </div>
            </Marker>
          );
        })}

        {/* Airport Click Popup */}
        {popupAirport && markers.find(mk => mk.icao === popupAirport) && (() => {
          const popupMarker = markers.find(mk => mk.icao === popupAirport)!;
          return (
            <Popup
              longitude={popupMarker.coordinates[0]}
              latitude={popupMarker.coordinates[1]}
              anchor="bottom"
              offset={[0, -20]}
              closeOnClick={false}
              onClose={() => setPopupAirport(null)}
              className="z-50"
            >
              <div className="bg-[#1a1a1a] text-white p-3 rounded-lg shadow-2xl border border-[#333] min-w-[140px] text-center">
                <div className="font-bold text-[14px] tracking-widest mb-1">{popupMarker.icao}</div>
                <div 
                  className="text-[10px] uppercase tracking-widest px-2 py-1 rounded inline-block font-bold mb-3"
                  style={{ backgroundColor: `${getCategoryColor(popupMarker.flightCategory)}20`, color: getCategoryColor(popupMarker.flightCategory) }}
                >
                  {popupMarker.flightCategory}
                </div>
                {popupMarker.metar && (
                  <div className="flex flex-col gap-1.5 text-[11px] font-mono text-[#aaa]">
                    {popupMarker.metar.wind?.speed != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[#666]">WIND</span>
                        <span>{popupMarker.metar.wind.degrees ? popupMarker.metar.wind.degrees.toString().padStart(3, '0') + '°' : 'VRB'}@{popupMarker.metar.wind.speed}kt{popupMarker.metar.wind.gust ? `G${popupMarker.metar.wind.gust}` : ''}</span>
                      </div>
                    )}
                    {popupMarker.metar.visibility != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[#666]">VIS</span>
                        <span>{popupMarker.metar.visibility} SM</span>
                      </div>
                    )}
                    {popupMarker.metar.temp != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[#666]">TEMP</span>
                        <span>{popupMarker.metar.temp}°C / {popupMarker.metar.dewpoint ?? '-'}°C</span>
                      </div>
                    )}
                    {popupMarker.metar.altimeter != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[#666]">ALTIM</span>
                        <span>{popupMarker.metar.altimeter.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Popup>
          );
        })()}

        {/* Flight Markers */}
        {showFlights && liveFlights.map((flight) => (
          <Marker
            key={flight.icao24}
            longitude={flight.longitude}
            latitude={flight.latitude}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setHoveredFlight(hoveredFlight?.icao24 === flight.icao24 ? null : flight);
            }}
            style={{ zIndex: hoveredFlight?.icao24 === flight.icao24 ? 40 : 10 }}
          >
            <div className="relative group cursor-pointer" style={{ transform: `rotate(${flight.heading ?? 0}deg)` }}>
              <Plane size={16} className="text-yellow-400 fill-yellow-400 drop-shadow-md" />
            </div>
          </Marker>
        ))}

        {/* Flight Popup */}
        {showFlights && hoveredFlight && (() => {
          const f = hoveredFlight as any;
          const altFt = f.altitude != null ? Math.round(f.altitude * 3.28084) : null;
          const spdKt = f.velocity != null ? Math.round(f.velocity * 1.94384) : null;
          const hdg = f.heading != null ? Math.round(f.heading) : null;
          const vr = f.verticalRate; // m/s
          const vrFpm = vr != null ? Math.round(vr * 196.85) : null;
          
          // Determine flight phase
          const phase = vr == null ? null 
            : vr > 1.5 ? "CLB" 
            : vr < -1.5 ? "DSC" 
            : "CRZ";
          const phaseColor = phase === "CLB" ? "#2ebd6b" : phase === "DSC" ? "#eb5757" : "#4b70db";
          const phaseLabel = phase === "CLB" ? "↑ CLIMBING" : phase === "DSC" ? "↓ DESCENDING" : "→ CRUISING";

          // FL or altitude label
          const flLevel = altFt != null ? (altFt >= 18000 ? `FL${Math.round(altFt / 100)}` : `${altFt.toLocaleString()} ft`) : "N/A";

          return (
            <Popup
              longitude={f.longitude}
              latitude={f.latitude}
              anchor="bottom"
              offset={[0, -14]}
              closeOnClick={false}
              onClose={() => setHoveredFlight(null)}
              className="z-50"
            >
              <div className="bg-[#111] text-white rounded-xl shadow-2xl border border-[#2a2a2a] overflow-hidden" style={{ minWidth: 220 }}>
                {/* Header */}
                <div className="bg-[#1a1a1a] px-4 py-3 border-b border-[#2a2a2a]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-[16px] tracking-widest text-[#fbbc05] font-mono">{f.callsign}</span>
                    {phase && (
                      <span className="text-[9px] font-bold tracking-[0.15em] px-2 py-0.5 rounded" style={{ color: phaseColor, backgroundColor: `${phaseColor}20` }}>
                        {phaseLabel}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-[#555]">{f.icao24?.toUpperCase()}</span>
                    {f.squawk && <span className="text-[9px] text-[#444] font-mono border border-[#333] px-1.5 rounded">SQ {f.squawk}</span>}
                  </div>
                </div>

                {/* Route/airline from Aviationstack */}
                {f.metadata ? (
                  <div className="px-4 py-2.5 border-b border-[#1e1e1e] bg-[#141414]">
                    <div className="text-[9px] text-[#666] uppercase tracking-[0.18em] mb-1.5">{f.metadata.airline}</div>
                    <div className="flex items-center gap-2 text-[13px] font-bold font-mono">
                      <span className="text-[#ddd]">{f.metadata.departure_airport}</span>
                      <span className="text-[#444] text-[10px]">——›</span>
                      <span className="text-[#ddd]">{f.metadata.arrival_airport}</span>
                    </div>
                    {(f.metadata.scheduled_departure || f.metadata.scheduled_arrival) && (
                      <div className="flex gap-3 mt-1.5 text-[9px] font-mono">
                        {f.metadata.scheduled_departure && (
                          <span className="text-[#555]">
                            DEP <span className="text-[#888]">{new Date(f.metadata.scheduled_departure).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </span>
                        )}
                        {f.metadata.scheduled_arrival && (
                          <span className="text-[#555]">
                            ARR <span className="text-[#888]">{new Date(f.metadata.scheduled_arrival).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : f.aircraftInfo ? (
                  <div className="px-4 py-2.5 border-b border-[#1e1e1e] bg-[#141414]">
                    {f.aircraftInfo.owner && (
                      <div className="text-[9px] text-[#666] uppercase tracking-[0.18em] mb-1.5 truncate" title={f.aircraftInfo.owner}>{f.aircraftInfo.owner}</div>
                    )}
                    <div className="flex items-center gap-2 text-[12px] font-bold font-mono">
                      <span className="text-[#ddd]">{f.aircraftInfo.registration}</span>
                      {f.aircraftInfo.typeCode && (
                        <>
                          <span className="text-[#333]">·</span>
                          <span className="text-[#888] text-[11px]">{f.aircraftInfo.typeCode}</span>
                        </>
                      )}
                    </div>
                    {f.aircraftInfo.model && (
                      <div className="text-[9px] text-[#555] mt-0.5 font-mono">{f.aircraftInfo.manufacturer} {f.aircraftInfo.model}</div>
                    )}
                  </div>
                ) : (
                  <div className="px-4 py-2 border-b border-[#1e1e1e] bg-[#141414]">
                    <span className="text-[9px] text-[#444] italic">Aircraft data unavailable</span>
                  </div>
                )}

                {/* Telemetry grid */}
                <div className="px-4 py-3 grid grid-cols-2 gap-x-5 gap-y-2.5 text-[11px] font-mono">
                  <div>
                    <div className="text-[9px] text-[#555] tracking-[0.15em] mb-0.5">ALTITUDE</div>
                    <div className="text-[#ddd] font-bold">{flLevel}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[#555] tracking-[0.15em] mb-0.5">SPEED</div>
                    <div className="text-[#ddd] font-bold">{spdKt != null ? `${spdKt} kt` : "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[#555] tracking-[0.15em] mb-0.5">HEADING</div>
                    <div className="text-[#ddd] font-bold">{hdg != null ? `${hdg}°` : "N/A"}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[#555] tracking-[0.15em] mb-0.5">VERT RATE</div>
                    <div className="font-bold" style={{ color: vrFpm != null ? phaseColor : "#555" }}>
                      {vrFpm != null ? `${vrFpm > 0 ? "+" : ""}${vrFpm.toLocaleString()} fpm` : "N/A"}
                    </div>
                  </div>
                </div>
              </div>
            </Popup>
          );
        })()}

        {/* Hazard Popup */}
        {hoverInfo && (
          <Popup
            longitude={hoverInfo.x}
            latitude={hoverInfo.y}
            closeButton={false}
            closeOnClick={false}
            className="z-50"
            anchor="bottom"
          >
            <div className="bg-[#1a1a1a] text-[#ddd] text-[11px] p-2 rounded shadow-xl border border-[#333] max-w-[250px]">
              <div className="font-bold text-[#fbbc05] mb-1 uppercase tracking-widest text-[9px]">
                {hoverInfo.feature.type ? "PIREP" : hoverInfo.feature.hazard ? `SIGMET: ${hoverInfo.feature.hazard}` : "HAZARD"}
              </div>
              <div className="font-mono text-[#aaa]">
                {hoverInfo.feature.raw}
              </div>
            </div>
          </Popup>
        )}
      </Map>

      {/* Radar zoom warning */}
      {showRadar && currentZoom > 14 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-16 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
        >
          <div className="bg-[#e09145]/90 text-[#1a1007] text-[10px] font-bold tracking-[0.15em] px-4 py-2 rounded-full shadow-lg backdrop-blur-md border border-[#1a1007]/20">
            RADAR LOSES RESOLUTION: ZOOM OUT
          </div>
        </motion.div>
      )}

      {/* Radar unavailable notice */}
      {showRadar && !radarPath && mapLoaded && (
        <div className="absolute top-4 left-4 z-10">
          <div className="text-[9px] font-bold tracking-[0.15em] text-[#555] bg-[#0a0a0a]/90 border border-[#1a1a1a] px-3 py-1.5 rounded backdrop-blur-sm">
            GLOBAL RADAR LAYER UNAVAILABLE
          </div>
        </div>
      )}
    </div>
  );
}
