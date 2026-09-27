import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Signierter OAuth-„state“: schützt den Rückruf vor Fälschung und trägt Mandant/Benutzer.

type State = { t: string; u: string; p: string; exp: number; n: string };

function key() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET fehlt oder ist zu kurz.");
  return createHmac("sha256", s).update("oauth-state").digest();
}

export function signState(tenantId: string, userId: string, provider: string): string {
  const payload: State = { t: tenantId, u: userId, p: provider, exp: Date.now() + 15 * 60_000, n: randomBytes(8).toString("hex") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(value: string | null): State | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", key()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const s = JSON.parse(Buffer.from(body, "base64url").toString()) as State;
  return s.exp > Date.now() ? s : null;
}

/** Öffentliche Adresse der App (für Weiterleitungs-URIs). */
export function appUrl(request?: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (request) {
    const h = request.headers;
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}
