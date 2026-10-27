/** Anteil vom günstigsten Handelspreis, der als Spendenpreis vorgeschlagen wird (Standard 25 %). */
export function donationShare(): number {
  const v = Number(process.env.PREISVORSCHLAG_ANTEIL ?? "0.25");
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.25;
}

/** Vorschlag für den Spendenpreis: Anteil vom Handelspreis, auf 10 Cent gerundet, mindestens 10 Cent. */
export function suggestDonationPrice(lowest: number | null | undefined, share = donationShare()): number | null {
  if (lowest === null || lowest === undefined || !(lowest > 0)) return null;
  return Math.max(0.1, Math.round(lowest * share * 10) / 10);
}

/**
 * Anteil für die ganze Packung (Karton, Tray …): Standard 20 % vom Handelspreis der ganzen Packung
 * (PACKUNG_ANTEIL). Getränke ausgenommen – dort gilt der normale Anteil (Pfand kommt ohnehin dazu).
 */
export function packShare(drink: boolean): number {
  if (drink) return donationShare();
  const v = Number(process.env.PACKUNG_ANTEIL ?? "0.2");
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.2;
}

/** Handelspreis je Stück/Flasche aus einem Angebot (Preis des ganzen Angebots ÷ Anzahl darin). */
export function perPiece(offer: { price: number; count?: number | null }): number {
  return offer.price / (offer.count && offer.count > 1 ? offer.count : 1);
}

/** Vorschlag für die ganze Packung: Anteil × Stückpreis × Anzahl, auf 10 Cent gerundet. */
export function suggestPackPrice(piece: number | null, count: number | null | undefined, drink: boolean): { price: number; retail: number; share: number } | null {
  if (piece === null || !(piece > 0) || !count || count < 2) return null;
  const retail = Math.round(piece * count * 100) / 100;
  const share = packShare(drink);
  return { price: Math.max(0.1, Math.round(retail * share * 10) / 10), retail, share };
}

/**
 * Viel da → etwas günstiger, damit es weggeht. Faktor auf die Spendenempfehlung je Bestand (ca.):
 * Palette 60 %, ½ Palette 70 %, ¼ Palette 80 %, mehrere Kartons 90 %; Einzelprodukt und Reste unverändert.
 */
export const STOCK_FACTOR: Record<string, number> = { palette: 0.6, "halbe-palette": 0.7, "viertel-palette": 0.8, kartons: 0.9, einzeln: 1, reste: 1 };

/** Vorschlag bei viel Bestand – null, wenn der Bestand den Preis nicht ändert oder nichts gespart würde. */
export function stockPrice(price: number | null, stock: string | null | undefined): { price: number; factor: number } | null {
  const factor = stock ? (STOCK_FACTOR[stock] ?? 1) : 1;
  if (price === null || !(price > 0) || factor >= 1) return null;
  const p = Math.max(0.1, Math.round(price * factor * 10) / 10);
  return p < price ? { price: p, factor } : null;
}
