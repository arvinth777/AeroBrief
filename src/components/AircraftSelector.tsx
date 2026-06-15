"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { ChevronDown, Plane } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AIRCRAFT_PROFILES } from "@/lib/aircraftProfiles";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function AircraftSelector({ value, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedProfile = AIRCRAFT_PROFILES[value];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative z-50 w-full md:w-auto" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full md:w-[220px] bg-[#111] hover:bg-[#1a1a1a] text-[#ccc] border border-[#222] hover:border-[#444] rounded-md px-3 py-2 flex items-center justify-between transition-colors focus:outline-none focus:ring-1 focus:ring-[#4b8ef5]"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {selectedProfile ? (
            <>
              <div className="w-8 h-8 rounded-sm overflow-hidden bg-[#050505] flex items-center justify-center shrink-0 border border-[#333]">
                <Image
                  src={`/aircraft/${selectedProfile.id.toLowerCase()}.png`}
                  alt={selectedProfile.name}
                  width={32}
                  height={32}
                  className="object-cover w-full h-full"
                />
              </div>
              <div className="flex flex-col items-start truncate">
                <span className="text-[11px] font-bold tracking-widest text-[#f5f5f5]">{selectedProfile.id}</span>
                <span className="text-[9px] text-[#888] truncate w-full">{selectedProfile.name}</span>
              </div>
            </>
          ) : value === "Other" ? (
            <>
              <div className="w-8 h-8 rounded-sm bg-[#050505] flex items-center justify-center shrink-0 border border-[#333]">
                <Plane size={16} className="text-[#666]" />
              </div>
              <div className="flex flex-col items-start truncate">
                <span className="text-[11px] font-bold tracking-widest text-[#f5f5f5]">OTHER</span>
                <span className="text-[9px] text-[#888] truncate w-full">Generic Airframe</span>
              </div>
            </>
          ) : (
            <span className="text-[11px] font-mono text-[#888]">Select Aircraft...</span>
          )}
        </div>
        <ChevronDown size={14} className={`text-[#666] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -5, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute top-full left-0 mt-2 w-full md:w-[260px] bg-[#0a0a0a] border border-[#222] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[300px]"
          >
            <div className="bg-[#111] px-3 py-2 border-b border-[#222] flex items-center gap-2">
              <Plane size={12} className="text-[#666]" />
              <span className="text-[9px] font-bold tracking-[0.2em] text-[#666] uppercase">Select Airframe</span>
            </div>
            <div className="overflow-y-auto flex-1 p-1">
              {Object.values(AIRCRAFT_PROFILES).map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onChange(p.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 p-2 rounded-md transition-colors ${
                    value === p.id ? "bg-[#1a1a1a] border border-[#333]" : "hover:bg-[#111] border border-transparent"
                  }`}
                >
                  <div className="w-12 h-12 rounded bg-[#050505] overflow-hidden shrink-0 border border-[#222]">
                    <Image
                      src={`/aircraft/${p.id.toLowerCase()}.png`}
                      alt={p.name}
                      width={48}
                      height={48}
                      className="object-cover w-full h-full"
                    />
                  </div>
                  <div className="flex flex-col items-start flex-1 text-left">
                    <span className={`text-[12px] font-bold tracking-widest ${value === p.id ? "text-[#4b8ef5]" : "text-[#ddd]"}`}>
                      {p.id}
                    </span>
                    <span className="text-[10px] text-[#888]">{p.name}</span>
                  </div>
                </button>
              ))}

              <button
                onClick={() => {
                  onChange("Other");
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 p-2 rounded-md transition-colors ${
                  value === "Other" ? "bg-[#1a1a1a] border border-[#333]" : "hover:bg-[#111] border border-transparent"
                }`}
              >
                <div className="w-12 h-12 rounded bg-[#050505] flex items-center justify-center shrink-0 border border-[#222]">
                  <Plane size={20} className="text-[#555]" />
                </div>
                <div className="flex flex-col items-start flex-1 text-left">
                  <span className={`text-[12px] font-bold tracking-widest ${value === "Other" ? "text-[#4b8ef5]" : "text-[#ddd]"}`}>
                    OTHER
                  </span>
                  <span className="text-[10px] text-[#888]">Generic Airframe</span>
                </div>
              </button>

              <button
                onClick={() => {
                  onChange("");
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 p-2 rounded-md transition-colors mt-2 border-t border-[#1a1a1a] pt-3 ${
                  value === "" ? "bg-[#1a1a1a] border border-[#333]" : "hover:bg-[#111] border border-transparent"
                }`}
              >
                <div className="flex flex-col items-start flex-1 text-left pl-2">
                  <span className={`text-[12px] font-bold tracking-widest ${value === "" ? "text-[#4b8ef5]" : "text-[#888]"}`}>
                    NONE
                  </span>
                  <span className="text-[10px] text-[#555]">Clear Selection</span>
                </div>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
