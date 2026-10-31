import "server-only";
import { FBA_SUBSTITUTE, type Substitute } from "./logic";
import { and, count, eq, gte, inArray, isNull, lt, lte, max, min, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { REPORT_KINDS, type ReportKind } from "@/lib/reports/amazon";
import { freshness, IDEA_KEY_PATTERN, type Freshness } from "./logic";

/** SQL: verbindliche Aufgabe (keine automatische Idee) – gleiche Regel wie isIdeaTask. */
export const bindingTask = sql`not (${schema.tasks.systemKey} is not null and (${schema.tasks.systemKey} ~ ${IDEA_KEY_PATTERN} or ${schema.tasks.category} = 'marken'))`;

// Tagesübersicht: dringende operative Themen direkt aus den Daten (nicht aus Aufgaben) und der
// Datenstand je Bereich (letzter Bericht, letzter erfolgreicher Abruf).

/** Mitternacht (Beginn des Tages) in Berlin als Zeitpunkt – Sommer- und Winterzeit berücksichtigt. */
export function berlinMidnight(iso: string): Date {
  const guess = new Date(`${iso}T00:00:00Z`);
  const local = Date.parse(guess.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  const utc = Date.parse(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local - utc));
}

export type Signal = { key: string; label: string; detail?: string; count: number; href: string; level: "danger" | "warn" | "info" };

export async function todaySignals(tenantId: string, today: string): Promise<Signal[]> {
  const O = schema.orders;
  const C = schema.claims;
  const K = schema.cases;
  // Überfällig = Frist schon vorbei (auch heute früher); heute fällig = Frist noch heute.
  const now = new Date();
  const endOfToday = berlinMidnight(addDaysIso(today, 1));
  const endOfTomorrow = berlinMidnight(addDaysIso(today, 2));
  // Offene Sendungen wie in Navigation und Kalender: eigener Versand, offen oder Label erstellt.
  // Getrennt gezählt: überfällig, heute fällig und Frist unbekannt (ohne Versandfrist) – nie in einer Zahl vermischt.
  const openShip = and(eq(O.tenantId, tenantId), eq(O.fulfillment, "FBM"), inArray(O.status, ["open", "label_created"]));
  const [[ship], [shipTomorrow], [shipLater], [neg], [claims], [expired], [cases]] = await Promise.all([
    db
      .select({
        n: count(),
        noDate: sql<number>`count(*) filter (where ${O.shipBy} is null)::int`,
        overdue: sql<number>`count(*) filter (where ${O.shipBy} < ${now})::int`,
        dueToday: sql<number>`count(*) filter (where ${O.shipBy} >= ${now} and ${O.shipBy} < ${endOfToday})::int`,
        labelled: sql<number>`count(*) filter (where ${O.status} = 'label_created' and (${O.shipBy} is null or ${O.shipBy} < ${endOfToday}))::int`,
      })
      .from(O)
      .where(and(openShip, or(isNull(O.shipBy), lt(O.shipBy, endOfToday)))),
    db.select({ n: count() }).from(O).where(and(openShip, gte(O.shipBy, endOfToday), lt(O.shipBy, endOfTomorrow))),
    db.select({ n: count(), next: min(O.shipBy) }).from(O).where(and(openShip, gte(O.shipBy, endOfTomorrow))),
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
  const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const dated = ship.overdue + ship.dueToday;
  if (dated) {
    const parts = [ship.overdue ? `${ship.overdue} überfällig` : null, ship.dueToday ? `${ship.dueToday} heute fällig` : null].filter(Boolean).join(", ");
    out.push({ key: "versand", label: `${pl(dated, "Auftrag", "Aufträge")} versenden: ${parts}`, detail: ship.labelled ? `${ship.labelled} mit Label (Reiter „Label erstellt“)` : undefined, count: dated, href: "/auftraege?ansicht=offen", level: "danger" });
  }
  if (ship.noDate) out.push({ key: "versand-ohne-frist", label: `${pl(ship.noDate, "offener Auftrag", "offene Aufträge")} ohne Versandfrist`, detail: "Frist unbekannt – nicht als überfällig gezählt; bitte prüfen und versenden", count: ship.noDate, href: "/auftraege?ansicht=offen", level: "warn" });
  if (cases.n) out.push({ key: "faelle", label: `${cases.n} ${cases.n === 1 ? "Fall" : "Fälle"} mit Frist bis übermorgen`, detail: "A-bis-Z, eBay-Fälle", count: cases.n, href: "/faelle", level: "danger" });
  if (neg.n) out.push({ key: "negativ", label: `${neg.n} SKU${neg.n === 1 ? "" : "s"} mit negativem Bestand`, detail: `${neg.units} Stück – überverkauft oder falsch gebucht`, count: neg.n, href: "/bestand?ansicht=negativ", level: "danger" });
  if (claims.n) out.push({ key: "ansprueche", label: `${claims.n} Anspr${claims.n === 1 ? "uch läuft" : "üche laufen"} in 7 Tagen ab`, detail: `zusammen ${euro(claims.sum)}`, count: claims.n, href: "/ansprueche?ansicht=fristen", level: "warn" });
  if (shipTomorrow.n) out.push({ key: "versand-morgen", label: `${shipTomorrow.n} ${shipTomorrow.n === 1 ? "Auftrag" : "Aufträge"} morgen versenden`, count: shipTomorrow.n, href: "/auftraege?ansicht=offen", level: "warn" });
  if (shipLater.n) {
    const next = shipLater.next ? new Date(shipLater.next).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" }) : null;
    out.push({ key: "versand-spaeter", label: `${shipLater.n} weitere ${shipLater.n === 1 ? "Sendung" : "Sendungen"} mit Frist ab übermorgen`, detail: next ? `nächste Frist ${next}` : undefined, count: shipLater.n, href: "/auftraege?ansicht=offen", level: "info" });
  }
  // B15.1: versendet, aber Amazon kennt den Versand nicht (ohne Schnittstelle) – mit Frist, bis die Datei hochgeladen ist.
  const unb = await import("@/lib/orders/bestaetigung").then((x) => x.offeneBestaetigungen(tenantId, now)).catch(() => []);
  if (unb.length) {
    const frist = unb.find((u) => u.frist)?.frist ?? null;
    const dringend = !frist || new Date(frist) < endOfTomorrow;
    out.unshift({
      key: "amazon-bestaetigung",
      label: `${pl(unb.length, "Auftrag", "Aufträge")} versendet, aber bei Amazon nicht bestätigt${frist ? ` – Frist ${new Date(frist).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit" })}` : ""}`,
      detail: "Versandbestätigung als Datei laden, in Seller Central hochladen, dann bestätigen",
      count: unb.length,
      href: "/auftraege?ansicht=fehler",
      level: dringend ? "danger" : "warn",
    });
  }
  if (expired.n) out.push({ key: "abgelaufen", label: `${expired.n} Anspr${expired.n === 1 ? "uch" : "üche"} mit abgelaufener Frist, nicht eingereicht`, count: expired.n, href: "/ansprueche?ansicht=fristen", level: "warn" });
  // Liquidität: alter oder fehlender Geschäfts-Kontostand – sonst ist die Prognose zu optimistisch (Umsetzungsstand 31.10.).
  const kb = await import("@/lib/bank/service").then((x) => x.kontostand(tenantId, "geschaeft", null, today)).catch(() => undefined);
  if (kb !== undefined) {
    const alter = kb?.stand ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${kb.stand.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null;
    if (!kb) out.push({ key: "kontostand", label: "Kein Geschäfts-Kontostand – Liquidität ohne Startwert", detail: "Kontoauszug (Sparkasse/Amex) unter Uploads hochladen", count: 1, href: "/cashflow", level: "warn" });
    else if (alter !== null && alter > 7) {
      const dmy = `${kb.stand.slice(8, 10)}.${kb.stand.slice(5, 7)}.`;
      out.push({ key: "kontostand", label: `Kontostand vom ${dmy} (${alter} Tage alt) – Liquidität ungenau`, detail: "Neuen Kontoauszug hochladen, dann stimmt die Prognose wieder", count: alter, href: "/cashflow", level: alter > 21 ? "danger" : "warn" });
    }
  }
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

export type DataArea = Freshness & { error: string | null; via?: string; empty?: boolean; substitute?: Substitute | null };

/** Datenstand je Bereich: Amazon-Berichte (Upload oder automatisch), manuelle Importe, Hintergrund-Abrufe. */
export async function dataAreas(tenantId: string): Promise<DataArea[]> {
  const R = schema.reportImports;
  const [reports, [uploads], jobs, [sbStock]] = await Promise.all([
    db.select({ kind: R.reportType, last: max(R.createdAt), via: sql<string>`(array_agg(${R.via} order by ${R.createdAt} desc))[1]`, lastRows: sql<number>`(array_agg(${R.rows} order by ${R.createdAt} desc))[1]` }).from(R).where(and(eq(R.tenantId, tenantId), ne(R.rows, -1))).groupBy(R.reportType),
    db.select({ last: max(schema.importRuns.createdAt) }).from(schema.importRuns).where(eq(schema.importRuns.tenantId, tenantId)),
    db.select().from(schema.jobRuns).where(eq(schema.jobRuns.tenantId, tenantId)),
    db.select({ last: max(schema.sellerboardInventory.syncedAt) }).from(schema.sellerboardInventory).where(eq(schema.sellerboardInventory.tenantId, tenantId)),
  ]);
  // FBA-Bestand aus sellerboard (höchstens 2 Tage alt) ersetzt den Amazon-Bestandsbericht für die meisten Zwecke.
  const sbLast = sbStock?.last ? new Date(sbStock.last) : null;
  const fbaSubstitute: Substitute | null =
    sbLast && Date.now() - sbLast.getTime() <= 2 * 86_400_000
      ? { label: `sellerboard-Bestand vorhanden (Stand ${sbLast.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" })})`, last: sbLast, ...FBA_SUBSTITUTE }
      : null;
  const byKind = new Map(reports.map((r) => [r.kind, r]));
  const kinds = [...new Set([...REPORT_CORE, ...reports.map((r) => r.kind as ReportKind)])].filter((k) => k in REPORT_KINDS);
  const items: (Omit<Freshness, "stale" | "missing"> & { error: string | null; via?: string; empty?: boolean; substitute?: Substitute | null })[] = kinds.map((k) => {
    const r = byKind.get(k);
    return { key: `report:${k}`, label: k === "inventory" ? "Amazon: FBA-Bestandsbericht" : `Amazon: ${REPORT_KINDS[k].split(" (")[0]}`, last: r?.last ? new Date(r.last) : null, maxAgeDays: REPORT_AGE[k] ?? 30, href: "/import", error: null, via: r?.via, empty: r ? Number(r.lastRows) === 0 : undefined, substitute: k === "inventory" ? fbaSubstitute : null };
  });
  items.push({ key: "uploads", label: "Datei-Importe (von Hand)", last: uploads?.last ? new Date(uploads.last) : null, maxAgeDays: 30, href: "/import", error: null });
  for (const [name, label, href] of JOB_AREAS) {
    const j = jobs.find((x) => x.name === name);
    if (!j) continue;
    const failing = j.lastErrorAt && (!j.lastOkAt || j.lastErrorAt > j.lastOkAt) ? j.lastError : null;
    items.push({ key: `job:${name}`, label, last: j.lastOkAt, maxAgeDays: 1, href, error: failing });
  }
  const fr = freshness(items, new Date());
  return fr.map((f, i) => ({ ...f, error: items[i].error, via: items[i].via, empty: items[i].empty, substitute: items[i].substitute ?? null }));
}
