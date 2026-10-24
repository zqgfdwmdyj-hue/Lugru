import "server-only";
import { and, count, eq, gte, inArray, lt, lte, max, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { REPORT_KINDS, type ReportKind } from "@/lib/reports/amazon";
import { freshness, type Freshness } from "./logic";

// Tagesübersicht: dringende operative Themen direkt aus den Daten (nicht aus Aufgaben) und der
// Datenstand je Bereich (letzter Bericht, letzter erfolgreicher Abruf).

/** Mitternacht (Beginn des Tages) in Berlin als Zeitpunkt – Sommer- und Winterzeit berücksichtigt. */
export function berlinMidnight(iso: string): Date {
  const guess = new Date(`${iso}T00:00:00Z`);
  const local = Date.parse(guess.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  const utc = Date.parse(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local - utc));
}

export type Signal = { key: string; label: string; detail?: string; count: number; href: string; level: "danger" | "warn" };

export async function todaySignals(tenantId: string, today: string): Promise<Signal[]> {
  const O = schema.orders;
  const C = schema.claims;
  const K = schema.cases;
  const endOfToday = berlinMidnight(addDaysIso(today, 1));
  const [[ship], [shipTomorrow], [neg], [claims], [expired], [cases]] = await Promise.all([
    db.select({ n: count() }).from(O).where(and(eq(O.tenantId, tenantId), eq(O.fulfillment, "FBM"), inArray(O.status, ["open", "label_created"]), lt(O.shipBy, endOfToday))),
    db.select({ n: count() }).from(O).where(and(eq(O.tenantId, tenantId), eq(O.fulfillment, "FBM"), inArray(O.status, ["open", "label_created"]), gte(O.shipBy, endOfToday), lt(O.shipBy, new Date(endOfToday.getTime() + 86_400_000)))),
    db.select({ n: count(), units: sql<number>`coalesce(sum(${schema.ownStock.quantity}), 0)::int` }).from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, tenantId), lt(schema.ownStock.quantity, 0))),
    db
      .select({ n: count(), sum: sql<number>`coalesce(sum(${C.expectedAmount}), 0)::float` })
      .from(C)
      .where(and(eq(C.tenantId, tenantId), inArray(C.status, ["detected", "queued", "submitted"]), gte(C.deadline, today), lte(C.deadline, addDaysIso(today, 7)))),
    db.select({ n: count() }).from(C).where(and(eq(C.tenantId, tenantId), inArray(C.status, ["detected", "queued"]), lt(C.deadline, today))),
    db.select({ n: count() }).from(K).where(and(eq(K.tenantId, tenantId), inArray(K.status, ["open", "waiting"]), lte(K.deadline, addDaysIso(today, 2)))),
  ]);
  const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  const out: Signal[] = [];
  if (ship.n) out.push({ key: "versand", label: `${ship.n} ${ship.n === 1 ? "Auftrag" : "Aufträge"} heute bzw. überfällig versenden`, count: ship.n, href: "/auftraege?ansicht=offen", level: "danger" });
  if (cases.n) out.push({ key: "faelle", label: `${cases.n} ${cases.n === 1 ? "Fall" : "Fälle"} mit Frist bis übermorgen`, detail: "A-bis-Z, eBay-Fälle", count: cases.n, href: "/faelle", level: "danger" });
  if (neg.n) out.push({ key: "negativ", label: `${neg.n} SKU${neg.n === 1 ? "" : "s"} mit negativem Bestand`, detail: `${neg.units} Stück – überverkauft oder falsch gebucht`, count: neg.n, href: "/bestand?ansicht=negativ", level: "danger" });
  if (claims.n) out.push({ key: "ansprueche", label: `${claims.n} Anspr${claims.n === 1 ? "uch läuft" : "üche laufen"} in 7 Tagen ab`, detail: `zusammen ${euro(claims.sum)}`, count: claims.n, href: "/ansprueche?ansicht=fristen", level: "warn" });
  if (shipTomorrow.n) out.push({ key: "versand-morgen", label: `${shipTomorrow.n} ${shipTomorrow.n === 1 ? "Auftrag" : "Aufträge"} morgen versenden`, count: shipTomorrow.n, href: "/auftraege?ansicht=offen", level: "warn" });
  if (expired.n) out.push({ key: "abgelaufen", label: `${expired.n} Anspr${expired.n === 1 ? "uch" : "üche"} mit abgelaufener Frist, nicht eingereicht`, count: expired.n, href: "/ansprueche?ansicht=fristen", level: "warn" });
  return out;
}

