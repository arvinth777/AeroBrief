"use client";

import dynamic from "next/dynamic";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, AlertTriangle, RefreshCw, Layers, Plane, Info } from "lucide-react";
import { WindsAloftTable } from "@/components/WindsAloftTable";
import { AIRCRAFT_PROFILES } from "@/lib/aircraftProfiles";
import { springs } from "@/lib/springs";
import { AIRPORT_COORDS } from "@/lib/airports";
import { FlightDetailsPanel } from "@/components/FlightDetailsPanel";
const AircraftSelector = dynamic(() => import("@/components/AircraftSelector").then(mod => mod.AircraftSelector), { ssr: false });

// Lazy-load the heavy Mapbox bundle
const AeroBriefMapDynamic = dynamic(() => import("@/components/AeroBriefMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#080808] rounded-xl border border-[#1a1a1a]">
      <div className="flex flex-col items-center gap-3">
        <div className="skeleton w-16 h-16 rounded-full" />
        <div className="skeleton w-32 h-3 rounded" />
        <div className="skeleton w-24 h-3 rounded opacity-60" />
      </div>
    </div>
  ),
});

/* ══════════════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════════════ */
interface MetarData {
  raw: string;
  flightCategory: "VFR" | "MVFR" | "IFR" | "LIFR";
  wind: { degrees: number | null; speed: number | null; gust: number | null };
  visibility: number | null;
  ceiling: number | null;
  temp: number | null;
  dewpoint: number | null;
  altimeter: number | null;
}
interface TafBlock {
  period: string;
  from: string;
  to: string;
  flightCategory: "VFR" | "MVFR" | "IFR" | "LIFR";
  wind: string;
  visibility: string;
  clouds: string;
}
const ICAO_RE = /^[A-Z0-9]{3,4}$/i;

interface AirportData {
  icao: string;
  name: string;
  coordinates: [number, number];
  metar: MetarData | null;
  parsedTaf: { raw: string; blocks: TafBlock[] } | null;
  windsAloft?: any;
  notams?: { id: string; message: string }[];
}
interface AIBriefing {
  summary: string;
  altitudeRisks: { altitude: string; risk: string }[];
  recommendation: "GO" | "NO-GO" | "MARGINAL";
  recommendationReason: string;
}
interface AppState {
  route: string[];
  isLoading: boolean;
  error: string | null;
  airports: Record<string, AirportData>;
  hazards: unknown[];
  pireps: unknown[];
  meta: { generatedAt: string; partialFailures: string[]; demoMode?: boolean } | null;
  ai: AIBriefing | null;
  activeAirport: string | null;
  mapLayers: {
    radar: boolean;
    sigmets: boolean;
    pireps: boolean;
    flights: boolean;
  };
  recentRoutes: string[][];
  alternates: string[];
}

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; payload: { briefing: { airports: Record<string, AirportData>; hazards: unknown[]; pireps: unknown[]; meta: AppState["meta"] }; ai: AIBriefing; alternates: string[]; route: string[] } }
  | { type: "FETCH_ERROR"; payload: string | null }
  | { type: "SET_ACTIVE_AIRPORT"; payload: string | null }
  | { type: "TOGGLE_LAYER"; payload: keyof AppState["mapLayers"] }
  | { type: "SET_RECENT_ROUTES"; payload: string[][] };

const initialState: AppState = {
  route: [],
  isLoading: false,
  error: null,
  airports: {},
  hazards: [],
  pireps: [],
  meta: null,
  ai: null,
  activeAirport: null,
  mapLayers: {
    radar: false,
    sigmets: true,
    pireps: true,
    flights: false,
  },
  recentRoutes: [],
  alternates: [],
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, isLoading: true, error: null };
    case "FETCH_SUCCESS": {
      const { briefing, ai, alternates, route } = action.payload;
      const firstAirport = route[0] ?? Object.keys(briefing.airports)[0] ?? null;
      return {
        ...state,
        isLoading: false,
        route: route ?? Object.keys(briefing.airports),
        airports: briefing.airports,
        hazards: briefing.hazards,
        pireps: briefing.pireps,
        meta: briefing.meta,
        ai,
        alternates,
        activeAirport: firstAirport,
      };
    }
    case "FETCH_ERROR":
      return { ...state, isLoading: false, error: action.payload || null };
    case "SET_ACTIVE_AIRPORT":
      return { ...state, activeAirport: action.payload };
    case "TOGGLE_LAYER":
      return {
        ...state,
        mapLayers: { ...state.mapLayers, [action.payload]: !state.mapLayers[action.payload] },
      };
    case "SET_RECENT_ROUTES":
      return { ...state, recentRoutes: action.payload };
    default:
      return state;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════ */
