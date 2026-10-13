import type { ListingAttempt, Settings, VariantItem, Variants } from '../types';
import { aspectProblems, missingRequired, type CategoryAspect } from './aspects';
import { roundCents } from './money';
import { buildOfferPayload } from './payload';

/**
 * Mehrfachangebote (eBay: „Angebot mit Varianten“): ein Angebot, mehrere Varianten eines
 * Merkmals – z. B. Sorte Kirsche, Blaue Himbeere, Apfel –, jede mit eigenem Preis, eigener
 * Menge, eigener EAN und eigenem Bild. Bei eBay wird daraus je Variante ein Inventory-Item
 * mit eigener SKU und eigenem Offer, zusammengehalten von einer Inventory-Item-Group.
 * Reine Logik, ohne Server-Abhängigkeiten.
 */

/** eBays Obergrenze je Angebot. */
export const MAX_VARIANTS = 250;
/** eBay: Merkmalsname und -wert je höchstens 65 Zeichen. */
const NAME_MAX = 65;
/** Vorschläge für das Variantenmerkmal (eBay-Merkmalsnamen). */
export const VARIATION_NAMES = ['Sorte', 'Geschmacksrichtung', 'Größe', 'Farbe', 'Menge', 'Packungsgröße', 'Duft', 'Modell'];

export const isVariation = (a: Pick<ListingAttempt, 'variants'>): boolean => (a.variants?.items.length ?? 0) > 0;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const nextIndex = (items: VariantItem[]) =>
  items.reduce((m, v) => Math.max(m, Number(/-V(\d+)$/.exec(v.sku)?.[1] ?? 0)), 0) + 1;

/**
 * Varianten aus dem Request prüfen und säubern. `null` heißt: zurück zum einfachen Angebot.
 * Vorhandene Varianten behalten SKU und Offer (per `sku` erkannt), neue bekommen die nächste
 * laufende SKU – auch wenn eine Variante entfernt wurde, wird keine SKU wiederverwendet.
 */
export function normalizeVariants(input: unknown, a: Pick<ListingAttempt, 'id' | 'variants'>): Variants | undefined {
  if (input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Varianten: unerwartetes Format.');
  const raw = input as { name?: unknown; items?: unknown };
  const name = String(raw.name ?? '').trim();
  if (!name) throw new Error('Bitte das Variantenmerkmal angeben (z. B. „Sorte“).');
  if (name.length > NAME_MAX) throw new Error(`Variantenmerkmal: höchstens ${NAME_MAX} Zeichen.`);
  if (!Array.isArray(raw.items) || raw.items.length === 0) throw new Error('Mindestens eine Variante anlegen – oder „Varianten entfernen“.');
  if (raw.items.length > MAX_VARIANTS) throw new Error(`Höchstens ${MAX_VARIANTS} Varianten je Angebot.`);

  const previous = a.variants?.items ?? [];
  let next = nextIndex(previous);
  const seen = new Set<string>();
  const items = (raw.items as Record<string, unknown>[]).map((r, i): VariantItem => {
    const value = String(r?.value ?? '').trim();
    if (!value) throw new Error(`Variante ${i + 1}: bitte einen Wert eintragen (z. B. „Kirsche“).`);
    if (value.length > NAME_MAX) throw new Error(`„${value.slice(0, 30)}…“: höchstens ${NAME_MAX} Zeichen.`);
    if (seen.has(value.toLowerCase())) throw new Error(`„${value}“ steht doppelt – jede Variante braucht einen eigenen Wert.`);
    seen.add(value.toLowerCase());

    const price = Number(r.price);
    if (!Number.isFinite(price) || roundCents(price) <= 0) throw new Error(`${value}: bitte einen gültigen Preis eingeben.`);
    const quantity = r.quantity === '' || r.quantity == null ? 0 : Number(r.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`${value}: die Menge muss eine ganze Zahl ab 0 sein.`);
    const ean = String(r.ean ?? '').replace(/\s/g, '');
    if (ean && !/^\d{8,14}$/.test(ean)) throw new Error(`${value}: die EAN muss 8–14 Ziffern haben.`);
    const imageUrl = String(r.imageUrl ?? '').trim();
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) throw new Error(`${value}: der Bild-Link muss mit http:// oder https:// beginnen.`);
    const ekRaw = r.purchasePrice === '' || r.purchasePrice == null ? undefined : Number(r.purchasePrice);
    if (ekRaw !== undefined && (!Number.isFinite(ekRaw) || ekRaw < 0)) throw new Error(`${value}: bitte einen gültigen Einkaufspreis eingeben.`);

    const old = typeof r.sku === 'string' ? previous.find((v) => v.sku === r.sku) : undefined;
    return {
      value,
      sku: old?.sku ?? `LG-${a.id}-V${next++}`,
      ...(ean ? { ean } : {}),
      price: roundCents(price),
      quantity,
      ...(imageUrl ? { imageUrl } : {}),
      ...(ekRaw !== undefined && ekRaw > 0 ? { purchasePrice: roundCents(ekRaw) } : {}),
      ...(old?.offerId ? { offerId: old.offerId } : {}),
    };
  });
  return { name, items };
}

/** Preis und Menge des Gesamtangebots (für Verlauf und Liste): günstigste Variante, Summe der Mengen. */
export function variantTotals(v: Variants): { price: number; quantity: number } {
  return { price: Math.min(...v.items.map((i) => i.price)), quantity: v.items.reduce((s, i) => s + i.quantity, 0) };
}

