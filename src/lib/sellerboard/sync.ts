import "server-only";
import { and, count, eq, inArray, like, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { recordJob } from "@/lib/today/jobs";
import { isNotWarmed, WARM_VERSUCHE_JE_SEITE } from "./warm";
import { jobEnded, jobStarted } from "@/lib/perf";
import { syncClaims } from "@/lib/claims/service";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { sbAllPages, sbCall, sbQuota } from "./client";
import { readConn, sbConnected, writeConn } from "./connection";
import { isReturnSku } from "@/lib/money/ek-logic";
import { dayOf, lastDays, mapEbayOrderUnits, mapFixCosts, mapInventory, mapKpis, mapMonths, mapProduct, mapShipments, mapSkuRows, mapSkuStats, mapTop, reorderNow, tilePeriods, type SbChannel, type SbInventory, type SbKpi, type SbProduct, type SbSkuStat } from "./parse";
import type { SbTopRow } from "@/db/tables/sellerboard";
import { refreshHebelTasks, syncHebelKeepa } from "@/lib/hebel/service";
import { refreshVerlustTasks } from "@/lib/money/verlust-service";
import { recordJobHinweis } from "@/lib/today/jobs";
import { budgetEntscheidung, faelligeScopes, istGestoppt, letzterSlot, SB_NACHHOL_FENSTER_MIN, SB_PRODUKTE_SEITEN, SB_SLOTS, tageZuLesen, uebersprungenText, verkaufUmfang, type SbGestoppt, type SbPrio, type SbScope } from "./budget-logic";
import { budgetStand, laufMerken, pauseBeenden, pauseSetzen, planLesen, planWerte, planWerteLesen, sbKontext, uebersprungenZaehlen } from "./budget";

// Abgleich mit sellerboard (nur lesend). B29: sellerboard erlaubt 125 Aufrufe am Tag (für alle Nutzer zusammen) –
// die Automatik läuft zu festen Uhrzeiten in getrennten Gruppen und nimmt sich höchstens 80 davon:
// „verkauf“ = Verkaufs-Kennzahlen Amazon + eBay (alle 2 Std. 06–22 Uhr, nachts 02:00), „tage“ = Gewinn je Produkt
// und Tag + Verlust-Stopp (04:00, 13:00), „bestand“ = FBA-Bestand + Sendungen (04:30, 16:30), „taeglich“ = Produkte/EK,
// Monatswerte, Fixkosten, Produkte 30 Tage (ab 02:00). „alles“ = von Hand („Jetzt abgleichen“, nach dem Verbinden).

export type SyncScope = SbScope | "alles";

/** Abrufe (job_runs ohne „sellerboard: “) je geplanter Gruppe – für „übersprungen (Tagesbudget)“. */
export const SB_SCHRITTE: Record<SbScope, string[]> = {
  verkauf: ["Verkauf (Amazon + eBay)"],
  tage: ["Gewinn je Produkt und Tag", "Verlust-Stopp"],
  bestand: ["FBA-Bestand", "FBA-Sendungen", "Hebel-Aufgaben", "Ansprüche aus Sendungen"],
  taeglich: ["Produkte & EK", "Monatswerte & Gewinn je SKU", "Fixkosten", "Produkte 30 Tage (Hebel)", "Keepa Buy Box (Hebel)", "Hebel-Aufgaben"],
};
const running = new Set<string>();
const chunks = <T,>(a: T[], n = 300) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
/** Doppelte Einträge (gleiche sellerboard-ID auf zwei Seiten) – der letzte gilt; sonst scheitert das Upsert. */
const uniqueBy = <T extends { sbId: string }>(a: T[]) => [...new Map(a.map((x) => [x.sbId, x])).values()];

/** Welches sellerboard-Konto (bei mehreren: das erste mit Daten). */
export async function identifyAccount(tenantId: string) {
  const r = await sbCall(tenantId, "list_accounts");
  const list = (r.accounts as { account_id?: string; name?: string; has_ebay?: boolean }[] | undefined) ?? [];
  const a = list[0];
  if (a?.account_id) await writeConn(tenantId, { config: { accountId: a.account_id, accountName: a.name ?? undefined, hasEbay: a.has_ebay === true } });
}

const monthOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 7);
const utcDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

/** Monatsgrenzen (UTC) der letzten n Monate inkl. laufendem Monat bis heute. */
export function monthPeriods(today: string, n: number) {
  const out: { start: number; end: number; month: string }[] = [];
  const [y, m] = today.split("-").map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const first = new Date(Date.UTC(y, m - 1 - i, 1));
    const last = new Date(Date.UTC(y, m - i, 0));
    const lastIso = i === 0 ? today : last.toISOString().slice(0, 10);
    out.push({ start: utcDay(first.toISOString().slice(0, 10)), end: utcDay(lastIso), month: first.toISOString().slice(0, 7) });
  }
  return out;
}

/** B29: höchstens so viele Seiten „Produkte & EK“ je Lauf – große Kataloge laufen über mehrere Tage durch. */
const PRODUKTE_SEITEN_JE_LAUF = Number(process.env.SB_PRODUKTE_SEITEN) || SB_PRODUKTE_SEITEN;

/**
 * Produkte mit EK. B29: nach Name sortiert und seitenweise mit gespeichertem Fortschritt – je Lauf höchstens
 * PRODUKTE_SEITEN_JE_LAUF Seiten (bei ~2.500 Produkten ca. 7 Tage für einen Durchgang statt 72 Aufrufe auf einmal).
 * Jede Seite wird gleich gespeichert; ein Budget-Stopp verliert nichts. In sellerboard gelöschte Produkte fallen erst
 * heraus, wenn sie zwei volle Durchgänge nicht mehr kamen.
 */