const CATEGORY_STYLES: Record<string, { pill: string; text: string; hex: string }> = {
  VFR:     { pill: "bg-[#0f2e1f] text-[#2ebd6b] border border-[#2ebd6b]/20", text: "text-[#2ebd6b]", hex: "#2ebd6b" },
  MVFR:    { pill: "bg-[#1e2338] text-[#4b70db] border border-[#4b70db]/20", text: "text-[#4b70db]", hex: "#4b70db" },
  IFR:     { pill: "bg-[#3b1c1c] text-[#eb5757] border border-[#eb5757]/20", text: "text-[#eb5757]", hex: "#eb5757" },
  LIFR:    { pill: "bg-[#36173d] text-[#c951e0] border border-[#c951e0]/20", text: "text-[#c951e0]", hex: "#c951e0" },
  default: { pill: "bg-[#1a1a1a] text-[#888] border border-white/5", text: "text-[#888]", hex: "#555" },
};

function categoryStyle(cat: string) {
  return CATEGORY_STYLES[cat] ?? CATEGORY_STYLES.default;
}

function formatWind(wind: MetarData["wind"]): string {
  if (!wind.speed) return "CALM";
  const dir = wind.degrees != null ? String(wind.degrees).padStart(3, "0") : "VRB";
  const gust = wind.gust ? `G${wind.gust}` : "";
  return `${dir}@${wind.speed}${gust}kt`;
}

function formatVis(vis: number | null): string {
  if (vis == null) return "--";
  if (vis >= 6) return "10.0 SM";
  return `${vis.toFixed(1)} SM`;
}

/* ══════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
══════════════════════════════════════════════════════════════════════ */

