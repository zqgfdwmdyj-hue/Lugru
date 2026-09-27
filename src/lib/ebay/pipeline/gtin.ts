/**
 * GTIN-Hilfen für Browse-Items. eBay liefert Artikelnummern mal 13-, mal
 * 14-stellig mit führenden Nullen, mal im gtin-Feld, mal als Aspekt — und
 * Verkäufer tragen dort auch Texte wie „Nicht zutreffend" ein.
 */

/** Verkäufer tragen ins GTIN-Feld auch Texte wie „Nicht zutreffend" ein — nur echte Nummern gelten. */
export function isRealGtin(value: unknown): value is string {
  return typeof value === 'string' && /^\d{8,14}$/.test(value.trim());
}

/** GTINs kommen mal 13-, mal 14-stellig mit führenden Nullen — für den Vergleich normalisieren. */
export function normalizeGtin(value: string): string {
  return value.trim().replace(/^0+/, '');
}

export function sameGtin(a: string, b: string): boolean {
  return normalizeGtin(a) === normalizeGtin(b);
}

/** Name eines Aspekts, der eine Artikelnummer trägt. */
const GTIN_ASPECT = /^(ean|gtin|upc|isbn)$/i;

/**
 * Zieht die Zahlenfolgen aus einem GTIN-Feld. eBay liefert Aspekt-Werte mal als
 * String, mal als Array mit einem Eintrag — beides muss zählen.
 */
export function gtinCandidates(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\D+/).filter((g) => g !== '');
  if (Array.isArray(value)) return value.flatMap(gtinCandidates);
  return [];
}

/** Die GTIN-tragenden Felder eines Browse-Items: gtin-Feld + EAN-/GTIN-/UPC-/ISBN-Aspekte. */
function gtinFields(item: unknown): unknown[] {
  if (typeof item !== 'object' || item === null) return [];
  const src = item as Record<string, unknown>;
  const aspects = src.localizedAspects as { name?: string; value?: unknown }[] | undefined;
  return [
    src.gtin,
    ...(aspects ?? []).filter((a) => GTIN_ASPECT.test((a?.name ?? '').trim())).map((a) => a?.value),
  ];
}

/** Prüft, ob ein Browse-Item die gesuchte EAN wirklich führt (gtin-Feld oder Aspekt). */
export function itemCarriesGtin(item: unknown, ean: string): boolean {
  const wanted = normalizeGtin(ean);
  return gtinFields(item).some((field) => gtinCandidates(field).some((g) => normalizeGtin(g) === wanted));
}

/** Alle echten GTINs eines Browse-Items in Fundreihenfolge, ohne Dubletten. */
export function extractGtins(item: unknown): string[] {
  const out: string[] = [];
  for (const candidate of gtinFields(item).flatMap(gtinCandidates)) {
    if (isRealGtin(candidate) && !out.some((g) => sameGtin(g, candidate))) out.push(candidate.trim());
  }
  return out;
}

/**
 * Die erste echte GTIN eines Browse-Items. Nötig, wenn ein Treffer über den
 * Produkttitel statt über die EAN gewählt wurde.
 */
export function extractGtin(item: unknown): string | undefined {
  return extractGtins(item)[0];
}
