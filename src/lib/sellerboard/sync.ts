import "server-only";
import { and, count, eq, inArray, like, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { recordJob } from "@/lib/today/jobs";
import { jobEnded, jobStarted } from "@/lib/perf";
import { syncClaims } from "@/lib/claims/service";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { sbAllPages, sbCall } from "./client";
import { readConn, sbConnected, writeConn } from "./connection";
import { isReturnSku } from "@/lib/money/ek-logic";
import { dayBatches, lastDays, mapEbayOrderUnits, mapFixCosts, mapInventory, mapKpis, mapMonths, mapProduct, mapShipments, mapSkuRows, mapSkuStats, mapTop, reorderNow, tilePeriods, type SbChannel, type SbInventory, type SbKpi, type SbProduct, type SbSkuStat } from "./parse";
import { refreshHebelTasks, syncHebelKeepa } from "@/lib/hebel/service";

// Abgleich mit sellerboard (nur lesend). „verkauf“ = Verkaufs-Kennzahlen Amazon + eBay (alle ~30 Min.),
// „bestand“ = zusätzlich Bestand + Sendungen (alle 4 Std.), „alles“ zusätzlich Produkte/EK, Monatswerte,
// Gewinn je SKU, Fixkosten und der 30-Tage-Verlauf (täglich). Läuft im Hintergrund, je Mandant einmal.

export type SyncScope = "verkauf" | "bestand" | "alles";
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

async function syncProducts(t: string, now: Date) {
  const rows = (await sbAllPages(t, "products", {}, 35)).map(mapProduct).filter((r): r is SbProduct => r !== null);
  const P = schema.sellerboardProducts;
  for (const part of chunks(uniqueBy(rows))) {
    await db
      .insert(P)
      .values(part.map((r) => ({ tenantId: t, ...r, vatPct: r.vatPct === null ? null : String(r.vatPct), syncedAt: now })))
      .onConflictDoUpdate({
        target: [P.tenantId, P.sbId],
        set: { sku: sql`excluded.sku`, asin: sql`excluded.asin`, ean: sql`excluded.ean`, name: sql`excluded.name`, channel: sql`excluded.channel`, cost: sql`excluded.cost`, costPeriod: sql`excluded.cost_period`, price: sql`excluded.price`, fbaFee: sql`excluded.fba_fee`, referralFee: sql`excluded.referral_fee`, vatPct: sql`excluded.vat_pct`, margin: sql`excluded.margin`, syncedAt: sql`excluded.synced_at` },
      });
  }
  // In sellerboard gelöschte Produkte: weg (der EK käme sonst aus einer alten Liste).
  if (rows.length) await db.delete(P).where(and(eq(P.tenantId, t), lt(P.syncedAt, now)));
  return rows.length;
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

async function syncInventory(t: string, now: Date) {
  const rows = (await sbAllPages(t, "inventory", { channel: "FBA" }, 35)).map(mapInventory).filter((r): r is SbInventory => r !== null).filter((r) => (r.channel ?? "FBA").toUpperCase() === "FBA");
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

async function syncShipments(t: string, now: Date) {
  const begin = Math.floor(Date.now() / 1000) - 150 * 86_400;
  const all: ReturnType<typeof mapShipments> = [];
  let total = Infinity;
  for (let page = 1; (page - 1) * 8 < total && page <= 200; page++) {
    const reply = await sbCall(t, "fba_shipments", { begin_date: begin, page, count: 8 });
    total = Number(reply.total ?? 0);
    const got = mapShipments(reply);
    all.push(...got);
    if (!((reply.result as unknown[] | undefined) ?? []).length) break;
  }
  const S = schema.sellerboardShipments;
  for (const part of chunks(uniqueBy(all), 200)) {
    await db
      .insert(S)
      .values(part.map((s) => ({ tenantId: t, ...s, syncedAt: now })))
      .onConflictDoUpdate({ target: [S.tenantId, S.sbId], set: { amazonId: sql`excluded.amazon_id`, name: sql`excluded.name`, status: sql`excluded.status`, createdOn: sql`excluded.created_on`, lastUpdate: sql`excluded.last_update`, lines: sql`excluded.lines`, syncedAt: sql`excluded.synced_at` } });
  }
  return all.length;
}

async function syncMonths(t: string, now: Date) {
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
  for (const p of periods.slice(-2)) {
    await sbCall(t, "dashboard_period", { periods: [{ start: p.start, end: p.end }] });
    const rows: ReturnType<typeof mapSkuRows> = [];
    let total = Infinity;
    for (let page = 1; (page - 1) * 35 < total && page <= 120; page++) {
      const reply = await sbCall(t, "dashboard_table", { entry_type: "product", period_start: p.start, period_end: p.end, page, count: 35 });
      total = Number(reply.total ?? 0);
      rows.push(...mapSkuRows(reply));
      if (!((reply.result as unknown[] | undefined) ?? []).length) break;
    }
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
  const T = schema.sellerboardTop;
  const total = Number(reply.total ?? rows.length) || 0;
  await db
    .insert(T)
    .values({ tenantId: t, channel, day: day.fromDay, total, rows, syncedAt: now })
    .onConflictDoUpdate({ target: [T.tenantId, T.channel, T.day], set: { total, rows, syncedAt: now } });
}

/**
 * Verkaufs-Kennzahlen wie die sellerboard-Kacheln (heute, gestern, Monat bis heute, letzter Monat) je Kanal,
 * Top-Produkte heute/gestern und – täglich oder wenn er fehlt – der Verlauf der letzten 30 Tage.
 */
async function syncSales(t: string, now: Date, withHistory: boolean) {
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
    for (const d of tiles.slice(0, 2)) await syncTop(t, channel, d, now);
    // eBay: Bestellmengen je SKU (für den Gewinn mit EK aus dem Seller-System) – heute/gestern laufend,
    // 31 Tage und letzter Monat beim großen Abgleich.
    if (channel === "ebay") {
      const d31 = { start: tiles[0].start - 30 * 86_400, end: tiles[0].end, fromDay: new Date((tiles[0].start - 30 * 86_400) * 1000).toISOString().slice(0, 10), toDay: tiles[0].toDay };
      await syncEbayUnits(t, withHistory ? [d31, tiles[3]] : [tiles[1], tiles[0]], now);
    }
    const [have] = await db.select({ n: count() }).from(K).where(and(eq(K.tenantId, t), eq(K.channel, channel), sql`${K.fromDay} = ${K.toDay}`, sql`${K.fromDay} >= ${today}::date - 29`));
    if (withHistory || (have?.n ?? 0) < 30) {
      for (const batch of dayBatches(today, 30)) {
        const r = await sbCall(t, TOOLS[channel].period, { periods: batch });
        const rows = mapKpis(r);
        await saveKpis(t, channel, rows, now);
        days += rows.length;
      }
    }
  }
  // Aufräumen: alte „Monat bis heute“-Bereiche, Tage älter als 120 Tage, Top-Listen älter als 14 Tage.
  await db.delete(K).where(and(eq(K.tenantId, t), ne(K.fromDay, K.toDay), lt(K.syncedAt, new Date(now.getTime() - 2 * 86_400_000))));
  await db.delete(K).where(and(eq(K.tenantId, t), sql`${K.toDay} < ${today}::date - 120`));
  const T = schema.sellerboardTop;
  await db.delete(T).where(and(eq(T.tenantId, t), sql`${T.day} < ${today}::date - 14`));
  return { channels: channels.length, days };
}

const isNotWarmed = (e: unknown) => /NOT_WARMED|not warmed/i.test(e instanceof Error ? e.message : String(e));

/** Alle Seiten einer Dashboard-Tabelle; ist der Zeitraum nicht (mehr) vorbereitet, einmal nachwärmen. */
async function tablePages(t: string, channel: SbChannel, args: Record<string, unknown> & { period_start: number; period_end: number }, count: number, maxPages: number) {
  const rows: Record<string, unknown>[] = [];
  let total = Infinity;
  let warmed = false;
  for (let page = 1; page <= maxPages && (page - 1) * count < total; ) {
    let reply: Record<string, unknown>;
    try {
      reply = await sbCall(t, TOOLS[channel].table, { ...args, page, count });
    } catch (e) {
      if (!isNotWarmed(e) || warmed) throw e;
      await sbCall(t, TOOLS[channel].period, { periods: [{ start: args.period_start, end: args.period_end }] });
      warmed = true;
      continue;
    }
    const list = (reply.result as Record<string, unknown>[] | undefined) ?? [];
    total = Number(reply.total ?? list.length);
    rows.push(...list);
    if (!list.length) break;
    page++;
  }
  return { result: rows, total: rows.length };
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
    const reply = await tablePages(t, channel, { entry_type: "product", period_start: p.start, period_end: p.end, sort: "sales desc" }, 35, 60);
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

/** Ein Abgleich (wartet bis fertig). Fehler eines Teils halten die anderen nicht auf. */
export async function syncSellerboard(tenantId: string, scope: SyncScope = "alles") {
  if (!(await sbConnected(tenantId))) return { skipped: true };
  if (running.has(tenantId)) return { skipped: true };
  running.add(tenantId);
  const now = new Date();
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    const job = `sellerboard: ${name}`;
    jobStarted(job);
    try {
      await fn();
      void recordJob(tenantId, job, null, Date.now() - t0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${name}: ${msg}`);
      void recordJob(tenantId, job, msg, Date.now() - t0);
    } finally {
      jobEnded(job);
    }
  };
  try {
    if (scope !== "verkauf") await writeConn(tenantId, { config: { syncing: scope === "alles" ? "Abgleich läuft (alles) …" : "Abgleich läuft (Bestand) …" } });
    const conn = await readConn(tenantId);
    if (!conn?.config.accountId || conn.config.hasEbay === undefined) await step("Konto", () => identifyAccount(tenantId));
    // Verkaufs-Kennzahlen (Startseite): eigener Stand und eigene Fehlermeldung – der kurze Abgleich alle
    // 30 Minuten überschreibt nicht die Meldungen des großen Abgleichs.
    const salesErrors = errors.length;
    await step("Verkauf (Amazon + eBay)", async () => void (counts.verkaufTage = (await syncSales(tenantId, now, scope === "alles")).days));
    const salesError = errors.length > salesErrors ? errors.pop()! : null;
    await writeConn(tenantId, { config: { salesSyncedAt: new Date().toISOString(), salesError } });
    if (scope === "verkauf") return { skipped: false, counts, errors: salesError ? [salesError] : [] };
    if (scope === "alles") await step("Produkte & EK", async () => void (counts.produkte = await syncProducts(tenantId, now)));
    await step("FBA-Bestand", async () => void (counts.bestand = await syncInventory(tenantId, now)));
    await step("FBA-Sendungen", async () => void (counts.sendungen = await syncShipments(tenantId, now)));
    if (scope === "alles") {
      await step("Monatswerte & Gewinn je SKU", async () => {
        const r = await syncMonths(tenantId, now);
        counts.monate = r.months;
        counts.skuMonat = r.skuRows;
      });
      await step("Fixkosten", async () => void (counts.fixkosten = await syncFixCosts(tenantId)));
      await step("Produkte 30 Tage (Hebel)", async () => void (counts.hebelProdukte = await syncSkuStats(tenantId, now)));
      await step("Keepa Buy Box (Hebel)", async () => void (counts.keepa = await syncHebelKeepa(tenantId)));
    }
    if (scope === "alles" || scope === "bestand") await step("Hebel-Aufgaben", async () => void (counts.hebel = await refreshHebelTasks(tenantId)));
    // Fehlmengen aus den Sendungen gleich als Ansprüche prüfen.
    await step("Ansprüche aus Sendungen", async () => void (await syncClaims(tenantId)));
    await writeConn(tenantId, { config: { syncing: null, lastSyncAt: new Date().toISOString(), lastSyncError: errors.length ? errors.join(" · ").slice(0, 800) : null, lastCounts: { ...((await readConn(tenantId))?.config.lastCounts ?? {}), ...counts } } });
    return { skipped: false, counts, errors };
  } catch (e) {
    await writeConn(tenantId, { config: { syncing: null, lastSyncError: e instanceof Error ? e.message : String(e) } }).catch(() => undefined);
    throw e;
  } finally {
    running.delete(tenantId);
  }
}

/** Im Hintergrund starten (Knopf „Jetzt abgleichen“, nach dem Verbinden, Zeitplan). */
export function startSellerboardSync(tenantId: string, scope: SyncScope) {
  void syncSellerboard(tenantId, scope).catch((e) => console.error("[sellerboard]", e instanceof Error ? e.message : e));
}

export const sellerboardSyncRunning = (tenantId: string) => running.has(tenantId);