/** Wie alt darf ein Amazon-Bericht sein, bevor er als veraltet gilt (Tage)? Kern-Berichte fehlen sichtbar. */
const REPORT_AGE: Partial<Record<ReportKind, number>> = { inventory: 2, orders: 3, ledger: 7, reimbursements: 7, customerReturns: 7, removalOrders: 14, settlement: 16 };
const REPORT_CORE: ReportKind[] = ["inventory", "settlement", "ledger", "reimbursements", "customerReturns"];
/** Hintergrund-Abrufe, die im Datenstand erscheinen (Name wie im Scheduler) – je 1 Tag. */
const JOB_AREAS: [string, string, string][] = [
  ["Amazon-Bestellungen", "Amazon-Bestellungen (Abruf)", "/auftraege"],
  ["eBay-Bestellungen", "eBay-Bestellungen (Abruf)", "/auftraege?kanal=ebay"],
  ["Temu-Bestellungen", "Temu-Bestellungen (Abruf)", "/auftraege?kanal=temu"],
  ["Amazon-Reports abholen", "Amazon-Berichte (automatisch)", "/import"],
  ["Postfächer", "Postfächer", "/posteingang"],
  ["Kalender", "Kalender", "/kalender"],
  ["Rechnungen", "Rechnungen aus Drive", "/rechnungen"],
];

export type DataArea = Freshness & { error: string | null; via?: string };

/** Datenstand je Bereich: Amazon-Berichte (Upload oder automatisch), manuelle Importe, Hintergrund-Abrufe. */
export async function dataAreas(tenantId: string): Promise<DataArea[]> {
  const R = schema.reportImports;
  const [reports, [uploads], jobs] = await Promise.all([
    db.select({ kind: R.reportType, last: max(R.createdAt), via: sql<string>`(array_agg(${R.via} order by ${R.createdAt} desc))[1]` }).from(R).where(and(eq(R.tenantId, tenantId), ne(R.rows, -1))).groupBy(R.reportType),
    db.select({ last: max(schema.importRuns.createdAt) }).from(schema.importRuns).where(eq(schema.importRuns.tenantId, tenantId)),
    db.select().from(schema.jobRuns).where(eq(schema.jobRuns.tenantId, tenantId)),
  ]);
  const byKind = new Map(reports.map((r) => [r.kind, r]));
  const kinds = [...new Set([...REPORT_CORE, ...reports.map((r) => r.kind as ReportKind)])].filter((k) => k in REPORT_KINDS);
  const items: (Omit<Freshness, "stale" | "missing"> & { error: string | null; via?: string })[] = kinds.map((k) => {
    const r = byKind.get(k);
    return { key: `report:${k}`, label: `Amazon: ${REPORT_KINDS[k].split(" (")[0]}`, last: r?.last ? new Date(r.last) : null, maxAgeDays: REPORT_AGE[k] ?? 30, href: "/import", error: null, via: r?.via };
  });
  items.push({ key: "uploads", label: "Datei-Importe (von Hand)", last: uploads?.last ? new Date(uploads.last) : null, maxAgeDays: 30, href: "/import", error: null });
  for (const [name, label, href] of JOB_AREAS) {
    const j = jobs.find((x) => x.name === name);
    if (!j) continue;
    const failing = j.lastErrorAt && (!j.lastOkAt || j.lastErrorAt > j.lastOkAt) ? j.lastError : null;
    items.push({ key: `job:${name}`, label, last: j.lastOkAt, maxAgeDays: 1, href, error: failing });
  }
  const fr = freshness(items, new Date());
  return fr.map((f, i) => ({ ...f, error: items[i].error, via: items[i].via }));
}
