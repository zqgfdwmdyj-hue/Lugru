import type { Gpsr, ListingAttempt } from "@/lib/ebay/types";
import { temuBasePrice, type TemuPriceRule } from "./price";

// Temu-Angebot über temu.local.goods.v3.add: Temu lädt die Bilder selbst, ordnet Kategorie,
// Merkmale und Herstellerangaben aus Titel, Beschreibung und Merkmalen zu und nimmt die
// Standard-Versandvorlage des Shops. Reine Logik, ohne Server-Abhängigkeiten.

export type TemuPackage = { weightG: number; lengthCm: number; widthCm: number; heightCm: number };
export type TemuSkuInput = { externalSkuId: string; price: number; quantity: number; images: string[]; ean?: string; variations?: { name: string; value: string }[] };
export type TemuGoodsInput = {
  externalGoodsId: string;
  title: string;
  description?: string;
  images: string[];
  attributes: Record<string, string[]>;
  categoryHint?: string;
  skus: TemuSkuInput[];
  pack: TemuPackage;
  gpsr?: Gpsr | null;
};

const LIMIT = { name: 500, desc: 10000, cat: 500, id: 128, images: 10, attrs: 200, attr: 128, skus: 500 };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const plain = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

/** Geldbetrag als Text mit zwei Nachkommastellen (Temu signiert den Text, nicht die Zahl). */
export const temuMoney = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Maß ohne Einheit, ohne überflüssige Nullen; 0 hieße bei Temu „Standardwert“ – dann leer. */
export function temuMeasure(n: number, decimals: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const s = n.toFixed(decimals);
  if (Number(s) === 0) return "";
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Barcode-Art nach Länge (8/13 = EAN, 12 = UPC, 14 = GTIN-14). */
export function temuBarcodeType(code: string): "EAN" | "UPC" | "GTIN-14" | null {
  const d = code.replace(/\D/g, "");
  if (d.length === 13 || d.length === 8) return "EAN";
  if (d.length === 12) return "UPC";
  if (d.length === 14) return "GTIN-14";
  return null;
}

/** Herstellerangaben als Text – Temu liest Herstellerinformationen aus der Beschreibung. */
export function gpsrText(g: Gpsr | null | undefined): string {
  if (!g) return "";
  const c = (x: Gpsr["manufacturer"]) => [x.companyName, x.addressLine1, [x.postalCode, x.city].filter(Boolean).join(" "), x.country, x.email, x.phone].filter(Boolean).join(", ");
  const parts = [c(g.manufacturer) && `Hersteller: ${c(g.manufacturer)}`, ...g.responsiblePersons.map((p) => c(p) && `EU-verantwortliche Person: ${c(p)}`)].filter(Boolean);
  return parts.map((p) => `<p>${p}</p>`).join("");
}

/** Was fehlt, bevor Temu das Angebot bekommt. `allowHttp` nur für Tests mit Bild-Attrappen. */
export function temuGoodsProblems(g: TemuGoodsInput, opts: { allowHttp?: boolean } = {}): string[] {
  const out: string[] = [];
  if (!g.title.trim()) out.push("Titel fehlt.");
  if (!g.skus.length) out.push("Keine Artikel (SKUs).");
  if (g.skus.length > LIMIT.skus) out.push(`Höchstens ${LIMIT.skus} Varianten.`);
  for (const s of g.skus) {
    const label = s.variations?.length ? s.variations.map((x) => x.value).join(" / ") : s.externalSkuId;
    if (!s.images.length) out.push(`${label}: kein Bild.`);
    if (!(s.price > 0)) out.push(`${label}: kein Preis (nach dem Rechner 0 € oder weniger – eigenen Preis eintragen).`);
  }
  const p = g.pack;
  if (!(p.weightG > 0)) out.push("Gewicht (g) fehlt.");
  if (!(p.lengthCm > 0 && p.widthCm > 0 && p.heightCm > 0)) out.push("Paketmaße (Länge, Breite, Höhe in cm) fehlen.");
  const pub = opts.allowHttp ? /^https?:\/\//i : /^https:\/\//i;
  if (g.images.some((u) => !pub.test(u)) || g.skus.some((s) => s.images.some((u) => !pub.test(u))))
    out.push("Bilder müssen öffentlich erreichbar sein (https) – erst auf eBay veröffentlichen, dann liegen sie bei eBay.");
  return out;
}

/** Anfrage für temu.local.goods.v3.add. */
export function temuGoodsPayload(g: TemuGoodsInput): Record<string, unknown> {
  const pack = {
    weight: temuMeasure(g.pack.weightG, 0),
    length: temuMeasure(g.pack.lengthCm, 1),
    width: temuMeasure(g.pack.widthCm, 1),
    height: temuMeasure(g.pack.heightCm, 1),
  };
  const desc = [g.description ?? "", gpsrText(g.gpsr)].join("").trim();
  const attributes = Object.entries(g.attributes)
    .map(([name, values]) => ({ name: clip(plain(name), LIMIT.attr), value: [...new Set(values.map((v) => clip(plain(v), LIMIT.attr)).filter(Boolean))] }))
    .filter((a) => a.name && a.value.length)
    .slice(0, LIMIT.attrs);
  return {
    goodsBasic: {
      externalGoodsId: clip(g.externalGoodsId, LIMIT.id),
      goodsName: clip(plain(g.title), LIMIT.name),
      productType: 1,
      ...(desc ? { goodsDesc: clip(desc, LIMIT.desc) } : {}),
      ...(g.categoryHint ? { extCatName: clip(plain(g.categoryHint), LIMIT.cat) } : {}),
      ...(g.images.length ? { goodsCarouselImage: g.images.slice(0, LIMIT.images) } : {}),
    },
    ...(attributes.length ? { attributes } : {}),
    skuList: g.skus.map((s) => {
      const type = s.ean ? temuBarcodeType(s.ean) : null;
      return {
        externalSkuId: clip(s.externalSkuId, LIMIT.id),
        images: s.images.slice(0, LIMIT.images),
        price: { basePrice: { amount: temuMoney(s.price), currency: "EUR" } },
        quantity: Math.max(0, Math.floor(s.quantity)),
        packageInfo: pack,
        ...(s.variations?.length ? { variations: s.variations.map((x) => ({ name: clip(plain(x.name), LIMIT.attr), value: clip(plain(x.value), LIMIT.attr) })) } : {}),
        ...(type ? { barCode: { barCodeType: type, barCodeId: [s.ean!.replace(/\D/g, "")] } } : {}),
      };
    }),
  };
}

/**
 * Ein eBay-Listing (einfach oder mit Varianten) als Temu-Angebot. Preise je SKU wie angegeben,
 * sonst nach dem Basispreis-Kalkulator aus dem eBay-Preis; Mengen je SKU aus der Wawi (sonst die
 * eBay-Menge). Die SKUs bleiben die eBay-SKUs – so finden Bestellungen und Bestandsabgleich
 * dasselbe Wawi-Lager.
 */
export function temuGoodsFromAttempt(
  a: ListingAttempt,
  opts: { rule: TemuPriceRule; prices?: Map<string, number>; pack: TemuPackage; quantities: Map<string, number>; goodsId?: string },
): TemuGoodsInput {
  const own = (sku: string) => opts.prices?.get(sku);
  const price = (sku: string, ref: number) => { const p = own(sku); return p !== undefined && p > 0 ? Math.round(p * 100) / 100 : temuBasePrice(ref, opts.rule); };
  const images = a.imageUrls ?? [];
  const v = a.variants;
  const skus: TemuSkuInput[] = v
    ? v.items.map((i) => ({
        externalSkuId: i.sku,
        price: price(i.sku, i.price),
        quantity: opts.quantities.get(i.sku) ?? i.quantity,
        images: i.imageUrl ? [i.imageUrl, ...images.filter((u) => u !== i.imageUrl)] : images,
        ean: i.ean,
        variations: i.specs?.length ? i.specs : [{ name: v.name, value: i.value }],
      }))
    : [{ externalSkuId: a.sku!, price: price(a.sku!, a.price), quantity: opts.quantities.get(a.sku!) ?? a.quantity, images, ean: a.ean || undefined }];
  // Variantenmerkmale stehen je SKU, nicht bei den Merkmalen des Angebots.
  const varNames = new Set(v ? [v.name, ...v.items.flatMap((i) => i.specs?.map((x) => x.name) ?? [])].map((n) => n.toLowerCase()) : []);
  const attributes = Object.fromEntries(Object.entries(a.aspects ?? {}).filter(([k]) => !varNames.has(k.toLowerCase())));
  const hint = a.aspects?.Produktart?.[0] ?? a.aspects?.Typ?.[0];
  return { externalGoodsId: opts.goodsId ?? a.sku!, title: a.title ?? "", description: a.description, images, attributes, categoryHint: hint, skus, pack: opts.pack, gpsr: a.gpsr };
}

/** Temu-Status eines Angebots → Text und Zustand des Wawi-Angebots. */
export const TEMU_GOODS_STATUS: Record<string, string> = {
  ACTIVE: "aktiv",
  INCOMPLETE: "in Prüfung bei Temu",
  DRAFT: "Entwurf – bei Temu fehlen Angaben",
  INACTIVE: "nicht im Verkauf",
  DELETED: "gelöscht",
};

export function temuListingState(status: string | null | undefined): { status: "active" | "draft" | "ended"; lastError: string | null } {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return { status: "active", lastError: null };
    case "DRAFT":
      return { status: "draft", lastError: "Temu: Entwurf – es fehlen Angaben (z. B. Pflichtmerkmale oder Bilder). Im Temu Seller Center beim Produkt ergänzen." };
    case "INACTIVE":
      return { status: "draft", lastError: "Temu: nicht im Verkauf (inaktiv) – im Seller Center prüfen." };
    case "DELETED":
      return { status: "ended", lastError: "Bei Temu gelöscht." };
    default:
      return { status: "draft", lastError: "Temu prüft das Angebot – sobald es freigegeben ist, läuft der Bestandsabgleich." };
  }
}
