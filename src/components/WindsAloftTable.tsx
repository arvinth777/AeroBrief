"use client";

import React from "react";

interface WindsAloftLevel {
  altitude: number;
  direction: number | null;
  speed: number;
  temp: number | null;
}

interface WindsAloftTableProps {
  levels: WindsAloftLevel[];
}

export function WindsAloftTable({ levels }: WindsAloftTableProps) {
  if (!levels || levels.length === 0) return null;

  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 flex flex-col gap-3">
      <h3 className="text-[#444] text-[9px] font-bold tracking-[0.2em] uppercase">Winds & Temps Aloft</h3>
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-left border-collapse min-w-[240px]">
          <thead>
            <tr className="border-b border-[#1a1a1a]">
              <th className="py-2 text-[10px] text-[#555] font-semibold tracking-wider w-1/3">ALTITUDE</th>
              <th className="py-2 text-[10px] text-[#555] font-semibold tracking-wider w-1/3">WIND</th>
              <th className="py-2 text-[10px] text-[#555] font-semibold tracking-wider text-right w-1/3">TEMP</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((lvl) => {
              const windStr = lvl.direction 
                ? `${lvl.direction.toString().padStart(3, '0')}° @ ${lvl.speed}kt`
                : lvl.speed === 0 ? "Light/Var" : `VRB @ ${lvl.speed}kt`;
                
              const tempStr = lvl.temp !== null ? `${lvl.temp > 0 ? '+' : ''}${lvl.temp}°C` : "—";
              const tempColor = lvl.temp !== null && lvl.temp <= 0 ? "text-blue-400" : "text-amber-500";

              return (
                <tr key={lvl.altitude} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="py-2 text-[12px] font-mono text-[#d1d1d1]">FL{Math.round(lvl.altitude/100).toString().padStart(3, '0')}</td>
                  <td className="py-2 text-[12px] font-mono text-[#a1a1a1]">{windStr}</td>
                  <td className={`py-2 text-[12px] font-mono font-bold text-right ${lvl.temp === null ? 'text-[#555]' : tempColor}`}>
                    {tempStr}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
