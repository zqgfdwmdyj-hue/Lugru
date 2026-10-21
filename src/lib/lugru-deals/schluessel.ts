import { createHash, timingSafeEqual } from "node:crypto";

// Prüfung des Verbindungsschlüssels von Lugru Deals — ohne Datenbank, damit
// sie sich testen lässt.

export const MIN_SCHLUESSEL = 32;

/** Liest den Schlüssel aus dem Auth-Header „Bearer …“. */
export function schluesselAusHeader(header: string | null): string {
  const m = /^Bearer\s+(\S+)$/i.exec((header ?? "").trim());
  return m ? m[1] : "";
}

/** Vergleicht in konstanter Zeit über Hashes gleicher Länge. */
export function schluesselPasst(eingabe: string, gespeichert: string | undefined): boolean {
  if (!eingabe || !gespeichert || gespeichert.length < MIN_SCHLUESSEL) return false;
  const a = createHash("sha256").update(eingabe).digest();
  const b = createHash("sha256").update(gespeichert).digest();
  return timingSafeEqual(a, b);
}
