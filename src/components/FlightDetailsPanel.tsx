"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Navigation, Activity, ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";
import { springs } from "@/lib/springs";
import Image from "next/image";

interface Props {
  flight: any;
  onClose: () => void;
}

export function FlightDetailsPanel({ flight, onClose }: Props) {
  if (!flight) return null;

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

  const aircraftStr = flight.icaoType ? `${flight.icaoType}` : "Unknown Type";
  const ownerStr = flight.owner || flight.airline || "Unknown Operator";

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
              {flight.callsign || flight.registration || "UNKNOWN"}
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
                  <p className="font-mono text-lg text-white">{flight.registration || "N/A"}</p>
                </div>
                {flight.icaoType && (
                  <div className="w-16 h-16 rounded overflow-hidden bg-[#050505] border border-[#333] flex items-center justify-center relative">
                    <Image
                      src={`/aircraft/${flight.icaoType.toLowerCase()}.png`}
                      alt={flight.icaoType}
                      fill
                      className="object-cover opacity-80"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="p-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] text-[#666] mb-1">Type Code</p>
                  <p className="font-bold text-[#ddd]">{aircraftStr}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#666] mb-1">Operator</p>
                  <p className="text-[13px] text-[#aaa] truncate" title={ownerStr}>{ownerStr}</p>
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

          {/* Route Section */}
          {(flight.origin || flight.destination) && (
            <section>
              <h3 className="text-[10px] font-bold text-[#666] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                <Navigation size={12} />
                Route
              </h3>
              <div className="bg-[#111] rounded-xl border border-[#222] p-4 flex items-center justify-between">
                <div className="text-center">
                  <p className="text-[11px] text-[#666] mb-1">Origin</p>
                  <p className="font-mono text-2xl text-white">{flight.origin || "---"}</p>
                </div>
                <div className="flex-1 flex flex-col items-center px-4">
                  <div className="w-full h-px bg-[#333] relative">
                    <ArrowRight size={14} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[#555] bg-[#111] px-1" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-[11px] text-[#666] mb-1">Destination</p>
                  <p className="font-mono text-2xl text-white">{flight.destination || "---"}</p>
                </div>
              </div>
            </section>
          )}

          {/* Source Info */}
          <p className="text-[9px] text-[#444] text-center mt-auto pt-8">
            Data provided by OpenSky Network & hexdb.io<br/>
            Position updated {(Date.now() / 1000 - flight.last_contact).toFixed(0)}s ago
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
