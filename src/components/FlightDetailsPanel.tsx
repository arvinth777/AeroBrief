"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Navigation, Activity, ArrowUpRight, ArrowDownRight, ArrowRight, Plane } from "lucide-react";
import { springs } from "@/lib/springs";

interface Props {
  flight: any;
  onClose: () => void;
}

export function FlightDetailsPanel({ flight, onClose }: Props) {
  if (!flight) return null;

  // Extract nested metadata and aircraftInfo
  const meta = flight.metadata || null;
  const acInfo = flight.aircraftInfo || null;

  // OpenSky sends altitude in meters, AirLabs sends in meters too
  const altFt = flight.altitude != null ? Math.round(flight.altitude * 3.28084) : null;
  const spdKt = flight.velocity != null ? Math.round(flight.velocity * 1.94384) : null;
  const hdg = flight.heading != null ? Math.round(flight.heading) : null;
  const vr = flight.verticalRate; // m/s
  const vrFpm = vr != null ? Math.round(vr * 196.85) : null;

  // Determine flight phase
  const phase = vr == null ? null : vr > 1.5 ? "CLIMB" : vr < -1.5 ? "DESCENT" : "CRUISE";
  const phaseColor = phase === "CLIMB" ? "#2ebd6b" : phase === "DESCENT" ? "#eb5757" : "#4b70db";
  const PhaseIcon = phase === "CLIMB" ? ArrowUpRight : phase === "DESCENT" ? ArrowDownRight : ArrowRight;

  const flLevel = altFt != null ? (altFt >= 18000 ? `FL${Math.round(altFt / 100)}` : `${altFt.toLocaleString()} ft`) : "N/A";

  // Derive display values from nested objects
  const registration = acInfo?.registration || "N/A";
  const typeCode = acInfo?.typeCode || "Unknown Type";
  const operator = meta?.airline && meta.airline !== "Unknown Airline"
    ? meta.airline
    : acInfo?.owner && acInfo.owner !== "Unknown Operator"
      ? acInfo.owner
      : "Unknown Operator";
  const origin = meta?.departure_airport && meta.departure_airport !== "Unknown" ? meta.departure_airport : null;
  const destination = meta?.arrival_airport && meta.arrival_airport !== "Unknown" ? meta.arrival_airport : null;

  // last_contact can be a unix timestamp (seconds) or null
  const lastContactAge = flight.last_contact
    ? Math.max(0, Math.round(Date.now() / 1000 - flight.last_contact))
    : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: "100%", opacity: 0.5 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0.5 }}
        transition={springs.bouncy}
        className="absolute top-0 right-0 h-full w-full sm:w-[400px] bg-[#0a0a0a]/95 backdrop-blur-xl border-l border-[#222] shadow-2xl z-[100] flex flex-col"
      >
        <div className="flex items-center justify-between p-6 border-b border-[#222]">
          <div>
            <h2 className="text-2xl font-bold tracking-widest text-[#fbbc05] font-mono">
              {flight.callsign || registration || "UNKNOWN"}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[12px] font-mono text-[#888] bg-[#1a1a1a] px-2 py-0.5 rounded border border-[#333]">
                {flight.icao24?.toUpperCase()}
              </span>
              {flight.squawk && (
                <span className="text-[12px] text-[#444] font-mono border border-[#333] px-2 py-0.5 rounded">
                  SQ {flight.squawk}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-[#1a1a1a] hover:bg-[#2a2a2a] rounded-full text-[#888] hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
          
          {/* Route Section — show prominently if we have origin/destination */}
          {(origin || destination) && (
            <section>
              <h3 className="text-[10px] font-bold text-[#666] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <Plane size={12} />
                Route
              </h3>
              <div className="bg-[#111] rounded-xl border border-[#222] p-4">
                {operator !== "Unknown Operator" && (
                  <div className="text-[9px] text-[#666] uppercase tracking-[0.18em] mb-3 font-bold">{operator}</div>
                )}
                <div className="flex items-center justify-between">
                  <div className="text-center">
                    <p className="text-[11px] text-[#666] mb-1">Origin</p>
                    <p className="font-mono text-2xl text-white">{origin || "---"}</p>
                  </div>
                  <div className="flex-1 flex flex-col items-center px-4">
                    <div className="w-full h-px bg-[#333] relative">
                      <ArrowRight size={14} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[#555] bg-[#111] px-1" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] text-[#666] mb-1">Destination</p>
                    <p className="font-mono text-2xl text-white">{destination || "---"}</p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Identity Section */}
          <section>
            <h3 className="text-[10px] font-bold text-[#666] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <Activity size={12} />
              Identity & Aircraft
            </h3>
            <div className="bg-[#111] rounded-xl border border-[#222] overflow-hidden">
              <div className="p-4 border-b border-[#222] flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-[#666] mb-1">Registration</p>
                  <p className="font-mono text-lg text-white">{registration}</p>
                </div>
              </div>
              <div className="p-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] text-[#666] mb-1">Type Code</p>
                  <p className="font-bold text-[#ddd]">{typeCode}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#666] mb-1">Operator</p>
                  <p className="text-[13px] text-[#aaa] truncate" title={operator}>{operator}</p>
                </div>
              </div>
            </div>
          </section>

          {/* Telemetry Section */}
          <section>
            <h3 className="text-[10px] font-bold text-[#666] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
              <Navigation size={12} />
              Live Telemetry
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#111] p-4 rounded-xl border border-[#222]">
                <p className="text-[11px] text-[#666] mb-1">Altitude</p>
                <p className="font-mono text-xl text-white">{flLevel}</p>
              </div>
              <div className="bg-[#111] p-4 rounded-xl border border-[#222]">
                <p className="text-[11px] text-[#666] mb-1">Ground Speed</p>
                <p className="font-mono text-xl text-white">{spdKt != null ? `${spdKt} kt` : "N/A"}</p>
              </div>
              <div className="bg-[#111] p-4 rounded-xl border border-[#222]">
                <p className="text-[11px] text-[#666] mb-1">True Track</p>
                <p className="font-mono text-xl text-white">{hdg != null ? `${hdg}°` : "N/A"}</p>
              </div>
              <div className="bg-[#111] p-4 rounded-xl border border-[#222] flex flex-col justify-center">
                <p className="text-[11px] text-[#666] mb-1">Phase</p>
                {phase ? (
                  <div className="flex items-center gap-2">
                    <PhaseIcon size={16} color={phaseColor} />
                    <span className="font-bold tracking-wider" style={{ color: phaseColor }}>{phase}</span>
                  </div>
                ) : (
                  <p className="font-mono text-xl text-white">N/A</p>
                )}
              </div>
            </div>
          </section>

          {/* Source Info */}
          <p className="text-[9px] text-[#444] text-center mt-auto pt-8">
            Data provided by AirLabs, OpenSky Network & hexdb.io<br/>
            {lastContactAge != null ? `Position updated ${lastContactAge}s ago` : "Position age unknown"}
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
