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

export type TeslaStatus = {
  name: string | null;
  online: boolean;
  ziel: string | null;
  minutenBisAnkunft: number | null;
  kmBisZiel: number | null;
  lat: number | null;
  lon: number | null;
  akku: number | null;
  reichweiteKm: number | null;
  innenTemp: number | null;
  klimaAn: boolean | null;
  verriegelt: boolean | null;
  fensterOffen: boolean | null;
  reifenWarnung: boolean | null;
  update: string | null;
};

const meilenKm = (m: number | undefined) => (typeof m === "number" ? Math.round(m * 1.609) : null);

/** Status bei Bedarf (Tesla berechnet je Abfrage – kein Dauer-Abruf): Ort, Navi, Akku/Reichweite, Klima, Verriegelung, Fenster, Reifen, Update. */
export async function teslaStatus(c: TeslaCfg): Promise<TeslaStatus> {
  const v = (await rufe(c, `${BASIS(c)}/api/1/vehicles/${encodeURIComponent(c.vin!)}/vehicle_data?endpoints=${encodeURIComponent("drive_state;location_data;charge_state;climate_state;vehicle_state")}`)) as {
    display_name?: string;
    state?: string;
    drive_state?: { active_route_destination?: string; active_route_minutes_to_arrival?: number; active_route_miles_to_arrival?: number; latitude?: number; longitude?: number };
    charge_state?: { battery_level?: number; battery_range?: number };
    climate_state?: { inside_temp?: number; is_climate_on?: boolean };
    vehicle_state?: { locked?: boolean; fd_window?: number; fp_window?: number; rd_window?: number; rp_window?: number; tpms_soft_warning_fl?: boolean; tpms_soft_warning_fr?: boolean; tpms_soft_warning_rl?: boolean; tpms_soft_warning_rr?: boolean; software_update?: { status?: string; version?: string } };
  };
  const d = v?.drive_state ?? {};
  const ch = v?.charge_state ?? {};
  const cl = v?.climate_state ?? {};
  const vs = v?.vehicle_state;
  const fenster = vs ? [vs.fd_window, vs.fp_window, vs.rd_window, vs.rp_window].filter((x) => typeof x === "number") : [];
  const reifen = vs ? [vs.tpms_soft_warning_fl, vs.tpms_soft_warning_fr, vs.tpms_soft_warning_rl, vs.tpms_soft_warning_rr].filter((x) => typeof x === "boolean") : [];
  const upd = vs?.software_update?.status;
  return {
    name: v?.display_name ?? null,
    online: v?.state === "online",
    ziel: d.active_route_destination ?? null,
    minutenBisAnkunft: d.active_route_minutes_to_arrival ?? null,
    kmBisZiel: meilenKm(d.active_route_miles_to_arrival),
    lat: d.latitude ?? null,
    lon: d.longitude ?? null,
    akku: typeof ch.battery_level === "number" ? ch.battery_level : null,
    reichweiteKm: meilenKm(ch.battery_range),
    innenTemp: typeof cl.inside_temp === "number" ? cl.inside_temp : null,
    klimaAn: typeof cl.is_climate_on === "boolean" ? cl.is_climate_on : null,
    verriegelt: typeof vs?.locked === "boolean" ? vs.locked : null,
    fensterOffen: fenster.length ? fenster.some((x) => (x as number) > 0) : null,
    reifenWarnung: reifen.length ? reifen.some(Boolean) : null,
    update: upd && upd !== "" ? `${upd}${vs?.software_update?.version ? ` (${vs.software_update.version})` : ""}` : null,
  };
}

/** Navigationsziel ans Auto (Adresse als Text, wie beim Teilen aus einer Karten-App). */
export async function teslaNavi(c: TeslaCfg, ziel: string): Promise<void> {
  await rufe(c, `${BEFEHL(c)}/api/1/vehicles/${encodeURIComponent(c.vin!)}/command/navigation_request`, { method: "POST", body: JSON.stringify({ type: "share_ext_content_raw", locale: "de-DE", timestamp_ms: String(Date.now()), value: { "android.intent.extra.TEXT": ziel.slice(0, 300) } }) });
}

/** Klima vorheizen – nur auf ausdrücklichen Wunsch (Knopf mit Bestätigung). */
export async function teslaKlima(c: TeslaCfg, temperatur?: number): Promise<void> {
  if (typeof temperatur === "number") await rufe(c, `${BEFEHL(c)}/api/1/vehicles/${encodeURIComponent(c.vin!)}/command/set_temps`, { method: "POST", body: JSON.stringify({ driver_temp: temperatur, passenger_temp: temperatur }) });
  await rufe(c, `${BEFEHL(c)}/api/1/vehicles/${encodeURIComponent(c.vin!)}/command/auto_conditioning_start`, { method: "POST", body: "{}" });
}

/** Klima aus – nur auf ausdrücklichen Wunsch. */
export async function teslaKlimaAus(c: TeslaCfg): Promise<void> {
  await rufe(c, `${BEFEHL(c)}/api/1/vehicles/${encodeURIComponent(c.vin!)}/command/auto_conditioning_stop`, { method: "POST", body: "{}" });
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
