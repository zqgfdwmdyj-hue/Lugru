import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { checklistFor, type BrandProfile } from "@/lib/brands/ai";
import { occasionByKey, upcomingOccasions } from "@/lib/brands/occasions";
import { tiktokTopSellers } from "@/lib/brands/shop-service";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { formatEuro } from "@/lib/numbers";
import { boxPrompt, calcBox, parseBoxes, type CatalogItem } from "./boxes";
import { packInfo } from "./scan";

const O = schema.supplierOffers;
const F = schema.supplierFeeds;
const I = schema.ideas;

export type BoxOptions = { feedId: string; allFeeds: boolean; brandId: string; occasion: string | null; count: number; wish?: string; packaging: number; fbaFee: number };

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
    .where(and(eq(O.tenantId, tenantId), isNotNull(O.price), isNotNull(O.title), ...(o.allFeeds ? [] : [eq(O.feedId, o.feedId)])))
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
  const values = boxes.map((b) => {
    const c = calcBox(b, catalog, { packaging: o.packaging, vatRate: vat, fbaFee: o.fbaFee });
    const calcText = [
      `Kalkulation (automatisch aus Lieferanten-Preisen, ${c.units} Einheiten):`,
      ...c.lines.map((l) => `- ${l}`),
      `Ware ${formatEuro(c.goods)} + Verpackung ${formatEuro(o.packaging)} = Einkauf ${formatEuro(c.cost)}`,
      c.profit && b.targetPrice
        ? `VK ${formatEuro(b.targetPrice)} → netto ${formatEuro(c.profit.netPrice)} − Provision ${formatEuro(c.profit.referral)} − FBA ${formatEuro(c.profit.fulfilment)} − Einkauf ${formatEuro(c.cost)} = Gewinn ${formatEuro(c.profit.profit)} (${c.profit.margin.toLocaleString("de-DE")} %)`
        : "",
      b.hook ? `TikTok-Hook: „${b.hook}“` : "",
    ].filter(Boolean);
    return {
      tenantId,
      brandId: brand.id,
      kind: "box" as const,
      occasion: occ?.key ?? null,
      title: b.title,
      concept: b.concept || null,
      contents: c.lines,
      targetPrice: b.targetPrice == null ? null : String(b.targetPrice),
      costEstimate: String(c.cost),
      why: b.why || null,
      sourcing: `Aus Lieferanten-Feed: ${feedNames}`,
      notes: calcText.join("\n"),
      launchDate: launch && launch > todayIso() ? launch : null,
      checklist: checklistFor("box"),
      source: "ai" as const,
      createdBy: userId,
    };
  });
  await db.insert(I).values(values);
  const best = values.map((v, n) => ({ title: v.title, profit: calcBox(boxes[n], catalog, { packaging: o.packaging, vatRate: vat, fbaFee: o.fbaFee }).profit?.profit ?? null }));
  return { count: values.length, brandId: brand.id, best };
}
