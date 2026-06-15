# AeroBrief // OPS

![AeroBrief Dashboard](/public/dashboard.png)
![AeroBrief Landing](/public/landing.png)

A modern, AI-powered global aviation weather briefing and flight planning dashboard. AeroBrief provides pilots and dispatchers with real-time weather, hazards, NOTAMs, and an intelligent Go/No-Go recommendation tailored to specific aircraft performance envelopes.

## ✨ Key Features

- **Live Weather & Hazards:** Automatically fetches the latest METAR, TAF, and Winds Aloft data from the Aviation Weather Center (AWC). 
- **Interactive Global Map:** A high-performance, dark-mode map (MapLibre) featuring:
  - Animated route plotting between departure, arrival, and alternate airports.
  - Live, animated RainViewer composite radar.
  - Interactive, geolocated SIGMETs and PIREPs with decoded popups.
  - Live flight tracking using the OpenSky Network, AirLabs, and HexDB.
- **Aircraft Performance Profiles:** Select from popular airframes including the Cessna 172, Cirrus SR22, Pilatus PC-12, Boeing 737-800, Boeing 777-300ER, Airbus A320, and Airbus A350-900.
- **Live FAA NOTAMs:** Direct integration with the official FAA NOTAM Search API to display critical airport closures, runway outages, and airspace restrictions.
- **AI Dispatcher (Gemini 2.5 Flash):** An intelligent agent that reads the raw weather data and NOTAMs, compares them against your selected aircraft's legal and physical limitations (like max crosswind, icing capability, etc.), and provides a safety-focused briefing and Go/No-Go recommendation.

## 🛠️ Tech Stack

- **Framework:** Next.js (App Router) + React
- **Styling:** Tailwind CSS + Framer Motion (for smooth micro-animations)
- **Map:** `react-map-gl/maplibre`
- **AI Integration:** `@google/genai`
- **Data Sources:** 
  - Aviation Weather Center (AWC)
  - FAA NOTAM Search API
  - OpenSky Network & AirLabs (Telemetry)
  - HexDB & Aviationstack (Aircraft Metadata)
  - RainViewer (Radar)

## 🚀 Getting Started

First, make sure to configure your environment variables by copying `.env.local.example` to `.env.local`:

```bash
# Required for the AI Dispatcher
GEMINI_API_KEY=your_gemini_api_key

# Optional for tracking actual flight metadata
AVIATIONSTACK_API_KEY=your_aviationstack_key
AIRLABS_API_KEY=your_airlabs_api_key
OPENSKY_USERNAME=your_username
OPENSKY_PASSWORD=your_password
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to launch the dashboard. Enter your route (e.g., `KLAX / KSAN`), select your aircraft, and click **BRIEF**.

## 📝 Disclaimer

AeroBrief is an experimental, open-source tool. Automated summaries and AI recommendations are for situational awareness and demonstration purposes only. Final authority and responsibility for flight safety and dispatch reside solely with the Pilot in Command (PIC).
