import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AmazonChannel, Contact } from "@/db/tables/articles";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { tiktokTopSellers } from "@/lib/brands/shop-service";
import { getIntegration } from "@/lib/integrations/store";
import { storeFile } from "@/lib/orders/service";
import { amazonListingBody, ebayAspects, ebayDescriptionHtml, ebayTitle, listingTextsPrompt, makeSku, parseListingResponse, parseListingTexts, type ArticleData } from "./logic";

const A = schema.articles;
const IMG = schema.articleImages;

export type ArticleRow = typeof schema.articles.$inferSelect;

export function toData(r: ArticleRow): ArticleData {
  const n = (v: string | number | null) => (v === null || v === "" ? null : Number(v));
  return {
    sku: r.sku,
    title: r.title,
    ean: r.ean,
    gtinExempt: r.gtinExempt,
    asin: r.asin,
    price: r.price,
    costPrice: r.costPrice,
    vatRate: Number(r.vatRate),
    weightGrams: r.weightGrams,
    lengthCm: n(r.lengthCm),
    widthCm: n(r.widthCm),
    heightCm: n(r.heightCm),
    bullets: r.bullets,
    description: r.description,
    keywords: r.keywords,
    contents: r.contents,
    attributes: r.attributes,
    food: r.food,
    manufacturer: r.manufacturer,
    amazon: r.amazon,
  };
}

export async function getArticle(tenantId: string, id: string) {
  const [a] = await db.select().from(A).where(and(eq(A.tenantId, tenantId), eq(A.id, id)));
  if (!a) throw new Error("Artikel nicht gefunden.");
  return a;
}

export async function articleImages(tenantId: string, articleId: string) {
  return db.select().from(IMG).where(and(eq(IMG.tenantId, tenantId), eq(IMG.articleId, articleId))).orderBy(asc(IMG.position), asc(IMG.createdAt));
}

async function takenSkus(tenantId: string) {
  return new Set((await db.select({ sku: A.sku }).from(A).where(eq(A.tenantId, tenantId))).map((r) => r.sku));
}

async function brandOf(tenantId: string, brandId: string | null) {
  if (!brandId) return null;
  const [b] = await db.select().from(schema.brands).where(and(eq(schema.brands.tenantId, tenantId), eq(schema.brands.id, brandId)));
  return b ?? null;
}

/** Hersteller-Vorlage: Markenprofil (GPSR) oder wenigstens der Name des Verkäuferkontos. */
function manufacturerFrom(b: Awaited<ReturnType<typeof brandOf>>): Contact {
  if (!b) return {};
  return b.gpsr?.companyName ? b.gpsr : b.sellerName ? { companyName: b.sellerName } : {};
}

export async function createArticle(tenantId: string, input: { brandId: string | null; title: string }) {
  const b = await brandOf(tenantId, input.brandId);
  const [row] = await db
    .insert(A)
    .values({ tenantId, brandId: b?.id ?? null, title: input.title.slice(0, 200), sku: makeSku(b?.name ?? null, input.title, await takenSkus(tenantId)), vatRate: b ? String(b.vatRate) : "19", manufacturer: manufacturerFrom(b), amazon: { account: (b?.amazonAccount as AmazonChannel["account"]) ?? "haupt", fulfillment: "FBA" } })
    .returning({ id: A.id });
  return row.id;
}

/** Idee → Artikel (einmalig; gibt es schon einen, wird dessen ID geliefert). */
export async function createFromIdea(tenantId: string, ideaId: string): Promise<string> {
  const [existing] = await db.select({ id: A.id }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.ideaId, ideaId)));
  if (existing) return existing.id;
  const [idea] = await db.select().from(schema.ideas).where(and(eq(schema.ideas.tenantId, tenantId), eq(schema.ideas.id, ideaId)));
  if (!idea) throw new Error("Idee nicht gefunden.");
  const b = await brandOf(tenantId, idea.brandId);
  const [row] = await db
    .insert(A)
    .values({
      tenantId,
      brandId: idea.brandId,
      ideaId: idea.id,
      title: `${b ? `${b.name} ` : ""}${idea.title}`.slice(0, 200),
      sku: makeSku(b?.name ?? null, idea.title, await takenSkus(tenantId)),
      price: idea.targetPrice ? Number(idea.targetPrice) : null,
      costPrice: idea.costEstimate ? Number(idea.costEstimate) : null,
      vatRate: b ? String(b.vatRate) : "19",
      description: idea.concept,
      contents: idea.contents,
      manufacturer: manufacturerFrom(b),
      amazon: { account: (b?.amazonAccount as AmazonChannel["account"]) ?? "haupt", fulfillment: "FBA" },
      notes: [idea.why && `Warum: ${idea.why}`, idea.sourcing && `Beschaffung: ${idea.sourcing}`, idea.notes].filter(Boolean).join("\n\n") || null,
    })
    .onConflictDoNothing()
    .returning({ id: A.id });
  if (row) return row.id;
  const [again] = await db.select({ id: A.id }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.ideaId, ideaId)));
  return again.id;
}

