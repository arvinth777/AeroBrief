// Demo Mode fixture data — matches the full API response shape.
// Used when DEMO_MODE=true or all AWC fetchers fail.

export const demoData = {
  briefing: {
    airports: {
      KLAX: {
        icao: "KLAX",
        name: "Los Angeles Intl, CA, US",
        coordinates: [-118.4085, 33.9425],
        metar: {
          raw: "KLAX 141953Z 25012KT 10SM FEW015 18/12 A2992 RMK A02 SLP131",
          flightCategory: "VFR",
          wind: { degrees: 250, speed: 12, gust: null },
          visibility: 10,
          ceiling: null,
          temp: 18,
          dewpoint: 12,
          altimeter: 29.92,
        },
        parsedTaf: {
          raw: "TAF KLAX 141120Z 1412/1512 25010KT P6SM FEW015 TEMPO 1414/1418 BKN012",
          blocks: [
            {
              period: "1412/1512",
              from: "2026-06-14T12:00:00Z",
              to: "2026-06-15T12:00:00Z",
              flightCategory: "VFR",
              wind: "25010KT",
              visibility: "P6SM",
              clouds: "FEW015",
            },
            {
              period: "TEMPO 1414/1418",
              from: "2026-06-14T14:00:00Z",
              to: "2026-06-14T18:00:00Z",
              flightCategory: "MVFR",
              wind: "25010KT",
              visibility: "P6SM",
              clouds: "BKN012",
            },
          ],
        },
      },
      KSAN: {
        icao: "KSAN",
        name: "San Diego Intl Arpt, CA, US",
        coordinates: [-117.1897, 32.7336],
        metar: {
          raw: "KSAN 142001Z 23009KT 5SM BR SCT008 17/14 A2994",
          flightCategory: "MVFR",
          wind: { degrees: 230, speed: 9, gust: null },
          visibility: 5,
          ceiling: 800,
          temp: 17,
          dewpoint: 14,
          altimeter: 29.94,
        },
        parsedTaf: {
          raw: "TAF KSAN 141120Z 1412/1512 23010KT 3SM BR OVC008 BECMG 1418/1420 P6SM SKC",
          blocks: [
            {
              period: "1412/1418",
              from: "2026-06-14T12:00:00Z",
              to: "2026-06-14T18:00:00Z",
              flightCategory: "MVFR",
              wind: "23010KT",
              visibility: "3SM BR",
              clouds: "OVC008",
            },
            {
              period: "BECMG 1418/1420",
              from: "2026-06-14T18:00:00Z",
              to: "2026-06-14T20:00:00Z",
              flightCategory: "VFR",
              wind: "23010KT",
              visibility: "P6SM",
              clouds: "SKC",
            },
          ],
        },
      },
      KPHX: {
        icao: "KPHX",
        name: "Phoenix/Sky Harbor Intl, AZ, US",
        coordinates: [-112.008, 33.4342],
        metar: {
          raw: "KPHX 141951Z 13003KT 10SM FEW090 FEW250 34/13 A2986 RMK A02 SLP088 CB DSNT S T03390133",
          flightCategory: "VFR",
          wind: { degrees: 130, speed: 3, gust: null },
          visibility: 10,
          ceiling: null,
          temp: 34,
          dewpoint: 13,
          altimeter: 29.86,
        },
        parsedTaf: {
          raw: "TAF KPHX 141120Z 1412/1512 VRB03KT P6SM FEW100 SCT250",
          blocks: [
            {
              period: "1412/1512",
              from: "2026-06-14T12:00:00Z",
              to: "2026-06-15T12:00:00Z",
              flightCategory: "VFR",
              wind: "VRB03KT",
              visibility: "P6SM",
              clouds: "FEW100 SCT250",
            },
          ],
        },
      },
    },
    hazards: [],
    pireps: [],
    meta: {
      generatedAt: new Date().toISOString(),
      partialFailures: [],
      demoMode: true,
    },
  },
  ai: {
    summary:
      "A marine layer is producing MVFR conditions at KSAN with ceilings near 800 feet and reduced visibility in mist. KLAX is VFR but a temporary MVFR period is forecast through 1800Z with broken ceilings at 1,200 feet. KPHX is clear and VFR with no significant convective activity, though a convective SIGMET is noted to the south.",
    altitudeRisks: [
      { altitude: "FL040 — FL080", risk: "Smooth" },
      { altitude: "FL100 — FL140", risk: "Light Chop" },
      { altitude: "FL180+", risk: "Not Sampled" },
    ],
    recommendation: "MARGINAL",
    recommendationReason:
      "Marine layer IFR/MVFR at KSAN warrants caution for coastal departures before 1800Z.",
  },
};
