import "server-only";
import { registerTester } from "../test";
import { parseDhlTracking, type DhlTrack } from "@/lib/pallets/shipments";

// DHL Sendungsverfolgung (developer.dhl.com → „Shipment Tracking – Unified“): eine Sendungsnummer je Abruf,
// gilt für DHL Paket, Express und Freight. Ohne Bestellung, nur der API-Key; Standard-Kontingent ist klein
// (rund 250 Abrufe am Tag) – deshalb fragt das System je Sendung höchstens alle paar Stunden nach.

// DHL_TRACKING_BASE_URL nur für Tests (nachgebildete Schnittstelle).
const BASE = process.env.DHL_TRACKING_BASE_URL || "https://api-eu.dhl.com/track/shipments";

export class DhlTrackError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Stand einer Sendung bei DHL – null, wenn DHL die Nummer (noch) nicht kennt. */
export async function trackDhl(apiKey: string, trackingNo: string): Promise<DhlTrack | null> {
  const url = `${BASE}?trackingNumber=${encodeURIComponent(trackingNo)}&language=de`;
  const res = await fetch(url, { headers: { "DHL-API-Key": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text) as { detail?: string; title?: string };
      detail = j.detail || j.title || "";
    } catch {
      detail = text.slice(0, 160);
    }
    const why = res.status === 401 || res.status === 403 ? "API-Key ungültig oder „Shipment Tracking – Unified“ nicht für die App freigeschaltet" : res.status === 429 ? "Abruf-Kontingent erschöpft – später erneut" : `HTTP ${res.status}`;
    throw new DhlTrackError(`DHL-Sendungsverfolgung: ${why}${detail ? ` (${detail.slice(0, 160)})` : ""}`, res.status);
  }
  try {
    return parseDhlTracking(JSON.parse(text));
  } catch {
    throw new DhlTrackError("DHL-Sendungsverfolgung: Antwort nicht lesbar.", 502);
  }
}

registerTester("dhl_tracking", async (v) => {
  if (!v?.apiKey) throw new Error("API-Key angeben.");
  // Eine erfundene Nummer: 404 heißt „Key gilt, Nummer unbekannt“ – also verbunden.
  await trackDhl(v.apiKey, "00340434161094000000");
  return "Verbunden. Sendungen mit DHL werden automatisch verfolgt (Ort, Liefertag, Zustellung).";
});