/** Was vor dem Veröffentlichen eines Mehrfachangebots noch fehlt. */
export function variationProblems(a: ListingAttempt): string[] {
  const v = a.variants;
  if (!v) return [];
  const out: string[] = [];
  if (v.items.length < 2) out.push('Ein Angebot mit Varianten braucht mindestens 2 Varianten.');
  if (v.items.every((i) => i.quantity === 0)) out.push('Mindestens eine Variante braucht eine Menge über 0.');
  return out;
}

/** Gemeinsame Merkmale ohne das Variantenmerkmal – das steht je Variante am Inventory-Item. */
export function groupAspects(a: Pick<ListingAttempt, 'aspects' | 'variants'>): Record<string, string[]> {
  const name = a.variants?.name ?? '';
  return Object.fromEntries(Object.entries(a.aspects ?? {}).filter(([k]) => !same(k, name)));
}

/**
 * Pflicht- und Wertprüfung der Kategorie-Merkmale für ein Mehrfachangebot: das Variantenmerkmal
 * zählt als ausgefüllt, und jeder Variantenwert wird einzeln geprüft (z. B. gegen eine eBay-Auswahlliste).
 */
export function variationAspectCheck(defs: CategoryAspect[], a: ListingAttempt): { missing: string[]; problems: string[] } {
  const v = a.variants!;
  const group = groupAspects(a);
  const ean = v.items.find((i) => i.ean)?.ean ?? a.ean;
  const missing = missingRequired(defs, { ...group, [v.name]: [v.items[0]?.value ?? ''] }, ean);
  const problems = new Set(aspectProblems(defs, group));
  for (const i of v.items) for (const p of aspectProblems(defs, { [v.name]: [i.value] })) problems.add(p);
  return { missing, problems: [...problems] };
}

/** Payload für PUT /sell/inventory/v1/inventory_item/{sku} einer Variante. */
export function buildVariantItemPayload(a: ListingAttempt, item: VariantItem, groupImages: string[]): unknown {
  const v = a.variants!;
  const product: Record<string, unknown> = {
    title: a.title,
    description: a.description,
    aspects: { ...groupAspects(a), [v.name]: [item.value] },
  };
  if (item.ean) product.ean = [item.ean];
  const images = item.imageUrl ? [item.imageUrl] : groupImages;
  if (images.length > 0) product.imageUrls = images;
  return {
    product,
    condition: a.condition,
    availability: { shipToLocationAvailability: { quantity: item.quantity } },
  };
}

/** Payload für PUT /sell/inventory/v1/inventory_item_group/{key}. */
export function buildGroupPayload(a: ListingAttempt, imageUrls: string[]): unknown {
  const v = a.variants!;
  const withImages = v.items.some((i) => i.imageUrl);
  return {
    title: a.title,
    description: a.description,
    imageUrls,
    aspects: groupAspects(a),
    variantSKUs: v.items.map((i) => i.sku),
    variesBy: {
      // Eigene Bilder je Variante: eBay wechselt das Bild, wenn der Käufer die Sorte wählt.
      ...(withImages ? { aspectsImageVariesBy: [v.name] } : {}),
      specifications: [{ name: v.name, values: v.items.map((i) => i.value) }],
    },
  };
}

/** Offer je Variante: wie beim einfachen Angebot, aber Preis/Menge/SKU der Variante; die Beschreibung kommt von der Gruppe. */
export function buildVariantOfferPayload(a: ListingAttempt, item: VariantItem, s: Settings): unknown {
  const offer = buildOfferPayload({ ...a, sku: item.sku, price: item.price, quantity: item.quantity }, s) as Record<string, unknown>;
  delete offer.listingDescription;
  return offer;
}

/** Titel einer Variante für die Wawi: „Titel – Kirsche“, auf 80 Zeichen gekürzt. */
export function variantTitle(title: string | undefined, value: string): string {
  const suffix = ` – ${value}`;
  const t = (title ?? '').trim();
  return (t.length + suffix.length > 80 ? t.slice(0, Math.max(0, 80 - suffix.length)).trimEnd() : t) + suffix;
}

/**
 * Ein Mehrfachangebot als einzelne Angebote je Variante – so übernimmt die Wawi jede Sorte
 * mit eigener SKU, eigenem Bestand und eigenem Abgleich. Einfache Angebote bleiben, wie sie sind.
 */
export function variantListings(a: ListingAttempt): ListingAttempt[] {
  if (!a.variants) return [a];
  return a.variants.items.map((i) => ({
    ...a,
    variants: undefined,
    sku: i.sku,
    ean: i.ean ?? '',
    price: i.price,
    quantity: i.quantity,
    offerId: i.offerId,
    title: variantTitle(a.title, i.value),
    imageUrls: i.imageUrl ? [i.imageUrl] : a.imageUrls,
    purchasePrice: i.purchasePrice,
  }));
}

const word = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const AMOUNT = /^\d+([.,]\d+)?(g|gr|kg|ml|l|cl|oz|x|er|stk|stück|st|pack|pcs|count|ct)?$/;

/**
 * Vorschlag für den Variantenwert aus dem Titel eines Suchtreffers: was er mehr hat als der
 * Angebotstitel, ohne Mengen. „Airheads Kaubonbons Blaue Himbeere 15,6 g“ gegen „Airheads
 * Kaubonbons Kirsche 15,6 g“ → „Blaue Himbeere“.
 */
export function suggestVariantValue(baseTitle: string | undefined, otherTitle: string): string {
  const have = new Set((baseTitle ?? '').split(/\s+/).map(word).filter(Boolean));
  const extra = otherTitle.split(/\s+/).filter((w) => {
    const n = word(w);
    return n !== '' && !have.has(n) && !AMOUNT.test(n);
  });
  return extra.join(' ').replace(/^[\s\-–,|/()]+|[\s\-–,|/()]+$/g, '').slice(0, NAME_MAX);
}
