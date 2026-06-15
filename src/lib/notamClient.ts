// notamClient.ts — Fetches NOTAMs from the official FAA NOTAM Search API

export interface Notam {
  id: string;
  type: string;
  issueDate: string;
  startDate: string;
  endDate: string;
  message: string;
}

export async function getNotamsForAirport(icao: string): Promise<Notam[]> {
  try {
    const params = new URLSearchParams();
    params.append("searchType", "0");
    params.append("designatorsForLocation", icao);

    const res = await fetch("https://notams.aim.faa.gov/notamSearch/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0", // FAA blocks empty/default user agents
      },
      body: params.toString(),
      // The FAA NOTAM API is sometimes slow; we don't want to block the whole briefing forever
      signal: AbortSignal.timeout(10000), 
    });

    if (!res.ok) {
      console.warn(`[notamClient] Failed to fetch NOTAMs for ${icao}: ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (!data.notamList || !Array.isArray(data.notamList)) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.notamList.map((n: any) => ({
      id: n.notamNumber || "UNKNOWN",
      type: n.sourceType || "NOTAM",
      issueDate: n.issueDate || "",
      startDate: n.startDate || "",
      endDate: n.endDate || "",
      message: n.traditionalMessageFrom4thWord || n.traditionalMessage || n.plainLanguageMessage || "No message available",
    }));
  } catch (err) {
    console.warn(`[notamClient] Error fetching NOTAMs for ${icao}:`, err);
    return [];
  }
}