// ---- Bilder -------------------------------------------------------------------------------------

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_ARTICLE_IMAGES = 12;

export async function addImages(tenantId: string, articleId: string, files: { name: string; type: string; bytes: Uint8Array }[]) {
  await getArticle(tenantId, articleId);
  const existing = await articleImages(tenantId, articleId);
  if (existing.length + files.length > MAX_ARTICLE_IMAGES) throw new Error(`Höchstens ${MAX_ARTICLE_IMAGES} Bilder je Artikel.`);
  let pos = existing.reduce((m, i) => Math.max(m, i.position), -1) + 1;
  for (const f of files) {
    if (!IMAGE_TYPES.has(f.type)) throw new Error(`„${f.name}“: bitte JPG, PNG oder WebP.`);
    if (f.bytes.length > 10 * 1024 * 1024) throw new Error(`„${f.name}“ ist größer als 10 MB.`);
    const fileId = await storeFile(tenantId, f.name.slice(0, 200), f.type, Buffer.from(f.bytes));
    await db.insert(IMG).values({ tenantId, articleId, fileId, position: pos++, publicToken: randomBytes(18).toString("base64url") });
  }
}

export async function deleteImage(tenantId: string, imageId: string) {
  const [img] = await db.select().from(IMG).where(and(eq(IMG.tenantId, tenantId), eq(IMG.id, imageId)));
  if (!img) return;
  await db.delete(IMG).where(eq(IMG.id, img.id));
  await db.delete(schema.files).where(and(eq(schema.files.id, img.fileId), eq(schema.files.tenantId, tenantId)));
}

/** Bild an die erste Stelle (Hauptbild). */
export async function makeMainImage(tenantId: string, imageId: string) {
  const [img] = await db.select().from(IMG).where(and(eq(IMG.tenantId, tenantId), eq(IMG.id, imageId)));
  if (!img) return;
  const all = await articleImages(tenantId, img.articleId);
  const order = [img, ...all.filter((i) => i.id !== img.id)];
  for (const [n, i] of order.entries()) await db.update(IMG).set({ position: n }).where(eq(IMG.id, i.id));
}

// ---- KI-Texte -----------------------------------------------------------------------------------

export async function generateTexts(tenantId: string, articleId: string) {
  const a = await getArticle(tenantId, articleId);
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) throw new Error("Für KI-Texte unter Anbindungen → KI (Claude) einen Schlüssel eintragen.");
  const b = await brandOf(tenantId, a.brandId);
  const idea = a.ideaId ? (await db.select({ concept: schema.ideas.concept }).from(schema.ideas).where(eq(schema.ideas.id, a.ideaId)))[0] : undefined;
  const top = b ? await tiktokTopSellers(tenantId, b.id, 8) : [];
  const r = await askClaude(ai.apiKey, listingTextsPrompt(toData(a), { brand: b?.name ?? "", tone: b?.tone ?? null, concept: idea?.concept ?? a.description, tiktokTop: top }), { model: modelFor(ai, "creative"), task: "creative", maxTokens: 3000 });
  const t = parseListingTexts(r.text);
  if (!t) throw new Error("Die KI hat keine lesbaren Texte geliefert – bitte noch einmal versuchen.");
  await db.update(A).set({ title: t.title, bullets: t.bullets, description: t.description, keywords: t.keywords, updatedAt: new Date() }).where(eq(A.id, a.id));
}

// ---- WaWi-Verknüpfung --------------------------------------------------------------------------

/** Mit ASIN: Produkt in der WaWi anlegen/verknüpfen, damit Chargen, Bestand und Gewinn es kennen. */
export async function linkProduct(tenantId: string, articleId: string) {
  const a = await getArticle(tenantId, articleId);
  if (!a.asin) return null;
  const [p] = await db
    .insert(schema.products)
    .values({ tenantId, asin: a.asin, title: a.title, ean: a.ean, weightGrams: a.weightGrams, lengthCm: a.lengthCm, widthCm: a.widthCm, heightCm: a.heightCm })
    .onConflictDoUpdate({ target: [schema.products.tenantId, schema.products.asin], set: { title: sql`coalesce(${schema.products.title}, excluded.title)`, ean: sql`coalesce(${schema.products.ean}, excluded.ean)`, weightGrams: sql`coalesce(${schema.products.weightGrams}, excluded.weight_grams)` } })
    .returning({ id: schema.products.id });
  await db.update(A).set({ productId: p.id, updatedAt: new Date() }).where(eq(A.id, a.id));
  return p.id;
}

