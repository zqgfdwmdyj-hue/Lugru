// Artikelstamm: Aufbau aus einer Idee, Vollständigkeit je Kanal, Amazon-Attribute, eBay-Merkmale und
// Beschreibung, KI-Texte. Ohne Server-Abhängigkeiten – testbar.

import { extractJsonArray } from "@/lib/brands/ai";
import type { AmazonChannel, ChannelIssue, Contact, FoodInfo } from "@/db/tables/articles";

export type ArticleData = {
  sku: string;
  title: string;
  ean: string | null;
  gtinExempt: boolean;
  asin: string | null;
  price: number | null;
  costPrice: number | null;
  vatRate: number;
  weightGrams: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  bullets: string[];
  description: string | null;
  keywords: string | null;
  contents: string[];
  attributes: Record<string, string>;
  food: FoodInfo;
  manufacturer: Contact;
  amazon: AmazonChannel;
};

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Eigene SKU: Markenkürzel + Titelstichwörter, eindeutig durch laufende Nummer. */
export function makeSku(brandName: string | null, title: string, taken: Set<string>): string {
  const prefix = brandName ? slug(brandName).slice(0, 3) : "ART";
  const words = slug(title)
    .split("-")
    .filter((w) => w.length > 2 && !["UND", "MIT", "FUR", "DER", "DIE", "DAS", "BOX"].includes(w))
    .slice(0, 3)
    .reduce((acc, w) => (acc.length + w.length + 1 <= 30 ? (acc ? `${acc}-${w}` : w) : acc), "");
  const base = `${prefix}-${words || "ARTIKEL"}`;
  for (let n = 1; n < 1000; n++) {
    const sku = `${base}-${String(n).padStart(2, "0")}`;
    if (!taken.has(sku)) return sku;
  }
  return `${base}-${Date.now() % 100000}`;
}

// ---- Vollständigkeit ---------------------------------------------------------------------------

export type Check = { ok: boolean; text: string };

const filled = (c: Contact) => Boolean(c.companyName && c.addressLine1 && c.postalCode && c.city && c.country);

/** Was fehlt noch? isFood = Lebensmittel (7 % USt) → Zutaten, Allergene, Nährwerte, MHD sind Pflicht. */
export function checklist(a: ArticleData, imageCount: number): { amazon: Check[]; ebay: Check[] } {
  const isFood = a.vatRate === 7;
  const common: Check[] = [
    { ok: a.title.trim().length >= 20, text: "Titel (mind. 20 Zeichen)" },
    { ok: imageCount >= 1, text: `Bilder (${imageCount}; empfohlen 5–7, Hauptbild weißer Hintergrund)` },
    { ok: (a.price ?? 0) > 0, text: "Verkaufspreis" },
    { ok: Boolean(a.ean) || a.gtinExempt || Boolean(a.asin), text: "EAN – oder GTIN-Befreiung bzw. vorhandene ASIN" },
    { ok: filled(a.manufacturer), text: "Hersteller/Verantwortlicher mit Anschrift (GPSR)" },
    { ok: (a.weightGrams ?? 0) > 0, text: "Gewicht" },
  ];
  const food: Check[] = isFood
    ? [
        { ok: Boolean(a.food.ingredients?.trim()), text: "Zutaten" },
        { ok: Boolean(a.food.allergens?.trim()), text: "Allergene (oder „keine“)" },
        { ok: Boolean(a.food.nutrition?.trim()), text: "Nährwerte" },
        { ok: Boolean(a.food.netQuantity?.trim()), text: "Füllmenge" },
      ]
    : [];
  return {
    amazon: [
      ...common,
      { ok: a.bullets.filter((b) => b.trim()).length >= 5, text: "5 Stichpunkte" },
      { ok: Boolean(a.description?.trim()), text: "Beschreibung" },
      { ok: Boolean(a.amazon.productType), text: "Amazon-Produkttyp" },
      ...food,
    ],
    ebay: [...common, { ok: Boolean(a.description?.trim() || a.bullets.length), text: "Beschreibung oder Stichpunkte" }, ...food],
  };
}

// ---- Amazon (Listings Items API, JSON-Attribute) ------------------------------------------

const lang = "de_DE";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Attribute für PUT /listings/2021-08-01/items. Mit ASIN nur das Angebot (LISTING_OFFER_ONLY),
 * sonst ein neues Produkt (LISTING). extraAttributes (JSON) überschreibt/ergänzt einzelne Attribute.
 */
