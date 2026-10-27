import "server-only";
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { skuCostMap } from "@/lib/money/costs";
import { db, schema } from "@/db";
import { readConn } from "./connection";
import { sumKpis, tilePeriods, type KpiSum, type SbChannel, type SbKpi, type SbTop } from "./parse";

// Verkaufs-Kennzahlen für die Startseite (aus dem letzten sellerboard-Abgleich, Amazon + eBay).

export type SalesTile = { key: string; label: string; fromDay: string; toDay: string; total: KpiSum; byChannel: Partial<Record<SbChannel, SbKpi>> };
export type SalesDay = { day: string; amazon: { sales: number; netProfit: number } | null; ebay: { sales: number; netProfit: number } | null };
export type TopItem = SbTop & { channel: SbChannel };
export type SalesOverview = {
  syncedAt: string | null;
  error: string | null;
  channels: SbChannel[];
  tiles: SalesTile[];
  days: SalesDay[];
  top: { heute: { rows: TopItem[]; total: number }; gestern: { rows: TopItem[]; total: number } };
  /** eBay-Gewinn mit EK aus dem Seller-System gerechnet (sellerboard kennt dort keinen EK). */
  ebayOwnCost: boolean;
};

type UnitsRow = { day: string; sku: string; units: number; unitsWithCost: number };

/**
 * EK für eBay-Einheiten, für die sellerboard keinen EK abgezogen hat, aus dem Seller-System. covered = es gibt
 * Bestellmengen für den Zeitraum; missing = verkaufte SKU ohne EK im Seller-System.
 */
export function ebayOwnCost(rows: UnitsRow[], from: string, to: string, cost: Map<string, number>) {
  let ek = 0;
  let covered = false;
  let missing = false;
  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    covered = true;
    const open = r.units - r.unitsWithCost;
    if (open <= 0) continue;
    const c = cost.get(r.sku);
    if (c === undefined) missing = true;
    else ek += open * c;
  }
  return { ek: Math.round(ek * 100) / 100, covered, missing };
}

const toKpi = (r: typeof schema.sellerboardKpis.$inferSelect): SbKpi => ({
  fromDay: r.fromDay,
  toDay: r.toDay,
  sales: r.sales,
  orders: r.orders,
  units: r.units,
  refunds: r.refunds,
  advertising: r.advertising,
  payout: r.payout,
  grossProfit: r.grossProfit,
  netProfit: r.netProfit,
  missingCost: r.missingCost,
});

