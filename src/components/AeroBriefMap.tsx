"use client";

import React, { useEffect, useRef, useState } from "react";
import Map, { Source, Layer, Marker, MapRef, Popup } from "react-map-gl/maplibre";
import { Plane } from "lucide-react";
import { motion } from "framer-motion";
import { springs } from "@/lib/springs";
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
  
  if (mainMarkers.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: mainMarkers.map(m => m.coordinates) },
      properties: { type: "main" }
    });
  }
  
  if (mainMarkers.length >= 1 && altMarkers.length > 0) {
    const lastMain = mainMarkers[mainMarkers.length - 1];
    altMarkers.forEach(alt => {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [lastMain.coordinates, alt.coordinates] },
        properties: { type: "alternate" }
      });
    });
  }
  
  if (features.length === 0) return null;
  return { type: "FeatureCollection" as const, features };
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
  activeAirport,
  onMarkerClick,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [radarPath, setRadarPath] = useState<string | null>(null);
  const [radarOpacity, setRadarOpacity] = useState(0);
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
  useEffect(() => {
    if (!mapLoaded) return;
    const target = showRadar ? 0.55 : 0;
    let frame: number;
    let current = radarOpacity;
    const step = () => {
      const delta = (target - current) * 0.12;
      current += delta;
      setRadarOpacity(current);
      if (Math.abs(target - current) > 0.005) {
        frame = requestAnimationFrame(step);
      } else {
        setRadarOpacity(target);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRadar, mapLoaded]);

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
      if (mapRef.current.getZoom() > 14) {
        mapRef.current.flyTo({ zoom: 14, duration: 1000 });
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

  const routeLine = buildRouteLine(markers);

  const movingPoint = React.useMemo(() => {
    const mainMarkers = markers.filter(m => !m.isAlternate);
    if (!routeLine || mainMarkers.length < 2 || isNaN(routeProgress)) return null;
    const segments = mainMarkers.length - 1;
    let currentSegment = Math.floor(routeProgress * segments);
    
    // Bounds safety checks
    if (currentSegment < 0) currentSegment = 0;
    if (currentSegment >= segments) currentSegment = segments - 1;
    
    const segmentProgress = (routeProgress * segments) - currentSegment;
    
    const m1 = mainMarkers[currentSegment];
    const m2 = mainMarkers[currentSegment + 1];
    
    if (!m1 || !m2) return null; // Final safety net
    
    const p1 = m1.coordinates;
    const p2 = m2.coordinates;
    
    const lon = p1[0] + (p2[0] - p1[0]) * segmentProgress;
    const lat = p1[1] + (p2[1] - p1[1]) * segmentProgress;
    
    // Bearing calculation for rotation
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const dLon = (p2[0] - p1[0]) * toRad;
    const lat1 = p1[1] * toRad;
    const lat2 = p2[1] * toRad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * toDeg;
    
    return {
      type: "Feature" as const,
      properties: { bearing },
      geometry: { type: "Point" as const, coordinates: [lon, lat] },
    };
  }, [routeProgress, markers, routeLine]);

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
          if (feature && (feature.layer.id === "sigmets-fill" || feature.layer.id === "pireps-points")) {
            setHoverInfo({ x: e.lngLat.lng, y: e.lngLat.lat, feature: feature.properties });
          } else {
            setHoverInfo(null);
          }
        }}
        interactiveLayerIds={(showSigmets || showPireps) ? ["sigmets-fill", "pireps-points"] : []}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Radar layer */}
        {radarPath && radarOpacity > 0.005 && (
          <Source
            id="radar"
            type="raster"
            tiles={[`https://tilecache.rainviewer.com${radarPath}/256/{z}/{x}/{y}/2/1_1.png`]}
            tileSize={256}
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
        {popupAirport && markers.find(m => m.icao === popupAirport) && (() => {
          const m = markers.find(m => m.icao === popupAirport)!;
          return (
            <Popup
              longitude={m.coordinates[0]}
              latitude={m.coordinates[1]}
              anchor="bottom"
              offset={[0, -20]}
              closeOnClick={false}
              onClose={() => setPopupAirport(null)}
              className="z-50"
            >
              <div className="bg-[#1a1a1a] text-white p-3 rounded-lg shadow-2xl border border-[#333] min-w-[140px] text-center">
                <div className="font-bold text-[14px] tracking-widest mb-1">{m.icao}</div>
                <div 
                  className="text-[10px] uppercase tracking-widest px-2 py-1 rounded inline-block font-bold mb-3"
                  style={{ backgroundColor: `${getCategoryColor(m.flightCategory)}20`, color: getCategoryColor(m.flightCategory) }}
                >
                  {m.flightCategory}
                </div>
                {m.metar && (
                  <div className="flex flex-col gap-1.5 text-[11px] font-mono text-[#aaa]">
                    {m.metar.wind?.speed != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[#666]">WIND</span>
                        <span>{m.metar.wind.degrees ? m.metar.wind.degrees.toString().padStart(3, '0') + '°' : 'VRB'}@{m.metar.wind.speed}kt{m.metar.wind.gust ? `G${m.metar.wind.gust}` : ''}</span>
                      </div>
                    )}
                    {m.metar.visibility != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[#666]">VIS</span>
                        <span>{m.metar.visibility} SM</span>
                      </div>
                    )}
                    {m.metar.temp != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[#666]">TEMP</span>
                        <span>{m.metar.temp}°C / {m.metar.dewpoint ?? '-'}°C</span>
                      </div>
                    )}
                    {m.metar.altimeter != null && (
                      <div className="flex justify-between gap-4">
                        <span className="text-[#666]">ALTIM</span>
                        <span>{m.metar.altimeter.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
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
