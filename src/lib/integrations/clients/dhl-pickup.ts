import "server-only";
import { dhlAntwortLesen, dhlAuftrag, dhlFehlerText, dhlStornoLesen, type AbholEingabe, type AbholErgebnis } from "@/lib/abholung/logic";
import type { DhlCreds } from "./dhl";

// DHL Parcel DE Pickup API v1 (Abholung beauftragen, stornieren). Gleicher Zugang wie der Versand
// (Anbindungen → DHL Geschäftskunden): API-Key der App mit „Parcel DE Pickup“ und ein GKP-Benutzer mit Abholrecht.
// DHL_PICKUP_BASE_URL nur für Tests (nachgebildete Schnittstelle).

const base = (sandbox: boolean) =>
  process.env.DHL_PICKUP_BASE_URL || (sandbox ? "https://api-sandbox.dhl.com/parcel/de/transportation/pickup/v1" : "https://api-eu.dhl.com/parcel/de/transportation/pickup/v1");

const headers = (c: DhlCreds) => ({
  "dhl-api-key": c.apiKey,
  Authorization: `Basic ${Buffer.from(`${c.username}:${c.password}`).toString("base64")}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  "Accept-Language": "de-DE",
});

export type DhlAbholAntwort = { ok: true; ergebnis: AbholErgebnis; roh: unknown } | { ok: false; fehler: string; roh: unknown };

export async function dhlAbholungBuchen(creds: DhlCreds, sandbox: boolean, e: AbholEingabe): Promise<DhlAbholAntwort> {
  const res = await fetch(`${base(sandbox)}/orders`, { method: "POST", headers: headers(creds), body: JSON.stringify(dhlAuftrag(e)), signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, fehler: dhlFehlerText(res.status, j), roh: j };
  const ergebnis = dhlAntwortLesen(j);
  return ergebnis ? { ok: true, ergebnis, roh: j } : { ok: false, fehler: "DHL hat keine Auftragsnummer zurückgegeben.", roh: j };
}

export async function dhlAbholungStornieren(creds: DhlCreds, sandbox: boolean, orderId: string): Promise<{ ok: boolean; text: string }> {
  const url = new URL(`${base(sandbox)}/orders`);
  url.searchParams.set("orderID", orderId);
  const res = await fetch(url, { method: "DELETE", headers: headers(creds), signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, text: dhlFehlerText(res.status, j) };
  return dhlStornoLesen(j, orderId);
}