async function syncProducts(t: string, now: Date) {
  const P = schema.sellerboardProducts;
  const werte = await planWerteLesen(t);
  let seite = Math.max(1, Number(werte["produkte:seite"]) || 1);
  const zyklus = seite === 1 || !werte["produkte:zyklus"] ? now.toISOString() : werte["produkte:zyklus"];
  let total = Infinity;
  let fertig = false;
  let n = 0;
  for (let i = 0; i < PRODUKTE_SEITEN_JE_LAUF; i++) {
    const reply = await sbCall(t, "products", { page: seite, count: 35, sort: "name asc" });
    const list = (reply.result as Record<string, unknown>[] | undefined) ?? [];
    total = Number(reply.total ?? list.length);
    const rows = uniqueBy(list.map(mapProduct).filter((r): r is SbProduct => r !== null));
    for (const part of chunks(rows)) {
      await db
        .insert(P)
        .values(part.map((r) => ({ tenantId: t, ...r, vatPct: r.vatPct === null ? null : String(r.vatPct), syncedAt: now })))
        .onConflictDoUpdate({
          target: [P.tenantId, P.sbId],
          set: { sku: sql`excluded.sku`, asin: sql`excluded.asin`, ean: sql`excluded.ean`, name: sql`excluded.name`, channel: sql`excluded.channel`, cost: sql`excluded.cost`, costPeriod: sql`excluded.cost_period`, price: sql`excluded.price`, fbaFee: sql`excluded.fba_fee`, referralFee: sql`excluded.referral_fee`, vatPct: sql`excluded.vat_pct`, margin: sql`excluded.margin`, syncedAt: sql`excluded.synced_at` },
        });
    }
    n += rows.length;
    seite++;
    fertig = !list.length || (seite - 1) * 35 >= total;
    await planWerte(t, { "produkte:seite": String(fertig ? 1 : seite), "produkte:zyklus": zyklus });
    if (fertig) break;
  }
  if (fertig) {
    const vorher = werte["produkte:vorher"];
    if (vorher && n + (total === Infinity ? 0 : total) > 0) await db.delete(P).where(and(eq(P.tenantId, t), lt(P.syncedAt, new Date(vorher))));
    await planWerte(t, { "produkte:vorher": zyklus });
  }
  return n;
}

/** Bestand je SKU zusammenfassen (eine SKU kann in mehreren Zeilen stehen, z. B. je Marktplatz). */
function bySku(rows: SbInventory[]) {
  const m = new Map<string, SbInventory>();
  for (const r of rows) {
    const cur = m.get(r.sku);
    if (!cur) m.set(r.sku, { ...r });
    else Object.assign(cur, { fbaStock: cur.fbaStock + r.fbaStock, reserved: cur.reserved + r.reserved, inbound: cur.inbound + r.inbound });
  }
  return [...m.values()];
}

/**
 * B29: FBA-Bestand in zwei Durchgängen statt aller jemals angelegten SKUs: alles mit Bestand, dazu ausverkaufte
 * mit Abverkauf (Nachbestell-Kandidaten, nach Abverkauf absteigend bis zur ersten Seite ohne Abverkauf).
 */
async function inventarLesen(t: string) {
  const mitBestand = await sbAllPages(t, "inventory", { channel: "FBA", show_out_of_stock: false }, 35);
  const ausverkauft: Record<string, unknown>[] = [];
  for (let page = 1; page <= 40; page++) {
    const reply = await sbCall(t, "inventory", { channel: "FBA", show_out_of_stock: true, sort: "SalesVelocity", sort_direction: "desc", page, count: 35 });
    const list = (reply.result as Record<string, unknown>[] | undefined) ?? [];
    ausverkauft.push(...list);
    const total = Number(reply.total ?? list.length);
    if (!list.length || page * 35 >= total || list.every((r) => !(Number(r.SalesVelocity) > 0))) break;
  }
  return [...mitBestand, ...ausverkauft];
}

async function syncInventory(t: string, now: Date) {
  const rows = uniqueBy((await inventarLesen(t)).map(mapInventory).filter((r): r is SbInventory => r !== null).filter((r) => (r.channel ?? "FBA").toUpperCase() === "FBA"));
  const S = schema.sellerboardInventory;
  for (const part of chunks(uniqueBy(rows))) {
    await db
      .insert(S)
      .values(part.map((r) => ({ tenantId: t, ...r, salesVelocity: r.salesVelocity === null ? null : String(r.salesVelocity), syncedAt: now })))
      .onConflictDoUpdate({
        target: [S.tenantId, S.sbId],
        set: { sku: sql`excluded.sku`, asin: sql`excluded.asin`, fnsku: sql`excluded.fnsku`, name: sql`excluded.name`, channel: sql`excluded.channel`, fbaStock: sql`excluded.fba_stock`, reserved: sql`excluded.reserved`, inbound: sql`excluded.inbound`, salesVelocity: sql`excluded.sales_velocity`, daysLeft: sql`excluded.days_left`, timeToReorder: sql`excluded.time_to_reorder`, daysToReorder: sql`excluded.days_to_reorder`, qtyToReorder: sql`excluded.qty_to_reorder`, runningOut: sql`excluded.running_out`, cost: sql`excluded.cost`, stockValue: sql`excluded.stock_value`, syncedAt: sql`excluded.synced_at` },
      });
  }
  if (rows.length) await db.delete(S).where(and(eq(S.tenantId, t), lt(S.syncedAt, now)));

  // B29: nicht mehr gelistete SKUs haben bei sellerboard keinen Bestand und keinen Abverkauf – ihr übernommener
  // sellerboard-Bestand geht auf 0 (wie vorher, als die Liste auch alle ausverkauften enthielt).
  const I0 = schema.amazonInventory;
  const gesehen = new Set(rows.map((r) => r.sku));
  if (rows.length) {
    const alt = await db.select({ sku: I0.sku }).from(I0).where(and(eq(I0.tenantId, t), eq(I0.source, "sellerboard"), sql`(${I0.fulfillable} + ${I0.reserved} + ${I0.inboundShipped}) > 0`));
    const weg = alt.map((a) => a.sku).filter((sku) => !gesehen.has(sku));
    for (const part of chunks(weg)) await db.update(I0).set({ fulfillable: 0, reserved: 0, inboundShipped: 0, inboundWorking: 0, inboundReceiving: 0, total: sql`${I0.unsellable}`, snapshotDate: todayIso(), updatedAt: new Date() }).where(and(eq(I0.tenantId, t), eq(I0.source, "sellerboard"), inArray(I0.sku, part)));
  }

  // FBA-Bestand wie aus dem Bestandsbericht (Stand heute, Herkunft sellerboard). Unverkäufliches kennt sellerboard
  // hier nicht – der bisherige Wert bleibt stehen.
  const I = schema.amazonInventory;
  const today = todayIso();
  for (const part of chunks(bySku(rows))) {
    await db
      .insert(I)
      .values(part.map((r) => ({ tenantId: t, sku: r.sku, fnsku: r.fnsku, asin: r.asin, title: r.name, fulfillable: r.fbaStock, reserved: r.reserved, inboundShipped: r.inbound, total: r.fbaStock + r.reserved + r.inbound, snapshotDate: today, source: "sellerboard" as const })))
      .onConflictDoUpdate({
        target: [I.tenantId, I.sku],
        set: {
          fnsku: sql`coalesce(excluded.fnsku, ${I.fnsku})`,
          asin: sql`coalesce(excluded.asin, ${I.asin})`,
          title: sql`coalesce(${I.title}, excluded.title)`,
          fulfillable: sql`excluded.fulfillable`,
          reserved: sql`excluded.reserved`,
          inboundWorking: sql`0`,
          inboundShipped: sql`excluded.inbound_shipped`,
          inboundReceiving: sql`0`,
          total: sql`excluded.total + ${I.unsellable}`,
          snapshotDate: sql`excluded.snapshot_date`,
          source: sql`excluded.source`,
          updatedAt: sql`now()`,
        },
      });
  }

  // Eine Sammelaufgabe statt vieler einzelner.
  // Retouren-SKUs (einzelne zurückgekommene Einheiten) sind nicht beim Lieferanten nachbestellbar – eigene Zeile.
  const all = reorderNow(rows);
  const now2 = all.filter((r) => !isReturnSku(r.sku));
  const rets = all.length - now2.length;
  const key = "sellerboard-reorder";
  if (now2.length) {
    await upsertSystemTask(db, t, key, {
      title: `${now2.length} Produkt${now2.length === 1 ? "" : "e"} jetzt nachbestellen (laut sellerboard)`,
      notes: `sellerboard rechnet mit Abverkauf, Lieferzeit und Puffer. Liste mit Menge, Kapitalbedarf (gültiger EK netto) und spätestem Bestelldatum unter Einkauf → Bestellvorschläge.${rets ? ` Dazu ${rets} Retouren-SKU${rets === 1 ? "" : "s"} – Beschaffung über den Ursprungsartikel prüfen.` : ""}`,
      category: "einkauf",
      link: "/einkauf/vorschlaege?weg=sellerboard",
      dueDate: today,
    });
  } else await resolveSystemTask(db, t, key);
  return rows.length;
}

