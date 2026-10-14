import { parseXml, xmlAt, xmlList, xmlText, type XmlObject, type XmlValue } from "@/lib/xml";
import type { CompanyContact, Condition, Gpsr, ListingAttempt, VariantItem } from "./types";

// Ältere eBay-Angebote (nicht übers eBay-Tool eingestellt) über die Trading API: Antworten von
// GetMyeBaySelling und GetItem in die Form des eBay-Tools bringen. Reine Logik.

export class TradingError extends Error {
  constructor(
    message: string,
    public readonly codes: string[],
  ) {
    super(message);
  }
}

/** Antwort einer Trading-Anfrage; bei „Failure“ ein Fehler mit eBays Text. */
export function tradingBody(xml: string, call: string): XmlObject {
  let doc: XmlObject;
  try {
    doc = parseXml(xml);
  } catch {
    throw new TradingError(`eBay (${call}): unerwartete Antwort.`, []);
  }
  const body = doc[`${call}Response`];
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TradingError(`eBay (${call}): unerwartete Antwort.`, []);
  const ack = xmlText(body.Ack);
  const errors = xmlList(body.Errors).filter((e) => xmlText(xmlAt(e, "SeverityCode")) !== "Warning");
  if (ack === "Failure" || ack === "PartialFailure" || (!/^(Success|Warning)$/.test(ack) && errors.length)) {
    const msg = errors.map((e) => xmlText(xmlAt(e, "LongMessage")) || xmlText(xmlAt(e, "ShortMessage"))).filter(Boolean);
    throw new TradingError(`eBay (${call}): ${[...new Set(msg)].join(" | ") || "abgelehnt"}`, errors.map((e) => xmlText(xmlAt(e, "ErrorCode"))));
  }
  return body;
}

