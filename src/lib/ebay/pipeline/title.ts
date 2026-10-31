const MAX_TITLE = 80;

/** Prioritätsreihenfolge deutscher Aspekt-Namen für den generierten Fakten-Titel. */
const TITLE_ASPECT_ORDER = [
  'Produktart',
  'Produktlinie',
  'Serie',
  'Modell',
  'Farbe',
  'Strichstärke',
  'Größe',
  'Material',
  'Anzahl der Einheiten',
  'Herstellernummer',
];

/**
 * Erzeugt einen rein faktenbasierten Titel aus Marke + Artikelmerkmalen
 * (keine Übernahme von Verkäufertiteln). Kann leer sein, wenn keine
 * brauchbaren Fakten vorliegen — dann muss der Nutzer den Titel eingeben.
 */
export function buildFactTitle(brand: string | undefined, aspects: Record<string, string[]>): string {
  const parts: string[] = [];
  if (brand && brand.trim() !== '') parts.push(brand.trim());
  for (const name of TITLE_ASPECT_ORDER) {
    const value = aspects[name]?.[0]?.trim();
    if (!value) continue;
    if (parts.some((p) => p.toLowerCase() === value.toLowerCase())) continue;
    parts.push(value);
    if (parts.length >= 5) break;
  }
  return truncateTitle(parts.join(' '));
}

export function truncateTitle(title: string): string {
  const t = title.trim();
  if (t.length <= MAX_TITLE) return t;
  const cut = t.slice(0, MAX_TITLE);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Ein Katalogtitel ist „dünn“, wenn er kaum etwas über das Produkt sagt: nur die Marke, weniger als drei Wörter
 * oder unter 20 Zeichen (z. B. eBay-Katalog „Tefal“ für ein Kochmesser).
 */
export function isThinTitle(title: string, brand?: string): boolean {
  const t = title.trim();
  const words = t.split(/\s+/).filter((w) => w.length > 1);
  if (words.length < 3 || t.length < 20) return true;
  return Boolean(brand && t.toLowerCase() === brand.trim().toLowerCase());
}

export type TitleSource = 'catalog' | 'listing' | 'facts';

/**
 * Titel für den Entwurf: der Katalogtitel, solange er aussagekräftig ist. Ist er dünn, gewinnt der Titel mit den
 * meisten Wörtern aus Angebot (Suchtreffer), Fakten-Titel und Katalogtitel – ein unvollständiger Katalogtitel
 * überschreibt so nie still einen aussagekräftigen Angebotstitel.
 */
export function chooseTitle(
  catalogTitle: string,
  listingTitle: string | undefined,
  factTitle: string,
  brand?: string
): { title: string; source: TitleSource } {
  const catalog = truncateTitle(catalogTitle ?? '');
  if (catalog && !isThinTitle(catalog, brand)) return { title: catalog, source: 'catalog' };
  const wordCount = (t: string) => t.split(/\s+/).filter((w) => w.length > 1).length;
  const all: { title: string; source: TitleSource }[] = [
    { title: truncateTitle(listingTitle ?? ''), source: 'listing' },
    { title: factTitle, source: 'facts' },
    { title: catalog, source: 'catalog' },
  ];
  const candidates = all.filter((c) => c.title !== '');
  if (!candidates.length) return { title: '', source: 'catalog' };
  return candidates.reduce((best, c) => (wordCount(c.title) > wordCount(best.title) ? c : best));
}