/**
 * FBA-Sendungen der letzten 150 Tage. B29: geplant nur die geänderten – nach letzter Änderung absteigend lesen und
 * aufhören, sobald eine Seite nur noch Pläne enthält, die vor dem bekannten Stand (minus 3 Tage) zuletzt geändert wurden.
 */
async function syncShipments(t: string, now: Date, voll: boolean) {
  const S = schema.sellerboardShipments;
  const [stand] = await db.select({ max: sql<string | null>`max(${S.lastUpdate})::text` }).from(S).where(eq(S.tenantId, t));
  const grenze = !voll && stand?.max ? new Date(Date.parse(`${stand.max}T00:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10) : null;
  const begin = Math.floor(Date.now() / 1000) - 150 * 86_400;
  const all: ReturnType<typeof mapShipments> = [];
  let total = Infinity;
  for (let page = 1; (page - 1) * 8 < total && page <= 200; page++) {
    const reply = await sbCall(t, "fba_shipments", { begin_date: begin, page, count: 8, ...(grenze ? { sort: "last_update_date desc" } : {}) });
    total = Number(reply.total ?? 0);
    const got = mapShipments(reply);
    all.push(...got);
    const plaene = (reply.result as Record<string, unknown>[] | undefined) ?? [];
    if (!plaene.length) break;
    if (grenze && plaene.every((p) => (dayOf(p.last_update_date) ?? "0000") < grenze)) break;
  }
  for (const part of chunks(uniqueBy(all), 200)) {
    await db
      .insert(S)
      .values(part.map((s) => ({ tenantId: t, ...s, syncedAt: now })))
      .onConflictDoUpdate({ target: [S.tenantId, S.sbId], set: { amazonId: sql`excluded.amazon_id`, name: sql`excluded.name`, status: sql`excluded.status`, createdOn: sql`excluded.created_on`, lastUpdate: sql`excluded.last_update`, lines: sql`excluded.lines`, syncedAt: sql`excluded.synced_at` } });
  }
  return all.length;
}

async function syncMonths(t: string, now: Date, mitVormonat: boolean) {
  const periods = monthPeriods(todayIso(), 12);
  const reply = await sbCall(t, "dashboard_period", { periods: periods.map((p) => ({ start: p.start, end: p.end })) });
  const months = mapMonths(reply, monthOf);
  const M = schema.sellerboardMonths;
  for (const m of months) {
    await db.insert(M).values({ tenantId: t, ...m, syncedAt: now }).onConflictDoUpdate({ target: [M.tenantId, M.month], set: { ...m, syncedAt: now } });
  }
  // Gewinn je SKU: laufender und letzter Monat.
  const SK = schema.sellerboardSkuMonths;
  let skuRows = 0;
  // B29: der Vormonat ändert sich nach Monatsende kaum noch – nur in den ersten 10 Tagen (oder von Hand) neu lesen.
  for (const p of periods.slice(mitVormonat ? -2 : -1)) {
    await sbCall(t, "dashboard_period", { periods: [{ start: p.start, end: p.end }] });
    // B27.4: abgelaufener Zeitraum mitten im Lesen → nachwärmen und dieselbe Seite wiederholen.
    const rows = mapSkuRows(await tablePages(t, "amazon", { entry_type: "product", period_start: p.start, period_end: p.end }, 35, 120, { key: "monat", fields: SKU_MONAT_FELDER, count: 200 }));
    const merged = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = merged.get(r.sku);
      if (!cur) merged.set(r.sku, { ...r });
      else Object.assign(cur, { units: (cur.units ?? 0) + (r.units ?? 0), sales: (cur.sales ?? 0) + (r.sales ?? 0), netProfit: (cur.netProfit ?? 0) + (r.netProfit ?? 0) });
    }
    await db.delete(SK).where(and(eq(SK.tenantId, t), eq(SK.month, p.month)));
    for (const part of chunks([...merged.values()])) await db.insert(SK).values(part.map((r) => ({ tenantId: t, month: p.month, ...r, syncedAt: now })));
    skuRows += merged.size;
  }
  return { months: months.length, skuRows };
}

async function syncFixCosts(t: string) {
  const rows = await sbAllPages(t, "expenses", {}, 50, 40);
  const costs = mapFixCosts(rows, todayIso());
  const C = schema.cashItems;
  const refs = costs.map((c) => `sellerboard:${c.ref}`);
  for (const c of costs) {
    const values = { tenantId: t, date: c.start, amount: c.amount, category: "Fixkosten (sellerboard)", description: c.name, recurrence: c.recurrence, endDate: c.end, externalRef: `sellerboard:${c.ref}` };
    await db
      .insert(C)
      .values(values)
      .onConflictDoUpdate({ target: [C.tenantId, C.externalRef], targetWhere: sql`${C.externalRef} is not null`, set: { date: values.date, amount: values.amount, description: values.description, recurrence: values.recurrence, endDate: values.endDate, category: values.category } });
  }
  // In sellerboard entfernte Fixkosten auch hier entfernen – nur die übernommenen, nie eigene Posten.
  const old = await db.select({ id: C.id, ref: C.externalRef }).from(C).where(and(eq(C.tenantId, t), like(C.externalRef, "sellerboard:%")));
  const gone = old.filter((o) => !refs.includes(o.ref!)).map((o) => o.id);
  if (gone.length) await db.delete(C).where(and(eq(C.tenantId, t), inArray(C.id, gone)));
  return costs.length;
}

const utcToday = () => new Date().toISOString().slice(0, 10);
const TOOLS: Record<SbChannel, { period: string; table: string }> = {
  amazon: { period: "dashboard_period", table: "dashboard_table" },
  ebay: { period: "ebay_dashboard_period", table: "ebay_dashboard_table" },
};

// B29: schlanke Spalten für katalogweite Tabellen (bis 200 statt 35 Zeilen je Seite = weniger Aufrufe).
const SKU_MONAT_FELDER = ["Units", "Sales", "NetProfit"];
const SKU_TAG_FELDER = ["Units", "Sales", "NetProfit", "AverageSalesPrice", "Refunds", "ProductRefunds"];
const SKU_30_FELDER: Record<SbChannel, string[]> = {
  amazon: ["Units", "Refunds", "Sales", "NetProfit", "GrossProfit", "AmazonFees", "ProductCosts", "Advertising", "VAT", "ProductRefunds", "AverageSalesPrice", "Price", "sessions", "unitSessionPercentage", "Stock", "DaysOfStockLeft", "SalesVelocity", "TimeToReorder", "StockAtCostPrice", "Cost", "Image", "LinkToAmazon", "variant_name"],
  ebay: ["Units", "Refunds", "Sales", "NetProfit", "GrossProfit", "Fees", "ProductCosts", "Advertising", "VAT", "ProductRefunds", "AverageSalesPrice", "Price", "Stock", "Cost", "Image", "Link", "variant_name"],
};

async function saveKpis(t: string, channel: SbChannel, rows: SbKpi[], now: Date) {
  const K = schema.sellerboardKpis;
  for (const r of rows) {
    const { fromDay, toDay, ...v } = r;
    await db
      .insert(K)
      .values({ tenantId: t, channel, fromDay, toDay, ...v, syncedAt: now })
      .onConflictDoUpdate({ target: [K.tenantId, K.channel, K.fromDay, K.toDay], set: { ...v, syncedAt: now } });
  }
}

async function saveTop(t: string, channel: SbChannel, day: string, rows: SbTopRow[], total: number, now: Date) {
  const T = schema.sellerboardTop;
  await db
    .insert(T)
    .values({ tenantId: t, channel, day, total, rows, syncedAt: now })
    .onConflictDoUpdate({ target: [T.tenantId, T.channel, T.day], set: { total, rows, syncedAt: now } });
}

/** Meistverkaufte Produkte eines Tages; ist der Tag bei sellerboard nicht vorbereitet, einmal nachwärmen. */
async function syncTop(t: string, channel: SbChannel, day: { start: number; fromDay: string }, now: Date) {
  const args = { entry_type: "product", period_start: day.start, period_end: day.start, page: 1, count: 10, sort: "units desc" };
  let reply: Record<string, unknown>;
  try {
    reply = await sbCall(t, TOOLS[channel].table, args);
  } catch (e) {
    if (!/NOT_WARMED|warm/i.test(e instanceof Error ? e.message : String(e))) throw e;
    await sbCall(t, TOOLS[channel].period, { periods: [{ start: day.start, end: day.start }] });
    reply = await sbCall(t, TOOLS[channel].table, args);
  }
  const rows = mapTop(reply).slice(0, 10);
  await saveTop(t, channel, day.fromDay, rows, Number(reply.total ?? rows.length) || 0, now);
}

/** B29: Top-Produkte eines abgeschlossenen Tages aus „Gewinn je Produkt und Tag“ – ohne eigenen Aufruf (Bild/Link aus den 30-Tage-Werten). */
async function topAusTag(t: string, channel: SbChannel, day: string, rows: { sku: string; name: string | null; units: number; refunds: number; sales: number | null; netProfit: number | null }[], now: Date) {
  const verkauft = rows.filter((r) => r.units > 0).sort((a, b) => b.units - a.units || (b.sales ?? 0) - (a.sales ?? 0));
  const top = verkauft.slice(0, 10);
  const S = schema.sellerboardSkuStats;
  const extra = top.length ? await db.select({ sku: S.sku, image: S.image, link: S.link }).from(S).where(and(eq(S.tenantId, t), eq(S.channel, channel), inArray(S.sku, top.map((r) => r.sku)))) : [];
  const m = new Map(extra.map((e) => [e.sku, e]));
  await saveTop(t, channel, day, top.map((r) => ({ name: r.name, sku: r.sku, image: m.get(r.sku)?.image ?? null, link: m.get(r.sku)?.link ?? null, units: r.units, refunds: r.refunds, sales: r.sales, netProfit: r.netProfit })), verkauft.length, now);
}

const DAY = 86_400;
const isoTag = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

type VerkaufUmfang = { verlauf: "voll" | "fehlend"; topHeute: boolean; topGestern: boolean; ebay: ("heute" | "gestern" | "monat")[] };

/**
 * Verkaufs-Kennzahlen wie die sellerboard-Kacheln (heute, gestern, Monat bis heute, letzter Monat) je Kanal – ein
 * Aufruf je Kanal. B29: Top-Produkte, eBay-Bestellmengen und fehlende Tage des 30-Tage-Verlaufs nur, wo nötig.
 */
async function syncSales(t: string, now: Date, u: VerkaufUmfang) {
  const conn = await readConn(t);
  const channels: SbChannel[] = conn?.config.hasEbay === false ? ["amazon"] : ["amazon", "ebay"];
  const today = utcToday();
  const tiles = tilePeriods(today);
  const K = schema.sellerboardKpis;
  let days = 0;
  for (const channel of channels) {
    let reply: Record<string, unknown>;
    try {
      reply = await sbCall(t, TOOLS[channel].period, { periods: tiles.map((p) => ({ start: p.start, end: p.end })) });
    } catch (e) {
      // eBay nicht bei sellerboard angebunden: merken und künftig auslassen.
      if (channel === "ebay" && /CHANNEL_NOT_CONNECTED|not connected/i.test(e instanceof Error ? e.message : String(e))) {
        await writeConn(t, { config: { hasEbay: false } });
        continue;
      }
      throw e;
    }
    await saveKpis(t, channel, mapKpis(reply), now);
    if (u.topHeute) await syncTop(t, channel, tiles[0], now);
    if (u.topGestern) await syncTop(t, channel, tiles[1], now);
    // eBay: Bestellmengen je SKU (für den Gewinn mit EK aus dem Seller-System).
    if (channel === "ebay" && u.ebay.length) {
      const d31 = { start: tiles[0].start - 30 * DAY, end: tiles[0].end, fromDay: isoTag(tiles[0].start - 30 * DAY), toDay: tiles[0].toDay };
      const ranges = u.ebay.includes("monat") ? [d31, tiles[3]] : [...(u.ebay.includes("gestern") ? [tiles[1]] : []), ...(u.ebay.includes("heute") ? [tiles[0]] : [])];
      await syncEbayUnits(t, ranges, now);
    }
    // 30-Tage-Verlauf: von Hand komplett, sonst nur fehlende Tage (heute/gestern kommen mit den Kacheln).
    const t0 = tiles[0].start;
    const alle = Array.from({ length: 30 }, (_, i) => t0 - (29 - i) * DAY);
    let tage = alle;
    if (u.verlauf === "fehlend") {
      const da = await db.select({ d: K.fromDay }).from(K).where(and(eq(K.tenantId, t), eq(K.channel, channel), sql`${K.fromDay} = ${K.toDay}`, sql`${K.fromDay} >= ${today}::date - 29`));
      const set = new Set(da.map((r) => r.d));
      tage = alle.filter((d) => d < t0 - DAY && !set.has(isoTag(d)));
    }
    for (let i = 0; i < tage.length; i += 12) {
      const r = await sbCall(t, TOOLS[channel].period, { periods: tage.slice(i, i + 12).map((d) => ({ start: d, end: d })) });
      const rows = mapKpis(r);
      await saveKpis(t, channel, rows, now);
      days += rows.length;
    }
  }
  // Aufräumen: alte „Monat bis heute“-Bereiche, Tage älter als 120 Tage, Top-Listen älter als 14 Tage.
  await db.delete(K).where(and(eq(K.tenantId, t), ne(K.fromDay, K.toDay), lt(K.syncedAt, new Date(now.getTime() - 2 * 86_400_000))));
  await db.delete(K).where(and(eq(K.tenantId, t), sql`${K.toDay} < ${today}::date - 120`));
  const T = schema.sellerboardTop;
  await db.delete(T).where(and(eq(T.tenantId, t), sql`${T.day} < ${today}::date - 14`));
  return { channels: channels.length, days };
}

/**
 * Alle Seiten einer Dashboard-Tabelle. Ist der Zeitraum nicht (mehr) vorbereitet: dashboard_period mit denselben
 * Argumenten erneut (sbCall wartet auf „preparing“), dann dieselbe Seite noch einmal – bis 3 Versuche je Seite;
 * die schon gelesenen Seiten bleiben.
 */
async function tablePagesRoh(t: string, channel: SbChannel, args: Record<string, unknown> & { period_start: number; period_end: number }, count: number, maxPages: number) {
  const rows: Record<string, unknown>[] = [];
  let total = Infinity;
  let versuche = 0;
  for (let page = 1; page <= maxPages && (page - 1) * count < total; ) {
    let reply: Record<string, unknown>;
    try {
      reply = await sbCall(t, TOOLS[channel].table, { ...args, page, count });
    } catch (e) {
      if (!isNotWarmed(e) || versuche >= WARM_VERSUCHE_JE_SEITE) throw e;
      versuche++;
      await sbCall(t, TOOLS[channel].period, { periods: [{ start: args.period_start, end: args.period_end }] });
      continue;
    }
    versuche = 0;
    const list = (reply.result as Record<string, unknown>[] | undefined) ?? [];
    total = Number(reply.total ?? list.length);
    rows.push(...list);
    if (!list.length) break;
    page++;
  }
  return { result: rows, total: rows.length };
}

/** Tabellen, die die schlanke Feldauswahl nicht annehmen – dann volle Zeilen (bis zum nächsten Neustart). */
const ohneFelder = new Set<string>();

/**
 * B29: erst mit schlanker Feldauswahl und großen Seiten (weniger Aufrufe); lehnt sellerboard die Auswahl ab, mit
 * vollen Zeilen zu 35 je Seite.
 */
async function tablePages(t: string, channel: SbChannel, args: Record<string, unknown> & { period_start: number; period_end: number }, count: number, maxPages: number, schlank?: { key: string; fields: string[]; count: number }) {
  const key = schlank ? `${schlank.key}:${channel}` : "";
  if (schlank && !ohneFelder.has(key)) {
    try {
      return await tablePagesRoh(t, channel, { ...args, fields: schlank.fields }, schlank.count, Math.max(1, Math.ceil((maxPages * count) / schlank.count)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (istGestoppt(e) || isNotWarmed(e) || !msg.startsWith("sellerboard (") || /Verbindung abgebrochen|unvollständige Antwort|nicht fertig/.test(msg)) throw e;
      ohneFelder.add(key);
      console.warn(`[sellerboard] Feldauswahl abgelehnt (${key}) – volle Zeilen:`, msg.slice(0, 160));
    }
  }
  return tablePagesRoh(t, channel, args, count, maxPages);
}

/** Kennzahlen je Produkt über die letzten 30 abgeschlossenen Tage (Amazon und eBay), komplett ersetzt. */
async function syncSkuStats(t: string, now: Date) {
  const conn = await readConn(t);
  const channels: SbChannel[] = conn?.config.hasEbay === false ? ["amazon"] : ["amazon", "ebay"];
  const p = lastDays(utcToday(), 30);
  const S = schema.sellerboardSkuStats;
  let n = 0;
  for (const channel of channels) {
    await sbCall(t, TOOLS[channel].period, { periods: [{ start: p.start, end: p.end }] });
    const reply = await tablePages(t, channel, { entry_type: "product", period_start: p.start, period_end: p.end, sort: "sales desc" }, 35, 60, { key: "skus30", fields: SKU_30_FELDER[channel], count: 100 });
    const merged = new Map<string, SbSkuStat>();
    for (const r of mapSkuStats(reply)) {
      const cur = merged.get(r.sku);
      if (!cur) merged.set(r.sku, r);
      else {
        // Gleiche SKU mehrfach (z. B. Marktplätze): Mengen und Beträge zusammenzählen.
        const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
        Object.assign(cur, { units: cur.units + r.units, refunds: cur.refunds + r.refunds, sales: add(cur.sales, r.sales), netProfit: add(cur.netProfit, r.netProfit), grossProfit: add(cur.grossProfit, r.grossProfit), fees: add(cur.fees, r.fees), productCosts: add(cur.productCosts, r.productCosts), advertising: add(cur.advertising, r.advertising), vat: add(cur.vat, r.vat), refundCost: add(cur.refundCost, r.refundCost), sessions: add(cur.sessions, r.sessions) });
      }
    }
    const rows = [...merged.values()];
    for (const part of chunks(rows)) {
      await db
        .insert(S)
        .values(part.map((r) => ({ tenantId: t, channel, ...r, salesVelocity: r.salesVelocity === null ? null : String(r.salesVelocity), conversion: r.conversion === null ? null : String(r.conversion), fromDay: p.fromDay, toDay: p.toDay, syncedAt: now })))
        .onConflictDoUpdate({
          target: [S.tenantId, S.channel, S.sku],
          set: Object.fromEntries(["name", "asin", "image", "link", "units", "refunds", "sales", "net_profit", "gross_profit", "fees", "product_costs", "advertising", "vat", "refund_cost", "avg_price", "price", "sessions", "conversion", "stock", "days_left", "sales_velocity", "time_to_reorder", "stock_value", "cost_missing", "from_day", "to_day", "synced_at"].map((c) => [c.replace(/_([a-z])/g, (_, x: string) => x.toUpperCase()), sql.raw(`excluded.${c}`)])),
        });
    }
    // Was in den 30 Tagen nicht mehr verkauft wurde, fällt heraus.
    await db.delete(S).where(and(eq(S.tenantId, t), eq(S.channel, channel), lt(S.syncedAt, now)));
    n += rows.length;
  }
  return n;
}

/**
 * Gewinn je SKU je abgeschlossenem Tag (Verlust-Stopp); je Tag ersetzt, 21 Tage aufbewahrt. B29: ein Aufruf wärmt
 * alle Tage auf einmal; um 04:00 gestern + vorgestern, um 13:00 nur gestern, fehlende Tage bis 3 zurück. Die
 * Top-Produkte von gestern (Startseite) entstehen dabei ohne eigenen Aufruf.
 */
async function syncSkuDays(t: string, now: Date) {
  const conn = await readConn(t);
  const channels: SbChannel[] = conn?.config.hasEbay === false ? ["amazon"] : ["amazon", "ebay"];
  const D = schema.sellerboardSkuTage;
  const today = utcToday();
  const vorhandenRows = await db.selectDistinct({ day: D.day }).from(D).where(and(eq(D.tenantId, t), sql`${D.day} >= ${today}::date - 3`));
  const vorhanden = new Set(vorhandenRows.map((r) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.day}T00:00:00Z`)) / 86_400_000)));
  const backs = tageZuLesen(new Date(), vorhanden);
  let n = 0;
  for (const channel of channels) {
    const tage = backs.map((back) => {
      const p = lastDays(today, back);
      return { start: p.start, end: p.start, fromDay: p.fromDay, back };
    });
    await sbCall(t, TOOLS[channel].period, { periods: tage.map((d) => ({ start: d.start, end: d.end })) });
    for (const day of tage) {
      const reply = await tablePages(t, channel, { entry_type: "product", period_start: day.start, period_end: day.end, sort: "sales desc" }, 35, 20, { key: "tage", fields: SKU_TAG_FELDER, count: 200 });
      const merged = new Map<string, { sku: string; asin: string | null; name: string | null; units: number; sales: number | null; netProfit: number | null; avgPrice: number | null; refunds: number; refundCost: number | null }>();
      for (const r of mapSkuStats(reply)) {
        const cur = merged.get(r.sku);
        const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
        if (!cur) merged.set(r.sku, { sku: r.sku, asin: r.asin, name: r.name, units: r.units, sales: r.sales, netProfit: r.netProfit, avgPrice: r.avgPrice, refunds: r.refunds, refundCost: r.refundCost });
        else Object.assign(cur, { units: cur.units + r.units, sales: add(cur.sales, r.sales), netProfit: add(cur.netProfit, r.netProfit), refunds: cur.refunds + r.refunds, refundCost: add(cur.refundCost, r.refundCost) });
      }
      const rows = [...merged.values()].filter((r) => r.units > 0 || (r.netProfit ?? 0) !== 0);
      // Leere Antwort für einen Tag, der schon Werte hat: eher ein Aussetzer bei sellerboard als „nichts verkauft“ –
      // vorhandene Tageswerte nicht löschen (sonst verliert der Verlust-Stopp seine Grundlage).
      if (!rows.length) {
        const [alt] = await db.select({ n: sql<number>`count(*)::int` }).from(D).where(and(eq(D.tenantId, t), eq(D.channel, channel), eq(D.day, day.fromDay)));
        if (alt.n > 0) continue;
      }
      await db.delete(D).where(and(eq(D.tenantId, t), eq(D.channel, channel), eq(D.day, day.fromDay)));
      for (const part of chunks(rows)) await db.insert(D).values(part.map((r) => ({ tenantId: t, channel, day: day.fromDay, ...r, syncedAt: now })));
      if (day.back === 1) await topAusTag(t, channel, day.fromDay, rows, now);
      n += rows.length;
    }
  }
  await db.delete(D).where(and(eq(D.tenantId, t), sql`${D.day} < ${today}::date - 21`));
  return n;
}