export function amazonListingBody(a: ArticleData, o: { marketplaceId: string; brand: string; imageUrls: string[] }): { productType: string; requirements: "LISTING" | "LISTING_OFFER_ONLY"; attributes: Record<string, unknown> } {
  const m = o.marketplaceId;
  const t = (value: string) => [{ value, language_tag: lang, marketplace_id: m }];
  const offerOnly = Boolean(a.asin) && !a.amazon.ownListing;
  const attrs: Record<string, unknown> = {
    condition_type: [{ value: "new_new", marketplace_id: m }],
  };
  if (a.price) attrs.purchasable_offer = [{ currency: "EUR", marketplace_id: m, our_price: [{ schedule: [{ value_with_tax: a.price }] }] }];
  attrs.fulfillment_availability = a.amazon.fulfillment === "FBA" ? [{ fulfillment_channel_code: "AMAZON_EU" }] : [{ fulfillment_channel_code: "DEFAULT", quantity: Math.max(0, a.amazon.quantity ?? 0) }];
  if (a.asin) attrs.merchant_suggested_asin = [{ value: a.asin, marketplace_id: m }];
  if (!offerOnly) {
    attrs.item_name = t(a.title.slice(0, 200));
    attrs.brand = t(o.brand);
    const bullets = a.bullets.map((b) => b.trim()).filter(Boolean).slice(0, 5);
    if (bullets.length) attrs.bullet_point = bullets.map((b) => ({ value: b.slice(0, 500), language_tag: lang, marketplace_id: m }));
    if (a.description?.trim()) attrs.product_description = t(a.description.trim().slice(0, 2000));
    if (a.keywords?.trim()) attrs.generic_keyword = t(a.keywords.trim().slice(0, 250));
    if (a.ean) attrs.externally_assigned_product_identifier = [{ type: "ean", value: a.ean, marketplace_id: m }];
    else if (a.gtinExempt) attrs.supplier_declared_has_product_identifier_exemption = [{ value: true, marketplace_id: m }];
    if (num(a.weightGrams)) attrs.item_package_weight = [{ value: a.weightGrams, unit: "grams", marketplace_id: m }];
    if (num(a.lengthCm) && num(a.widthCm) && num(a.heightCm)) {
      attrs.item_package_dimensions = [{ length: { value: a.lengthCm, unit: "centimeters" }, width: { value: a.widthCm, unit: "centimeters" }, height: { value: a.heightCm, unit: "centimeters" }, marketplace_id: m }];
    }
    if (a.food.countryOfOrigin?.trim()) attrs.country_of_origin = [{ value: a.food.countryOfOrigin.trim().toUpperCase().slice(0, 2), marketplace_id: m }];
    if (a.food.ingredients?.trim()) attrs.ingredients = t(a.food.ingredients.trim());
    if (a.food.allergens?.trim()) attrs.allergen_information = [{ value: a.food.allergens.trim(), marketplace_id: m }];
    if (a.manufacturer.companyName) attrs.manufacturer = t(a.manufacturer.companyName);
    if (a.contents.length) attrs.included_components = t(a.contents.join(", ").slice(0, 500));
    o.imageUrls.slice(0, 9).forEach((url, i) => {
      attrs[i === 0 ? "main_product_image_locator" : `other_product_image_locator_${i}`] = [{ media_location: url, marketplace_id: m }];
    });
  }
  if (a.amazon.extraAttributes?.trim()) {
    const extra = JSON.parse(a.amazon.extraAttributes) as Record<string, unknown>;
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("Zusätzliche Amazon-Attribute müssen ein JSON-Objekt sein.");
    Object.assign(attrs, extra);
  }
  return { productType: a.amazon.productType || "PRODUCT", requirements: offerOnly ? "LISTING_OFFER_ONLY" : "LISTING", attributes: attrs };
}

/** Antwort von PUT/Listings in Status und verständliche Meldungen. */
export function parseListingResponse(json: unknown): { status: string; issues: ChannelIssue[] } {
  const r = (json ?? {}) as { status?: string; issues?: { severity?: string; message?: string; attributeNames?: string[] }[] };
  const issues = (r.issues ?? []).map((i) => ({ severity: (i.severity ?? "ERROR").toUpperCase(), message: i.message ?? "Unbekannter Hinweis", attributes: i.attributeNames ?? [] }));
  return { status: r.status ?? (issues.some((i) => i.severity === "ERROR") ? "INVALID" : "ACCEPTED"), issues };
}

// ---- eBay ------------------------------------------------------------------------------------

