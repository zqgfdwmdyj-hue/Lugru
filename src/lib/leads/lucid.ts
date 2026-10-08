import "server-only";
import { kendoFilter } from "./logic";

// Öffentliches Herstellerregister der Zentralen Stelle Verpackungsregister (LUCID).
// Gleiche Abfrage wie die Suchmaske im Browser: Seite laden (Formular-Token + Cookie),
// dann die Ergebnisliste und je Firma die Markenliste. Höflich: nacheinander, kurze Pause.

const BASE = () => (process.env.LUCID_BASE_URL || "https://oeffentliche-register.verpackungsregister.org").replace(/\/$/, "");
const UA = "Seller-System (Bezugsquellensuche)";
const PAUSE_MS = Number(process.env.LUCID_PAUSE_MS ?? 400);

export type LucidProducer = {
  ManufacturerId: string;
  CompanyName: string;
  RegisterNumber?: string | null;
  Street?: string | null;
  StreetNumber?: string | null;
  ZipCode?: string | null;
  Location?: string | null;
  Country?: string | null;
  TelephoneNumber?: string | null;
  RegisterDate?: string | null;
  RegistrationEndDate?: string | null;
  IsForeignProducer?: boolean;
};

type Session = { cookie: string; token: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openSession(): Promise<Session> {
  const res = await fetch(`${BASE()}/Producer`, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Verpackungsregister nicht erreichbar (HTTP ${res.status}).`);
  const html = await res.text();
  const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
  if (!token) throw new Error("Verpackungsregister: Suchformular nicht gefunden – die Seite hat sich vermutlich geändert.");
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, token };
}

async function grid<T>(s: Session, path: string, form: Record<string, string>): Promise<{ Data: T[]; Total: number }> {
  const res = await fetch(`${BASE()}${path}`, {
    method: "POST",
    headers: { "User-Agent": UA, Cookie: s.cookie, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
    body: new URLSearchParams({ sort: "", group: "", filter: "", ...form, __RequestVerificationToken: s.token }),
    signal: AbortSignal.timeout(30_000),
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