/** eBay-Bestellmengen je Tag/SKU für Zeiträume (je höchstens 31 Tage); vorhandene Tage werden ersetzt. */
async function syncEbayUnits(t: string, ranges: { start: number; end: number; fromDay: string; toDay: string }[], now: Date) {
  const conn = await readConn(t);
  if (conn?.config.hasEbay === false) return 0;
  const U = schema.sellerboardEbayUnits;
  let n = 0;
  for (const r of ranges) {
    const reply = await tablePages(t, "ebay", { entry_type: "order_item", period_start: r.start, period_end: r.end, sort: "orderdate desc" }, 50, 60);
    const rows = mapEbayOrderUnits(reply).filter((x) => x.day >= r.fromDay && x.day <= r.toDay);
    await db.delete(U).where(and(eq(U.tenantId, t), sql`${U.day} between ${r.fromDay} and ${r.toDay}`));
    for (const part of chunks(rows)) await db.insert(U).values(part.map((x) => ({ tenantId: t, ...x, syncedAt: now })));
    n += rows.length;
  }
  await db.delete(U).where(and(eq(U.tenantId, t), sql`${U.day} < ${utcToday()}::date - 70`));
  return n;
}

/** B27.4: höchstens so lange je Schritt – ein hängender Abruf gibt die Sperre wieder frei. */
const SCHRITT_MS = Number(process.env.SB_SCHRITT_MS) || 20 * 60_000;

