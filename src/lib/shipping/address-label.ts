import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import type { Address } from "@/db/tables/core";
import { safe } from "@/lib/ebay/invoices/pdf";

// Adressetiketten für Brother QL (z. B. QL-800) auf 62 × 29 mm (DK-11209): nur Name und Anschrift,
// eine Seite je Etikett – für Bücher- und Warensendungen, die ohne DHL-Label rausgehen.

const MM = 72 / 25.4;
export const LABEL_62x29 = { widthMm: 62, heightMm: 29 };
/** Rand: der QL druckt auf Stanzetiketten nicht bis an die Kante. */
const PAD_X_MM = 3;
const PAD_Y_MM = 2;
const MAX_PT = 15;
const MIN_PT = 6;
const LEADING = 1.15;

const COUNTRY_DE: Record<string, string> = {
  AUT: "ÖSTERREICH", CHE: "SCHWEIZ", NLD: "NIEDERLANDE", BEL: "BELGIEN", LUX: "LUXEMBURG", FRA: "FRANKREICH", ITA: "ITALIEN",
  ESP: "SPANIEN", PRT: "PORTUGAL", POL: "POLEN", CZE: "TSCHECHIEN", SVK: "SLOWAKEI", HUN: "UNGARN", SVN: "SLOWENIEN",
  HRV: "KROATIEN", DNK: "DÄNEMARK", SWE: "SCHWEDEN", FIN: "FINNLAND", NOR: "NORWEGEN", IRL: "IRLAND", GBR: "VEREINIGTES KÖNIGREICH",
  GRC: "GRIECHENLAND", ROU: "RUMÄNIEN", BGR: "BULGARIEN", EST: "ESTLAND", LVA: "LETTLAND", LTU: "LITAUEN", LIE: "LIECHTENSTEIN",
  MLT: "MALTA", CYP: "ZYPERN", USA: "USA",
};
const ISO2: Record<string, string> = {
  DE: "DEU", AT: "AUT", CH: "CHE", NL: "NLD", BE: "BEL", LU: "LUX", FR: "FRA", IT: "ITA", ES: "ESP", PT: "PRT", PL: "POL", CZ: "CZE",
  SK: "SVK", HU: "HUN", SI: "SVN", HR: "HRV", DK: "DNK", SE: "SWE", FI: "FIN", NO: "NOR", IE: "IRL", GB: "GBR", GR: "GRC", RO: "ROU",
  BG: "BGR", EE: "EST", LV: "LVA", LT: "LTU", LI: "LIE", MT: "MLT", CY: "CYP", US: "USA",
};

/** Land für die letzte Zeile – bei Deutschland keine. */
export function countryLine(country: string | undefined): string | null {
  const c = (country ?? "").trim().toUpperCase();
  if (!c || c === "DE" || c === "DEU" || c === "DEUTSCHLAND" || c === "GERMANY") return null;
  const iso3 = c.length === 2 ? ISO2[c] ?? c : c;
  return COUNTRY_DE[iso3] ?? c;
}

/** Zeilen des Etiketts: Name (fett), Zusatz, Straße + Nr., PLZ Ort, Land (nur Ausland). Ohne Anschrift: null. */
export function addressLines(a: Address | null | undefined, fallbackName?: string | null): string[] | null {
  const name = (a?.name1 ?? "").trim() || (fallbackName ?? "").trim();
  const street = [a?.street, a?.houseNo].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  const place = [a?.zip, a?.city].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  if (!name || !street || !place) return null;
  return [name, (a?.name2 ?? "").trim(), street, place, countryLine(a?.country) ?? ""].filter(Boolean);
}

/**
 * Eine Schriftgröße für alle Zeilen: so groß wie möglich (höchstens 15 pt), aber jede Zeile passt in
 * die Breite und alle zusammen in die Höhe; sehr lange Zeilen werden notfalls gekürzt.
 */
export function fitFontSize(widthsAt1pt: number[], availW: number, availH: number): number {
  const byHeight = availH / (widthsAt1pt.length * LEADING);
  const byWidth = Math.min(...widthsAt1pt.map((w) => (w > 0 ? availW / w : MAX_PT)));
  return Math.max(MIN_PT, Math.min(MAX_PT, byHeight, byWidth));
}

function shorten(text: string, font: PDFFont, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export type LabelInput = { address: Address | null | undefined; fallbackName?: string | null };

/** PDF mit einem 62 × 29-mm-Etikett je Anschrift. Ohne vollständige Anschrift wird übersprungen. */
export async function buildAddressLabels(inputs: LabelInput[], size = LABEL_62x29): Promise<{ pdf: Uint8Array; printed: number; skipped: number }> {
  const doc = await PDFDocument.create();
  doc.setTitle("Adressetiketten");
  doc.setProducer("Seller-System");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = size.widthMm * MM;
  const H = size.heightMm * MM;
  const availW = W - 2 * PAD_X_MM * MM;
  const availH = H - 2 * PAD_Y_MM * MM;
  let printed = 0;
  let skipped = 0;
  for (const input of inputs) {
    const raw = addressLines(input.address, input.fallbackName);
    if (!raw) {
      skipped++;
      continue;
    }
    const lines = raw.map(safe);
    const fontOf = (i: number) => (i === 0 ? bold : regular);
    const widths = lines.map((l, i) => fontOf(i).widthOfTextAtSize(l, 1));
    // Anschrift (ohne Namen) bestimmt die Größe; ein sehr langer Name wird allein kleiner.
    // Höhe so teilen, als hätte auch der Name diese Größe (alle Zeilen passen sicher drauf).
    const pt = fitFontSize(widths.slice(1), availW, (availH * (lines.length - 1)) / lines.length);
    const sizes = widths.map((w, i) => (i === 0 ? Math.max(MIN_PT, Math.min(pt, w > 0 ? availW / w : pt)) : pt));
    const page = doc.addPage([W, H]);
    const blockH = sizes.reduce((sum, s) => sum + s * LEADING, 0) - (LEADING - 1) * sizes[sizes.length - 1];
    // Block senkrecht mittig; Grundlinie je Zeile.
    let y = H - (H - blockH) / 2 - sizes[0];
    lines.forEach((l, i) => {
      page.drawText(shorten(l, fontOf(i), sizes[i], availW), { x: PAD_X_MM * MM, y, size: sizes[i], font: fontOf(i) });
      y -= (sizes[i + 1] ?? sizes[i]) * LEADING;
    });
    printed++;
  }
  return { pdf: await doc.save(), printed, skipped };
}