// ── Pill Tag Route Input ────────────────────────────────────────────
export function RouteInput({
  onSubmit,
  isLoading,
  recentRoutes,
  currentRoute = [],
  currentAlternates = [],
}: {
  onSubmit: (airports: string[], alternates: string[]) => void;
  isLoading: boolean;
  recentRoutes: string[][];
  currentRoute?: string[];
  currentAlternates?: string[];
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [alts, setAlts] = useState<string[]>([]);
  const [isAltMode, setIsAltMode] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setTags(currentRoute);
    setAlts(currentAlternates);
    setIsAltMode(currentAlternates.length > 0);
  // Only re-sync when the parent route changes (not on every local interaction)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoute.join(","), currentAlternates.join(",")]);

  const addTag = useCallback(
    (raw: string) => {
      const icao = raw.trim().toUpperCase();
      if (!icao) return;
      
      // If user types a slash or ALTN, switch to alternate mode
      if (icao === "/" || icao === "//" || icao === "ALTN" || icao === "ALT") {
        setIsAltMode(true);
        setInputVal("");
        return;
      }
      
      // We can also catch if they type "/KPHL" directly
      const isAltExplicit = icao.startsWith("/") || icao.startsWith("ALTN");
      const cleanIcao = icao.replace(/^\/?(ALTN)?\/?/, "");

      if (!ICAO_RE.test(cleanIcao) || tags.includes(cleanIcao) || alts.includes(cleanIcao)) {
        setShake(true);
        setTimeout(() => setShake(false), 600);
        setInputVal("");
        return;
      }

      if (isAltMode || isAltExplicit) {
        setAlts((prev) => [...prev, cleanIcao]);
        setIsAltMode(true); // Keep in alt mode
      } else {
        setTags((prev) => [...prev, cleanIcao]);
      }
      setInputVal("");
    },
    [tags, alts, isAltMode]
  );

  const removeTag = (icao: string, isAlt: boolean) => {
    if (isAlt) {
      setAlts((prev) => prev.filter((t) => t !== icao));
      if (alts.length === 1) setIsAltMode(false); // If last alt removed, reset mode
    } else {
      setTags((prev) => prev.filter((t) => t !== icao));
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      if (inputVal.trim()) addTag(inputVal);
      else if (tags.length > 0) handleSubmit();
    } else if (e.key === "Backspace" && !inputVal) {
      if (alts.length > 0) {
        setAlts((prev) => prev.slice(0, -1));
        if (alts.length === 1) setIsAltMode(false);
      } else if (tags.length > 0) {
        setTags((prev) => prev.slice(0, -1));
      }
    }
  };

  const handleSubmit = () => {
    if (tags.length === 0 && inputVal.trim()) addTag(inputVal);
    if (tags.length > 0) {
      onSubmit(tags, alts);
      setInputVal("");
    }
  };

  const handleClear = () => {
    setTags([]);
    setAlts([]);
    setIsAltMode(false);
    setInputVal("");
    onSubmit([], []); // Submit empty route to clear everything
  };

  const loadRecent = (route: string[]) => {
    setTags(route);
    setAlts([]);
    setIsAltMode(false);
    onSubmit(route, []);
  };

  return (
    <div className="flex flex-col gap-2 w-full max-w-xl">
      <motion.div
        animate={shake && !shouldReduceMotion ? { x: [0, -8, 8, -4, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-2 bg-[#0a0a0a] border border-[#1e1e1e] rounded-md px-3 py-2 focus-within:ring-2 focus-within:ring-[#0a84ff]/30 transition-all min-h-[44px]"
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isLoading ? "bg-amber-500 animate-pulse" : "bg-[#2ebd6b]"}`} />
        <div className="flex flex-wrap gap-1.5 flex-1 items-center">
          <AnimatePresence>
            {[...tags.map(t => ({ val: t, alt: false })), ...alts.map(t => ({ val: t, alt: true }))].map((tag) => (
              <motion.span
                key={tag.val}
                initial={shouldReduceMotion ? {} : { scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={springs.bouncy}
                className={`flex items-center gap-1 border text-[11px] font-bold tracking-[0.08em] px-2 py-0.5 rounded ${tag.alt ? "bg-[#331111] border-[#552222] text-[#eb5757]" : "bg-[#1a1a1a] border-[#2a2a2a] text-[#ddd]"}`}
              >
                {tag.val}
                <button
                  onClick={() => removeTag(tag.val, tag.alt)}
                  className="text-[#666] hover:text-[#aaa] transition-colors ml-0.5 cursor-pointer"
                >
                  <X size={10} />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          <input
            ref={inputRef}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value.toUpperCase())}
            onKeyDown={handleKey}
            placeholder={tags.length === 0 ? "add airport…" : "add airport…"}
            className="bg-transparent text-[#ddd] text-[12px] font-medium tracking-widest outline-none placeholder-[#333] flex-1 min-w-[80px] uppercase"
          />
        </div>
        <div className="flex items-center gap-3">
          {(tags.length > 0 || alts.length > 0) && (
            <button
              onClick={handleClear}
              className="shrink-0 text-[10px] text-[#555] hover:text-[#ff4444] transition-colors p-1"
              title="Clear Route"
            >
              <X size={12} />
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={isLoading || (tags.length === 0 && !inputVal.trim())}
            className="shrink-0 text-[9px] font-bold tracking-[0.15em] text-[#555] hover:text-[#aaa] disabled:opacity-30 transition-colors cursor-pointer"
          >
            {isLoading ? "PROCESSING" : "BRIEF ↵"}
          </button>
        </div>
      </motion.div>

      {recentRoutes.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {recentRoutes.slice(0, 3).map((route, i) => (
            <button
              key={i}
              onClick={() => loadRecent(route)}
              className="text-[9px] font-bold tracking-[0.12em] text-[#444] hover:text-[#888] border border-[#1a1a1a] hover:border-[#2a2a2a] rounded px-2 py-1 transition-colors cursor-pointer"
            >
              {route.join(" · ")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Flight Category Badge ────────────────────────────────────────────
function CategoryBadge({ category }: { category: string }) {
  const s = categoryStyle(category);
  const shape = { VFR: "●", MVFR: "◆", IFR: "▲", LIFR: "✕" }[category] ?? "●";
  return (
    <span className={`text-[10px] font-bold tracking-[0.08em] px-2 py-0.5 rounded-sm ${s.pill}`}>
      {shape} {category}
    </span>
  );
}

// ── Skeleton Card ─────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5 flex flex-col gap-4">
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-2">
          <div className="skeleton w-16 h-6 rounded" />
          <div className="skeleton w-32 h-3 rounded" />
        </div>
        <div className="skeleton w-12 h-5 rounded" />
      </div>
      <div className="skeleton w-full h-14 rounded-md" />
      <div className="flex gap-0">
        <div className="skeleton w-1/2 h-12 rounded-l-md" />
        <div className="skeleton w-1/2 h-12 rounded-r-md" />
      </div>
    </div>
  );
}

// ── Airport Station Card ─────────────────────────────────────────────
function StationCard({
  airport,
  index,
  isActive,
  isAlternate,
  onClick,
}: {
  airport: AirportData;
  index: number;
  isActive: boolean;
  isAlternate: boolean;
  onClick: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={shouldReduceMotion ? {} : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.default, delay: index * 0.05 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`bg-[#0a0a0a] border rounded-xl p-5 flex flex-col gap-4 cursor-pointer transition-all duration-200 ${
        isActive ? "border-[#2a2a2a] shadow-[0_0_0_1px_#2a2a2a]" : "border-[#1a1a1a]"
      }`}
    >
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-[#f5f5f5] font-semibold text-[22px] leading-none tracking-tight flex items-center gap-2">
            {airport.icao}
            {isAlternate && (
              <span className="text-[9px] bg-[#eb5757]/20 text-[#eb5757] px-1.5 py-0.5 rounded border border-[#eb5757]/30 tracking-widest font-bold">ALTN</span>
            )}
          </h2>
          <p className="text-[#555] text-[10px] tracking-[0.08em] uppercase mt-1.5 font-medium">
            {airport.name}
          </p>
        </div>
        {airport.metar ? (
          <motion.span
            initial={shouldReduceMotion ? {} : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={springs.bouncy}
          >
            <CategoryBadge category={airport.metar.flightCategory} />
          </motion.span>
        ) : (
          <span className="text-[10px] font-bold tracking-[0.08em] px-2 py-0.5 rounded-sm bg-[#1a1a1a] text-[#555] border border-white/5">
            NO DATA
          </span>
        )}
      </div>

      <div className="flex justify-between items-center mt-2">
        <span className="text-[10px] text-[#555] uppercase font-bold tracking-widest">Observations</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowRaw(!showRaw);
          }}
          className={`text-[9px] font-bold tracking-[0.1em] px-2 py-1 rounded transition-colors ${
            showRaw ? "bg-[#333] text-white" : "bg-[#1a1a1a] text-[#777] hover:bg-[#2a2a2a]"
          }`}
        >
          {showRaw ? "DECODED" : "RAW TEXT"}
        </button>
      </div>

      {showRaw ? (
        <div className="flex flex-col gap-3">
          {airport.metar?.raw && (
            <div className="border border-[#1a1a1a] bg-[#050505] p-3 rounded-md text-[11px] font-mono text-[#888] leading-[1.6] break-words">
              <span className="text-[#555] font-bold block mb-1">METAR</span>
              {airport.metar.raw}
            </div>
          )}
          {airport.parsedTaf?.raw && (
            <div className="border border-[#1a1a1a] bg-[#050505] p-3 rounded-md text-[11px] font-mono text-[#888] leading-[1.6] break-words">
              <span className="text-[#555] font-bold block mb-1">TAF</span>
              {airport.parsedTaf.raw}
            </div>
          )}
          {airport.notams && airport.notams.length > 0 && (
            <div className="border border-[#1a1a1a] bg-[#050505] p-3 rounded-md text-[11px] font-mono text-[#888] leading-[1.6] break-words">
              <span className="text-[#555] font-bold block mb-1">NOTAMs</span>
              <ul className="flex flex-col gap-2">
                {airport.notams.map(n => (
                  <li key={n.id} className="pb-2 border-b border-[#1a1a1a] last:border-0 last:pb-0">
                    <strong className="text-[#aaa] mr-2">{n.id}</strong>
                    {n.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <>
          {airport.metar ? (
            <div className="flex border border-[#1a1a1a] rounded-md overflow-hidden">
              <div className="p-3 w-1/2 border-r border-[#1a1a1a]">
                <div className="text-[#444] text-[9px] font-bold tracking-[0.2em] mb-1.5">WIND</div>
                <div className="text-[#d1d1d1] text-[14px] font-medium tabular-nums tracking-wide">
                  {formatWind(airport.metar.wind)}
                </div>
              </div>
              <div className="p-3 w-1/2">
                <div className="text-[#444] text-[9px] font-bold tracking-[0.2em] mb-1.5">VIS</div>
                <div className="text-[#d1d1d1] text-[14px] font-medium tabular-nums tracking-wide">
                  {formatVis(airport.metar.visibility)}
                </div>
              </div>
            </div>
          ) : (
            <div className="border border-[#1a1a1a] border-dashed p-4 rounded-md text-[11px] text-[#444] font-mono text-center">
              METAR data unavailable
            </div>
          )}
          {airport.notams && airport.notams.length > 0 && (
            <div className="mt-2">
              <div className="text-[#444] text-[9px] font-bold tracking-[0.2em] mb-1.5">CRITICAL NOTAMs ({airport.notams.length})</div>
              <div className="text-[#888] text-[11px] font-mono line-clamp-3 leading-[1.5]">
                {airport.notams[0].message}
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

// ── TAF Timeline ──────────────────────────────────────────────────────
function TAFTimeline({
  airport,
}: {
  airport: AirportData | null;
}) {
  if (!airport?.parsedTaf?.blocks?.length) return null;

  const blocks = airport.parsedTaf.blocks;
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[#444] text-[9px] font-bold tracking-[0.2em] uppercase">TAF Forecast</span>
        <span className={`text-[9px] font-bold tracking-[0.08em] ${categoryStyle(airport.icao).text}`}>
          {airport.icao}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 px-4 -mx-4 snap-x no-scrollbar">
        {blocks.map((block, i) => {
          const s = categoryStyle(block.flightCategory);
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.default, delay: i * 0.04 }}
              className={`snap-start shrink-0 border rounded-lg p-3 min-w-[120px] cursor-pointer transition-all duration-150 ${s.pill} ${i === 0 ? 'ml-0' : ''}`}
              whileTap={{ scale: 0.96 }}
            >
              <div className="text-[9px] font-bold tracking-[0.08em] mb-1 opacity-70">
                {block.period.replace("TEMPO ", "T ").replace("BECMG ", "B ").slice(0, 12)}
              </div>
              <div className="text-[13px] font-bold mb-1.5">{block.flightCategory}</div>
              <div className="text-[10px] font-mono opacity-60 leading-[1.5]">
                <div>{block.wind}</div>
                <div>{block.visibility}</div>
                <div>{block.clouds}</div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── AI Insights Panel ─────────────────────────────────────────────────
function AIInsights({ ai, isLoading, onRefresh }: { ai: AIBriefing | null; isLoading: boolean; onRefresh: () => void }) {
  const shouldReduceMotion = useReducedMotion();

  const recStyle = ai?.recommendation === "GO"
    ? { text: "text-[#2ebd6b]", border: "border-[#173d2a]", bg: "bg-[#0a1f12]" }
    : ai?.recommendation === "NO-GO"
    ? { text: "text-[#eb5757]", border: "border-[#3b1c1c]", bg: "bg-[#200e0e]" }
    : { text: "text-[#e09145]", border: "border-[#3d240e]", bg: "bg-[#1a1007]" };

  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6 flex flex-col gap-5 h-full">
      <div className="flex justify-between items-center">
        <h2 className="text-[#555] text-[10px] font-bold tracking-[0.2em] uppercase">AI Dispatch Summary</h2>
        <div className={`w-1.5 h-1.5 rounded-full ${isLoading ? "bg-amber-500 animate-pulse" : "bg-[#fbbc05]"}`} />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <div className="skeleton w-full h-24 rounded-lg" />
          <div className="skeleton w-full h-4 rounded" />
          <div className="skeleton w-4/5 h-4 rounded" />
          <div className="skeleton w-3/4 h-4 rounded" />
        </div>
      ) : ai ? (
        <>
          <div className={`border ${recStyle.border} ${recStyle.bg} rounded-lg p-4`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#888] text-[10px] font-bold tracking-[0.2em] uppercase">Recommendation</span>
              <motion.span
                initial={shouldReduceMotion ? {} : { scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={springs.bouncy}
                className={`text-[28px] font-black leading-none tracking-tight ${recStyle.text}`}
              >
                {ai.recommendation}
              </motion.span>
            </div>
            <p className="text-[#aaa] text-[13px] leading-[1.65] font-light">
              {ai.summary}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-[#444] text-[9px] font-bold tracking-[0.2em] uppercase">Altitude Risk Profile</h3>
            {(ai.altitudeRisks || []).map((risk, i) => {
              const riskLower = (risk.risk || "").toLowerCase();
              const riskColor = riskLower.includes("smooth") ? "text-[#2ebd6b]"
                : riskLower.includes("chop") || riskLower.includes("mod") ? "text-[#e09145]"
                : riskLower.includes("sev") || riskLower.includes("thunder") || riskLower.includes("ext") ? "text-[#eb5757]"
                : "text-[#888]";
              return (
                <motion.div
                  key={i}
                  initial={shouldReduceMotion ? {} : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...springs.default, delay: i * 0.06 }}
                  className="flex justify-between items-start py-3 border-b border-[#1a1a1a] last:border-0 gap-3"
                >
                  <span className="text-[#666] font-mono text-[13px] tracking-wide shrink-0">{risk.altitude || "N/A"}</span>
                  <span className={`text-right text-[13px] leading-[1.4] ${riskColor}`}>{risk.risk || "Unknown"}</span>
                </motion.div>
              );
            })}
          </div>

          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={onRefresh}
            className="w-full flex items-center justify-center gap-2 bg-[#f5f5f5] text-[#0a0a0a] hover:bg-white font-bold text-[13px] py-3.5 rounded-md mt-auto transition-colors cursor-pointer"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            {isLoading ? "Refreshing..." : "Refresh Dispatch Briefing"}
          </motion.button>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[#333] text-[13px] font-mono py-8 text-center border border-white/5 border-dashed rounded-lg w-full">
            Submit route to initialize
          </div>
        </div>
      )}

      <div className="border border-[#1a1a1a] border-dashed rounded-xl p-4 mt-auto">
        <p className="text-[10px] text-[#444] leading-[1.8]">
          Systems checked against latest SIGMETs and PIREPs.<br />
          Automated summaries are for situational awareness only.<br />
          Final authority resides with the PIC.
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════════════════════ */
export default function Page() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [selectedFlight, setSelectedFlight] = useState<any | null>(null);
  
  // Always start with "" on both server and client to avoid hydration mismatch.
  // Hydrate from localStorage in a useEffect (client-only).
  const [selectedAircraft, setSelectedAircraftRaw] = useState<string>("");
  const setSelectedAircraft = useCallback((val: string) => {
    setSelectedAircraftRaw(val);
    try { localStorage.setItem("aerobrief_aircraft", val); } catch { /* ignore */ }
  }, []);
  const shouldReduceMotion = useReducedMotion();

  // Hydrate localStorage and URL params after mount (client-only — avoids SSR mismatch)
  useEffect(() => {
    try {
      const savedAircraft = localStorage.getItem("aerobrief_aircraft");
      let initialAircraft = savedAircraft || "";
      const params = new URLSearchParams(window.location.search);
      const urlAircraft = params.get("aircraft");
      if (urlAircraft) {
        initialAircraft = urlAircraft;
      }
      if (initialAircraft) setSelectedAircraftRaw(initialAircraft);

      const urlRoute = params.get("route");
      if (urlRoute) {
        const airports = urlRoute.split(",").map((a) => a.trim().toUpperCase()).filter(Boolean);
        if (airports.length > 0) {
          // Fire initial fetch based on URL
          fetchBriefing(airports, [], initialAircraft);
        }
      }
    } catch { /* ignore */ }
    try {
      const saved = localStorage.getItem("aerobrief_recent_routes");
      if (saved) dispatch({ type: "SET_RECENT_ROUTES", payload: JSON.parse(saved) });
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticking clock for data staleness — use ref to set initial value synchronously,
  // then update via interval callback (not sync setState in effect body)
  const [staleCounter, setStaleCounter] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setStaleCounter(c => c + 1), 30000);
    return () => clearInterval(interval);
  }, []);
  // Reset counter when new data arrives
  const metaGenRef = useRef(state.meta?.generatedAt);
  if (state.meta?.generatedAt !== metaGenRef.current) {
    metaGenRef.current = state.meta?.generatedAt;
  }
  
  // staleMinutes: only computed client-side after mount (Date.now() changes each render — SSR unsafe)
  const [staleMinutes, setStaleMinutes] = useState(0);
  useEffect(() => {
    if (state.meta?.generatedAt) {
      setStaleMinutes(Math.floor((Date.now() - new Date(state.meta.generatedAt).getTime()) / 60000));
    } else {
      setStaleMinutes(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleCounter, state.meta?.generatedAt]);

  const fetchBriefing = useCallback(async (airports: string[], alternates: string[] = [], aircraftId?: string) => {
    if (airports.length === 0) {
      dispatch({ 
        type: "FETCH_SUCCESS", 
        payload: { 
          briefing: { airports: {}, hazards: [], pireps: [], meta: null },
          ai: { summary: "", altitudeRisks: [], recommendation: "GO", recommendationReason: "" },
          route: [], 
          alternates: [] 
        } 
      });
      try {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete("route");
        window.history.replaceState({}, "", newUrl.toString());
      } catch { /* ignore */ }
      return;
    }
    dispatch({ type: "FETCH_START" });

    try {
      const res = await fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ airports, aircraft: aircraftId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed." }));
        dispatch({ type: "FETCH_ERROR", payload: err.error ?? "Request failed." });
        return;
      }
      const data = await res.json();
      dispatch({ type: "FETCH_SUCCESS", payload: { ...data, alternates, route: airports } });

      // Persist route
      try {
        let saved = JSON.parse(localStorage.getItem("aerobrief_recent_routes") ?? "[]");
        if (!Array.isArray(saved)) saved = [];
        const updated = [airports, ...saved.filter((r: string[]) => Array.isArray(r) && r.join(",") !== airports.join(","))].slice(0, 5);
        localStorage.setItem("aerobrief_recent_routes", JSON.stringify(updated));
        dispatch({ type: "SET_RECENT_ROUTES", payload: updated });
      } catch { /* ignore */ }

      // Update URL
      try {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("route", airports.join(","));
        if (aircraftId) newUrl.searchParams.set("aircraft", aircraftId);
        else newUrl.searchParams.delete("aircraft");
        window.history.replaceState({}, "", newUrl.toString());
      } catch { /* ignore */ }
    } catch {
      dispatch({ type: "FETCH_ERROR", payload: "Network error. Check your connection." });
    }
  }, []);

  const handleRefresh = useCallback(() => {
    if (Object.keys(state.airports).length > 0) {
      fetchBriefing(Object.keys(state.airports), state.alternates, selectedAircraft);
    }
  }, [state.airports, state.alternates, fetchBriefing, selectedAircraft]);

  const airportList = Object.values(state.airports);
  const isStale = staleMinutes >= 15;
  const hasData = airportList.length > 0;
  const isLandingPage = !hasData && !state.isLoading;

  const markers = airportList.map((apt) => ({
    icao: apt.icao,
    coordinates: apt.coordinates ?? AIRPORT_COORDS[apt.icao] ?? [-98.58, 39.83],
    flightCategory: apt.metar?.flightCategory ?? "VFR",
    isActive: apt.icao === state.activeAirport,
    isAlternate: state.alternates.includes(apt.icao),
    metar: apt.metar,
  }));

  return (
    <div className="h-dvh bg-[#050505] text-[#eee] flex flex-col font-sans overflow-hidden relative">
      <AnimatePresence>
        {isLandingPage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-auto"
          >
            <div className="flex flex-col items-center gap-8 w-full max-w-2xl px-6">
              <div className="flex flex-col items-center text-center gap-4">
                <h1 className="text-4xl md:text-6xl font-bold tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-b from-[#fff] to-[#888]">
                  AEROBRIEF <span className="text-[#4b8ef5]">//</span> OPS
                </h1>
                <p className="text-[#aaa] text-sm md:text-base tracking-wider max-w-md">
                  Global Aviation Weather & AI Dispatch Dashboard. Enter your route and aircraft to begin.
                </p>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-4 w-full justify-center bg-[#0a0a0a]/80 p-6 rounded-2xl border border-[#333] shadow-2xl backdrop-blur-xl">
                <AircraftSelector 
                  value={selectedAircraft}
                  onChange={setSelectedAircraft}
                />
                <div className="h-px w-full md:w-px md:h-12 bg-[#333] shrink-0" />
                <RouteInput
                  onSubmit={(apts, alts) => fetchBriefing(apts, alts, selectedAircraft)}
                  isLoading={state.isLoading}
                  recentRoutes={state.recentRoutes}
                  currentRoute={Object.keys(state.airports)}
                  currentAlternates={state.alternates}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stale Data Banner ─────────────────────────────────────── */}
      <AnimatePresence>
        {isStale && (
          <motion.div
            initial={shouldReduceMotion ? {} : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="w-full bg-[#3d240e] text-[#e09145] text-[10px] font-bold py-2.5 px-6 flex justify-between items-center tracking-[0.15em] border-b border-[#e09145]/20 shrink-0"
          >
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#e09145] stale-dot" />
              CAUTION: WEATHER DATA IS {staleMinutes}M STALE. CONDITIONS MAY HAVE SHIFTED.
            </div>
            <button onClick={handleRefresh} className="hover:text-white transition-colors cursor-pointer flex items-center gap-1.5">
              <RefreshCw size={10} />
              REFRESH FEED
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error Banner ───────────────────────────────────────────── */}
      <AnimatePresence>
        {state.error && (
          <motion.div
            initial={shouldReduceMotion ? {} : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="w-full bg-[#3b1c1c] text-[#eb5757] text-[10px] font-bold py-2.5 px-6 flex justify-between items-center tracking-[0.15em] border-b border-[#eb5757]/20 shrink-0"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle size={12} />
              {state.error}
            </div>
            <button onClick={() => dispatch({ type: "FETCH_ERROR", payload: null })} className="hover:text-white transition-colors cursor-pointer">
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Demo Mode Banner ───────────────────────────────────────── */}
      <AnimatePresence>
        {state.meta?.demoMode && (
          <motion.div
            initial={shouldReduceMotion ? {} : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="w-full bg-[#0c1f3d] text-[#4b8ef5] text-[10px] font-bold py-2 px-6 flex items-center gap-3 tracking-[0.15em] border-b border-[#4b8ef5]/20 shrink-0 z-30 relative"
          >
            <Info size={11} />
            DEMO MODE ACTIVE — DISPLAYING SAMPLE DATA
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {!isLandingPage && (
          <motion.header 
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex flex-col md:flex-row items-center justify-between py-3.5 px-6 border-b border-[#1a1a1a] bg-[#050505] shrink-0 gap-3 z-30 relative"
          >
            <div className="w-full md:w-1/4">
              <span className="text-[#888] font-bold tracking-[0.25em] text-[11px]">AEROBRIEF // OPS</span>
            </div>

            <div className="w-full md:w-1/2 flex flex-col md:flex-row justify-center items-stretch md:items-center gap-3">
              <AircraftSelector 
                value={selectedAircraft}
                onChange={setSelectedAircraft}
              />
              <RouteInput
                onSubmit={(apts, alts) => fetchBriefing(apts, alts, selectedAircraft)}
                isLoading={state.isLoading}
                recentRoutes={state.recentRoutes}
                currentRoute={state.route}
                currentAlternates={state.alternates}
              />
            </div>

            <div className="w-full md:w-1/4 flex justify-end">
              <div className="bg-transparent border border-[#1a1a1a] rounded-md px-4 py-2 flex items-center gap-2.5">
                <div className={`w-1.5 h-1.5 rounded-full ${state.isLoading ? "bg-amber-500 animate-pulse" : "bg-[#2ebd6b]"}`} />
                <span className="text-[#666] text-[9px] font-bold tracking-[0.15em]">
                  {state.isLoading ? "PROCESSING..." : "SYSTEM NOMINAL"}
                </span>
              </div>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* ── Main Grid ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-5 p-5 min-h-0 overflow-y-auto lg:overflow-hidden relative z-10">

        {/* Flight Details Panel Overlay */}
        <FlightDetailsPanel flight={selectedFlight} onClose={() => setSelectedFlight(null)} />

        {/* Map */}
        <motion.div 
          layout
          className={
            isLandingPage 
              ? "absolute inset-0 z-0 pointer-events-none" 
              : "order-1 lg:order-2 lg:col-span-6 flex flex-col min-h-[45dvh] lg:min-h-0 relative shrink-0 z-10"
          }
        >
          <div className={`flex-1 relative min-h-0 ${isLandingPage ? "opacity-50" : "rounded-xl border border-[#1a1a1a] overflow-hidden"}`}>
            <div className={`${isLandingPage ? "pointer-events-none" : "pointer-events-auto"} w-full h-full`}>
              <AeroBriefMapDynamic
                markers={markers}
                hazards={state.hazards}
                pireps={state.pireps}
                showRadar={state.mapLayers.radar}
                showSigmets={state.mapLayers.sigmets}
                showPireps={state.mapLayers.pireps}
                showFlights={state.mapLayers.flights}
                activeAirport={state.activeAirport}
                onMarkerClick={(icao) => dispatch({ type: "SET_ACTIVE_AIRPORT", payload: icao })}
                onFlightClick={setSelectedFlight}
              />
            </div>

            {/* Layer Controls - Segmented Pill */}
            {!isLandingPage && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute top-4 right-4 z-10 bg-[#0a0a0a]/80 backdrop-blur-md p-1 border border-[#1a1a1a] rounded-lg flex items-center shadow-lg"
              >
                {(["radar", "sigmets", "pireps", "flights"] as const).map((layer) => (
                  <button
                    key={layer}
                    onClick={() => dispatch({ type: "TOGGLE_LAYER", payload: layer })}
                    className={`relative px-4 py-2 rounded-md text-[9px] font-bold tracking-[0.2em] transition-all duration-200 cursor-pointer ${
                      state.mapLayers[layer]
                        ? "bg-[#1a1a1a] text-[#eee] border border-white/10"
                        : "bg-transparent text-[#555] hover:text-[#888] border border-transparent"
                    }`}
                  >
                    {layer.toUpperCase()}
                  </button>
                ))}
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Left: Station Cards */}
        {!isLandingPage && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="order-2 lg:order-1 lg:col-span-3 flex flex-col gap-4 lg:overflow-y-auto shrink-0 pb-10 lg:pb-0 z-10"
          >
            <h3 className="text-[#444] text-[10px] font-bold tracking-[0.25em] uppercase pl-1 shrink-0">
              En-Route Stations
            </h3>

            {state.isLoading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : hasData ? (
              <>
                {airportList.map((apt, i) => (
                  <StationCard
                    key={apt.icao}
                    airport={apt}
                    index={i}
                    isActive={apt.icao === state.activeAirport}
                    isAlternate={state.alternates.includes(apt.icao)}
                    onClick={() => dispatch({ type: "SET_ACTIVE_AIRPORT", payload: apt.icao })}
                  />
                ))}
              </>
            ) : null}
          </motion.div>
        )}

        {/* Right: AI Insights & TAF */}
        {!isLandingPage && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="order-3 lg:order-3 lg:col-span-3 flex flex-col gap-4 lg:overflow-y-auto shrink-0 pb-10 lg:pb-0 z-10"
          >
            <AIInsights
              ai={state.ai}
              isLoading={state.isLoading}
              onRefresh={handleRefresh}
            />
            
            {/* TAF Timeline for active airport */}
            {state.activeAirport && state.airports[state.activeAirport] && (
              <TAFTimeline airport={state.airports[state.activeAirport]} />
            )}

            {/* Winds Aloft for active airport */}
            {state.activeAirport && state.airports[state.activeAirport]?.windsAloft && (
              <WindsAloftTable levels={state.airports[state.activeAirport].windsAloft.levels} />
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
