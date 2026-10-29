import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { skuCostMap } from "@/lib/money/costs";
import { getSettings } from "@/lib/settings";
import { aeltesteTage, bewerteKapital, breakEven, letzte90, type Ampel, type KapitalZeile } from "./kapital";

// Kapital-Ampel: Bestand (FBA inkl. unterwegs + eigenes Lager) × gültiger EK, Gewinn der letzten 90 Tage
// (sellerboard je Monat), Reichweite, Lageralter (Amazon-Bericht), Preis gegen Break-even, Preis-Trend (Keepa).

export async function kapitalAmpel(tenantId: string, heute: string): Promise<{ zeilen: KapitalZeile[]; stand: Date | null; summe: Record<Ampel | "gesamt", number> }> {
  const t = tenantId;
  const s = await getSettings(t);
  const SBI = schema.sellerboardInventory;
  const inv = await db.select().from(SBI).where(eq(SBI.tenantId, t));
  const own = await db.select({ sku: schema.ownStock.sku, menge: schema.ownStock.quantity }).from(schema.ownStock).where(eq(schema.ownStock.tenantId, t));
  const eigen = new Map(own.map((o) => [o.sku, o.menge]));
  const skus = [...new Set([...inv.filter((r) => r.fbaStock + r.reserved + r.inbound > 0).map((r) => r.sku), ...own.filter((o) => o.menge > 0).map((o) => o.sku)])];
  if (!skus.length) return { zeilen: [], stand: null, summe: { gruen: 0, gelb: 0, rot: 0, gesamt: 0 } };
  const [kosten, monate, alter, stats, produkte] = await Promise.all([
    skuCostMap(t),
    db.select().from(schema.sellerboardSkuMonths).where(and(eq(schema.sellerboardSkuMonths.tenantId, t), inArray(schema.sellerboardSkuMonths.sku, skus), gte(schema.sellerboardSkuMonths.month, monatMinus(heute, 4)))),
    db.select({ sku: schema.amazonLageralter.sku, alter: schema.amazonLageralter.alter }).from(schema.amazonLageralter).where(and(eq(schema.amazonLageralter.tenantId, t), inArray(schema.amazonLageralter.sku, skus))),
    db.select({ sku: schema.sellerboardSkuStats.sku, price: schema.sellerboardSkuStats.price, avg: schema.sellerboardSkuStats.avgPrice, channel: schema.sellerboardSkuStats.channel }).from(schema.sellerboardSkuStats).where(and(eq(schema.sellerboardSkuStats.tenantId, t), inArray(schema.sellerboardSkuStats.sku, skus))),
    db.select({ sku: schema.sellerboardProducts.sku, fba: schema.sellerboardProducts.fbaFee, ref: schema.sellerboardProducts.referralFee, price: schema.sellerboardProducts.price, vat: schema.sellerboardProducts.vatPct }).from(schema.sellerboardProducts).where(and(eq(schema.sellerboardProducts.tenantId, t), inArray(schema.sellerboardProducts.sku, skus))),
  ]);
  const asins = [...new Set(inv.map((r) => r.asin).filter((a): a is string => !!a))];
  const keepa = asins.length ? await db.select({ asin: schema.keepaCache.asin, stand: schema.keepaCache.stand }).from(schema.keepaCache).where(and(eq(schema.keepaCache.tenantId, t), eq(schema.keepaCache.marktplatz, "DE"), inArray(schema.keepaCache.asin, asins))) : [];
  const trend = new Map(keepa.map((k) => [k.asin, k.stand ? pct(k.stand.kennzahlen["30"].buybox.schnitt, k.stand.kennzahlen["90"].buybox.schnitt) : null]));
  const keepaPreis = new Map(keepa.map((k) => [k.asin, k.stand?.aktuell.buybox ?? null]));
  const z = { zielRendite: s.kapital.zielRendite, geringRendite: s.kapital.geringRendite, gruenReichweite: s.kapital.gruenReichweite, rotReichweite: s.kapital.rotReichweite };
  const zeilen = skus.map((sku) => {
    const i = inv.filter((r) => r.sku === sku);
    const fba = i.reduce((n, r) => n + r.fbaStock + r.reserved + r.inbound, 0);
    const stueck = fba + (eigen.get(sku) ?? 0);
    const asin = i.find((r) => r.asin)?.asin ?? null;
    const vel = i.reduce((n, r) => n + Number(r.salesVelocity ?? 0), 0);
    const m = letzte90(monate.filter((x) => x.sku === sku), heute);
    const ek = kosten.get(sku)?.cost ?? null;
    const p = produkte.find((x) => x.sku === sku);
    const st = stats.find((x) => x.sku === sku && x.channel === "amazon") ?? stats.find((x) => x.sku === sku);
    const preis = (asin ? keepaPreis.get(asin) : null) ?? st?.price ?? st?.avg ?? p?.price ?? null;
    const prov = p?.ref && p.price ? Math.abs(p.ref) / p.price : s.pricing.referralRate;
    const mwst = p?.vat !== null && p?.vat !== undefined ? Number(p.vat) / 100 : s.vatRate;
    const fbaFee = p?.fba !== null && p?.fba !== undefined ? Math.abs(p.fba) : s.pricing.defaultFbaFee;
    const alt = alter.filter((a) => a.sku === sku).map((a) => aeltesteTage(a.alter)).filter((x): x is number => x !== null);
    return bewerteKapital(
      {
        sku,
        asin,
        name: i.find((r) => r.name)?.name ?? null,
        stueck,
        ek,
        gewinn90: m.gewinn,
        stueck90: m.stueck,
        tageDaten: m.tage,
        verkaufProTag: vel > 0 ? vel : m.tage >= 30 && m.stueck > 0 ? m.stueck / m.tage : null,
        aeltesteTage: alt.length ? Math.max(...alt) : null,
        preis,
        breakEven: breakEven({ ek, fba: fbaFee, provision: prov, mwst }),
        trendProzent: asin ? (trend.get(asin) ?? null) : null,
      },
      z,
    );
  });
  zeilen.sort((a, b) => ({ rot: 0, gelb: 1, gruen: 2 })[a.ampel] - ({ rot: 0, gelb: 1, gruen: 2 })[b.ampel] || (b.kapital ?? 0) - (a.kapital ?? 0));
  const stand = inv.reduce<Date | null>((m, r) => (!m || r.syncedAt > m ? r.syncedAt : m), null);
  const summe = { gruen: 0, gelb: 0, rot: 0, gesamt: 0 };
  for (const zz of zeilen) {
    summe[zz.ampel] += zz.kapital ?? 0;
    summe.gesamt += zz.kapital ?? 0;
  }
  for (const k of Object.keys(summe) as (keyof typeof summe)[]) summe[k] = Math.round(summe[k] * 100) / 100;
  return { zeilen, stand, summe };
}

