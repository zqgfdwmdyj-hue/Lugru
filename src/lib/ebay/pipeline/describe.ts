function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Baut die Listing-Beschreibung als schlichtes HTML-Fragment.
 * Nutzt ausschließlich Katalogdaten — nie Texte fremder Verkäufer.
 */
export function buildDescription(
  title: string,
  aspects: Record<string, string[]>,
  catalogDescription?: string
): string {
  const parts: string[] = [];
  if (title.trim() !== '') parts.push(`<h2>${esc(title)}</h2>`);

  if (catalogDescription && catalogDescription.trim() !== '') {
    parts.push(`<p>${esc(catalogDescription.trim())}</p>`);
  }

  const entries = Object.entries(aspects);
  if (entries.length > 0) {
    const rows = entries
      .map(
        ([name, values]) =>
          `<tr><th style="text-align:left;padding:4px 12px 4px 0;">${esc(name)}</th><td style="padding:4px 0;">${esc(values.join(', '))}</td></tr>`
      )
      .join('');
    parts.push(`<table style="border-collapse:collapse;">${rows}</table>`);
  }

  return parts.join('\n');
}
