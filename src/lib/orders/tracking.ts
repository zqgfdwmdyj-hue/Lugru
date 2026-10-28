// Wann ein Versand an den Kanal gemeldet wird – reine Logik, testbar.

/** Warensendung über Amazon: versendet ohne Sendungsverfolgung, trotzdem an Amazon melden. */
export function untrackedPost(o: { channel: string; carrier: string | null; trackingNumber: string | null; status: string }): boolean {
  return o.channel === "amazon" && o.carrier === "Deutsche Post" && !o.trackingNumber && o.status === "shipped";
}
