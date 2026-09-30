import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { keepaKey, keepaProducts } from "@/lib/integrations/clients/keepa";
import { asinFrom, listingPrompt, parseKeepaOwn, parseTikTokExport } from "./shop";

const P = schema.brandProducts;
const SNAP = schema.productSnapshots;
const MI = schema.marketImports;

/** Kurzlinks (amzn.eu, amzn.to, a.co) auflösen und die ASIN herausholen. */
export async function resolveAsin(input: string): Promise<string | null> {
  const direct = asinFrom(input);
  if (direct) return direct;
  if (!/^https?:\/\/(amzn\.(eu|to)|a\.co)\//i.test(input.trim())) return null;
  let url = input.trim();
  for (let i = 0; i < 5; i++) {
    // GET statt HEAD: amzn.eu beantwortet HEAD mit 404.
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    await res?.body?.cancel().catch(() => {});
    const loc = res?.headers.get("location");
    if (!loc) break;
    url = new URL(loc, url).toString();
    const a = asinFrom(url);
    if (a) return a;
  }
  return null;
}

export async function addOwnProduct(tenantId: string, brandId: string, input: string) {
  const [b] = await db.select({ id: schema.brands.id }).from(schema.brands).where(and(eq(schema.brands.id, brandId), eq(schema.brands.tenantId, tenantId)));
  if (!b) throw new Error("Marke nicht gefunden.");
  const asin = await resolveAsin(input);
  if (!asin) throw new Error("Keine ASIN erkannt – bitte die ASIN oder einen Amazon-Link (auch amzn.eu) einfügen.");
  await db.insert(P).values({ tenantId, brandId, asin }).onConflictDoUpdate({ target: [P.tenantId, P.asin], set: { brandId } });
  await refreshOwnProducts(tenantId, true).catch(() => {});
  return asin;
}

/** Keepa-Daten der eigenen Produkte holen (sonst höchstens einmal am Tag) und Tageswert speichern. */
export async function refreshOwnProducts(tenantId: string, force = false) {
  const key = await keepaKey(tenantId);
  if (!key) return { updated: 0, error: "Kein Keepa-Schlüssel." };
  const cutoff = new Date(Date.now() - 20 * 3600_000);
  const due = await db.select().from(P).where(and(eq(P.tenantId, tenantId), force ? undefined : or(isNull(P.fetchedAt), lt(P.fetchedAt, cutoff))));
  if (!due.length) return { updated: 0 };
  let updated = 0;
  for (let i = 0; i < due.length; i += 50) {
    const batch = due.slice(i, i + 50);
    try {
      const r = await keepaProducts(key, batch.map((p) => p.asin));
      for (const row of batch) {
        const raw = r.products.find((p) => p.asin === row.asin);
        const d = raw ? parseKeepaOwn(raw) : null;
        if (!d) {
          await db.update(P).set({ lastError: "Keepa kennt diese ASIN nicht.", fetchedAt: new Date() }).where(eq(P.id, row.id));
          continue;
        }
        await db.update(P).set({ data: d, lastError: null, fetchedAt: new Date() }).where(eq(P.id, row.id));
        const snap = { price: d.price == null ? null : String(d.price), salesRank: d.salesRank == null ? null : String(d.salesRank), monthlySold: d.monthlySold == null ? null : String(d.monthlySold), reviews: d.reviews == null ? null : String(d.reviews), rating: d.rating == null ? null : String(d.rating) };
        await db.insert(SNAP).values({ tenantId, productId: row.id, day: todayIso(), ...snap }).onConflictDoUpdate({ target: [SNAP.productId, SNAP.day], set: snap });
        updated++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const row of batch) await db.update(P).set({ lastError: msg }).where(eq(P.id, row.id));
    }
  }
  return { updated };
}

export async function productHistory(tenantId: string, productId: string) {
  return db
    .select()
    .from(SNAP)
    .where(and(eq(SNAP.tenantId, tenantId), eq(SNAP.productId, productId), gte(SNAP.day, new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10))))
    .orderBy(asc(SNAP.day));
}

export async function latestTikTokImport(tenantId: string, brandId: string) {
  const [r] = await db.select().from(MI).where(and(eq(MI.tenantId, tenantId), eq(MI.brandId, brandId), eq(MI.source, "helium10-tiktok"))).orderBy(desc(MI.createdAt)).limit(1);
  return r ?? null;
}

/** Die meistverkauften TikTok-Produkte aus dem letzten Import – als Anregung für Ideen und Listings. */
export async function tiktokTopSellers(tenantId: string, brandId: string, n = 15): Promise<string[]> {
  const imp = await latestTikTokImport(tenantId, brandId);
  if (!imp) return [];
  return [...imp.items]
    .sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0))
    .slice(0, n)
    .map((i) => `TikTok-Shop-Bestseller: ${i.title}${i.sales ? ` (${Math.round(i.sales).toLocaleString("de-DE")} verkauft)` : ""}${i.price ? `, ${i.price.toLocaleString("de-DE")} €` : ""}`);
}

export async function importTikTok(tenantId: string, brandId: string, fileName: string, rows: string[][]) {
  const items = parseTikTokExport(rows);
  if (!items.length) throw new Error("In der Datei wurden keine Produkte gefunden.");
  await db.insert(MI).values({ tenantId, brandId, source: "helium10-tiktok", fileName, items });
  return items.length;
}

export async function suggestListing(tenantId: string, productId: string) {
  const [row] = await db.select({ p: P, b: schema.brands }).from(P).innerJoin(schema.brands, eq(schema.brands.id, P.brandId)).where(and(eq(P.tenantId, tenantId), eq(P.id, productId)));
  if (!row?.p.data) throw new Error("Für dieses Produkt gibt es noch keine Keepa-Daten.");
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) throw new Error("Für Listing-Vorschläge unter Anbindungen → „KI (Claude)“ einen Schlüssel eintragen.");
  const top = (await tiktokTopSellers(tenantId, row.b.id, 10)).map((t) => t.replace(/^TikTok-Shop-Bestseller: /, ""));
  const r = await askClaude(ai.apiKey, listingPrompt({ brand: row.b.name, tone: row.b.tone, d: row.p.data, tiktokTop: top }), { model: modelFor(ai, "creative"), task: "creative", maxTokens: 2000 });
  await db.update(P).set({ aiListing: r.text }).where(eq(P.id, productId));
}