/** Ampel je SKU – für Bestellvorschläge (rot = nicht vorschlagen) und Liquidität. */
export async function ampelJeSku(tenantId: string, heute: string): Promise<Map<string, Ampel>> {
  const { zeilen } = await kapitalAmpel(tenantId, heute);
  return new Map(zeilen.map((z) => [z.sku, z.ampel]));
}

/** Kosten je SKU für Preisrechnungen: gültiger EK, FBA-Gebühr, Provision (Anteil), USt (sellerboard-Produktdaten, sonst Standard). */
export async function kostenJeSku(tenantId: string, skus: string[]): Promise<Map<string, { ek: number | null; fba: number; provision: number; mwst: number }>> {
  if (!skus.length) return new Map();
  const [s, kosten, produkte] = await Promise.all([
    getSettings(tenantId),
    skuCostMap(tenantId),
    db.select({ sku: schema.sellerboardProducts.sku, fba: schema.sellerboardProducts.fbaFee, ref: schema.sellerboardProducts.referralFee, price: schema.sellerboardProducts.price, vat: schema.sellerboardProducts.vatPct }).from(schema.sellerboardProducts).where(and(eq(schema.sellerboardProducts.tenantId, tenantId), inArray(schema.sellerboardProducts.sku, skus))),
  ]);
  return new Map(
    skus.map((sku) => {
      const p = produkte.find((x) => x.sku === sku);
      return [
        sku,
        {
          ek: kosten.get(sku)?.cost ?? null,
          fba: p?.fba !== null && p?.fba !== undefined ? Math.abs(p.fba) : s.pricing.defaultFbaFee,
          provision: p?.ref && p.price ? Math.abs(p.ref) / p.price : s.pricing.referralRate,
          mwst: p?.vat !== null && p?.vat !== undefined ? Number(p.vat) / 100 : s.vatRate,
        },
      ];
    }),
  );
}

/** Break-even (brutto) je SKU aus gültigem EK, FBA-Gebühr, Provision und USt. */
export async function breakEvenJeSku(tenantId: string, skus: string[]): Promise<Map<string, number | null>> {
  const k = await kostenJeSku(tenantId, skus);
  return new Map(skus.map((sku) => { const x = k.get(sku)!; return [sku, breakEven({ ek: x.ek, fba: x.fba, provision: x.provision, mwst: x.mwst })]; }));
}

function monatMinus(heute: string, n: number) {
  const [j, m] = heute.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}
const pct = (a: number | null, b: number | null) => (a !== null && b ? Math.round(((a - b) / b) * 1000) / 10 : null);
