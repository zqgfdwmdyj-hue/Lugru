import "server-only";
import { kendoFilter, lucidFailureMessage, type LucidProducer } from "./logic";

// Öffentliches Herstellerregister der Zentralen Stelle Verpackungsregister (LUCID).
// Gleiche Abfrage wie die Suchmaske im Browser: Seite laden (Formular-Token + Cookie),
// dann die Ergebnisliste und je Firma die Markenliste. Höflich: nacheinander, kurze Pause.
// Sperrt das Register den Server (Rechenzentrums-Adressen), gibt es den Weg übers
// Lesezeichen im eigenen Browser (lucid-bookmarklet.ts).

export const LUCID_ORIGIN = "https://oeffentliche-register.verpackungsregister.org";
const BASE = () => (process.env.LUCID_BASE_URL || LUCID_ORIGIN).replace(/\/$/, "");
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; Seller-System Bezugsquellensuche)", "Accept-Language": "de-DE,de;q=0.9,en;q=0.5" };
const PAUSE_MS = Number(process.env.LUCID_PAUSE_MS ?? 400);
const RETRIES = 3;

export type { LucidProducer };

/** Register nicht nutzbar – die Meldung sagt, warum, und nennt den Weg über den Browser. */
export class LucidUnavailableError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mit kurzen Wiederholungen bei Drosselung, Serverfehlern und Netzwerkaussetzern. */
async function lucidFetch(url: string, init: RequestInit): Promise<Response> {
  let status: number | null = null;
  let cause: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000) });
      if (res.status === 429 || res.status >= 500) {
        status = res.status;
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => "");
        console.error(`[Verpackungsregister] HTTP ${res.status} für ${new URL(url).pathname}: ${body.replace(/\s+/g, " ").slice(0, 200)}`);
        throw new LucidUnavailableError(lucidFailureMessage(res.status), res.status);
      }
      return res;
    } catch (e) {
      if (e instanceof LucidUnavailableError) throw e;
      status = null;
      cause = e;
    }
  }
  console.error(`[Verpackungsregister] ${new URL(url).pathname}: ${status !== null ? `HTTP ${status}` : String((cause as Error)?.message ?? cause)}`);
  throw new LucidUnavailableError(lucidFailureMessage(status, cause), status);
}

type Session = { cookie: string; token: string };

async function openSession(): Promise<Session> {
  const res = await lucidFetch(`${BASE()}/Producer`, { headers: { ...HEADERS, Accept: "text/html,application/xhtml+xml" } });
  if (!res.ok) throw new LucidUnavailableError(lucidFailureMessage(res.status), res.status);
  const html = await res.text();
  const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
  if (!token) {
    // Manche Schutzsysteme antworten mit 200 und einer Sperrseite.
    if (/request rejected|was rejected|access denied|zugriff verweigert|captcha/i.test(html)) throw new LucidUnavailableError(lucidFailureMessage(403), 403);
    throw new Error("Verpackungsregister: Suchformular nicht gefunden – die Seite hat sich vermutlich geändert.");
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, token };
}

async function grid<T>(s: Session, path: string, form: Record<string, string>): Promise<{ Data: T[]; Total: number }> {
  const res = await lucidFetch(`${BASE()}${path}`, {
    method: "POST",
    headers: { ...HEADERS, Cookie: s.cookie, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
    body: new URLSearchParams({ sort: "", group: "", filter: "", ...form, __RequestVerificationToken: s.token }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Verpackungsregister: Abfrage fehlgeschlagen (HTTP ${res.status}).`);
  try {
    const j = JSON.parse(text) as { Data?: T[]; Total?: number; Errors?: unknown };
    if (j.Errors) throw new Error("Verpackungsregister meldet einen Fehler bei der Abfrage.");
    return { Data: j.Data ?? [], Total: j.Total ?? 0 };
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error("Verpackungsregister: unerwartete Antwort (kein JSON).");
    throw e;
  }
}

/** Alle Hersteller, deren Eintrag die Marke (Teilwort) enthält – seitenweise, höchstens `max`. */
export async function searchProducers(q: { brand?: string; companyName?: string }, max = 600): Promise<{ producers: LucidProducer[]; total: number; session: Session }> {
  const s = await openSession();
  const filter = kendoFilter({ Brand: q.brand, CompanyName: q.companyName });
  if (!filter) throw new Error("Bitte eine Marke oder einen Firmennamen angeben.");
  const pageSize = 100;
  const out: LucidProducer[] = [];
  let total = 0;
  for (let page = 1; out.length < max; page++) {
    const r = await grid<LucidProducer>(s, "/Producer/ManufacturerRead", { page: String(page), pageSize: String(pageSize), filter });
    total = r.Total;
    out.push(...r.Data);
    if (r.Data.length < pageSize || out.length >= total) break;
    await sleep(PAUSE_MS);
  }
  return { producers: out.slice(0, max), total, session: s };
}

/**
 * Markennamen eines Herstellers. Große Händler melden hunderte Marken – `complete` sagt,
 * ob die Liste vollständig ist (sonst darf „Marke fehlt“ nicht zum Ausschluss führen).
 */
export async function brandsOf(s: Session, manufacturerId: string): Promise<{ brands: string[]; complete: boolean }> {
  const r = await grid<{ Name?: string; ValidUntil?: string | null }>(s, `/Producer/BrandRead?manufacturerId=${encodeURIComponent(manufacturerId)}`, { page: "1", pageSize: "2000" });
  return {
    brands: [...new Set(r.Data.filter((b) => !b.ValidUntil).map((b) => (b.Name ?? "").trim()).filter(Boolean))],
    complete: r.Data.length >= r.Total,
  };
}

export { openSession, sleep, PAUSE_MS };
export type { Session };
