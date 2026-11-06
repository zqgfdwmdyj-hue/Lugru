import "server-only";
import { upsAntwortLesen, upsAuftrag, upsFehlerText, type AbholEingabe, type AbholErgebnis } from "@/lib/abholung/logic";
import { registerTester } from "../test";

// UPS Pickup API v2409 mit OAuth (Client Credentials). Zugang unter Anbindungen → UPS (App im UPS Developer Portal
// mit „Pickup“ und „OAuth“). UPS_API_BASE_URL nur für Tests (nachgebildete Schnittstelle).

export type UpsCreds = { clientId: string; clientSecret: string; kontonummer: string; umgebung?: string };

export const upsCreds = (v: Record<string, string> | null): UpsCreds | null =>
  v?.clientId && v.clientSecret ? { clientId: v.clientId, clientSecret: v.clientSecret, kontonummer: (v.kontonummer ?? "").trim(), umgebung: v.umgebung } : null;

const base = (c: Pick<UpsCreds, "umgebung">) => process.env.UPS_API_BASE_URL || (c.umgebung === "test" ? "https://wwwcie.ups.com" : "https://onlinetools.ups.com");

// Token bis kurz vor Ablauf wiederverwenden (je Client-ID).
const tokens = new Map<string, { token: string; bis: number }>();

async function token(c: UpsCreds): Promise<string> {
  const key = `${base(c)}|${c.clientId}`;
  const t = tokens.get(key);
  if (t && t.bis > Date.now()) return t.token;
  const res = await fetch(`${base(c)}/security/v1/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", ...(c.kontonummer ? { "x-merchant-id": c.kontonummer } : {}) },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: string | number } | null;
  if (!res.ok || !j?.access_token) throw new Error(upsFehlerText(res.status === 400 ? 401 : res.status, j));
  tokens.set(key, { token: j.access_token, bis: Date.now() + Math.max(60, Number(j.expires_in ?? 3600) - 120) * 1000 });
  return j.access_token;
}

const kopf = (tk: string) => ({ Authorization: `Bearer ${tk}`, "Content-Type": "application/json", Accept: "application/json", transId: crypto.randomUUID().replace(/-/g, "").slice(0, 32), transactionSrc: "seller-system" });

export type UpsAbholAntwort = { ok: true; ergebnis: AbholErgebnis; roh: unknown } | { ok: false; fehler: string; roh: unknown };

export async function upsAbholungBuchen(c: UpsCreds, e: AbholEingabe): Promise<UpsAbholAntwort> {
  let tk: string;
  try {
    tk = await token(c);
  } catch (err) {
    return { ok: false, fehler: err instanceof Error ? err.message : String(err), roh: null };
  }
  const res = await fetch(`${base(c)}/api/pickupcreation/v2409/pickup`, { method: "POST", headers: kopf(tk), body: JSON.stringify(upsAuftrag(e, c.kontonummer)), signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, fehler: upsFehlerText(res.status, j), roh: j };
  const ergebnis = upsAntwortLesen(j);
  return ergebnis ? { ok: true, ergebnis, roh: j } : { ok: false, fehler: "UPS hat keine Abholnummer (PRN) zurückgegeben.", roh: j };
}

/** Storno per PRN (CancelBy 02). */
export async function upsAbholungStornieren(c: UpsCreds, prn: string): Promise<{ ok: boolean; text: string }> {
  let tk: string;
  try {
    tk = await token(c);
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
  const res = await fetch(`${base(c)}/api/shipments/v2409/pickup/02`, { method: "DELETE", headers: { ...kopf(tk), Prn: prn }, signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, text: upsFehlerText(res.status, j) };
  const code = (j as { PickupCancelResponse?: { Response?: { ResponseStatus?: { Code?: string } } } })?.PickupCancelResponse?.Response?.ResponseStatus?.Code;
  return code === "1" || code === undefined ? { ok: true, text: "UPS hat die Abholung storniert." } : { ok: false, text: "UPS hat die Stornierung nicht bestätigt." };
}

registerTester("ups", async (v) => {
  const c = upsCreds(v);
  if (!c) throw new Error("Client-ID und Client-Secret eintragen.");
  await token(c);
  return `Zugang von UPS akzeptiert (${c.umgebung === "test" ? "Testumgebung" : "Produktion"}).${c.kontonummer ? "" : " Kontonummer fehlt noch – ohne sie geht keine Abholung."}`;
});
