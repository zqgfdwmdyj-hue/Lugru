/**
 * Artikelmerkmale (Item Specifics) einer eBay-Kategorie: was Pflicht ist, was
 * empfohlen, welche Werte erlaubt sind — und die Prüfung eines Entwurfs dagegen.
 * Reine Logik; der Abruf steht in ebay/taxonomy.ts.
 */

export interface CategoryAspect {
  name: string;
  required: boolean;
  /** eBay empfiehlt das Merkmal (bessere Auffindbarkeit), Pflicht ist es nicht. */
  recommended: boolean;
  /** Nur Werte aus `values` sind erlaubt. */
  selectionOnly: boolean;
  /** Mehrere Werte möglich (z. B. Material). */
  multi: boolean;
  maxLength?: number;
  values: string[];
}

/** Aspekte, die eine Artikelnummer tragen — die gehören ins EAN-Feld, nicht in die Merkmale. */
export const GTIN_ASPECT = /^(ean|gtin|upc|isbn)$/i;

const MAX_VALUES = 400;
const NAME_MAX = 65;
const VALUE_MAX = 65;

interface RawAspect {
  localizedAspectName?: string;
  aspectConstraint?: {
    aspectRequired?: boolean;
    aspectUsage?: string;
    aspectMode?: string;
    itemToAspectCardinality?: string;
    aspectMaxLength?: number;
  };
  aspectValues?: { localizedValue?: string }[];
}

/** Antwort von get_item_aspects_for_category → Merkmalsliste, Pflicht zuerst, dann empfohlen. */
export function mapTaxonomyAspects(json: unknown): CategoryAspect[] {
  const raw = (json as { aspects?: RawAspect[] } | null)?.aspects ?? [];
  const out: CategoryAspect[] = [];
  for (const a of raw) {
    const name = a.localizedAspectName?.trim();
    if (!name) continue;
    const c = a.aspectConstraint ?? {};
    out.push({
      name,
      required: c.aspectRequired === true,
      recommended: c.aspectUsage === 'RECOMMENDED',
      selectionOnly: c.aspectMode === 'SELECTION_ONLY',
      multi: c.itemToAspectCardinality === 'MULTI',
      maxLength: typeof c.aspectMaxLength === 'number' ? c.aspectMaxLength : undefined,
      values: (a.aspectValues ?? [])
        .map((v) => v.localizedValue?.trim() ?? '')
        .filter((v) => v !== '')
        .slice(0, MAX_VALUES),
    });
  }
  const rank = (a: CategoryAspect) => (a.required ? 0 : a.recommended ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

const hasValue = (aspects: Record<string, string[]>, name: string) =>
  Object.entries(aspects).some(([k, v]) => k.toLowerCase() === name.toLowerCase() && v.some((x) => x.trim() !== ''));

/** Pflicht-Merkmale ohne Wert. Ein Pflicht-„EAN" gilt mit gültiger EAN am Entwurf als erfüllt. */
export function missingRequired(defs: CategoryAspect[], aspects: Record<string, string[]>, ean?: string): string[] {
  return defs
    .filter((d) => d.required)
    .filter((d) => !(GTIN_ASPECT.test(d.name) && ean && isValidGtin(ean)))
    .filter((d) => !hasValue(aspects, d.name))
    .map((d) => d.name);
}

/**
 * Werte, die eBay so nicht annimmt: Auswahl-Merkmale mit freiem Text, zu lange Werte,
 * mehrere Werte bei Einzel-Merkmalen.
 */
export function aspectProblems(defs: CategoryAspect[], aspects: Record<string, string[]>): string[] {
  const problems: string[] = [];
  for (const [name, values] of Object.entries(aspects)) {
    const d = defs.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!d) continue;
    if (!d.multi && values.length > 1) problems.push(`${d.name}: nur ein Wert erlaubt.`);
    if (d.selectionOnly && d.values.length > 0) {
      const bad = values.filter((v) => !d.values.some((x) => x.toLowerCase() === v.toLowerCase()));
      if (bad.length) problems.push(`${d.name}: „${bad.join('", "')}" steht nicht in der eBay-Liste.`);
    }
    const max = d.maxLength ?? VALUE_MAX;
    const long = values.filter((v) => v.length > max);
    if (long.length) problems.push(`${d.name}: höchstens ${max} Zeichen je Wert.`);
  }
  return problems;
}

/**
 * Merkmale aus dem Request prüfen und säubern: Namen und Werte getrimmt, leere
 * entfernt, doppelte zusammengefasst. Auswahlwerte bekommen die Schreibweise aus
 * der eBay-Liste, wenn sie nur in Groß-/Kleinschreibung abweichen.
 */
export function normalizeAspects(input: unknown, defs: CategoryAspect[] = []): Record<string, string[]> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Artikelmerkmale: unerwartetes Format.');
  }
  const out: Record<string, string[]> = {};
  for (const [rawName, rawValues] of Object.entries(input as Record<string, unknown>)) {
    const name = rawName.trim();
    if (!name) continue;
    if (name.length > NAME_MAX) throw new Error(`Merkmal „${name.slice(0, 30)}…": Name höchstens ${NAME_MAX} Zeichen.`);
    const list = (Array.isArray(rawValues) ? rawValues : [rawValues])
      .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''))
      .filter((v) => v !== '');
    if (!list.length) continue;
    const d = defs.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const values = [...new Set(list.map((v) => d?.values.find((x) => x.toLowerCase() === v.toLowerCase()) ?? v))];
    const key = d?.name ?? Object.keys(out).find((k) => k.toLowerCase() === name.toLowerCase()) ?? name;
    out[key] = [...new Set([...(out[key] ?? []), ...values])];
  }
  return out;
}

/** Merkmalsnamen aus eBays Fehlermeldung („Das Artikelmerkmal Stil fehlt." / „The item specific Style is missing."). */
export function aspectsFromError(message?: string | null): string[] {
  if (!message) return [];
  const out: string[] = [];
  const patterns = [
    /Artikelmerkmal\s+[„"'»]?([^„"'«».|]+?)[“"'«]?\s+fehlt/gi,
    /item specific\s+["'“]?([^"'”.|]+?)["'”]?\s+is missing/gi,
  ];
  for (const re of patterns) for (const m of message.matchAll(re)) out.push(m[1].trim());
  return [...new Set(out.filter((n) => n.length > 0 && n.length <= NAME_MAX))];
}

/** Prüfziffer von EAN-8, UPC-A (12), EAN-13 und GTIN-14. */
export function isValidGtin(raw: string): boolean {
  const s = raw.trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return false;
  const digits = [...s].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** EAN aus dem Eingabefeld: Leerzeichen/Bindestriche raus, leer = keine EAN. */
export function parseEan(value: unknown): string {
  const s = String(value ?? '').replace(/[\s-]/g, '');
  if (s === '') return '';
  if (!/^\d+$/.test(s)) throw new Error('EAN: bitte nur Ziffern (8, 12, 13 oder 14 Stellen).');
  if (!isValidGtin(s)) throw new Error(`EAN ${s} ist ungültig — Länge oder Prüfziffer stimmt nicht.`);
  return s;
}
