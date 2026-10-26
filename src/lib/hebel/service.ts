import "server-only";
import { and, eq, gte, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { skuCostMap } from "@/lib/money/costs";
import { keepaKey, keepaProducts } from "@/lib/integrations/clients/keepa";
import { parseKeepaOwn } from "@/lib/brands/shop";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { computeHebel, hebelTask, summarize, HEBEL_INFO, type BuyBox, type Hebel, type HebelSummary, type HebelType, type StatInput, type StockInput } from "./rules";

// Hebel laden (für Seite, Startseite und Aufgaben), Buy Box per Keepa nachholen, Aufgaben pflegen.

const todayIso = () => new Date().toISOString().slice(0, 10);

export type HebelData = { list: Hebel[]; summary: HebelSummary[]; statsFrom: string | null; statsTo: string | null; syncedAt: Date | null; dismissed: number };

export async function loadHebel(tenantId: string): Promise<HebelData> {
  const S = schema.sellerboardSkuStats;
  const I = schema.sellerboardInventory;
  const K = schema.hebelKeepa;
  const D = schema.hebelDismissals;
  const [stats, stock, keepa, dism, costs] = await Promise.all([
    db.select().from(S).where(eq(S.tenantId, tenantId)),
    db.select().from(I).where(and(eq(I.tenantId, tenantId), gte(I.fbaStock, 1))),
    db.select().from(K).where(eq(K.tenantId, tenantId)),
    db.select().from(D).where(and(eq(D.tenantId, tenantId), gte(D.until, todayIso()))),
    skuCostMap(tenantId),
  ]);
  const ownCost = new Map<string, number>();
  for (const [sku, c] of costs) {
    // EK aus sellerboard selbst zählt hier nicht als „eigener“ EK (sonst doppelt abgezogen).
    if (c.source !== "sellerboard" && c.cost > 0) ownCost.set(sku, c.cost);
  }
  const statInputs: StatInput[] = stats.map((r) => ({
    channel: r.channel as StatInput["channel"],
    sku: r.sku,
    name: r.name,
    asin: r.asin,
    image: r.image,
    link: r.link,
    units: r.units,
    refunds: r.refunds,
    sales: r.sales,
    netProfit: r.netProfit,
    fees: r.fees,
    productCosts: r.productCosts,
    advertising: r.advertising,
    vat: r.vat,
    refundCost: r.refundCost,
    price: r.price,
    sessions: r.sessions,
    conversion: r.conversion === null ? null : Number(r.conversion),
    daysLeft: r.daysLeft,
    timeToReorder: r.timeToReorder,
    costMissing: r.costMissing,
  }));
  // Ladenhüter: je SKU zusammengefasst (mehrere FNSKU/Marktplätze möglich).
  const bySku = new Map<string, StockInput>();
  for (const r of stock) {
    const cur = bySku.get(r.sku);
    const v = r.salesVelocity === null ? null : Number(r.salesVelocity);
    if (!cur) bySku.set(r.sku, { sku: r.sku, name: r.name, asin: r.asin, fbaStock: r.fbaStock, daysLeft: r.daysLeft, salesVelocity: v, stockValue: r.stockValue, cost: r.cost });
    else Object.assign(cur, { fbaStock: cur.fbaStock + r.fbaStock, stockValue: cur.stockValue === null && r.stockValue === null ? null : (cur.stockValue ?? 0) + (r.stockValue ?? 0), salesVelocity: cur.salesVelocity === null && v === null ? null : (cur.salesVelocity ?? 0) + (v ?? 0), daysLeft: null });
  }
  const buyBox = new Map<string, BuyBox>(keepa.map((k) => [k.asin, { price: k.buyBoxPrice, hasBuyBox: k.hasBuyBox, isAmazon: k.buyBoxIsAmazon }]));
  const list = computeHebel({ stats: statInputs, stock: [...bySku.values()], ownCost, buyBox, dismissed: new Set(dism.map((d) => d.key)) });
  const first = stats[0];
  return { list, summary: summarize(list), statsFrom: first?.fromDay ?? null, statsTo: first?.toDay ?? null, syncedAt: first?.syncedAt ?? null, dismissed: dism.length };
}

/** Eine Sammelaufgabe je Hebel-Art (Wirkung ab 20 € bzw. EK fehlt); nichts mehr da → automatisch erledigt. */
export async function refreshHebelTasks(tenantId: string, opts: { reopen?: boolean } = {}): Promise<number> {
  const { list, summary } = await loadHebel(tenantId);
  const types = Object.keys(HEBEL_INFO) as HebelType[];
  let n = 0;
  for (const type of types) {
    const key = `hebel-${type}`;
    const sum = summary.find((s) => s.type === type);
    const task = sum && (sum.impact >= 20 || type === "ek_fehlt") ? hebelTask(sum, list.filter((h) => h.type === type)) : null;
    if (task) {
      await upsertSystemTask(db, tenantId, key, { title: task.title, notes: task.notes, category: type === "ek_fehlt" ? "einkauf" : "geld", link: `/hebel?typ=${type}`, dueDate: todayIso() });
      // Ausdrücklich wieder eingeblendet: die Aufgabe gilt wieder (sonst bleibt eine erledigte erledigt).
      if (opts.reopen) await db.update(schema.tasks).set({ status: "open", completedAt: null }).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.systemKey, key)));
      n++;
    } else await resolveSystemTask(db, tenantId, key);
  }
  return n;
}

