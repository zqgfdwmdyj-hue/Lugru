import "server-only";
import { registerTester } from "../test";

// B35 Stufe 2: Lead-Quellen per API – Apify (Läufe mit Kostenobergrenze) und Google Places (Text-Suche).
// Läuft nie über ein Verkäuferkonto, keine Anmeldung bei Marktplätzen, kein Auslesen von Suchergebnisseiten.
// Zugangsdaten verschlüsselt unter Anbindungen. Im Testbetrieb gegen den Nachbau (APIFY_BASE_URL, GOOGLE_PLACES_BASE_URL).

const APIFY = () => (process.env.APIFY_BASE_URL || "https://api.apify.com").replace(/\/$/, "");
const PLACES = () => (process.env.GOOGLE_PLACES_BASE_URL || "https://places.googleapis.com").replace(/\/$/, "");

async function json<T>(res: Response, wo: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${wo}: HTTP ${res.status}${text ? ` – ${text.slice(0, 200)}` : ""}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${wo}: keine gültige Antwort`);
  }
}

// ---- Apify -------------------------------------------------------------------------------------------------------

export type ApifyLauf = { id: string; status: string; datasetId: string | null; usd: number };
type ApifyRun = { data: { id: string; status: string; defaultDatasetId?: string; usageTotalUsd?: number } };

const lauf = (r: ApifyRun): ApifyLauf => ({ id: r.data.id, status: r.data.status, datasetId: r.data.defaultDatasetId ?? null, usd: Number(r.data.usageTotalUsd ?? 0) });

/** Lauf starten – mit Kostenobergrenze (maxTotalChargeUsd) und höchstens maxItems Ergebnissen. */
export async function apifyStarten(token: string, actorId: string, eingabe: unknown, o: { maxItems: number; maxUsd: number }): Promise<ApifyLauf> {
  const id = encodeURIComponent(actorId.trim().replace("/", "~"));
  const u = `${APIFY()}/v2/acts/${id}/runs?maxItems=${Math.max(1, Math.round(o.maxItems))}&maxTotalChargeUsd=${o.maxUsd.toFixed(2)}`;
  return lauf(await json<ApifyRun>(await fetch(u, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(eingabe ?? {}), signal: AbortSignal.timeout(30_000) }), "Apify-Start"));
}

export async function apifyStatus(token: string, runId: string): Promise<ApifyLauf> {
  return lauf(await json<ApifyRun>(await fetch(`${APIFY()}/v2/actor-runs/${encodeURIComponent(runId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }), "Apify-Status"));
}

export async function apifyAbbrechen(token: string, runId: string): Promise<void> {
  await fetch(`${APIFY()}/v2/actor-runs/${encodeURIComponent(runId)}/abort`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
}

export async function apifyErgebnisse(token: string, datasetId: string, limit: number): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${APIFY()}/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${Math.max(1, Math.round(limit))}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  const d = await json<unknown>(r, "Apify-Ergebnisse");
  return Array.isArray(d) ? (d as Record<string, unknown>[]) : [];
}

/** Verschachtelte Apify-Datensätze in Tabellenspalten („location/lat“, „emails/0“) – passt zum vorhandenen CSV-Import. */
export function flachTabelle(items: Record<string, unknown>[]): { headers: string[]; rows: string[][] } {
  const flach = items.map((it) => {
    const out: Record<string, string> = {};
    const lauf = (v: unknown, pfad: string, tiefe: number) => {
      if (v === null || v === undefined) return;
      if (Array.isArray(v)) v.slice(0, 5).forEach((x, i) => lauf(x, `${pfad}/${i}`, tiefe + 1));
      else if (typeof v === "object" && tiefe < 3) for (const [k, x] of Object.entries(v as Record<string, unknown>)) lauf(x, pfad ? `${pfad}/${k}` : k, tiefe + 1);
      else if (typeof v !== "object") out[pfad] = String(v);
    };
    lauf(it, "", 0);
    return out;
  });
  const headers = [...new Set(flach.flatMap((f) => Object.keys(f)))];
  return { headers, rows: flach.map((f) => headers.map((h) => f[h] ?? "")) };
}

registerTester("apify", async (v) => {
  if (!v.token) throw new Error("API-Token fehlt.");
  const d = await json<{ data?: { username?: string } }>(await fetch(`${APIFY()}/v2/users/me`, { headers: { Authorization: `Bearer ${v.token}` }, signal: AbortSignal.timeout(20_000) }), "Apify");
  return `Verbunden als ${d.data?.username ?? "?"} – Läufe nur nach rechtlicher Prüfung und mit Budget (Leads → Quellen).`;
});

// ---- Google Places (Text-Suche) -----------------------------------------------------------------------------------

export type PlaceTreffer = { id: string; name: string; strasse: string | null; plz: string | null; ort: string | null; land: string | null; lat: number | null; lng: number | null; website: string | null; kategorie: string | null };
type PlacesAntwort = {
  places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; addressComponents?: { longText?: string; shortText?: string; types?: string[] }[]; location?: { latitude?: number; longitude?: number }; websiteUri?: string; primaryTypeDisplayName?: { text?: string }; types?: string[] }[];
  nextPageToken?: string;
};
const FELDER = "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.websiteUri,places.primaryTypeDisplayName,places.types,nextPageToken";

/** Eine Seite der Text-Suche (ein kostenpflichtiger Abruf). */
export async function placesSuche(apiKey: string, o: { text: string; lat?: number | null; lng?: number | null; radiusM?: number | null; pageToken?: string | null }): Promise<{ treffer: PlaceTreffer[]; next: string | null }> {
  const body: Record<string, unknown> = { textQuery: o.text, languageCode: "de", regionCode: "DE", pageSize: 20 };
  if (o.pageToken) body.pageToken = o.pageToken;
  if (o.lat != null && o.lng != null && o.radiusM) body.locationBias = { circle: { center: { latitude: o.lat, longitude: o.lng }, radius: Math.min(50_000, Math.max(100, o.radiusM)) } };
  const d = await json<PlacesAntwort>(await fetch(`${PLACES()}/v1/places:searchText`, { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FELDER }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) }), "Google Places");
  const treffer = (d.places ?? []).map((p) => {
    const teil = (typ: string, kurz = false) => p.addressComponents?.find((c) => c.types?.includes(typ))?.[kurz ? "shortText" : "longText"] ?? null;
    const route = teil("route");
    const nr = teil("street_number");
    return {
      id: p.id ?? "",
      name: p.displayName?.text ?? "",
      strasse: route ? `${route}${nr ? ` ${nr}` : ""}` : null,
      plz: teil("postal_code"),
      ort: teil("locality") ?? teil("postal_town"),
      land: teil("country", true),
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      website: p.websiteUri ?? null,
      kategorie: p.primaryTypeDisplayName?.text ?? p.types?.[0] ?? null,
    };
  });
  return { treffer: treffer.filter((t) => t.name), next: d.nextPageToken ?? null };
}

registerTester("google_places", async (v) => {
  if (!v.apiKey) throw new Error("API-Schlüssel fehlt.");
  // Jeder Abruf kostet – der Test prüft nur, ob ein Schlüssel hinterlegt ist.
  return "Schlüssel hinterlegt – kein Testabruf (jeder Abruf kostet). Läufe nur nach rechtlicher Prüfung und mit Budget (Leads → Quellen).";
});
