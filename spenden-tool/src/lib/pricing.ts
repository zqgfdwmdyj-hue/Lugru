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
