import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { registerTester } from "../test";

// SMS über Twilio (EU-Region möglich): nur an Ludwigs eigene Nummer (Einstellungen → Handy & Tesla). Antworten kommen
// per Webhook (/api/sms/antwort) und werden mit der Twilio-Signatur geprüft. TWILIO_BASE_URL → Testdienste.

export type SmsCfg = { accountSid?: string; authToken?: string; absender?: string };

const BASIS = () => (process.env.TWILIO_BASE_URL || "https://api.twilio.com").replace(/\/$/, "");

export async function smsSenden(c: SmsCfg, an: string, text: string): Promise<string> {
  if (!c.accountSid || !c.authToken || !c.absender) throw new Error("SMS nicht eingerichtet.");
  const r = await fetch(`${BASIS()}/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: an, From: c.absender, Body: text.slice(0, 320) }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!r.ok) throw new Error(`SMS ${r.status}: ${j.message ?? "Fehler"}`.slice(0, 200));
  return j.sid ?? "";
}

/** Twilio-Signatur: Base64(HMAC-SHA1(authToken, URL + sortierte Parameter)). */
export function twilioSignaturOk(authToken: string, url: string, params: Record<string, string>, signatur: string | null): boolean {
  if (!signatur) return false;
  const daten = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const soll = createHmac("sha1", authToken).update(daten, "utf8").digest("base64");
  const a = Buffer.from(soll);
  const b = Buffer.from(signatur);
  return a.length === b.length && timingSafeEqual(a, b);
}

registerTester("twilio", async (v) => {
  const c = v as SmsCfg;
  const r = await fetch(`${BASIS()}/2010-04-01/Accounts/${encodeURIComponent(c.accountSid ?? "")}.json`, { headers: { Authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Twilio ${r.status}`);
  return `Verbunden: Konto ${((await r.json()) as { friendly_name?: string }).friendly_name ?? "ok"}.`;
});