// ---- Amazon -------------------------------------------------------------------------------------

export async function searchProductTypes(tenantId: string, account: "haupt" | "zweit", keywords: string) {
  const { listingsConn } = await import("@/lib/integrations/clients/amazon");
  const c = await listingsConn(tenantId, account);
  const r = await c.call<{ productTypes?: { name: string; displayName?: string }[] }>("GET", `/definitions/2020-09-01/productTypes?marketplaceIds=${c.marketplaceId}&keywords=${encodeURIComponent(keywords.slice(0, 100))}&locale=de_DE`);
  return (r.productTypes ?? []).slice(0, 12).map((p) => ({ name: p.name, label: p.displayName ?? p.name }));
}

/** Prüfen (VALIDATION_PREVIEW – legt nichts an) oder Senden. Ergebnis und Hinweise landen am Artikel. */
export async function sendToAmazon(tenantId: string, articleId: string, mode: "pruefen" | "senden") {
  const a = await getArticle(tenantId, articleId);
  const account = a.amazon.account ?? "haupt";
  const { listingsConn } = await import("@/lib/integrations/clients/amazon");
  const c = await listingsConn(tenantId, account);
  if (!a.amazon.productType && !a.asin) throw new Error("Bitte zuerst den Amazon-Produkttyp wählen.");
  const b = await brandOf(tenantId, a.brandId);
  const imgs = await articleImages(tenantId, a.id);
  const imageUrls = c.publicImageBase ? imgs.map((i) => `${c.publicImageBase}/api/public/artikel-bild/${i.publicToken}`) : [];
  const body = amazonListingBody(toData(a), { marketplaceId: c.marketplaceId, brand: b?.name ?? a.manufacturer.companyName ?? "", imageUrls });
  const path = `/listings/2021-08-01/items/${encodeURIComponent(c.sellerId)}/${encodeURIComponent(a.sku)}?marketplaceIds=${c.marketplaceId}&includedData=issues${mode === "pruefen" ? "&mode=VALIDATION_PREVIEW" : ""}`;
  const res = parseListingResponse(await c.call("PUT", path, body));
  if (!imageUrls.length && imgs.length && !a.asin) res.issues.unshift({ severity: "WARNING", message: "Bilder wurden nicht mitgeschickt – keine öffentliche Bild-Adresse unter Anbindungen → Amazon eingetragen. Bilder in Seller Central hochladen (Download als ZIP auf dieser Seite)." });
  const accepted = mode === "senden" && !res.issues.some((i) => i.severity === "ERROR");
  const amazon: AmazonChannel = { ...a.amazon, lastCheck: { at: new Date().toISOString(), mode, status: res.status, issues: res.issues }, status: mode === "senden" ? res.status : a.amazon.status, ownListing: a.amazon.ownListing || (accepted && !a.asin) };
  await db.update(A).set({ amazon, updatedAt: new Date() }).where(eq(A.id, a.id));
  return res;
}

/** Stand bei Amazon abrufen: ASIN und Status; mit ASIN wird das Produkt in der WaWi verknüpft. */
export async function refreshAmazonStatus(tenantId: string, articleId: string) {
  const a = await getArticle(tenantId, articleId);
  const { listingsConn } = await import("@/lib/integrations/clients/amazon");
  const c = await listingsConn(tenantId, a.amazon.account ?? "haupt");
  const r = await c.call<{ summaries?: { asin?: string; status?: string[] }[]; issues?: unknown[] }>("GET", `/listings/2021-08-01/items/${encodeURIComponent(c.sellerId)}/${encodeURIComponent(a.sku)}?marketplaceIds=${c.marketplaceId}&includedData=summaries,issues`);
  const s = r.summaries?.[0];
  const issues = parseListingResponse({ issues: r.issues }).issues;
  const status = s?.status?.join(", ") || "noch nicht sichtbar";
  await db
    .update(A)
    .set({ asin: s?.asin ?? a.asin, status: s?.status?.includes("BUYABLE") ? "aktiv" : a.status, amazon: { ...a.amazon, status, lastCheck: { at: new Date().toISOString(), mode: "senden", status, issues } }, updatedAt: new Date() })
    .where(eq(A.id, a.id));
  if (s?.asin) await linkProduct(tenantId, a.id);
  return { asin: s?.asin ?? null, status };
}