/** Sperre je Gruppe: „tage“ läuft unabhängig, alles andere teilt sich eine Sperre (Hand-Abgleich und Zeitplan). */
const sperre = (tenantId: string, scope: SyncScope) => `${tenantId}:${scope === "tage" ? "tage" : "haupt"}`;

export type SyncErgebnis = { skipped: boolean; counts: Record<string, number>; errors: string[]; gestoppt?: { art: "pausiert" | "tagesbudget"; bis: Date; grund: string } };

/**
 * Ein Abgleich (wartet bis fertig). Fehler eines Teils halten die anderen nicht auf. B29.2: Ist das Tagesbudget
 * erschöpft oder pausiert sellerboard, stoppt der Lauf ohne Fehler – die Schritte bekommen den Hinweis
 * „übersprungen (Tagesbudget)“ bzw. es gibt den einen Eintrag „pausiert bis …“. Mit „seit“ (Nachholen) bleiben
 * Schritte aus, die seitdem schon erfolgreich waren.
 */
export async function syncSellerboard(tenantId: string, scope: SyncScope = "alles", opts: { automatik?: boolean; seit?: Date | null } = {}): Promise<SyncErgebnis> {
  if (!(await sbConnected(tenantId))) return { skipped: true, counts: {}, errors: [] };
  const key = sperre(tenantId, scope);
  if (running.has(key)) return { skipped: true, counts: {}, errors: [] };
  running.add(key);
  const prio: SbPrio = !opts.automatik ? "hand" : scope === "verkauf" ? "verkauf" : "normal";
  try {
    return await sbKontext.run({ prio }, () => syncLauf(tenantId, scope, opts));
  } finally {
    running.delete(key);
  }
}

