export interface AircraftProfile {
  id: string;
  name: string;
  maxWindKt: number;
  maxCrosswindKt: number;
  ifrCapable: boolean;
  fikiCapable: boolean; // Flight Into Known Icing
  maxAltitude: number; // in feet
}

export const AIRCRAFT_PROFILES: Record<string, AircraftProfile> = {
  C172: {
    id: "C172",
    name: "Cessna 172 Skyhawk",
    maxWindKt: 20,
    maxCrosswindKt: 15,
    ifrCapable: false, // For this specific profile, assume VFR-only for strictness
    fikiCapable: false,
    maxAltitude: 13000,
  },
  SR22: {
    id: "SR22",
    name: "Cirrus SR22",
    maxWindKt: 35,
    maxCrosswindKt: 20,
    ifrCapable: true,
    fikiCapable: true,
    maxAltitude: 17500,
  },
  PC12: {
    id: "PC12",
    name: "Pilatus PC-12",
    maxWindKt: 45,
    maxCrosswindKt: 30,
    ifrCapable: true,
    fikiCapable: true,
    maxAltitude: 30000,
  },
  B738: {
    id: "B738",
    name: "Boeing 737-800",
    maxWindKt: 50,
    maxCrosswindKt: 33, // Typical dry runway crosswind limit
    ifrCapable: true,
    fikiCapable: true,
    maxAltitude: 41000,
  },
  B77W: {
    id: "B77W",
    name: "Boeing 777-300ER",
    maxWindKt: 65,
    maxCrosswindKt: 38,
    ifrCapable: true,
    fikiCapable: true,
    maxAltitude: 43100,
  },
  A320: {
    id: "A320",
    name: "Airbus A320",
    maxWindKt: 50,
    maxCrosswindKt: 38,
    ifrCapable: true,
    fikiCapable: true,
    maxAltitude: 39800,
  },
  A359: {
    id: "A359",
    name: "Airbus A350-900",
    maxWindKt: 65,
    maxCrosswindKt: 40,
    ifrCapable: true,
    fikiCapable: true,
    maxAltitude: 43100,
  },
};
