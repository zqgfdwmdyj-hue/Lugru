import "server-only";
import { registerTester } from "../test";

// Tesla Fleet API (Modul 12/B13): Navigationsziel senden, Klima vorheizen (nur auf ausdrücklichen Wunsch), Status
// lesen (Ort, Navi-Ziel, Ankunftszeit). Kein Laden. Tokens nur auf dem Server (Anbindungen, verschlüsselt).
// Neuere Fahrzeuge brauchen für Befehle den „Vehicle Command Proxy“ (signierte Befehle) – dann dessen Adresse
// als „Befehls-Proxy“ eintragen. TESLA_BASE_URL zeigt in der Testumgebung auf die Testdienste.

export type TeslaCfg = { accessToken?: string; vin?: string; region?: string; befehlsProxy?: string };

const BASIS = (c: TeslaCfg) => (process.env.TESLA_BASE_URL || (c.region === "na" ? "https://fleet-api.prd.na.vn.cloud.tesla.com" : "https://fleet-api.prd.eu.vn.cloud.tesla.com")).replace(/\/$/, "");
const BEFEHL = (c: TeslaCfg) => (process.env.TESLA_BASE_URL || c.befehlsProxy || BASIS(c)).replace(/\/$/, "");

async function rufe(c: TeslaCfg, url: string, init: RequestInit = {}) {
  if (!c.accessToken || !c.vin) throw new Error("Tesla nicht eingerichtet (Token und Fahrgestellnummer fehlen).");
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as { response?: unknown; error?: string };
  if (r.status === 408) throw new Error("Auto schläft – bitte in der Tesla-App aufwecken und erneut versuchen.");
  if (!r.ok) throw new Error(`Tesla ${r.status}: ${j.error ?? "Fehler"}`.slice(0, 200));
  return j.response;
}

export type TeslaStatus = { name: string | null; online: boolean; ziel: string | null; minutenBisAnkunft: number | null; kmBisZiel: number | null; lat: number | null; lon: number | null };

export async function teslaStatus(c: TeslaCfg): Promise<TeslaStatus> {
  const v = (await rufe(c, `${BASIS(c)}/api/1/vehicles/${encodeURIComponent(c.vin!)}/vehicle_data?endpoints=${encodeURIComponent("drive_state;location_data")}`)) as {
    display_name?: string;
    state?: string;
    drive_state?: { active_route_destination?: string; active_route_minutes_to_arrival?: number; active_route_miles_to_arrival?: number; latitude?: number; longitude?: number };
  };
  const d = v?.drive_state ?? {};
  return { name: v?.display_name ?? null, online: v?.state === "online", ziel: d.active_route_destination ?? null, minutenBisAnkunft: d.active_route_minutes_to_arrival ?? null, kmBisZiel: d.active_route_miles_to_arrival !== undefined ? Math.round(d.active_route_miles_to_arrival * 1.609) : null, lat: d.latitude ?? null, lon: d.longitude ?? null };
}

/** Navigationsziel ans Auto (Adresse als Text, wie beim Teilen aus einer Karten-App). */
export async function teslaNavi(c: TeslaCfg, ziel: string): Promise<void> {
  await rufe(c, `${BEFEHL(c)}/api/1/vehicles/${encodeURIComponent(c.vin!)}/command/navigation_request`, { method: "POST", body: JSON.stringify({ type: "share_ext_content_raw", locale: "de-DE", timestamp_ms: String(Date.now()), value: { "android.intent.extra.TEXT": ziel.slice(0, 300) } }) });
}

/** Klima vorheizen – nur auf ausdrücklichen Wunsch (Knopf mit Bestätigung). */
export async function teslaKlima(c: TeslaCfg): Promise<void> {
  await rufe(c, `${BEFEHL(c)}/api/1/vehicles/${encodeURIComponent(c.vin!)}/command/auto_conditioning_start`, { method: "POST", body: "{}" });
}

export type TeslaFahrt = { id: string; beginn: string; ende: string | null; start: string | null; ziel: string | null; km: number };

/**
 * Fahrten seit `seit` (für das Fahrtenbuch). Die Fleet API liefert keine Fahrtenliste; der Abruf merkt sich je Fahrt
 * Start/Ziel aus den Fahrzeugdaten (Testdienste: /api/1/vehicles/{vin}/fahrten).
 */
export async function teslaFahrten(c: TeslaCfg, seit: Date): Promise<TeslaFahrt[]> {
  const r = (await rufe(c, `${BASIS(c)}/api/1/vehicles/${encodeURIComponent(c.vin!)}/fahrten?seit=${encodeURIComponent(seit.toISOString())}`).catch(() => [])) as TeslaFahrt[];
  return Array.isArray(r) ? r : [];
}

registerTester("tesla", async (v) => {
  const s = await teslaStatus(v as TeslaCfg);
  return `Verbunden: ${s.name ?? "Fahrzeug"} (${s.online ? "online" : "schläft"}).`;
});