// ---- eBay ---------------------------------------------------------------------------------------

export async function suggestEbayCategories(tenantId: string, query: string) {
  const { ebayDb } = await import("@/lib/ebay/db/pg");
  const { getSettings } = await import("@/lib/ebay/db/db");
  const { getAppAccessToken } = await import("@/lib/ebay/ebay/auth");
  const { apiBase } = await import("@/lib/ebay/ebay/config");
  const edb = ebayDb(tenantId);
  const settings = await getSettings(edb);
  if (!settings.clientId) throw new Error("eBay ist nicht verbunden (eBay → eBay-Einstellungen → Verbindung).");
  const res = await fetch(`${process.env.EBAY_API_BASE_URL || apiBase(settings.env)}/commerce/taxonomy/v1/category_tree/77/get_category_suggestions?q=${encodeURIComponent(query.slice(0, 100))}`, {
    headers: { Authorization: `Bearer ${await getAppAccessToken(edb, settings)}`, "Accept-Language": "de-DE" },
  });
  const j = (await res.json().catch(() => ({}))) as { categorySuggestions?: { category: { categoryId: string; categoryName: string }; categoryTreeNodeAncestors?: { categoryName: string }[] }[] };
  if (!res.ok) throw new Error(`eBay-Kategorievorschläge fehlgeschlagen (HTTP ${res.status}).`);
  return (j.categorySuggestions ?? []).slice(0, 8).map((s) => ({ id: s.category.categoryId, name: [...(s.categoryTreeNodeAncestors ?? []).map((x) => x.categoryName).reverse(), s.category.categoryName].join(" › ") }));
}

/**
 * Artikel als Entwurf ins eBay-Tool: Bilder zu eBay hochladen (einmal, dann wiederverwendet), Titel,
 * HTML-Beschreibung, Merkmale, Kategorie, GPSR, EK/VK. Veröffentlicht wird in der eBay-Vorschau.
 */
export async function sendToEbay(tenantId: string, articleId: string): Promise<number> {
  const a = await getArticle(tenantId, articleId);
  if (!a.ebay.categoryId) throw new Error("Bitte zuerst eine eBay-Kategorie wählen.");
  const imgs = await articleImages(tenantId, a.id);
  if (!imgs.length) throw new Error("Mindestens ein Bild hochladen.");
  const { ebayDb } = await import("@/lib/ebay/db/pg");
  const { getSettings, createAttempt, updateAttempt } = await import("@/lib/ebay/db/db");
  const { uploadPictureToEps } = await import("@/lib/ebay/ebay/pictures");
  const edb = ebayDb(tenantId);
  const settings = await getSettings(edb);
  const urls: string[] = [];
  for (const img of imgs) {
    if (img.ebayUrl) {
      urls.push(img.ebayUrl);
      continue;
    }
    const [f] = await db.select().from(schema.files).where(and(eq(schema.files.id, img.fileId), eq(schema.files.tenantId, tenantId)));
    if (!f) continue;
    const url = await uploadPictureToEps(edb, settings, f.name, f.data);
    await db.update(IMG).set({ ebayUrl: url }).where(eq(IMG.id, img.id));
    urls.push(url);
  }
  const b = await brandOf(tenantId, a.brandId);
  const d = toData(a);
  const m = a.manufacturer;
  const contact = { companyName: m.companyName, addressLine1: m.addressLine1, postalCode: m.postalCode, city: m.city, country: m.country, email: m.email, phone: m.phone };
  const price = a.price ?? 0;
  if (price <= 0) throw new Error("Bitte einen Verkaufspreis eintragen.");
  const vat = settings.vatPercentage ?? 19;
  const attempt = await createAttempt(edb, { ean: a.ean ?? "", price, quantity: 1, condition: "NEW", purchasePrice: a.costPrice ? Math.round((a.costPrice / (1 + vat / 100)) * 100) / 100 : undefined, purchaseSource: `Artikelstamm ${a.sku}`, targetPrice: price });
  await updateAttempt(edb, attempt.id, {
    sku: a.sku,
    title: ebayTitle(a.title),
    description: ebayDescriptionHtml(d),
    imageUrls: urls,
    aspects: ebayAspects(d, b?.name ?? null),
    categoryId: a.ebay.categoryId,
    gpsr: m.companyName ? { manufacturer: contact, responsiblePersons: [contact], sourceItemId: "" } : null,
    status: "draft",
  });
  await db.update(A).set({ ebay: { ...a.ebay, attemptId: attempt.id, sentAt: new Date().toISOString(), lastError: undefined }, updatedAt: new Date() }).where(eq(A.id, a.id));
  return attempt.id;
}
