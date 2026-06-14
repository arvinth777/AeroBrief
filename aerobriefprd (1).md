# AeroBrief — Product Requirements Document
**Version 1.1 | Global Aviation Weather Briefing Platform**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement & Target Users](#2-problem-statement--target-users)
3. [Goals & Success Metrics](#3-goals--success-metrics)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [End-to-End Data Flow](#5-end-to-end-data-flow)
6. [Backend & API Route Specification](#6-backend--api-route-specification)
7. [Frontend Specification](#7-frontend-specification)
   - 7.1 [Interactive Component Integration](#71-interactive-component-integration)
   - 7.2 [Mobile Scrolling Isolation](#72-mobile-scrolling-isolation-scroll-trap-prevention)
   - 7.3 [Data Freshness & Age Indicators](#73-data-freshness--age-indicators)
   - 7.4 [TAF Timeline Component](#74-taf-timeline-component)
   - 7.5 [Design System & Visual Language](#75-design-system--visual-language)
8. [API Integration Contracts](#8-api-integration-contracts)
9. [State Management & Persistence](#9-state-management--persistence)
10. [Error Handling & Resilience](#10-error-handling--resilience)
11. [Development Phases & Roadmap](#11-development-phases--roadmap)
12. [Environment & Configuration](#12-environment--configuration)
13. [Open Questions & Risks](#13-open-questions--risks)

---

## 1. Executive Summary

**AeroBrief** is a web-based aviation weather briefing tool that aggregates real-time METARs, TAFs, PIREPs, SIGMETs, and global radar data into a single, pilot-friendly interface. It supplements raw data with AI-generated plain-English summaries powered by Google Gemini, helping general aviation pilots and student pilots make confident go/no-go decisions without needing to interpret cryptic ICAO codes manually.

**Core value proposition:** One URL → full global route briefing → AI plain-English summary → go/no-go decision.

---

## 2. Problem Statement & Target Users

### Problem

Aviation weather data is publicly available but fragmented across multiple government sources and delivered in formats (METAR, TAF, SIGMET) that require significant training to interpret. Student pilots and VFR-only pilots are especially vulnerable to making poor decisions due to misread forecasts.

### Target Users

| Persona | Description | Primary Need |
|---|---|---|
| **Student Pilot** | In training, limited experience with weather products | Plain-English interpretation, no jargon |
| **VFR Private Pilot** | Weekend flyer, single-engine | Quick route overview, ceiling/visibility at a glance |
| **IFR Private Pilot** | More experience; wants raw data + context | Raw TAF + timeline + AI summary side by side |
| **Flight Instructor** | Reviews student flight plans | Pedagogical overlay, explainable summaries |

### Out of Scope (v1)

- ATC clearance management
- Flight plan filing
- Commercial airline operations
- Mobile-native apps (web-responsive only in v1)

---

## 3. Goals & Success Metrics

### Product Goals

- **G1** — A pilot can enter a route of 2–6 international airports and receive a full briefing within 5 seconds.
- **G2** — The AI summary is accurate enough that a CFI would not contradict it in >95% of test cases.
- **G3** — The app remains usable (Demo Mode) when all external APIs are unavailable.
- **G4** — All flight categories (VFR/MVFR/IFR/LIFR) are visible at a glance on the Mapbox vector map.

### Success Metrics

| Metric | Target (90-day post-launch) |
|---|---|
| Time-to-briefing (from route entry to AI summary loaded) | < 5 seconds (p90) |
| API error rate surfaced to user | < 2% of requests |
| Demo Mode parity with live mode (feature coverage) | 100% |
| Downstream rate-limit errors (429s) | 0 per day |

---

## 4. System Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                  NEXT.JS FULLSTACK APPLICATION               │
│                                                              │
│  [FRONTEND LAYER — React + Mapbox GL JS]                     │
│  RouteInput → BriefingContext (+ localStorage hydration)     │
│       │              │                  │                    │
│       │              ▼                  ▼                    │
│       │         InteractiveMap    TAFTimeline + AIInsights   │
│       │                                                      │
│       └──── HTTP POST /api/briefing ─────────────────────┐   │
│                                                          │   │
│  ────────────────────────────────────────────────────────┼───│
│  [SERVERLESS API ROUTE LAYER — Node.js Runtime]          │   │
│                                                          │   │
│  app/api/briefing/route.js  ◄────────────────────────────┘   │
│       │                                                      │
│       ├─ IP rate-limiter middleware (10 req / 60s)           │
│       │                                                      │
│       ├─ briefingService.js (orchestrator)                   │
│       │       ├── metar.js  ──┐                              │
│       │       ├── taf.js    ──┤── awcClient.js (Axios)       │
│       │       ├── pirep.js  ──┤   (Cache-Control + UA)       │
│       │       └── sigmet.js ──┘                              │
│       │                │                                     │
│       │      metar-taf-parser (npm)                          │
│       │                │                                     │
│       │       aggregated JSON blob                           │
│       │                                                      │
│       └─ geminiService.js (Structured JSON Schema)           │
│                   └── Google Gemini API                      │
│                                                              │
│  app/api/radar/route.js ──► OpenWeatherMap Maps 1.0          │
└──────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Framework | Next.js 14+ (App Router) | Unified monolith; serverless API routes hide all server-side keys; single deployment target |
| Styling | Tailwind CSS | Utility-first; consistent design tokens |
| Animation | Framer Motion | Spring physics, layout animations, gesture-driven transitions |
| Typography | Inter (via Fontsource) | Closest open-source match to SF Pro; clean at all weights |
| Mapping | Mapbox GL JS (`react-map-gl`) | Hardware-accelerated WebGL vector map; 60fps zooming; premium visual clarity |
| Basemap Style | Custom Mapbox Dark Aviation | Civilian noise removed (roads, POIs); highlights airports, tracks, and hazard polygons |
| Weather Radar | OpenWeatherMap Maps 1.0 | Global precipitation tiles; generous free tier; native Mapbox raster-source integration |
| Aviation Parsing | `metar-taf-parser` (npm) | Standardized open-source engine; handles NOSIG, AMD, COR, VV natively |
| AI Pipeline | Google Gemini SDK (`gemini-1.5-flash`) | Strict structured JSON schema enforcement via `responseMimeType` |
| Icons | Lucide-React | Lightweight, tree-shakeable |
| Backend Runtime | Node.js 18+ | Native Next.js serverless environment |

---

## 5. End-to-End Data Flow

This section is the critical integration glue. Every action has a defined trigger, owner, and output.

### 5.1 Happy Path: Route Briefing Request

```
User types "KLAX, EGLL, VIDP" → clicks "Get Briefing"
│
▼
[Frontend: RouteInput.jsx]
  - Normalizes input (uppercase, trim whitespace, strip commas)
  - Validates against global ICAO pattern (2–4 alpha chars; not just K-prefix)
  - Dispatches FETCH_START to BriefingContext
  - POSTs to /api/briefing { airports: ["KLAX","EGLL","VIDP"] }
│
▼
[app/api/briefing/route.js]
  - IP-based rate limiter: rejects with HTTP 429 if > 10 req / 60s from same IP
  - Deduplicates airport list via Set (prevents doubled API calls for repeated ICAOs)
  - Calls briefingService.getBriefing(dedupedAirports)
│
▼
[briefingService.js — parallel fan-out]
  - Promise.allSettled([
      metar.fetch(airports),         // AWC: global METAR text lookup
      taf.fetch(airports),           // AWC: global TAF text lookup
      pirep.fetch(boundingBox),      // AWC: PIREP box padded around route
      sigmet.fetch(boundingBox),     // AWC: SIGMET polygon bounds
    ])
  - Partial success is fine; missing types are recorded in meta.partialFailures[]
│
▼
[metar-taf-parser — per airport]
  Input:  Raw METAR/TAF strings from fetchers
  Output: Tokenized objects with flightCategory, ceiling, visibility, winds,
          explicit VV (Vertical Visibility) ceiling handling
│
▼
[briefingService.js — aggregation]
  Returns: {
    airports: { KLAX: { metar, parsedTaf }, EGLL: {...}, VIDP: {...} },
    hazards:  [ { type: "SIGMET", polygon: [...], text: "..." } ],
    pireps:   [ { lat, lon, altitude, text, time } ],
    meta:     { generatedAt: ISO8601, partialFailures: [] }
  }
│
▼
[geminiService.js — Structured AI Execution]
  - Condenses briefing to < 2,000-token payload (ceilings, categories, winds, hazard texts only)
  - Calls Gemini SDK with responseMimeType: "application/json" + strict responseSchema
  - Returns verified: { summary, altitudeRisks, recommendation, recommendationReason }
│
▼
[app/api/briefing/route.js — response assembly]
  Returns unified payload: { briefing, ai }
  Sets Cache-Control: no-store (weather data must never be served stale from CDN)
│
▼
[Frontend: BriefingContext]
  - Dispatches FETCH_SUCCESS; stores airports, hazards, pireps, ai
  - Persists route to localStorage (aerobrief_recent_routes)
  - Persists active layer config to localStorage (aerobrief_map_layers)
  - WeatherMap, TAFTimeline, AIInsights re-render via context subscription
```

### 5.2 Radar Tile Flow (Independent of Briefing)

```
[InteractiveMap.jsx mounts]
  → Mapbox raster source added directly in client:
    source: {
      type: "raster",
      tiles: ["https://maps.openweathermap.org/maps/1.0/precipitation/{z}/{x}/{y}.png?appid=..."],
      tileSize: 256
    }
  → Layer applied with raster-opacity: 0.55, raster-resampling: "linear"
  → No backend proxy needed; OWM key is NEXT_PUBLIC_ (client-safe)
  → Layer toggled via BriefingContext mapLayers.radar boolean
```

### 5.3 Winds Aloft Fallback Flow

```
[briefingService.js — post-aggregation check]
  - If any airport is missing wind data after AWC fetch:
    → GET https://api.open-meteo.com/v1/forecast
         ?latitude={lat}&longitude={lon}
         &hourly=windspeed_80m,windspeed_120m,windspeed_180m,winddirection_80m
         &wind_speed_unit=kn&forecast_days=1
    → Merged into airport.windsAloft; tagged with source: "open-meteo"
  - UI displays "*wind data from Open-Meteo" footnote for those airports
```

---

## 6. Backend & API Route Specification

### 6.1 Directory Structure

```
├── app/
│   ├── layout.js
│   ├── page.js                      # AeroBrief core dashboard
│   └── api/
│       ├── briefing/
│       │   └── route.js             # POST /api/briefing
│       └── radar/
│           └── route.js             # GET /api/radar (optional timestamp wrapper)
├── src/
│   ├── fetchers/
│   │   ├── metar.js
│   │   ├── taf.js
│   │   ├── pirep.js
│   │   └── sigmet.js
│   ├── services/
│   │   ├── briefingService.js
│   │   └── geminiService.js
│   └── utils/
│       ├── awcClient.js             # Axios instance: User-Agent, dedup, 90s cache
│       ├── boundingBox.js           # Computes padded lat/lon bbox from airport list
│       └── demoData.js              # Hardcoded briefing for DEMO_MODE
└── public/
    └── data/
        └── airports.json            # Global ICAO → lat/lon mapping (~3,000 airports)
```

### 6.2 Route Contracts

#### `POST /api/briefing`

```json
// Request
{ "airports": ["KLAX", "EGLL", "VIDP"] }

// Response 200
{
  "briefing": {
    "airports": {
      "KLAX": {
        "metar": { "raw": "KLAX 141753Z ...", "flightCategory": "VFR", "temp": 18 },
        "parsedTaf": { "blocks": [ ... ] }
      },
      "EGLL": { ... },
      "VIDP": { ... }
    },
    "hazards": [],
    "pireps": [],
    "meta": { "generatedAt": "2026-06-14T13:32:00Z", "partialFailures": [] }
  },
  "ai": {
    "summary": "Conditions across the flight sequence are clear...",
    "altitudeRisks": [{ "altitude": 7000, "risk": "Moderate wind shear near FL070" }],
    "recommendation": "GO",
    "recommendationReason": "All destination profiles report strong VFR conditions."
  }
}

// Response 400 — invalid ICAO
{ "error": "Invalid ICAO: 'XYZABC'. Expected 2–4 alpha characters." }

// Response 429 — rate limited
{ "error": "Too many requests. Try again in 60 seconds." }

// Response 503 — all data sources failed
{ "error": "AWC API unavailable. Enable DEMO_MODE in settings." }
```

### 6.3 `awcClient.js` — Axios Instance

```javascript
// Key responsibilities:
// 1. Inject required User-Agent header (prevents AWC 403)
// 2. Request deduplication: if same URL called within 500ms, reuse in-flight Promise
// 3. Response caching: TTL 90 seconds (METAR standard refresh interval)
// 4. Retry: up to 2 retries with 1s backoff on 5xx

const AWC_BASE    = 'https://aviationweather.gov/api/data';
const USER_AGENT  = 'AeroBrief/1.1 (aviation-weather-briefing; contact@aerobrief.app)';
```

### 6.4 `boundingBox.js`

Fetchers for PIREPs and SIGMETs require a geographic bounding box, not ICAO strings. This utility resolves airport coordinates from the bundled `airports.json` and pads the box by 1.5° on each side to capture nearby hazards.

```javascript
// Returns: { minLat, maxLat, minLon, maxLon }
// Padding of 1.5° covers approximately 100nm — sufficient for en-route hazard capture
export function getBoundingBox(airports, paddingDeg = 1.5) { ... }
```

**Why bundled JSON, not a live lookup:** An extra network call to resolve coordinates before fetching would add ~300–600ms of sequential latency to every briefing. The static `airports.json` (~300KB, loaded once at cold start) eliminates this bottleneck.

### 6.5 Flight Category Decision Tree (with VV)

The `metar-taf-parser` package tokenizes raw strings. AeroBrief applies its own flight category classification on top of the parsed tokens, including explicit handling of Vertical Visibility (`VV`) — a fog/obscuration indicator that the npm package surfaces but does not categorize:

```
IF ceiling < 500  OR visibility < 1SM
   OR (token is VV AND VV_value < 500)   → LIFR  (Magenta)

ELIF ceiling < 1000 OR visibility < 3SM  → IFR   (Red)

ELIF ceiling < 3000 OR visibility < 5SM  → MVFR  (Blue)

ELSE                                     → VFR   (Green)

Rule: Only BKN, OVC, and VV tokens set the ceiling value.
      FEW and SCT clouds are ignored for category calculation.
```

### 6.6 `geminiService.js` — Prompt & Schema

**Token budget:** The raw briefing JSON is condensed before sending. Strip: raw strings, observation timestamps, and all fields not relevant to safety. Keep: airport ID, flight category per TAF block, wind speed/direction, ceiling, visibility, SIGMET text (truncated to 100 chars), PIREP count. Hard cap: 2,000 input tokens.

```javascript
const response = await model.generateContent({
  contents: [{ role: "user", parts: [{ text: condensedPrompt }] }],
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        summary:             { type: "string" },
        altitudeRisks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              altitude: { type: "number" },
              risk:     { type: "string" }
            },
            required: ["altitude", "risk"]
          }
        },
        recommendation:       { type: "string", enum: ["GO", "NO-GO", "MARGINAL"] },
        recommendationReason: { type: "string" }
      },
      required: ["summary", "altitudeRisks", "recommendation", "recommendationReason"]
    }
  }
});
```

**Fallback:** If the SDK throws or schema validation fails, return `{ summary: "AI summary unavailable.", altitudeRisks: [], recommendation: "MARGINAL", recommendationReason: "Could not generate AI analysis." }`. The AI panel must never block the core briefing display.

---

## 7. Frontend Specification

### 7.1 Interactive Component Integration

```
app/page.js
 └── BriefingProvider (context + localStorage hydration on mount)
      ├── RouteInput.jsx
      │     └── [on submit] → dispatches FETCH_START + calls POST /api/briefing
      │
      ├── InteractiveMap.jsx              (react-map-gl MapboxMap)
      │     ├── OWMRadarLayer             ← Mapbox raster-source (direct client)
      │     ├── AviationMarkers           ← BriefingContext.airports (GeoJSON points)
      │     ├── HazardPolygons            ← BriefingContext.hazards (GeoJSON fill layer)
      │     ├── PirepClusters             ← BriefingContext.pireps (grid-clustered)
      │     ├── MapBoundsHandler          ← fitBounds() on BriefingContext.airports
      │     └── MapLayerControls          ← toggles BriefingContext.mapLayers
      │
      ├── TAFTimeline.jsx
      │     └── parsedTaf.blocks[] from BriefingContext.airports[activeAirport]
      │
      ├── AIInsights.jsx                  ← BriefingContext.ai (renders independently)
      │     └── AltitudeRisks.jsx
      │
      ├── DataAgeIndicator.jsx            ← polls meta.generatedAt vs Date.now()
      └── ErrorBanner.jsx                 ← BriefingContext.error + partialFailures[]
```

### 7.2 Mobile Scrolling Isolation (Scroll Trap Prevention)

On viewports `< 768px`, the Mapbox instance sets `dragPan={false}` and `scrollZoom={false}` by default. Users scroll past the map naturally to access the TAF Timeline and AI panels. A dedicated "Expand Map" button transitions to a full-screen isolated overlay where all pan/zoom interactions are re-enabled.

```jsx
<MapboxMap
  dragPan={isMobile ? false : true}
  scrollZoom={isMobile ? false : true}
  style={{ height: isMobile ? '45dvh' : '100%' }}  // dvh not vh — Safari toolbar fix
/>
```

**Note:** Use `dvh` (dynamic viewport height) units for all full-screen map containers. Safari's dynamic address bar causes `100vh` to clip content; `100dvh` adjusts correctly.

### 7.3 Data Freshness & Age Indicators

Weather data older than 15 minutes represents a flight safety risk. The `DataAgeIndicator` component polls `meta.generatedAt` against the current clock every 30 seconds:

| Age | Behavior |
|---|---|
| < 15 minutes | Normal display; subtle timestamp shown in footer |
| ≥ 15 minutes | Permanent amber banner: `"Caution: Weather data is stale. Conditions may have changed."` + inline Refresh button that re-invokes `POST /api/briefing` with the same route |

The stale banner is rendered above all content panels and cannot be dismissed — only resolved by refreshing.

### 7.4 TAF Timeline Component

Parsed TAF blocks from `metar-taf-parser` are rendered as a horizontally scrollable timeline. On desktop, the timeline lives in the right detail panel. On mobile, it appears as a full-width horizontal scroll row below the map.

```
[EGLL TAF — Jun 14 18Z to Jun 15 18Z]

18Z       00Z       06Z       12Z       18Z
 │         │         │         │         │
 ██████████░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▓▓▓▓▓▓▓▓▓
 VFR        MVFR      IFR       IFR
 23010KT    22015KT   BKN008    OVC005
 P6SM       4SM BR    2SM FG    VV002
```

Each block is a clickable card. Selecting one sets `BriefingContext.activeAirport` and highlights the corresponding marker on the Mapbox map.

---

### 7.5 Design System & Visual Language

AeroBrief's UI must feel native-quality — closer to an iOS app than a web dashboard. The guiding principle is **physical, fluid, and frictionless**: elements should feel like objects with weight and momentum.

---

#### 7.5.1 Design Philosophy

AeroBrief inherits from Apple's Human Interface Guidelines, adapted for web:

- **Clarity** — Typography and layout do the heavy lifting. Data is never buried in noise. If a pilot can't find the ceiling at a glance, the design has failed.
- **Deference** — The UI steps back and lets the weather data and Mapbox canvas take center stage. Chrome (nav, borders, labels) is kept to a minimum.
- **Depth** — Translucent layers, shadows, and blur convey hierarchy without relying on borders or dividers. Panels feel like frosted glass hovering above the map.

---

#### 7.5.2 Color System

```
Light Mode (default):
  Background          #F2F2F7    (iOS systemGroupedBackground)
  Surface / cards     #FFFFFF    backdrop-blur-xl bg-white/75
  Surface elevated    #FFFFFF    shadow-lg
  Label primary       #000000
  Label secondary     #3C3C43 @ 60% opacity
  Label tertiary      #3C3C43 @ 30% opacity
  Separator           #3C3C43 @ 12% opacity

Dark Mode (auto via prefers-color-scheme):
  Background          #000000
  Surface             #1C1C1E
  Surface elevated    #2C2C2E
  Label primary       #FFFFFF
  Label secondary     #EBEBF5 @ 60% opacity

Brand accent:
  Sky Blue            #0A84FF    (primary actions, active states, links)

Flight Category (color + shape always paired for accessibility):
  VFR                 #30D158    Green   ● circle
  MVFR                #0A84FF    Blue    ◆ diamond
  IFR                 #FF453A    Red     ▲ triangle
  LIFR                #BF5AF2    Magenta ✕ cross
```

**Rule:** Never use flat opaque fills for floating panel backgrounds. All cards, popovers, and bottom sheets use `backdrop-blur` + semi-transparent `bg-white/75` — the same visual treatment as iOS's `UIBlurEffect`.

---

#### 7.5.3 Typography

Install Inter via `@fontsource/inter`. Add to Tailwind config:

```javascript
fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'] }
```

```
Scale                               Usage
text-[34px] font-bold  tracking-tight    Page title (e.g. "Route Briefing")
text-[28px] font-bold  tracking-tight    Airport ICAO identifier
text-[22px] font-semibold               Card title / section header
text-[17px] font-normal  leading-snug   Body, raw METAR text
text-[15px] font-normal                 Secondary label
text-[13px] font-normal  text-secondary Caption, timestamps
text-[11px] font-semibold tracking-wide uppercase   Overline tag (e.g. "TAF FORECAST")
```

**Rules:**
- No text below 11px.
- All numeric data (altitudes, wind speeds, visibility) rendered with Tailwind's `tabular-nums` class (`font-variant-numeric: tabular-nums`) to prevent layout jitter when values refresh live.
- Headings never use all-caps except overline/tag labels.

---

#### 7.5.4 Motion & Animation

All motion runs on spring physics via **Framer Motion**. Never linear easing on interactive elements.

**Spring presets:**

```javascript
export const springs = {
  // Snappy — toggles, pills, small UI state changes
  snappy:  { type: 'spring', stiffness: 400, damping: 28 },
  // Default — cards sliding in, panels expanding
  default: { type: 'spring', stiffness: 300, damping: 30 },
  // Gentle — page-level transitions, map-driven panel changes
  gentle:  { type: 'spring', stiffness: 200, damping: 26 },
  // Bouncy — success states, GO badge appearing
  bouncy:  { type: 'spring', stiffness: 400, damping: 20, mass: 0.8 },
};
```

**Interaction → animation mapping:**

| Interaction | Animation |
|---|---|
| Briefing loads | Airport cards stagger in: `y: 20 → 0`, `opacity: 0 → 1`, 50ms delay per card |
| Airport marker tapped (mobile) | Bottom sheet slides up with `gentle` spring |
| TAF block selected | Active block scales to `1.02`; siblings scale to `0.98`; shadow deepens |
| Flight category badge appears | `bouncy` spring: scale `0.5 → 1.0` |
| GO / NO-GO badge enters | Scale `0 → 1` + bounce; color fills from center outward |
| Button / card pressed | `whileTap={{ scale: 0.96 }}` on all interactive elements |
| Error banner appears | Slides down from top with `default` spring; dismiss slides back up |
| Layer toggle pill | Active pill slides with Framer Motion `layoutId="segment-pill"` |
| Skeleton → loaded content | Crossfade `opacity: 0 → 1` on loaded panel; skeleton fades out simultaneously |
| Stale data banner | Pulse animation on the amber accent every 8s to keep it salient without being disruptive |

**Performance rules:**
- Animate only `transform` and `opacity`. Never animate `height`, `width`, `top`, or `background-color` directly — these force layout recalc.
- `will-change: transform` on bottom sheet and Mapbox overlay panels only (not globally).
- Target 60fps on mid-range hardware (Snapdragon 695 class).
- Wrap all Framer Motion components with `useReducedMotion()` — if user's OS setting is enabled, all durations collapse to `0ms`.

---

#### 7.5.5 Component Design Patterns

**Cards & Panels — Frosted Glass**

```jsx
<div className="
  rounded-2xl
  bg-white/75 dark:bg-zinc-900/75
  backdrop-blur-xl
  shadow-sm
  border border-white/20 dark:border-white/10
  p-4
  transition-colors duration-300
">
```

Cards never have a visible stroke in light mode — the `border-white/20` is invisible on white but appears as a subtle edge when the card floats over the dark Mapbox canvas.

**Segmented Controls (replaces all `<select>` dropdowns)**

```
[ Radar ] [ PIREPs ] [ Hazards ]
```

The active segment is a filled white pill that animates position using `layoutId="segment-pill"`. This mirrors iOS's `UISegmentedControl` exactly. No native `<select>` elements anywhere in the UI.

**Route Input — Pill Tag Input**

Each confirmed ICAO becomes an animated pill tag:

```
[ KLAX × ] [ EGLL × ] [ VIDP × ] [   type ICAO...  ]
```

- Pills enter with `bouncy` spring scale (`0 → 1`).
- Removing a pill: scale to `0` + opacity to `0` simultaneously, then splice from array.
- Invalid ICAO shakes horizontally (`x: [0, -8, 8, -4, 4, 0]`) rather than showing a static error text.

**Bottom Sheet (mobile airport detail)**

```
States:
  Peeking    →  120px from bottom (shows airport name + category badge)
  Half       →  50dvh (shows METAR summary + first 3 TAF blocks)
  Expanded   →  90dvh (full TAF timeline + all fields)

Drag handle:  Visible pill at top of sheet. Drag velocity determines snap target.
Background:   backdrop-blur-xl bg-white/80 dark:bg-zinc-900/80
```

Implement drag with Framer Motion `useMotionValue` + `useDragControls`. Sheet snaps to nearest state on release, using velocity to decide direction when between two states.

**Skeleton Loading**

No spinners. Skeleton screens mirror the exact layout of loaded content.

```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
  border-radius: 8px;
}
```

The map canvas, TAF timeline, and AI panel each have distinct skeleton states that appear immediately on `FETCH_START` dispatch.

**Flight Category Badges**

Always encode flight category with both color and shape — never color alone:

```jsx
<FlightCategoryBadge category="IFR" />
// Renders: [▲ IFR] — rounded-full pill, 11px semibold uppercase, red background
```

---

#### 7.5.6 Layout & Spacing

AeroBrief uses an 8pt grid (Tailwind default: `4 units = 1rem = 16px`):

```
Page padding mobile:    px-4   (16px)
Page padding desktop:   px-6   (24px)
Card padding:           p-4    (16px)
Stack gap tight:        gap-2  (8px)
Stack gap default:      gap-4  (16px)
Stack gap loose:        gap-6  (24px)
Section spacing:        mt-8   (32px)
```

**Responsive layout breakpoints:**

| Breakpoint | Layout |
|---|---|
| `< 768px` (mobile) | Single column. Map full-width at 45dvh. `dragPan` and `scrollZoom` off; "Expand Map" button available. TAF Timeline as horizontal scroll row below map. AI Insights below that. Airport detail as draggable bottom sheet. |
| `768px–1024px` (tablet) | Two columns: Map (60%) + sidebar panel (40%). Bottom sheet becomes a slide-in right drawer. Map interactions fully enabled. |
| `> 1024px` (desktop) | Three columns: sidebar (280px fixed) + Map (flex-grow) + detail panel (360px fixed). TAF Timeline in right panel per selected airport. AI Insights pinned at top of right panel. All map interactions enabled. |

---

#### 7.5.7 Micro-Interactions Checklist

These details are the difference between a polished iOS-feel product and a standard web app. All must pass review before v1 launch:

- [ ] Route input has `ring-2 ring-sky-500/30` glow on focus — no default browser outline
- [ ] All buttons and tappable cards: `whileTap={{ scale: 0.96 }}`
- [ ] Active airport marker has a looping pulse ring animation on the Mapbox canvas
- [ ] GO / NO-GO badge never just "appears" — always enters with `bouncy` scale spring
- [ ] Switching active airport in the timeline animates card positions via `layoutId`
- [ ] All scrollable areas: `-webkit-overflow-scrolling: touch` + hidden scrollbars (`::-webkit-scrollbar { display: none }`)
- [ ] All tap targets: minimum `44×44px` (iOS HIG minimum; enforced with `min-h-[44px] min-w-[44px]`)
- [ ] Color + shape always encode flight category together — never color alone
- [ ] Dark mode: `transition-colors duration-300` on all surfaces (no instant flicker on toggle)
- [ ] Radar opacity: custom pill-style slider track — not a native `<input type="range">`
- [ ] Invalid ICAO entry triggers horizontal shake animation (not static error text)
- [ ] Stale data banner: amber pulse every 8s; no dismiss until data is refreshed
- [ ] Map tiles: `raster-resampling: "linear"` applied to OWM precipitation layer

---

## 8. API Integration Contracts

### 8.1 AWC API (METARs, TAFs, PIREPs, SIGMETs)

| Fetcher | Endpoint | Key Params | Format |
|---|---|---|---|
| `metar.js` | `/metar/data` | `ids=KLAX,EGLL&format=json&hours=3` | JSON array |
| `taf.js` | `/taf/data` | `ids=KLAX,EGLL&format=json&time=valid` | JSON array |
| `pirep.js` | `/pirep/data` | `bbox={minLat,minLon,maxLat,maxLon}&format=json&age=3` | JSON array |
| `sigmet.js` | `/isigmet/data` | `bbox=...&format=json` | JSON (GeoJSON polygons) |

**Required header on every AWC call (set in `awcClient.js`, not per-fetcher):**
```
User-Agent: AeroBrief/1.1 (contact@aerobrief.app)
```
AWC returns `403 Forbidden` without a descriptive User-Agent.

**Caching:** All AWC responses cached in-memory for 90 seconds (standard METAR update interval). Same-URL requests within the TTL window return the cached response without hitting AWC.

### 8.2 OpenWeatherMap Maps 1.0 (Global Radar)

Loaded directly in the Mapbox client as a raster source — no backend proxy needed. The `NEXT_PUBLIC_OWM_API_KEY` is client-safe.

```javascript
const owmRadarTileUrl =
  `https://maps.openweathermap.org/maps/1.0/precipitation/{z}/{x}/{y}.png?appid=${process.env.NEXT_PUBLIC_OWM_API_KEY}`;

// Mapbox layer paint:
{
  "raster-opacity": 0.55,
  "raster-resampling": "linear"   // prevents blocky pixel artifacts at high zoom
}
```

### 8.3 Google Gemini SDK (AI Summary)

See `geminiService.js` spec in §6.6. Key points:
- Model: `gemini-1.5-flash`
- Output enforced via `responseMimeType: "application/json"` + `responseSchema`
- Hard token cap: 2,000 input tokens via `condenseBriefing()` utility
- On any failure: graceful fallback object returned; AI panel hides itself cleanly

### 8.4 Open-Meteo API (Winds Aloft Fallback)

```
GET https://api.open-meteo.com/v1/forecast
  ?latitude={lat}&longitude={lon}
  &hourly=windspeed_80m,windspeed_120m,windspeed_180m,winddirection_80m
  &wind_speed_unit=kn
  &forecast_days=1
```

No API key required. Called only when AWC winds-aloft data is absent for an airport. Tagged `source: "open-meteo"` in the response.

---

## 9. State Management & Persistence

Application state is managed via React Context + `useReducer`. No Redux — too heavy for this scope.

### BriefingContext Shape

```javascript
const initialState = {
  // Input
  route: [],                   // ["KLAX", "EGLL", "VIDP"]
  recentRoutes: [],            // last 3 valid searches (hydrated from localStorage)

  // Loading & error
  isLoading: false,
  error: null,                 // string | null

  // Core data
  airports: {},                // { KLAX: { metar, parsedTaf, coordinates }, ... }
  hazards: [],                 // SIGMET/AIRMET GeoJSON polygons
  pireps: [],                  // raw PIREP list
  meta: null,                  // { generatedAt, partialFailures }

  // AI
  ai: null,                    // { summary, altitudeRisks, recommendation, recommendationReason }

  // UI
  activeAirport: null,         // ICAO string — drives map popups + timeline focus
  mapLayers: {
    radar:    true,
    pireps:   true,
    hazards:  true,
    airports: true,
  },
  demoMode: false,
};
```

### Reducer Actions

| Action | Trigger | Effect |
|---|---|---|
| `SET_ROUTE` | User submits RouteInput | Updates `route` array |
| `FETCH_START` | API call begins | `isLoading = true`, `error = null` |
| `FETCH_SUCCESS` | 200 response received | Populates `airports`, `hazards`, `pireps`, `ai`, `meta`; appends to `recentRoutes` |
| `FETCH_ERROR` | Non-200 or network error | `isLoading = false`, `error = message string` |
| `SET_ACTIVE_AIRPORT` | Map marker or timeline card clicked | `activeAirport = ICAO` |
| `TOGGLE_LAYER` | MapLayerControls segment clicked | Toggles `mapLayers[layerName]` boolean |
| `SET_DEMO_MODE` | Demo toggle clicked | `demoMode = true/false`; next fetch uses `demoData.js` |

### LocalStorage Persistence

`BriefingProvider` reads these keys on mount and writes them on `FETCH_SUCCESS` / `TOGGLE_LAYER`:

| Key | Value | Purpose |
|---|---|---|
| `aerobrief_recent_routes` | Array of last 3 route arrays | Populates route shortcut chips below RouteInput |
| `aerobrief_map_layers` | `{ radar, pireps, hazards, airports }` booleans | Restores layer toggles across sessions |

---

## 10. Error Handling & Resilience

### Philosophy

Partial data > no data. A briefing with missing PIREPs but complete METARs and TAFs is still flight-useful. The backend uses `Promise.allSettled` so one failing fetcher never blocks the rest. The frontend renders whatever it has.

### Degradation Matrix

| Failure | Backend Action | UI Presentation |
|---|---|---|
| AWC 403 (missing User-Agent) | Log; add to `partialFailures[]` | Yellow `ErrorBanner` — "Some weather data unavailable." App still usable. |
| AWC timeout (> 8s) | `AbortController` fires; treat as partial failure | Same as above |
| One fetcher fails (e.g. PIREPs) | `allSettled` continues; type omitted from response | Warning chip in `MapLayerControls`: "PIREPs unavailable" |
| All AWC fetchers fail | Return HTTP 503 | Red `ErrorBanner` + "Enable Demo Mode" suggestion |
| Gemini rate limited / throws | Catch at service level; return null `ai` field | AI Insights panel shows "AI engine busy. Raw weather tools remain active." — never blocks briefing |
| OWM radar tiles fail | Mapbox tile error handler | `MapLayerControls` shows grayed "Radar Unavailable" chip |
| metar-taf-parser encounters malformed string | Parser logs token error; skips block | Raw unparsed string passed to secondary panel view |
| All sources fail | HTTP 503 | Suggest Demo Mode |
| Stale data (≥ 15 min) | Client-side `DataAgeIndicator` poll | Permanent amber banner with Refresh button |

### ErrorBanner Variants

```
"warning"  →  Amber  — partial data; app still usable; no action required
"error"    →  Red    — briefing failed; shows Retry button
"info"     →  Blue   — demo mode active
"stale"    →  Amber  — weather data age ≥ 15 min; shows Refresh button; non-dismissible
```

Each banner variant slides in from the top with `default` spring, and out on dismiss/resolve.

---

## 11. Development Phases & Roadmap

### Phase 1 — Architecture & Core API (Weeks 1–2) ✅

- [x] Unify project inside Next.js App Router structure
- [x] Configure IP-based rate-limiting middleware (10 req / 60s per IP)
- [x] Set up `awcClient.js` with User-Agent, dedup, and 90s cache
- [x] Switch weather parsing to `metar-taf-parser` npm package
- [x] Implement VV-aware flight category classification
- [x] Integrate Gemini SDK with structured JSON schema enforcement
- [x] Wire DEMO_MODE toggle through `demoData.js`

### Phase 2 — Advanced Global Map View (Weeks 3–4) ✅

- [x] Replace Leaflet with Mapbox GL JS (`react-map-gl`)
- [x] Apply custom dark aviation basemap style
- [x] Connect OWM precipitation layer as Mapbox raster source
- [x] Apply `raster-resampling: "linear"` paint property
- [x] `MapBoundsHandler`: `fitBounds()` on route airports after briefing loads
- [x] `AviationMarkers`: GeoJSON point layer, colored + shaped by flight category
- [x] `HazardPolygons`: GeoJSON fill layer for SIGMETs
- [x] Grid-based PIREP clustering (0.5° × 0.5° cells; count badge on cluster marker)

### Phase 3 — Interface Safety & Persistence (Weeks 5–6) ✅

- [x] `BriefingContext` with `useReducer` and all defined actions
- [x] localStorage hydration on mount (`recentRoutes`, `mapLayers`)
- [x] `DataAgeIndicator`: 30s polling, amber banner at ≥ 15 min stale
- [x] Mobile scroll trap prevention (`dragPan={false}` + "Expand Map" overlay)
- [x] `dvh` units on all full-screen map containers (Safari fix)

### Phase 4 — TAF Timeline & AI Panel (Week 7)

- [ ] `TAFTimeline.jsx`: horizontal scrollable timeline from `parsedTaf.blocks[]`
- [ ] `TAFBlock.jsx`: clickable card per time period; sets `activeAirport` on select
- [ ] `AIInsights.jsx`: summary text + recommendation badge with `bouncy` entrance
- [ ] `AltitudeRisks.jsx`: altitude risk list, staggered entrance animation
- [ ] Open-Meteo fallback integration + "* wind from Open-Meteo" footnote

### Phase 5 — Design System Foundation (Week 8)

- [ ] Inter font via Fontsource; Tailwind `fontFamily` config
- [ ] Full color token system in `tailwind.config.js` (all brand + flight category colors)
- [ ] Frosted glass card component (backdrop-blur, semi-transparent surface)
- [ ] Segmented control component with Framer Motion `layoutId` sliding pill
- [ ] Pill tag route input with `bouncy` entrance + shake-on-invalid animation
- [ ] Skeleton loading screens for map, TAF timeline, and AI panel
- [ ] Bottom sheet component with `useMotionValue` drag + velocity snap
- [ ] `springs.js` presets file; all interactions wired

### Phase 6 — Polish, Accessibility & Launch (Week 9)

- [ ] All `whileTap={{ scale: 0.96 }}` press states applied globally
- [ ] Staggered card entrance animation on briefing load
- [ ] Active airport pulse ring on Mapbox marker
- [ ] `useReducedMotion()` pass — confirm zero-duration mode works
- [ ] Full `ErrorBanner` suite (warning / error / info / stale variants)
- [ ] Accessibility audit: ARIA labels on map, 44px tap targets, color + shape category encoding
- [ ] Dark mode pass: all surfaces, text, and borders verified
- [ ] Performance audit: p90 time-to-briefing < 5 seconds
- [ ] Demo Mode end-to-end parity check (100% feature coverage vs live mode)

---

## 12. Environment & Configuration

### `.env.local`

```env
# Server-side only (never exposed to client)
GEMINI_API_KEY=your_gemini_api_key_here

# Client-safe (NEXT_PUBLIC_ prefix — embedded at build time)
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_public_token_here
NEXT_PUBLIC_OWM_API_KEY=your_openweathermap_key_here

# Feature flags
DEMO_MODE=false                     # Bypasses all external APIs; returns demoData.js
AWC_CACHE_TTL_SECONDS=90            # METAR standard refresh interval
```

**Key security note:** `GEMINI_API_KEY` and the AWC User-Agent email are server-side only. Because AeroBrief is a Next.js monolith, these keys never leave the serverless function environment. The only client-exposed keys (`NEXT_PUBLIC_*`) are Mapbox and OWM — both are designed to be public-facing with usage restrictions set in their respective dashboards.

---

## 13. Open Questions & Risks

| # | Risk | Priority | Resolution |
|---|---|---|---|
| 1 | **Global SIGMET coordinate formats** — European (ICAO EUR) and Asian SIGMETs occasionally use text-path descriptions instead of numeric coordinate arrays, which are not GeoJSON-parseable. | High | If coordinate parsing fails for a hazard, fall back to drawing a standardized warning radius (~100nm) around the nearest airport in the route. Log the raw text to `partialFailures[]` for debugging. |
| 2 | **Gemini token cost on long routes** — A 6-airport international route produces a large aggregated JSON blob. | Medium | `condenseBriefing()` utility strips all raw strings, keeping only categorized fields. Hard input cap at 2,000 tokens; if exceeded, trim oldest TAF blocks first. |
| 3 | **AWC rate limits** — AWC's public rate limit is undocumented. Aggressive polling from multiple users could trigger 429s. | High | 90-second in-memory cache on `awcClient.js` ensures the same endpoint is never hit more than once per TTL window, regardless of concurrent users. |
| 4 | **Mapbox GL JS bundle size** — `mapbox-gl` is ~250KB gzipped, adding significant JS weight. | Medium | Lazy-load `react-map-gl` behind a dynamic `import()` with `next/dynamic`. The map canvas should not block the initial briefing panel render. |
| 5 | **`metar-taf-parser` edge cases** — Package handles most global formats but may not cover all regional variations (e.g., some Caribbean and African METARs use non-standard visibility units). | Low | Log unrecognized tokens; pass raw string through to the secondary panel view. File upstream issues to the npm package if patterns emerge. |
| 6 | **Safari `dvh` support** — `dvh` is supported in Safari 15.4+. Users on older Safari may see map clipping. | Low | Provide `100vh` as a CSS fallback before the `100dvh` declaration. Acceptable degradation for < 1% of users. |
| 7 | **Gemini structured output reliability** — SDK schema enforcement is generally reliable but not guaranteed under high load or model updates. | Medium | Already mitigated in §6.6: any parse failure returns the defined fallback object. Monitor Gemini SDK release notes for schema enforcement changes. |
