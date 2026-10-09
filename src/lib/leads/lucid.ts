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
/** Pause zwischen zwei Abfragen. Das Register drosselt (HTTP 503) nach vielen schnellen Abfragen. */
const PAUSE_MS = Number(process.env.LUCID_PAUSE_MS ?? 3000);
/** Grundwert für das Warten nach einer Drosselung (in Tests kürzer). */
const BACKOFF_MS = Number(process.env.LUCID_BACKOFF_MS ?? 5000);

export type { LucidProducer };

/** Register nicht nutzbar – die Meldung sagt, warum, und nennt den Weg über den Browser. */
export class LucidUnavailableError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

/** Das Register drosselt (HTTP 429/503) – später erneut versuchen, nicht weiter nachfragen. */
export class LucidThrottledError extends LucidUnavailableError {}

/** Formular-Token abgelaufen – neue Sitzung öffnen. */
export class LucidSessionError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry-After in Millisekunden (Sekunden oder Datum), höchstens eine Minute. */
const retryAfterMs = (res: Response) => {
  const v = res.headers.get("retry-after");
  if (!v) return 0;
  const n = /^\d+$/.test(v.trim()) ? Number(v) * 1000 : Date.parse(v) - Date.now();
  return Number.isFinite(n) ? Math.min(60_000, Math.max(0, n)) : 0;
};

/**
 * Abfrage mit Wiederholungen bei Drosselung, Serverfehlern und Netzwerkaussetzern.
 * `patient`: Hintergrund-Läufe warten länger (5 s, 20 s) – ein Klick soll nicht minutenlang hängen.
 */
async function lucidFetch(url: string, init: RequestInit, patient = false): Promise<Response> {
  let status: number | null = null;
  let cause: unknown;
  let wait = 0;
  const waits = patient ? [BACKOFF_MS, BACKOFF_MS * 4] : [Math.round(BACKOFF_MS / 2.5)];
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    if (attempt) await sleep(Math.max(wait, waits[attempt - 1]));
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000) });
      if (res.status === 429 || res.status >= 500) {
        status = res.status;
        wait = retryAfterMs(res);
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
  if (status === 429 || status === 503) throw new LucidThrottledError(lucidFailureMessage(status), status);
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

async function grid<T>(s: Session, path: string, form: Record<string, string>, patient = false): Promise<{ Data: T[]; Total: number }> {
  const res = await lucidFetch(`${BASE()}${path}`, {
    method: "POST",
    headers: { ...HEADERS, Cookie: s.cookie, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
    body: new URLSearchParams({ sort: "", group: "", filter: "", ...form, __RequestVerificationToken: s.token }),
  }, patient);
  const text = await res.text();
  // Abgelaufenes Formular-Token/Cookie: ASP.NET antwortet mit 400.
  if (res.status === 400) throw new LucidSessionError("Sitzung beim Verpackungsregister abgelaufen.");
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
  const r = await grid<{ Name?: string; ValidUntil?: string | null }>(s, `/Producer/BrandRead?manufacturerId=${encodeURIComponent(manufacturerId)}`, { page: "1", pageSize: "2000" }, true);
  return {
    brands: [...new Set(r.Data.filter((b) => !b.ValidUntil).map((b) => (b.Name ?? "").trim()).filter(Boolean))],
    complete: r.Data.length >= r.Total,
  };
}

export { openSession, sleep, PAUSE_MS };
export type { Session };
