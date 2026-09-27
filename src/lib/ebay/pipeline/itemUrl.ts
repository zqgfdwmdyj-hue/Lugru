/**
 * Extrahiert die eBay-Artikelnummer (Legacy-Item-ID) aus einer eingefügten
 * Listing-URL oder einer nackten Nummer. Liefert null, wenn die Eingabe kein
 * eBay-Link und keine Artikelnummer ist (dann ist es ein Suchbegriff).
 */
export function parseEbayItemUrl(input: string): string | null {
  const s = input.trim();
  if (s === '') return null;

  if (/^\d{9,15}$/.test(s)) return s;

  if (!/(^|\.)ebay\./i.test(s)) return null;
  const match = s.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

/** Nur eine zusammenhängende eBay-Adresse gilt als Link. */
const EBAY_URL = /^(?:https?:\/\/)?(?:[\w-]+\.)*ebay\.[a-z]{2,}(?:\.[a-z]{2,})?\//i;

/**
 * Entscheidet, ob eine Sucheingabe als eBay-Link gemeint ist. Nackte Ziffern
 * sind in der Suche die EAN, und ein Suchbegriff wie „Bosch Bohrer ebay.de"
 * bleibt ein Suchbegriff — nur eine echte Artikel-URL wird übernommen.
 */
export function parseSearchInputAsItemUrl(input: string): string | null {
  const s = input.trim();
  if (/\s/.test(s) || !EBAY_URL.test(s)) return null;
  return parseEbayItemUrl(s);
}
