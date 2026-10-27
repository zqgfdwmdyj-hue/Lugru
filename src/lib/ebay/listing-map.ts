// Antworten der neuen eBay-Listing-API (GraphQL) in dieselben Formen bringen, die bisher aus der Trading
// API kamen (EbayActiveItem, LegacyItem, ListingFacts) – so ändert sich für Wawi-Übernahme, Bestandsabgleich
// und „Angebote prüfen“ nur die Quelle. Reine Logik, damit testbar.

import { GTIN_ASPECT } from "@/lib/ebay/pipeline/aspects";
import { fitTitle, htmlToText, type ListingFacts, type Revision } from "@/lib/ebay-review/logic";
import { conditionOf, legacySku, realGtin, type EbayActiveItem, type LegacyItem, type LegacySku } from "./trading-map";
import type { GqlItem, GqlListing } from "./listing-api";
import type { CompanyContact, Gpsr, ListingAttempt, VariantItem } from "./types";

const GTIN_NAMES = /^(ean|gtin|upc|isbn)$/i;
const NO_BRAND = /^(markenlos|unbranded|ohne marke|no brand|nicht zutreffend|n\/a|-)$/i;

const money = (m: { original?: { value?: string | number | null } | null } | null | undefined) => {
  const n = Number(String(m?.original?.value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const qtyOf = (i: GqlItem) => Math.max(0, Math.round(Number(i.itemTerms?.availability?.quantityAvailable ?? 0) || 0));
const soldOf = (i: GqlItem) => Math.max(0, Math.round(Number(i.itemTerms?.availability?.quantitySold ?? 0) || 0));
const priceOf = (i: GqlItem) => money(i.itemTerms?.pricingTerms?.fixedPrice);
export const viewUrl = (listingId: string) => `https://www.ebay.de/itm/${listingId}`;

/** Angebot mit Varianten? (Typname, sonst mehrere Positionen bzw. Positionen mit Merkmalen) */
export function isVariationListing(l: GqlListing): boolean {
  if (l.__typename) return l.__typename === "VariationListing";
  const items = l.items ?? [];
  return items.length > 1 || items.some((i) => (i.itemSellerProduct?.traits ?? []).length > 0);
}

/** Bilder in eBays Reihenfolge; eBay-gehostete Adresse bevorzugt. */
export function imagesOf(l: GqlListing): string[] {
  return [...(l.sellerProduct?.images ?? [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((x) => x.ebayImageUrl || x.externalImageUrl || "")
    .filter(Boolean);
}

/** Merkmale (Name → Werte), ohne leere. */
export function aspectsOf(l: GqlListing): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of l.sellerProduct?.aspects ?? []) {
    const name = (a.name ?? "").trim();
    const values = (a.values ?? []).map((v) => v.trim()).filter(Boolean);
    if (name && values.length) out[name] = values;
  }
  return out;
}

const eanOfItem = (i: GqlItem | undefined) => realGtin(i?.itemSellerProduct?.productIdentifiers?.globalIdentifiers?.ean ?? undefined) ?? realGtin(i?.itemSellerProduct?.productIdentifiers?.globalIdentifiers?.upc ?? undefined);

/** Liste aller laufenden Angebote (Ersatz für GetMyeBaySelling). */
export function activeFromListing(l: GqlListing): EbayActiveItem {
  const items = l.items ?? [];
  const variation = isVariationListing(l);
  const prices = items.map(priceOf).filter((p) => p > 0);
  return {
    itemId: l.listingId,
    title: l.sellerProduct?.title ?? "",
    sku: (variation ? l.sku : items[0]?.sku) || null,
    price: prices.length ? Math.min(...prices) : 0,
    quantity: items.reduce((s, i) => s + qtyOf(i), 0),
    image: imagesOf(l)[0] ?? null,
    url: viewUrl(l.listingId),
    variations: variation ? items.length : 0,
  };
}

function contactOf(a: { companyName?: string | null; address?: { addressLine1?: string | null; addressLine2?: string | null; city?: string | null; postalCode?: string | null; country?: string | null } | null; contact?: { email?: string | null; phone?: string | null } | null } | null | undefined): CompanyContact | null {
  if (!a?.companyName) return null;
  const v = (x: string | null | undefined) => x || undefined;
  return { companyName: a.companyName, addressLine1: v(a.address?.addressLine1), addressLine2: v(a.address?.addressLine2), city: v(a.address?.city), postalCode: v(a.address?.postalCode), country: v(a.address?.country), email: v(a.contact?.email), phone: v(a.contact?.phone) };
}

/** Ein Angebot mit allen Angaben in der Form des eBay-Tools (Ersatz für GetItem bei der Wawi-Übernahme). */
export function legacyFromListing(l: GqlListing): LegacyItem {
  const itemId = l.listingId;
  const aspects = aspectsOf(l);
  const gtinAspect = Object.entries(aspects).find(([k]) => GTIN_NAMES.test(k))?.[1]?.[0];
  for (const k of Object.keys(aspects)) if (GTIN_NAMES.test(k)) delete aspects[k];
  const items = l.items ?? [];
  const variation = isVariationListing(l);
  const ean = (!variation ? eanOfItem(items[0]) : undefined) ?? realGtin(gtinAspect) ?? "";
  const reg = l.listingTerms?.regulatory;
  const manufacturer = contactOf(reg?.manufacturer);
  const persons = (reg?.responsiblePersons ?? []).map(contactOf).filter((c): c is CompanyContact => Boolean(c));
  const gpsr: Gpsr | null = manufacturer || persons.length ? { manufacturer: manufacturer ?? {}, responsiblePersons: persons, sourceItemId: itemId } : null;

  let variants: ListingAttempt["variants"];
  let skus: LegacySku[];
  if (variation) {
    const iv = l.listingVariations?.imagesVaryByTrait;
    const pics = new Map((iv?.traitValueImages ?? []).map((t) => [t.traitValue ?? "", t.traitImages?.[0]?.ebayImageUrl || t.traitImages?.[0]?.externalImageUrl || ""]));
    const vItems: VariantItem[] = items.map((it, n) => {
      const specs = (it.itemSellerProduct?.traits ?? []).map((t) => ({ name: t.name, value: t.value })).filter((t) => t.name && t.value);
      const pic = pics.get(specs.find((s) => s.name === iv?.traitName)?.value ?? "");
      const e = eanOfItem(it);
      return {
        value: specs.map((s) => s.value).join(" / ") || `Variante ${n + 1}`,
        sku: it.sku || legacySku(itemId, n),
        ...(e ? { ean: e } : {}),
        price: priceOf(it),
        quantity: qtyOf(it),
        ...(pic ? { imageUrl: pic } : {}),
        specs,
      };
    });
    const names = [...new Set(vItems.flatMap((i) => i.specs!.map((s) => s.name)))];
    variants = { name: names.join(" / ") || "Variante", items: vItems };
    skus = vItems.map((i, n) => ({ sku: i.sku, ebaySku: items[n].sku || null, specifics: i.specs!, quantity: i.quantity }));
  } else {
    const it = items[0];
    skus = [{ sku: it?.sku || legacySku(itemId), ebaySku: it?.sku || null, specifics: [], quantity: it ? qtyOf(it) : 0 }];
  }
  const price = variants ? Math.min(...variants.items.map((i) => i.price).filter((p) => p > 0), Infinity) : items[0] ? priceOf(items[0]) : 0;
  const attempt: ListingAttempt = {
    id: 0,
    ean,
    price: Number.isFinite(price) ? price : 0,
    quantity: skus.reduce((s, k) => s + k.quantity, 0),
    condition: conditionOf(l.sellerProduct?.itemCondition?.itemConditionId ?? ""),
    status: "published",
    sku: variants ? legacySku(itemId) : skus[0].sku,
    listingId: itemId,
    title: l.sellerProduct?.title ?? "",
    description: l.sellerProduct?.description || undefined,
    imageUrls: imagesOf(l),
    aspects,
    categoryId: l.sellerProduct?.categories?.primaryCategory?.categoryId || undefined,
    gpsr,
    ...(variants ? { variants } : {}),
    createdAt: "",
    updatedAt: "",
  };
  const status = l.listingTerms?.lifecycleTerms?.listingStatus;
  return { attempt, skus, active: !status || status === "ACTIVE", url: viewUrl(itemId) };
}

/** „DAYS_30“ → 30, „MONTHS_1“ → 30, sonst null. */
export function durationDays(v: string | null | undefined): number | null {
  const d = /^DAYS_(\d+)$/.exec(v ?? "");
  if (d) return Number(d[1]);
  const m = /^MONTHS_(\d+)$/.exec(v ?? "");
  return m ? Number(m[1]) * 30 : null;
}

const FORMAT: Record<string, string> = { FIXED_PRICE: "FixedPriceItem", AUCTION: "Chinese", CLASSIFIED_AD: "AdType" };

/**
 * Fakten für „Angebote prüfen“ (Ersatz für GetItem mit Merkmalen). Die neue Schnittstelle liefert keine
 * Beobachterzahl (bleibt leer) und keinen Verkäufernamen (kommt vom Aufrufer, z. B. aus der Browse API).
 */
export function factsFromListing(l: GqlListing, sellerUser: string | null = null): ListingFacts {
  const aspects = aspectsOf(l);
  const aspect = (re: RegExp) => Object.entries(aspects).find(([k]) => re.test(k))?.[1]?.[0];
  const items = l.items ?? [];
  const variation = isVariationListing(l);
  const ean = (!variation ? eanOfItem(items[0]) : undefined) ?? realGtin(aspect(GTIN_ASPECT)) ?? null;
  const brandRaw = aspect(/^(marke|brand)$/i);
  const prices = items.map(priceOf).filter((p) => p > 0);
  const html = l.sellerProduct?.description ?? "";
  const text = htmlToText(html);
  const ft = l.listingTerms?.listingFulfillmentTerms;
  const first = [...(ft?.shippingTerms?.shippingServices ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
  const ret = l.listingTerms?.listingReturnTerms?.domesticReturnTerms;
  const reg = l.listingTerms?.regulatory;
  const hasPerson = (reg?.responsiblePersons ?? []).some((p) => p.companyName);
  return {
    itemId: l.listingId,
    title: l.sellerProduct?.title ?? "",
    sku: (variation ? l.sku : items[0]?.sku) || null,
    categoryId: l.sellerProduct?.categories?.primaryCategory?.categoryId || null,
    categoryName: l.sellerProduct?.categories?.primaryCategory?.name || null,
    conditionId: l.sellerProduct?.itemCondition?.itemConditionId || null,
    conditionName: l.sellerProduct?.itemCondition?.displayName || null,
    listingType: FORMAT[l.listingTerms?.listingFormat ?? ""] ?? l.listingTerms?.listingFormat ?? null,
    price: prices.length ? Math.min(...prices) : 0,
    quantity: items.reduce((s, i) => s + qtyOf(i), 0),
    sold: items.reduce((s, i) => s + soldOf(i), 0),
    watchers: null,
    startTime: l.listingTerms?.lifecycleTerms?.startAt ?? null,
    images: imagesOf(l),
    descriptionText: text.slice(0, 4000),
    descriptionHtml: html.slice(0, 500_000),
    descriptionLength: text.length,
    activeContent: /<(script|iframe|form|embed|object)\b/i.test(html),
    fixedWidth: /width\s*[:=]\s*["']?\s*(9\d\d|[1-9]\d{3})\s*(px)?\b/i.test(html),
    aspects,
    ean,
    brand: brandRaw && !NO_BRAND.test(brandRaw.trim()) ? brandRaw.trim() : null,
    variations: variation ? items.length : 0,
    bestOffer: l.listingTerms?.bestOfferTerms?.acceptBestOffer === true,
    shippingCost: first ? (ft?.freeShippingAvailable ? 0 : money(first.shippingCostAmount)) : null,
    dispatchDays: durationDays(ft?.shippingTerms?.handlingTimeDuration),
    returnsAccepted: ret?.returnAccepted ?? null,
    returnDays: durationDays(ret?.returnDuration),
    freeReturns: ret?.returnShipmentInvoicee ? ret.returnShipmentInvoicee.toUpperCase() === "SELLER" : null,
    hasManufacturer: reg ? Boolean(reg.manufacturer?.companyName || hasPerson) : null,
    sellerUser,
    url: viewUrl(l.listingId),
  };
}

/**
 * Änderung als updateListing-Eingabe (Ersatz für ReviseFixedPriceItem). Merkmale und Bilder ersetzt eBay
 * vollständig – wie bisher. Der Preis geht über bulkUpdateInventory (siehe priceUpdate).
 */
export function updateInput(listingId: string, r: Revision, marketplace = "EBAY_DE"): Record<string, unknown> | null {
  const product: Record<string, unknown> = {};
  if (r.title) product.title = fitTitle(r.title);
  if (r.aspects) {
    product.aspects = Object.entries(r.aspects)
      .filter(([k, v]) => k.trim() && v.length)
      .slice(0, 45)
      .map(([k, v]) => ({ name: k.slice(0, 65), values: v.map((x) => x.slice(0, 65)) }));
  }
  if (r.description !== undefined) product.description = r.description;
  if (r.images?.length) product.imageUrls = r.images.slice(0, 24);
  const listingTerms = r.bestOffer !== undefined ? { bestOfferTerms: { bestOfferEnabled: r.bestOffer } } : undefined;
  if (!Object.keys(product).length && !listingTerms) return null;
  return { listingIdentifier: { listingId }, marketplace, ...(Object.keys(product).length ? { product } : {}), ...(listingTerms ? { listingTerms } : {}) };
}