async function syncLauf(tenantId: string, scope: SyncScope, opts: { automatik?: boolean; seit?: Date | null }): Promise<SyncErgebnis> {
  const beginn = new Date();
  const now = beginn;
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const { ABRUF_PLAN } = await import("@/lib/today/abruf-plan");
  let gestoppt: SbGestoppt | null = null;
  let gezaehlt = false;
  const J = schema.jobRuns;
  const erledigt = new Map<string, Date>();
  if (opts.seit) {
    const rows = await db.select({ name: J.name, ok: J.lastOkAt }).from(J).where(and(eq(J.tenantId, tenantId), like(J.name, "sellerboard: %")));
    for (const r of rows) if (r.ok) erledigt.set(r.name, r.ok);
  }
  const hinweis = async (job: string) => {
    if (!gestoppt || gestoppt.art !== "tagesbudget") return;
    await recordJobHinweis(tenantId, job, uebersprungenText(gestoppt), ABRUF_PLAN[job] ?? null);
    if (!gezaehlt) {
      gezaehlt = true;
      await uebersprungenZaehlen(tenantId);
    }
  };
  /** Schritt ausführen; false = nicht gelaufen (gestoppt oder seit der Uhrzeit schon erledigt). */
  const step = async (name: string, fn: () => Promise<void>): Promise<boolean> => {
    const job = `sellerboard: ${name}`;
    if (gestoppt) {
      await hinweis(job);
      return false;
    }
    const ok = erledigt.get(job);
    if (opts.seit && ok && ok >= opts.seit) return false;
    const t0 = Date.now();
    jobStarted(job);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([fn(), new Promise<never>((_, nein) => (timer = setTimeout(() => nein(new Error(`Zeitüberschreitung nach ${Math.round(SCHRITT_MS / 60_000)} Min. – beim nächsten Lauf erneut.`)), SCHRITT_MS)))]);
      void recordJob(tenantId, job, null, Date.now() - t0, ABRUF_PLAN[job] ?? null);
      return true;
    } catch (e) {
      if (istGestoppt(e)) {
        gestoppt = e;
        await hinweis(job);
        return false;
      }
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${name}: ${msg}`);
      void recordJob(tenantId, job, msg, Date.now() - t0, ABRUF_PLAN[job] ?? null);
      return false;
    } finally {
      clearTimeout(timer);
      jobEnded(job);
    }
  };
  const ergebnis = (): SyncErgebnis => {
    const g = gestoppt as SbGestoppt | null;
    return { skipped: false, counts, errors, ...(g ? { gestoppt: { art: g.art, bis: g.bis, grund: g.message } } : {}) };
  };
  const umfang: VerkaufUmfang =
    scope === "alles"
      ? { verlauf: "voll", topHeute: true, topGestern: true, ebay: ["monat"] }
      : (() => {
          const u = verkaufUmfang(beginn);
          return { verlauf: "fehlend", topHeute: u.topHeute, topGestern: false, ebay: [...(u.ebayGestern ? (["gestern"] as const) : []), ...(u.ebayHeute ? (["heute"] as const) : [])] };
        })();
  try {
    if (scope === "tage") {
      // B27.4/B29.1: Gewinn je Produkt und Tag + Verlust-Stopp (04:00, 13:00) – Verlust-Stopp ohne eigenen Aufruf.
      await step("Gewinn je Produkt und Tag", async () => void (counts.produktTage = await syncSkuDays(tenantId, now)));
      await step("Verlust-Stopp", async () => void (counts.verlust = await refreshVerlustTasks(tenantId, todayIso())));
      return ergebnis();
    }
    if (scope !== "verkauf") await writeConn(tenantId, { config: { syncing: scope === "alles" ? "Abgleich läuft (alles) …" : scope === "bestand" ? "Abgleich läuft (Bestand) …" : "Abgleich läuft (Tagesabrufe) …" } });
    const conn = await readConn(tenantId);
    if (!conn?.config.accountId || conn.config.hasEbay === undefined) await step("Konto", () => identifyAccount(tenantId));
    if (scope === "verkauf" || scope === "alles") {
      // Verkaufs-Kennzahlen (Startseite): eigener Stand und eigene Fehlermeldung.
      const vorher = errors.length;
      const lief = await step("Verkauf (Amazon + eBay)", async () => void (counts.verkaufTage = (await syncSales(tenantId, now, umfang)).days));
      const salesError = errors.length > vorher ? errors.pop()! : null;
      if (lief || salesError) await writeConn(tenantId, { config: { ...(lief ? { salesSyncedAt: new Date().toISOString() } : {}), salesError } });
      if (scope === "verkauf") return { ...ergebnis(), errors: salesError ? [salesError] : [] };
    }
    if (scope === "alles" || scope === "taeglich") await step("Produkte & EK", async () => void (counts.produkte = await syncProducts(tenantId, now)));
    if (scope === "alles" || scope === "bestand") {
      await step("FBA-Bestand", async () => void (counts.bestand = await syncInventory(tenantId, now)));
      await step("FBA-Sendungen", async () => void (counts.sendungen = await syncShipments(tenantId, now, scope === "alles")));
    }
    if (scope === "alles" || scope === "taeglich") {
      await step("Monatswerte & Gewinn je SKU", async () => {
        const r = await syncMonths(tenantId, now, scope === "alles" || Number(utcToday().slice(8, 10)) <= 10);
        counts.monate = r.months;
        counts.skuMonat = r.skuRows;
      });
      await step("Fixkosten", async () => void (counts.fixkosten = await syncFixCosts(tenantId)));
      await step("Produkte 30 Tage (Hebel)", async () => void (counts.hebelProdukte = await syncSkuStats(tenantId, now)));
      await step("Keepa Buy Box (Hebel)", async () => void (counts.keepa = await syncHebelKeepa(tenantId)));
    }
    await step("Hebel-Aufgaben", async () => void (counts.hebel = await refreshHebelTasks(tenantId)));
    // Fehlmengen aus den Sendungen gleich als Ansprüche prüfen.
    if (scope === "alles" || scope === "bestand") await step("Ansprüche aus Sendungen", async () => void (await syncClaims(tenantId)));
    const g = gestoppt as SbGestoppt | null;
    await writeConn(tenantId, { config: { syncing: null, ...(g ? {} : { lastSyncAt: new Date().toISOString() }), lastSyncError: errors.length ? errors.join(" · ").slice(0, 800) : null, lastCounts: { ...((await readConn(tenantId))?.config.lastCounts ?? {}), ...counts } } });
    // Von Hand: deckt die geplanten Läufe dieser Gruppen ab (kein doppelter Abruf kurz danach).
    if (!opts.automatik && !g) await laufMerken(tenantId, scope === "alles" ? ["verkauf", "bestand", "taeglich"] : scope === "bestand" ? ["bestand"] : [], beginn);
    return ergebnis();
  } catch (e) {
    if (scope !== "tage") await writeConn(tenantId, { config: { syncing: null, lastSyncError: e instanceof Error ? e.message : String(e) } }).catch(() => undefined);
    throw e;
  }
}

/** Im Hintergrund starten (Knopf „Jetzt abgleichen“, nach dem Verbinden) – von Hand, zählt nicht zur Automatik. */
export function startSellerboardSync(tenantId: string, scope: SyncScope) {
  void syncSellerboard(tenantId, scope).catch((e) => console.error("[sellerboard]", e instanceof Error ? e.message : e));
}

const automatikLaeuft = new Set<string>();

export const sellerboardSyncRunning = (tenantId: string) => running.has(`${tenantId}:haupt`) || running.has(`${tenantId}:tage`) || automatikLaeuft.has(tenantId);

/** Hinweis „übersprungen (Tagesbudget)“ an allen Abrufen einer Gruppe – einmal je Tag und Gruppe gezählt. */
async function gruppeUebersprungen(tenantId: string, scope: SbScope, text: string, jetzt: Date) {
  const { ABRUF_PLAN } = await import("@/lib/today/abruf-plan");
  const J = schema.jobRuns;
  const erster = `sellerboard: ${SB_SCHRITTE[scope][0]}`;
  const [j] = await db.select({ hinweis: J.hinweis, at: J.hinweisAt }).from(J).where(and(eq(J.tenantId, tenantId), eq(J.name, erster)));
  const schonHeute = j?.at && j.hinweis?.startsWith("übersprungen (Tagesbudget)") && j.at.toISOString().slice(0, 10) === jetzt.toISOString().slice(0, 10);
  for (const name of SB_SCHRITTE[scope]) await recordJobHinweis(tenantId, `sellerboard: ${name}`, text, ABRUF_PLAN[`sellerboard: ${name}`] ?? null);
  if (!schonHeute) await uebersprungenZaehlen(tenantId, jetzt);
}

/**
 * B29.1/B29.2: geplante sellerboard-Abrufe. Je Takt alle fälligen Gruppen nacheinander in der Reihenfolge
 * Verkauf → Gewinn je Produkt → Bestand → Tagesabrufe. Vorab der kostenlose Blick auf usage_quota (zählt auch
 * Claude). Übersprungene Gruppen bleiben fällig und werden nach der Rücksetzung (00:00 UTC) nachgeholt.
 */
export async function sbAutomatik(tenantId: string): Promise<{ gelaufen: SbScope[]; uebersprungen: SbScope[]; pausiert: boolean }> {
  const aus = { gelaufen: [] as SbScope[], uebersprungen: [] as SbScope[], pausiert: false };
  if (automatikLaeuft.has(tenantId) || !(await sbConnected(tenantId))) return aus;
  automatikLaeuft.add(tenantId);
  try {
    await pauseBeenden(tenantId);
    let quotaGeholt = false;
    const versucht = new Set<SbScope>();
    for (;;) {
      const jetzt = new Date();
      const plan = await planLesen(tenantId);
      if (plan.pausiertBis && plan.pausiertBis > jetzt) {
        aus.pausiert = true;
        break;
      }
      const scope = faelligeScopes(plan.laeufe, jetzt).find((s) => !versucht.has(s));
      if (!scope) break;
      versucht.add(scope);
      if (!quotaGeholt) {
        quotaGeholt = true;
        const q = await sbQuota(tenantId);
        // Laut sellerboard schon alles verbraucht (z. B. durch Claude): gleich pausieren statt einen Fehlaufruf zu machen.
        if (q && q.limit > 0 && q.genutzt >= q.limit) {
          await pauseSetzen(tenantId, jetzt);
          aus.pausiert = true;
          break;
        }
      }
      const e = budgetEntscheidung(await budgetStand(tenantId, jetzt), scope === "verkauf" ? "verkauf" : "normal", jetzt);
      if (!e.ok) {
        if (e.art === "pausiert") {
          aus.pausiert = true;
          break;
        }
        await gruppeUebersprungen(tenantId, scope, uebersprungenText(e), jetzt);
        aus.uebersprungen.push(scope);
        continue;
      }
      const seit = new Date(letzterSlot(SB_SLOTS[scope], jetzt).getTime() - SB_NACHHOL_FENSTER_MIN[scope] * 60_000);
      const r = await syncSellerboard(tenantId, scope, { automatik: true, seit });
      if (r.skipped) break; // Hand-Abgleich läuft gerade – nächster Takt
      if (r.gestoppt) {
        if (r.gestoppt.art === "pausiert") {
          aus.pausiert = true;
          break;
        }
        aus.uebersprungen.push(scope);
        continue;
      }
      await laufMerken(tenantId, [scope], jetzt);
      aus.gelaufen.push(scope);
    }
  } finally {
    automatikLaeuft.delete(tenantId);
  }
  return aus;
}

/** Im Hintergrund (Zeitplan alle 5 Min., Knopf „Fällige Abrufe nachholen“). */
export function startSbAutomatik(tenantId: string) {
  void sbAutomatik(tenantId).catch((e) => console.error("[sellerboard]", e instanceof Error ? e.message : e));
}
