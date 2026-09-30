import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { checklistFor, type BrandProfile } from "@/lib/brands/ai";
import { occasionByKey, upcomingOccasions } from "@/lib/brands/occasions";
import { tiktokTopSellers } from "@/lib/brands/shop-service";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { upsertSystemTask } from "@/lib/tasks/system";
import { boxPrompt, calcBox, goodsBudget, parseBoxes, pricingFor, repairPrompt, type BoxDraft, type CatalogItem } from "./boxes";
import { summarizeMarket } from "@/lib/brands/market";
import { keepaKey, keepaSearch } from "@/lib/integrations/clients/keepa";
import type { MarketData } from "@/db/tables/brands";
import { packInfo } from "./scan";

const O = schema.supplierOffers;
const F = schema.supplierFeeds;
const I = schema.ideas;

export type BoxOptions = { feedId: string | null; allFeeds: boolean; brandId: string; occasion: string | null; count: number; wish?: string; packaging: number; fbaFee: number };

/**
 * Boxen aus den Artikeln eines Feeds (oder aller Feeds) vorschlagen lassen und als Ideen im Marken-Board anlegen.
 * Die KI wählt nur Artikel und Mengen – Einkauf und Gewinn rechnet das System mit den echten Einzelpreisen.
 */
export async function suggestBoxes(tenantId: string, userId: string | null, o: BoxOptions) {
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) throw new Error("Für Box-Vorschläge unter Anbindungen → KI (Claude) einen Schlüssel eintragen.");
  const [brand] = await db.select().from(schema.brands).where(and(eq(schema.brands.tenantId, tenantId), eq(schema.brands.id, o.brandId)));
  if (!brand) throw new Error("Marke nicht gefunden.");

  const rows = await db
    .select({ id: O.id, title: O.title, url: O.url, price: O.price, stock: O.stock, market: O.market, mapping: F.mapping, feedName: F.name })
    .from(O)
    .innerJoin(F, eq(F.id, O.feedId))
    .where(and(eq(O.tenantId, tenantId), isNotNull(O.price), isNotNull(O.title), ...(o.allFeeds || !o.feedId ? [] : [eq(O.feedId, o.feedId)])))
    .limit(400);
  const catalog: CatalogItem[] = rows
    .filter((r) => r.stock !== 0)
    .map((r, n) => {
      const p = packInfo(r.title!, r.url);
      const withCosts = Number(r.price) * (1 + Number(r.mapping.costPct || 0) / 100);
      return { nr: n + 1, offerId: r.id, title: r.title!.slice(0, 100), unitCost: Math.round((withCosts / p.caseQty) * 100) / 100, unitSize: p.unitSize, amazonPrice: r.market?.price ?? null, monthlySold: r.market?.monthlySold ?? null };
    })
    .slice(0, 300);
  if (catalog.length < 3) throw new Error("Zu wenige Artikel mit Preis – erst eine Liste oder Seite scannen.");

  const occ = o.occasion ? occasionByKey(o.occasion) : null;
  const upcoming = occ ? upcomingOccasions(todayIso(), { [occ.key]: brand.occasions[occ.key] ?? occ.leadWeeks })[0] : null;
  const existing = (await db.select({ title: I.title }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.brandId, brand.id)))).map((r) => r.title);
  const trends = await tiktokTopSellers(tenantId, brand.id, 15);

  const r = await askClaude(
    ai.apiKey,
    boxPrompt({ brand: brand as BrandProfile, occasion: upcoming ? { name: upcoming.name, date: upcoming.date } : null, trends, catalog, count: o.count, wish: o.wish, packaging: o.packaging, existing }),
    { model: modelFor(ai, "creative"), task: "creative", maxTokens: 6000, timeoutMs: 180_000 },
  );
  const boxes = parseBoxes(r.text, catalog);
  if (!boxes.length) throw new Error("Die KI hat keine verwertbaren Boxen geliefert – bitte noch einmal versuchen.");

  const vat = o.allFeeds ? Number(brand.vatRate) : Number(rows[0]?.mapping.vatPct || brand.vatRate);
  const launch = upcoming ? addDaysIso(upcoming.date, -14) : null;
  const feedNames = [...new Set(rows.map((x) => x.feedName))].join(", ");
  const keepa = await keepaKey(tenantId);
  const storageFee = (await getSettings(tenantId)).pricing.storageFee;
  // Amazon-Vergleich je Suchbegriff einmal (Keepa, ca. 10 Tokens je Suche).
  const markets = new Map<string, MarketData | null>();
  const marketFor = async (term: string) => {
    if (!keepa || !term) return null;
    if (!markets.has(term)) {
      markets.set(term, await keepaSearch(keepa, term).then((r) => ({ source: "keepa" as const, term, fetchedAt: new Date().toISOString(), products: r.products.slice(0, 20) })).catch(() => null));
    }
    return markets.get(term) ?? null;
  };
  const evaluate = async (b: BoxDraft, term = b.searchTerm) => {
    const market = await marketFor(term);
    const m = market?.products.length ? summarizeMarket(market.products) : null;
    const pr = pricingFor(b.targetPrice, m, o.fbaFee);
    const box = { ...b, searchTerm: term, targetPrice: pr.price };
    const c = calcBox(box, catalog, { packaging: o.packaging, vatRate: vat, fbaFee: pr.fbaFee, referralPct: pr.referralPct, storageFee });
    return { box, market, m, pr, c };
  };
  const MIN_MARGIN = 20;
  const weak = (e: Awaited<ReturnType<typeof evaluate>>) => !e.c.profit || e.c.profit.margin < MIN_MARGIN;
  const evals = [];
  for (const b of boxes) evals.push(await evaluate(b));

  // Zweite Runde: unrentable Boxen mit Warenbudget aus den Marktdaten neu zusammenstellen lassen.
  const failing = evals.map((e, n) => ({ e, n })).filter(({ e }) => weak(e) && e.box.targetPrice);
  let repaired = 0;
  if (failing.length) {
    const r2 = await askClaude(
      ai.apiKey,
      repairPrompt({
        catalog,
        boxes: failing.map(({ e }) => ({ title: e.box.title, concept: e.box.concept, price: e.box.targetPrice!, current: e.c.goods, budget: goodsBudget({ price: e.box.targetPrice!, vatRate: vat, referralPct: e.pr.referralPct, fbaFee: e.pr.fbaFee, packaging: o.packaging }) })),
      }),
      { model: modelFor(ai, "creative"), task: "creative", maxTokens: 5000, timeoutMs: 180_000 },
    ).catch(() => null);
    const revised = r2 ? parseBoxes(r2.text, catalog) : [];
    for (const [k, { e, n }] of failing.entries()) {
      const rb = revised[k];
      if (!rb) continue;
      const again = await evaluate({ ...rb, title: rb.title || e.box.title }, e.box.searchTerm);
      if ((again.c.profit?.profit ?? -Infinity) > (e.c.profit?.profit ?? -Infinity)) {
        evals[n] = again;
        repaired++;
      }
    }
  }
  const keep = evals.filter((e) => (e.c.profit?.profit ?? 0) > 0);
  const dropped = evals.length - keep.length;
  if (!keep.length) {
    const worst = evals.map((e) => `${e.box.title}: Einkauf ${formatEuro(e.c.cost)} bei VK ${formatEuro(e.box.targetPrice)}`).join("; ");
    throw new Error(`Keine Box war rentabel (${worst}). Günstigere Artikel scannen, den Nebenkosten-Aufschlag prüfen oder einen Wunsch wie „unter 25 €“ angeben.`);
  }

  const values = [];
  const best: { title: string; profit: number | null; margin: number | null; compared: number }[] = [];
  for (const { box, market, m, pr, c } of keep) {
    const calcText = [
      `Kalkulation (automatisch aus Lieferanten-Preisen, ${c.units} Einheiten):`,
      ...c.lines.map((l) => `- ${l}`),
      `Ware ${formatEuro(c.goods)} + Verpackung ${formatEuro(o.packaging)} = Einkauf ${formatEuro(c.cost)}`,
      m
        ? `Amazon-Vergleich „${box.searchTerm}“ (Keepa): ${m.count} ähnliche Produkte, Preis Median ${formatEuro(m.price)} (${formatEuro(m.priceLow)}–${formatEuro(m.priceHigh)}), FBA-Gebühr ${formatEuro(m.fbaFee)}, Provision ${m.referralPct ?? 15} %${m.monthlySold ? `, zusammen ~${m.monthlySold} Verkäufe/Monat` : ""}`
        : keepa ? `Amazon-Vergleich: keine Treffer für „${box.searchTerm}“ – FBA ${formatEuro(o.fbaFee)} und 15 % Provision geschätzt.` : "Ohne Keepa: FBA-Gebühr und Provision geschätzt.",
      pr.note ?? "",
      c.profit && box.targetPrice
        ? `VK ${formatEuro(box.targetPrice)} → netto ${formatEuro(c.profit.netPrice)} − Provision ${formatEuro(c.profit.referral)} − FBA ${formatEuro(c.profit.fulfilment)} − Einkauf ${formatEuro(c.cost)} = Gewinn ${formatEuro(c.profit.profit)} (${c.profit.margin.toLocaleString("de-DE")} %${c.profit.roi !== null ? `, ROI ${c.profit.roi.toLocaleString("de-DE")} %` : ""})`
        : "",
      box.hook ? `TikTok-Hook: „${box.hook}“` : "",
    ].filter(Boolean);
    best.push({ title: box.title, profit: c.profit?.profit ?? null, margin: c.profit?.margin ?? null, compared: m?.count ?? 0 });
    values.push({
      tenantId,
      brandId: brand.id,
      kind: "box" as const,
      occasion: occ?.key ?? null,
      title: box.title,
      concept: box.concept || null,
      contents: c.lines,
      targetPrice: box.targetPrice == null ? null : String(box.targetPrice),
      costEstimate: String(c.cost),
      why: box.why || null,
      sourcing: `Aus Lieferanten-Feed: ${feedNames}`,
      notes: calcText.join("\n"),
      market,
      launchDate: launch && launch > todayIso() ? launch : null,
      checklist: checklistFor("box"),
      source: "ai" as const,
      createdBy: userId,
    });
  }
  await db.insert(I).values(values);
  return { count: values.length, brandId: brand.id, best, repaired, dropped };
}