/** null = sellerboard nicht verbunden und keine Werte vorhanden (Bereich ausblenden). */
export async function loadSalesOverview(tenantId: string, todayUtc = new Date().toISOString().slice(0, 10)): Promise<SalesOverview | null> {
  const conn = await readConn(tenantId);
  const K = schema.sellerboardKpis;
  const tiles = tilePeriods(todayUtc);
  const [tileRows, dayRows, topRows] = await Promise.all([
    db.select().from(K).where(and(eq(K.tenantId, tenantId), or(...tiles.map((p) => and(eq(K.fromDay, p.fromDay), eq(K.toDay, p.toDay)))))),
    db
      .select()
      .from(K)
      .where(and(eq(K.tenantId, tenantId), sql`${K.fromDay} = ${K.toDay}`, gte(K.fromDay, sql`${todayUtc}::date - 29`))),
    db
      .select()
      .from(schema.sellerboardTop)
      .where(and(eq(schema.sellerboardTop.tenantId, tenantId), inArray(schema.sellerboardTop.day, [tiles[0].fromDay, tiles[1].fromDay]))),
  ]);
  // eBay: Bestellmengen je Tag/SKU und EK aus dem Seller-System (nicht der EK aus sellerboard selbst).
  const oldest = [tiles[3].fromDay, new Date(Date.parse(`${todayUtc}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)].sort()[0];
  const U = schema.sellerboardEbayUnits;
  const [unitRows, costs] = await Promise.all([db.select().from(U).where(and(eq(U.tenantId, tenantId), gte(U.day, oldest))), skuCostMap(tenantId)]);
  const own = new Map<string, number>();
  for (const [sku, c] of costs) if (c.source !== "sellerboard" && c.cost > 0) own.set(sku, c.cost);
  let ebayOwn = false;
  const fixEbay = (k: SbKpi): SbKpi => {
    const r = ebayOwnCost(unitRows, k.fromDay, k.toDay, own);
    if (!r.covered) return k;
    ebayOwn = true;
    return { ...k, netProfit: k.netProfit === null ? null : Math.round((k.netProfit - r.ek) * 100) / 100, grossProfit: k.grossProfit === null ? null : Math.round((k.grossProfit - r.ek) * 100) / 100, missingCost: r.missing };
  };
  const toKpiFixed = (r: typeof schema.sellerboardKpis.$inferSelect) => (r.channel === "ebay" ? fixEbay(toKpi(r)) : toKpi(r));
  const connected = Boolean(conn?.secrets.refreshToken || conn?.secrets.accessToken);
  if (!connected && !tileRows.length && !dayRows.length) return null;

  const present = new Set<SbChannel>([...tileRows, ...dayRows].map((r) => r.channel as SbChannel));
  const channels = (["amazon", "ebay"] as SbChannel[]).filter((c) => present.has(c) || (c === "amazon" && connected) || (c === "ebay" && connected && conn?.config.hasEbay !== false));

  const salesTiles: SalesTile[] = tiles.map((p) => {
    const rows = tileRows.filter((r) => r.fromDay === p.fromDay && r.toDay === p.toDay);
    const byChannel: Partial<Record<SbChannel, SbKpi>> = {};
    for (const r of rows) byChannel[r.channel as SbChannel] = toKpiFixed(r);
    return { key: p.key, label: p.label, fromDay: p.fromDay, toDay: p.toDay, total: sumKpis(Object.values(byChannel)), byChannel };
  });

  const days: SalesDay[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.parse(`${todayUtc}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    const pick = (c: SbChannel) => {
      const r = dayRows.find((x) => x.fromDay === day && x.channel === c);
      if (!r) return null;
      const k = toKpiFixed(r);
      return { sales: k.sales ?? 0, netProfit: k.netProfit ?? 0 };
    };
    days.push({ day, amazon: pick("amazon"), ebay: pick("ebay") });
  }

  const topFor = (day: string) => {
    const rows = topRows.filter((r) => r.day === day);
    const items: TopItem[] = rows.flatMap((r) =>
      r.rows.map((x) => {
        if (r.channel !== "ebay" || !x.sku || x.netProfit === null) return { ...x, channel: r.channel as SbChannel };
        const u = unitRows.find((y) => y.day === day && y.sku === x.sku);
        const c = own.get(x.sku);
        const open = u ? Math.min(x.units, u.units - u.unitsWithCost) : 0;
        return { ...x, channel: r.channel as SbChannel, netProfit: c !== undefined && open > 0 ? Math.round((x.netProfit - open * c) * 100) / 100 : x.netProfit };
      }),
    );
    items.sort((a, b) => b.units - a.units || (b.sales ?? 0) - (a.sales ?? 0));
    return { rows: items.slice(0, 10), total: rows.reduce((s, r) => s + r.total, 0) };
  };

  return {
    syncedAt: conn?.config.salesSyncedAt ?? null,
    error: conn?.config.salesError ?? null,
    channels,
    tiles: salesTiles,
    days,
    top: { heute: topFor(tiles[0].fromDay), gestern: topFor(tiles[1].fromDay) },
    ebayOwnCost: ebayOwn,
  };
}

export type SbRange = {
  from: string;
  to: string;
  /** Umsatz brutto (inkl. USt.) wie im sellerboard-Dashboard. */
  sales: number;
  grossProfit: number;
  netProfit: number;
  orders: number;
  units: number;
  channels: SbChannel[];
  /** Alle Tage des Zeitraums vorhanden (oder genau dieser Zeitraum gespeichert). */
  complete: boolean;
  daysCovered: number;
  daysWanted: number;
  ebayOwnCost: boolean;
  missingCost: boolean;
};

/**
 * sellerboard-Werte für einen beliebigen Zeitraum (für die Überleitung auf der Gewinnseite): genau gespeicherter
 * Zeitraum (Monat bis heute, letzter Monat) oder Summe der Tageswerte (letzte 30 Tage). eBay mit eigenem EK wie
 * auf der Startseite. null = keine sellerboard-Werte.
 */
export async function sellerboardRange(tenantId: string, from: string, to: string): Promise<SbRange | null> {
  const K = schema.sellerboardKpis;
  const U = schema.sellerboardEbayUnits;
  const [exact, dayRows, unitRows, costs] = await Promise.all([
    db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.fromDay, from), eq(K.toDay, to))),
    db.select().from(K).where(and(eq(K.tenantId, tenantId), sql`${K.fromDay} = ${K.toDay}`, gte(K.fromDay, from), lte(K.fromDay, to))),
    db.select().from(U).where(and(eq(U.tenantId, tenantId), gte(U.day, from), lte(U.day, to))),
    skuCostMap(tenantId),
  ]);
  const daysWanted = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const rows = exact.length && from !== to ? exact : dayRows;
  if (!rows.length) return null;
  const own = new Map<string, number>();
  for (const [sku, c] of costs) if (c.source !== "sellerboard" && c.cost > 0) own.set(sku, c.cost);
  let ebayOwn = false;
  let missingCost = false;
  const kpis = rows.map((r) => {
    let k = toKpi(r);
    if (r.channel === "ebay") {
      const e = ebayOwnCost(unitRows, r.fromDay, r.toDay, own);
      if (e.covered) {
        ebayOwn = true;
        k = { ...k, netProfit: k.netProfit === null ? null : k.netProfit - e.ek, grossProfit: k.grossProfit === null ? null : k.grossProfit - e.ek, missingCost: e.missing };
      }
    }
    if (k.missingCost) missingCost = true;
    return k;
  });
  const sum = sumKpis(kpis);
  const daysCovered = rows === exact ? daysWanted : new Set(dayRows.map((r) => r.fromDay)).size;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    from,
    to,
    sales: r2(sum.sales),
    grossProfit: r2(sum.grossProfit),
    netProfit: r2(sum.netProfit),
    orders: sum.orders,
    units: sum.units,
    channels: [...new Set(rows.map((r) => r.channel as SbChannel))],
    complete: daysCovered >= daysWanted,
    daysCovered,
    daysWanted,
    ebayOwnCost: ebayOwn,
    missingCost,
  };
}
