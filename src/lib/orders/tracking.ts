// Wann ein Versand an den Kanal gemeldet wird – reine Logik, testbar.

/** Warensendung über Amazon, eBay oder Temu: versendet ohne Sendungsverfolgung, trotzdem an den Kanal melden
 *  (Temu verlangt eine Nummer – dort geht die Frankier-ID der Internetmarke mit). */
export function untrackedPost(o: { channel: string; carrier: string | null; trackingNumber: string | null; status: string }): boolean {
  return (o.channel === "amazon" || o.channel === "ebay" || o.channel === "temu") && o.carrier === "Deutsche Post" && !o.trackingNumber && o.status === "shipped";
}

/** Fehlgeschlagene Versandmeldungen: so oft automatisch neu versuchen (alle 30 Min.), danach nur noch von Hand. */
export const MELDUNG_MAX_VERSUCHE = 6;
/** … und nur für Sendungen der letzten 14 Tage (ältere meldet kein Kanal mehr an). */
export const MELDUNG_NACHHOLEN_TAGE = 14;

export type MeldungStand = {
  channel: string;
  fulfillment: string;
  status: string;
  shippedAt: Date | null;
  trackingUploadedAt: Date | null;
  trackingUploadManuell: boolean;
  trackingUploadError: string | null;
  trackingUploadVersuche: number;
};

/** Soll eine offene Versandmeldung jetzt automatisch neu versucht werden? */
export function meldungNachholen(o: MeldungStand, ohneMeldung: (channel: string) => boolean, jetzt = new Date()): boolean {
  if (o.fulfillment !== "FBM" || !["shipped", "delivered"].includes(o.status)) return false;
  if (o.trackingUploadedAt || o.trackingUploadManuell || !o.trackingUploadError || ohneMeldung(o.channel)) return false;
  if (o.trackingUploadVersuche >= MELDUNG_MAX_VERSUCHE) return false;
  return !!o.shippedAt && jetzt.getTime() - o.shippedAt.getTime() < MELDUNG_NACHHOLEN_TAGE * 86_400_000;
}

/** Temu: Sendungsnummer für die Meldung – eigene Nummer, sonst die Frankier-ID der Warensendung (Internetmarke). */
export function temuSendungsnummer(o: { trackingNumber: string | null; carrier: string | null }, frankierId: string | null): string | null {
  if (o.trackingNumber?.trim()) return o.trackingNumber.trim();
  if (o.carrier === "Deutsche Post" && frankierId?.trim()) return frankierId.trim();
  return null;
}