/**
 * Buy Box laut Keepa für die wichtigsten Kandidaten (Verlust, Marge, Kaufquote, knappe Reichweite), höchstens
 * 30 ASINs am Tag und je ASIN höchstens einmal in 20 Stunden (≈ 3 Tokens je ASIN). Ohne Keepa-Schlüssel: nichts.
 */
export async function syncHebelKeepa(tenantId: string): Promise<number> {
  const key = await keepaKey(tenantId);
  if (!key) return 0;
  const S = schema.sellerboardSkuStats;
  const K = schema.hebelKeepa;
  const [stats, fresh] = await Promise.all([
    db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.channel, "amazon"))),
    db.select({ asin: K.asin }).from(K).where(and(eq(K.tenantId, tenantId), gte(K.fetchedAt, new Date(Date.now() - 20 * 3_600_000)))),
  ]);
  const skip = new Set(fresh.map((f) => f.asin));
  const candidates = stats
    .filter((s) => s.asin && !skip.has(s.asin) && s.units >= 3 && (s.sales ?? 0) > 0)
    .filter((s) => {
      const m = ((s.netProfit ?? 0) / (s.sales ?? 1)) * 100;
      return m < 15 || (s.daysLeft !== null && s.daysLeft <= 21) || (s.sessions ?? 0) >= 300;
    })
    .sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0));
  const asins = [...new Set(candidates.map((c) => c.asin!))].slice(0, 30);
  if (!asins.length) return 0;
  const { products } = await keepaProducts(key, asins, { buybox: true });
  const now = new Date();
  let n = 0;
  for (const p of products) {
    const d = parseKeepaOwn(p);
    if (!d) continue;
    const values = { buyBoxPrice: d.hasBuyBox ? d.price : null, hasBuyBox: d.hasBuyBox, buyBoxIsAmazon: d.buyBoxIsAmazon, buyBoxIsFba: d.buyBoxIsFBA, buyBoxSellerId: d.buyBoxSellerId, fetchedAt: now };
    await db.insert(K).values({ tenantId, asin: d.asin, ...values }).onConflictDoUpdate({ target: [K.tenantId, K.asin], set: values });
    n++;
  }
  await db.delete(K).where(and(eq(K.tenantId, tenantId), lt(K.fetchedAt, new Date(Date.now() - 30 * 86_400_000))));
  return n;
}

/** Hebel ausblenden (z. B. erledigt) – nach `days` Tagen erscheint er wieder, falls er dann noch zutrifft. */
export async function dismissHebel(tenantId: string, key: string, days = 30) {
  const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const D = schema.hebelDismissals;
  await db.insert(D).values({ tenantId, key, until }).onConflictDoUpdate({ target: [D.tenantId, D.key], set: { until } });
}

export async function undismissAll(tenantId: string) {
  await db.delete(schema.hebelDismissals).where(eq(schema.hebelDismissals.tenantId, tenantId));
}