export const escXml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const num = (v: XmlValue | undefined) => {
  const n = Number(xmlText(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const left = (qty: XmlValue | undefined, sold: XmlValue | undefined) => Math.max(0, Math.round(num(qty) - num(sold)));

/** Echte EAN/GTIN (8–14 Ziffern), nicht „Nicht zutreffend“. */
export function realGtin(v: string | undefined): string | undefined {
  const d = (v ?? "").replace(/\s/g, "");
  return /^\d{8,14}$/.test(d) && !/^0+$/.test(d) ? d : undefined;
}

export type EbayActiveItem = {
  itemId: string;
  title: string;
  sku: string | null;
  price: number;
  quantity: number;
  image: string | null;
  url: string | null;
  variations: number;
};

/** GetMyeBaySelling (ActiveList): Angebote einer Seite und Seitenzahl. */
export function activeItems(body: XmlObject): { items: EbayActiveItem[]; pages: number; total: number } {
  const list = xmlAt(body, "ActiveList");
  const items = xmlList(xmlAt(list, "ItemArray", "Item")).map((it): EbayActiveItem => {
    const vs = xmlList(xmlAt(it, "Variations", "Variation"));
    const prices = vs.map((v) => num(xmlAt(v, "StartPrice"))).filter((p) => p > 0);
    return {
      itemId: xmlText(xmlAt(it, "ItemID")),
      title: xmlText(xmlAt(it, "Title")),
      sku: xmlText(xmlAt(it, "SKU")) || null,
      price: prices.length ? Math.min(...prices) : num(xmlAt(it, "SellingStatus", "CurrentPrice")) || num(xmlAt(it, "BuyItNowPrice")) || num(xmlAt(it, "StartPrice")),
      quantity: vs.length
        ? vs.reduce((s, v) => s + left(xmlAt(v, "Quantity"), xmlAt(v, "SellingStatus", "QuantitySold")), 0)
        : xmlText(xmlAt(it, "QuantityAvailable"))
          ? Math.max(0, num(xmlAt(it, "QuantityAvailable")))
          : left(xmlAt(it, "Quantity"), xmlAt(it, "SellingStatus", "QuantitySold")),
      image: xmlText(xmlAt(it, "PictureDetails", "GalleryURL")) || null,
      url: xmlText(xmlAt(it, "ListingDetails", "ViewItemURL")) || null,
      variations: vs.length,
    };
  });
  return {
    items: items.filter((i) => i.itemId),
    pages: Math.max(1, num(xmlAt(list, "PaginationResult", "TotalNumberOfPages"))),
    total: num(xmlAt(list, "PaginationResult", "TotalNumberOfEntries")),
  };
}

/** eBay-Zustandsnummer → Zustand im eBay-Tool. Ohne Angabe (Kategorie ohne Zustand): neu. */
export function conditionOf(id: string): Condition {
  const n = Number(id);
  if (!id || n === 1000) return "NEW";
  if (n === 1500 || n === 1750) return "NEW_OTHER";
  if (n === 5000) return "USED_GOOD";
  if (n === 6000) return "USED_ACCEPTABLE";
  return "USED_VERY_GOOD";
}

const GTIN_NAMES = /^(ean|gtin|upc|isbn)$/i;

function contact(v: XmlValue | undefined): CompanyContact | null {
  if (!v) return null;
  const t = (k: string) => xmlText(xmlAt(v, k)) || undefined;
  const c: CompanyContact = { companyName: t("CompanyName"), addressLine1: t("Street1"), addressLine2: t("Street2"), city: t("CityName"), postalCode: t("PostalCode"), country: t("Country"), email: t("Email"), phone: t("Phone") };
  return c.companyName ? c : null;
}

/** Je Wawi-SKU: die SKU bei eBay (falls vergeben) und die Merkmale der Variante. */
export type LegacySku = { sku: string; ebaySku: string | null; specifics: { name: string; value: string }[]; quantity: number };
export type LegacyItem = { attempt: ListingAttempt; skus: LegacySku[]; active: boolean; url: string | null };

/** SKU für Wawi und Temu: die eBay-SKU, sonst aus der Artikelnummer. */
export const legacySku = (itemId: string, n?: number) => (n === undefined ? `EB-${itemId}` : `EB-${itemId}-V${n + 1}`);

/** GetItem (DetailLevel ReturnAll, mit Merkmalen) → Angebot in der Form des eBay-Tools. */
export function legacyItem(body: XmlObject): LegacyItem {
  const it = xmlAt(body, "Item");
  const itemId = xmlText(xmlAt(it, "ItemID"));
  if (!itemId) throw new TradingError("eBay (GetItem): Angebot ohne Artikelnummer.", []);
  const aspects: Record<string, string[]> = {};
  for (const nv of xmlList(xmlAt(it, "ItemSpecifics", "NameValueList"))) {
    const name = xmlText(xmlAt(nv, "Name"));
    const values = xmlList(xmlAt(nv, "Value")).map((x) => xmlText(x)).filter(Boolean);
    if (name && values.length) aspects[name] = values;
  }
  const gtinAspect = Object.entries(aspects).find(([k]) => GTIN_NAMES.test(k))?.[1]?.[0];
  for (const k of Object.keys(aspects)) if (GTIN_NAMES.test(k)) delete aspects[k];
  const ean = realGtin(xmlText(xmlAt(it, "ProductListingDetails", "EAN"))) ?? realGtin(xmlText(xmlAt(it, "ProductListingDetails", "UPC"))) ?? realGtin(gtinAspect) ?? "";
  const images = xmlList(xmlAt(it, "PictureDetails", "PictureURL")).map((x) => xmlText(x)).filter(Boolean);
  const reg = xmlAt(it, "Regulatory");
  const manufacturer = contact(xmlAt(reg, "Manufacturer"));
  const persons = xmlList(xmlAt(reg, "ResponsiblePersons", "ResponsiblePerson")).map(contact).filter((c): c is CompanyContact => Boolean(c));
  const gpsr: Gpsr | null = manufacturer || persons.length ? { manufacturer: manufacturer ?? {}, responsiblePersons: persons, sourceItemId: itemId } : null;
  const itemSku = xmlText(xmlAt(it, "SKU")) || null;

  const vs = xmlList(xmlAt(it, "Variations", "Variation"));
  let variants: ListingAttempt["variants"];
  let skus: LegacySku[];
  if (vs.length) {
    const picName = xmlText(xmlAt(it, "Variations", "Pictures", "VariationSpecificName"));
    const pics = new Map(
      xmlList(xmlAt(it, "Variations", "Pictures", "VariationSpecificPictureSet")).map((p) => [
        xmlText(xmlAt(p, "VariationSpecificValue")),
        xmlText(xmlAt(p, "PictureURL")),
      ]),
    );
    const items: VariantItem[] = vs.map((v, n) => {
      const specs = xmlList(xmlAt(v, "VariationSpecifics", "NameValueList")).map((nv) => ({ name: xmlText(xmlAt(nv, "Name")), value: xmlText(xmlAt(nv, "Value")) })).filter((s) => s.name && s.value);
      const ebaySku = xmlText(xmlAt(v, "SKU")) || null;
      const pic = pics.get(specs.find((s) => s.name === picName)?.value ?? "");
      return {
        value: specs.map((s) => s.value).join(" / ") || `Variante ${n + 1}`,
        sku: ebaySku ?? legacySku(itemId, n),
        ...(realGtin(xmlText(xmlAt(v, "VariationProductListingDetails", "EAN"))) ? { ean: realGtin(xmlText(xmlAt(v, "VariationProductListingDetails", "EAN"))) } : {}),
        price: num(xmlAt(v, "StartPrice")),
        quantity: left(xmlAt(v, "Quantity"), xmlAt(v, "SellingStatus", "QuantitySold")),
        ...(pic ? { imageUrl: pic } : {}),
        specs,
      };
    });
    const names = [...new Set(items.flatMap((i) => i.specs!.map((s) => s.name)))];
    variants = { name: names.join(" / ") || "Variante", items };
    skus = items.map((i, n) => ({ sku: i.sku, ebaySku: xmlText(xmlAt(vs[n], "SKU")) || null, specifics: i.specs!, quantity: i.quantity }));
  } else {
    const sku = itemSku ?? legacySku(itemId);
    const quantity = left(xmlAt(it, "Quantity"), xmlAt(it, "SellingStatus", "QuantitySold"));
    skus = [{ sku, ebaySku: itemSku, specifics: [], quantity }];
  }

  const price = variants
    ? Math.min(...variants.items.map((i) => i.price).filter((p) => p > 0), Infinity)
    : num(xmlAt(it, "StartPrice")) || num(xmlAt(it, "SellingStatus", "CurrentPrice"));
  const attempt: ListingAttempt = {
    id: 0,
    ean,
    price: Number.isFinite(price) ? price : 0,
    quantity: skus.reduce((s, k) => s + k.quantity, 0),
    condition: conditionOf(xmlText(xmlAt(it, "ConditionID"))),
    status: "published",
    sku: variants ? legacySku(itemId) : skus[0].sku,
    listingId: itemId,
    title: xmlText(xmlAt(it, "Title")),
    description: xmlText(xmlAt(it, "Description")) || undefined,
    imageUrls: images,
    aspects,
    categoryId: xmlText(xmlAt(it, "PrimaryCategory", "CategoryID")) || undefined,
    gpsr,
    ...(variants ? { variants } : {}),
    createdAt: "",
    updatedAt: "",
  };
  return {
    attempt,
    skus,
    active: !xmlText(xmlAt(it, "SellingStatus", "ListingStatus")) || xmlText(xmlAt(it, "SellingStatus", "ListingStatus")) === "Active",
    url: xmlText(xmlAt(it, "ListingDetails", "ViewItemURL")) || null,
  };
}

/** Anfrage-Rumpf (ohne Hülle) für die Menge eines Angebots bzw. einer Variante. */
export function inventoryStatusXml(itemId: string, quantity: number, sku?: string | null): string {
  return `<InventoryStatus><ItemID>${escXml(itemId)}</ItemID>${sku ? `<SKU>${escXml(sku)}</SKU>` : ""}<Quantity>${Math.max(0, Math.floor(quantity))}</Quantity></InventoryStatus>`;
}

/** Zu einer verkauften Position ohne SKU die Variante finden (über die Merkmale aus der Bestellung). */
export function matchSpecifics(stored: { name: string; value: string }[], aspects: { name?: string; value?: string }[]): boolean {
  if (!stored.length) return !aspects.length;
  const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();
  return stored.every((s) => aspects.some((a) => norm(a.name) === norm(s.name) && norm(a.value) === norm(s.value)));
}