/**
 * Selbstständige Box-Vorschläge: je Marke mit „automatisch“ höchstens einmal pro Woche, und nur wenn seit dem
 * letzten Lauf neue oder geänderte Lieferanten-Artikel da sind. Anlass = der nächste, dessen Planung läuft.
 */
export async function autoBoxes(tenantId: string) {
  const brands = await db.select().from(schema.brands).where(and(eq(schema.brands.tenantId, tenantId), eq(schema.brands.boxAuto, true)));
  if (!brands.length || !(await getIntegration(tenantId, "anthropic"))?.apiKey) return { runs: 0 };
  const [latest] = await db.select({ at: sql<Date | null>`max(${O.updatedAt})` }).from(O).where(eq(O.tenantId, tenantId));
  const newest = latest?.at ? new Date(latest.at) : null;
  const settings = await getSettings(tenantId);
  let runs = 0;
  for (const b of brands) {
    const last = b.lastBoxRunAt;
    if (!newest || (last && (newest <= last || Date.now() - last.getTime() < 7 * 86400_000))) continue;
    const next = upcomingOccasions(todayIso(), b.occasions).find((u) => u.planning);
    try {
      const r = await suggestBoxes(tenantId, null, { feedId: null, allFeeds: true, brandId: b.id, occasion: next?.key ?? null, count: 3, packaging: 2.5, fbaFee: settings.pricing.defaultFbaFee + 1.5 });
      const good = r.best.filter((x) => (x.profit ?? 0) > 0).length;
      await upsertSystemTask(db, tenantId, `box-auto:${b.id}:${todayIso()}`, {
        title: `${b.name}: ${r.count} neue Box-Vorschläge aus Lieferanten-Artikeln${good ? ` (${good} mit Gewinn)` : ""}`,
        notes: r.best.map((x) => `${x.title}: ${x.profit === null ? "ohne Preis" : `${x.profit.toFixed(2).replace(".", ",")} € Gewinn`}`).join("\n"),
        category: "marken",
        priority: "normal",
        link: `/marken?marke=${b.id}`,
        dueDate: todayIso(),
      });
      runs++;
    } catch (e) {
      console.error(`[Boxen] ${b.name}:`, e instanceof Error ? e.message : e);
    } finally {
      await db.update(schema.brands).set({ lastBoxRunAt: new Date() }).where(eq(schema.brands.id, b.id));
    }
  }
  return { runs };
}
