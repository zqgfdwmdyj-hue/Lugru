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
