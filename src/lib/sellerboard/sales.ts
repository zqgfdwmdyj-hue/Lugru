import "server-only";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
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
};

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
  const connected = Boolean(conn?.secrets.refreshToken || conn?.secrets.accessToken);
  if (!connected && !tileRows.length && !dayRows.length) return null;

  const present = new Set<SbChannel>([...tileRows, ...dayRows].map((r) => r.channel as SbChannel));
  const channels = (["amazon", "ebay"] as SbChannel[]).filter((c) => present.has(c) || (c === "amazon" && connected) || (c === "ebay" && connected && conn?.config.hasEbay !== false));

  const salesTiles: SalesTile[] = tiles.map((p) => {
    const rows = tileRows.filter((r) => r.fromDay === p.fromDay && r.toDay === p.toDay);
    const byChannel: Partial<Record<SbChannel, SbKpi>> = {};
    for (const r of rows) byChannel[r.channel as SbChannel] = toKpi(r);
    return { key: p.key, label: p.label, fromDay: p.fromDay, toDay: p.toDay, total: sumKpis(rows.map(toKpi)), byChannel };
  });

  const days: SalesDay[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.parse(`${todayUtc}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    const pick = (c: SbChannel) => {
      const r = dayRows.find((x) => x.fromDay === day && x.channel === c);
      return r ? { sales: r.sales ?? 0, netProfit: r.netProfit ?? 0 } : null;
    };
    days.push({ day, amazon: pick("amazon"), ebay: pick("ebay") });
  }

  const topFor = (day: string) => {
    const rows = topRows.filter((r) => r.day === day);
    const items: TopItem[] = rows.flatMap((r) => r.rows.map((x) => ({ ...x, channel: r.channel as SbChannel })));
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
  };
}
