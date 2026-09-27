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