/** eBay-Artikelmerkmale: Marke, Produktart aus den Merkmalen, bei Lebensmitteln Pflichtangaben. */
export function ebayAspects(a: ArticleData, brand: string | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (brand) out["Marke"] = [brand];
  if (a.ean) out["EAN"] = [a.ean];
  for (const [k, v] of Object.entries(a.attributes)) if (k.trim() && v.trim()) out[k.trim().slice(0, 65)] = [v.trim().slice(0, 65)];
  if (a.food.allergens?.trim()) out["Allergene"] = [a.food.allergens.trim().slice(0, 65)];
  if (a.food.countryOfOrigin?.trim()) out["Herstellungsland und -region"] = [a.food.countryOfOrigin.trim().slice(0, 65)];
  if (a.food.netQuantity?.trim()) out["Nettogewicht"] = [a.food.netQuantity.trim().slice(0, 65)];
  return out;
}

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Schlichte, eBay-taugliche HTML-Beschreibung (ohne Skripte, mobilfreundlich). */
export function ebayDescriptionHtml(a: ArticleData): string {
  const parts = [`<h2>${esc(a.title)}</h2>`];
  if (a.description?.trim()) parts.push(...a.description.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`));
  const bullets = a.bullets.filter((b) => b.trim());
  if (bullets.length) parts.push(`<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`);
  if (a.contents.length) parts.push(`<h3>Inhalt</h3><ul>${a.contents.map((c) => `<li>${esc(c.replace(/\s*\(je [^)]*\)$/, ""))}</li>`).join("")}</ul>`);
  const f = a.food;
  const food = [
    ["Zutaten", f.ingredients],
    ["Allergene", f.allergens],
    ["Nährwerte", f.nutrition],
    ["Füllmenge", f.netQuantity],
    ["Aufbewahrung", f.storage],
    ["Mindesthaltbarkeit", f.bestBefore],
    ["Herkunft", f.countryOfOrigin],
  ].filter(([, v]) => v?.trim());
  if (food.length) parts.push(`<h3>Produktinformationen</h3><table>${food.map(([k, v]) => `<tr><th style="text-align:left;padding:4px 12px 4px 0;vertical-align:top">${k}</th><td style="padding:4px 0">${esc(v!.trim()).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`);
  const m = a.manufacturer;
  if (m.companyName) parts.push(`<p style="font-size:12px;color:#555">Hersteller/Verantwortlich: ${esc([m.companyName, m.addressLine1, [m.postalCode, m.city].filter(Boolean).join(" "), m.country, m.email].filter(Boolean).join(", "))}</p>`);
  return parts.join("\n");
}

/** eBay-Titel: max. 80 Zeichen, an Wortgrenze gekürzt. */
export function ebayTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= 80) return t;
  const cut = t.slice(0, 80);
  return cut.slice(0, Math.max(40, cut.lastIndexOf(" "))).replace(/[\s|,–-]+$/, "");
}

// ---- KI-Texte ----------------------------------------------------------------------------------

export type ListingTexts = { title: string; bullets: string[]; description: string; keywords: string };

export function listingTextsPrompt(a: ArticleData, o: { brand: string; tone: string | null; concept: string | null; tiktokTop: string[] }): string {
  return [
    "Du schreibst verkaufsstarke, regelkonforme Amazon.de-Listings für eine kleine Marke.",
    `Marke: ${o.brand}${o.tone ? ` · Tonalität: ${o.tone}` : ""}`,
    `Produkt: ${a.title}`,
    o.concept ? `Konzept: ${o.concept}` : "",
    a.contents.length ? `Inhalt:\n${a.contents.map((c) => `- ${c.replace(/\s*\(je [^)]*\)$/, "")}`).join("\n")}` : "",
    a.food.netQuantity ? `Füllmenge: ${a.food.netQuantity}` : "",
    o.tiktokTop.length ? `Gerade gefragt auf TikTok Shop (Anregung für Suchbegriffe):\n${o.tiktokTop.slice(0, 8).map((t) => `- ${t}`).join("\n")}` : "",
    "",
    "Schreib auf Deutsch: Titel (max. 180 Zeichen, Marke vorn, wichtigste Suchbegriffe, Menge/Anlass), 5 Stichpunkte (je max. 250 Zeichen, mit GROSSGESCHRIEBENEM Einstieg, Nutzen zuerst), Beschreibung (3–5 kurze Absätze, ohne HTML), Backend-Suchbegriffe (max. 250 Zeichen, durch Leerzeichen getrennt, keine Wiederholungen aus dem Titel, keine fremden Marken).",
    "Keine Gesundheitsversprechen, keine Superlative wie „das beste“, nichts erfinden, was nicht oben steht.",
    'Antworte NUR mit einem JSON-Array mit genau einem Objekt: [{"titel":"…","stichpunkte":["…","…","…","…","…"],"beschreibung":"…","suchbegriffe":"…"}]',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function parseListingTexts(text: string): ListingTexts | null {
  const r = extractJsonArray(text)[0] as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return null;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const bullets = Array.isArray(r.stichpunkte ?? r.bullets) ? ((r.stichpunkte ?? r.bullets) as unknown[]).map((b) => str(b, 500)).filter(Boolean).slice(0, 5) : [];
  const title = str(r.titel ?? r.title, 200);
  if (!title) return null;
  return { title, bullets, description: str(r.beschreibung ?? r.description, 2000), keywords: str(r.suchbegriffe ?? r.keywords, 250) };
}

/** Merkmale aus Textfeld „Name: Wert“ je Zeile. */
export function parseAttributeLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k && v) out[k.slice(0, 65)] = v.slice(0, 200);
    }
  }
  return out;
}
