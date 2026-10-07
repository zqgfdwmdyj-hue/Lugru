import type { PriceBox } from "@/db/schema";
import { parseAmount } from "@/lib/numbers";

// Auswertung der KI-Antwort „Preis steht schon auf dem Foto“ – ohne Server-Abhängigkeiten, damit testbar.

/**
 * Preis aus einem aufgedruckten Text wie „60 Cent“, „je 50 ct“, „2,50 €“, „1€“, „€ 1,99“.
 * Bei mehreren Beträgen zählt der erste. Gibt null zurück, wenn kein Betrag erkennbar ist.
 */
/** Mehrere Preise im Foto, z. B. „2kg – 5€ / 5kg – 10€ / 10kg – 18€“? Dann nie überdecken. */
export function hasSeveralPrices(text: string | null | undefined): boolean {
  if (!text) return false;
  return (text.match(/\d+(?:[.,]\d{1,2})?\s*(?:€|euro|eur|cent|ct)/gi) ?? []).length >= 2;
}

/**
 * Ist die Lage des alten Preises glaubwürdig genug zum Überdecken? Ein Preisschriftzug ist ein schmales Band –
 * meldet die KI ein riesiges Feld, stimmt die Angabe nicht, und ein Überdecken würde das Produkt verdecken.
 */
export function plausibleBox(b: PriceBox | null | undefined): b is PriceBox {
  return !!b && b.h <= 0.3 && b.w * b.h <= 0.18 && b.w >= 0.05 && b.h >= 0.03;
}

export function parsePrintedPrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ");
  const cent = /(\d{1,3})\s*(?:cent|ct\.?|c)(?![a-zäöü])/i.exec(t);
  const euro = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)(?![a-z])|(?:€|eur)\s*(\d{1,4}(?:[.,]\d{1,2})?)/i.exec(t);
  const fromCent = cent ? Number(cent[1]) / 100 : null;
  const fromEuro = euro ? parseAmount(euro[1] ?? euro[2]) : null;
  // Was zuerst im Text steht, gewinnt („1 € statt 60 Cent“ ist selten, aber dann zählt der erste).
  if (fromCent !== null && fromEuro !== null) return cent!.index < euro!.index ? fromCent : fromEuro;
  const v = fromCent ?? fromEuro;
  return v !== null && v > 0 && v < 1000 ? Math.round(v * 100) / 100 : null;
}

/**
 * Rahmen der KI („[links, oben, rechts, unten]“ in Prozent) prüfen und großzügig erweitern –
 * die Angabe ist nur ungefähr, und beim Überdecken soll vom alten Preis nichts mehr hervorschauen.
 */
export function normalizeBox(raw: unknown): PriceBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const n = raw.map((v) => (typeof v === "number" ? v : Number(v)));
  if (n.some((v) => !Number.isFinite(v))) return null;
  // Prozent oder schon Anteile?
  const scale = n.some((v) => v > 1.5) ? 100 : 1;
  let [x0, y0, x1, y1] = n.map((v) => Math.min(1, Math.max(0, v / scale)));
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 0.02 || h < 0.01) return null;
  // Etwas Rand dazu, damit vom alten Preis nichts hervorschaut – aber nicht mehr als nötig.
  const padX = Math.max(w * 0.08, 0.015);
  const padY = Math.max(h * 0.15, 0.012);
  const x = Math.max(0, x0 - padX);
  const y = Math.max(0, y0 - padY);
  const box = { x, y, w: Math.min(1, x1 + padX) - x, h: Math.min(1, y1 + padY) - y };
  return plausibleBox(box) ? box : null;
}

/** Preis, der schon im Foto steht (für Collage/Social Media); null = keiner. */
export type PrintedInfo = { price: number | null; text: string; box: PriceBox | null } | null;

/**
 * Was die Collage mit dem Preis macht – über einen Preis im Foto wird nie etwas gezeichnet, das Produkt bleibt
 * immer ganz zu sehen:
 *  - „keep“: Im Foto steht schon ein Preis → Foto unverändert, kein zweiter Preis. Weicht der eingetragene Preis ab,
 *    gibt es nur einen Hinweis (differsFromPhoto) mit „Preise vom Foto übernehmen“.
 *  - „normal“: kein Preis im Foto → Preis wie sonst drucken.
 */
export function printedPlan(printed: PrintedInfo): "keep" | "normal" {
  return printed ? "keep" : "normal";
}

/** Weicht der eingetragene Preis vom Preis im Foto ab (dann stünde ein anderer Preis auf der Collage)? */
export function differsFromPhoto(printed: PrintedInfo, price: number | null): boolean {
  return !!printed && printed.price !== null && price !== null && !hasSeveralPrices(printed.text) && Math.abs(printed.price - price) >= 0.005;
}

export type PrintedReading = { found: boolean; price: number | null; text: string | null; box: PriceBox | null };

/** JSON-Antwort der KI auswerten: {"preis_text": "60 Cent", "preis": 0.6, "rahmen": [x0, y0, x1, y1]} */
export function parsePrintedReading(answer: string): PrintedReading {
  const none: PrintedReading = { found: false, price: null, text: null, box: null };
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end < start) return none;
  let json: { preis_text?: unknown; preis?: unknown; rahmen?: unknown };
  try {
    json = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return none;
  }
  const text = typeof json.preis_text === "string" && json.preis_text.trim() ? json.preis_text.trim().slice(0, 60) : null;
  if (!text) return none;
  // Der abgelesene Text ist verlässlicher als die Zahl der KI („60 Cent“ wird gern zu 60).
  const price = parsePrintedPrice(text) ?? (typeof json.preis === "number" && json.preis > 0 && json.preis < 100 ? Math.round(json.preis * 100) / 100 : null);
  return { found: true, price, text, box: normalizeBox(json.rahmen) };
}
