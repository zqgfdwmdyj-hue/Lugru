// Inhalte für bestehende eBay-Angebote: Produktdaten von Amazon (über Keepa) in Bilder, Beschreibung und
// Merkmale übersetzen, Beschreibungen säubern (eBay verbietet aktive Inhalte) und Bilderlisten prüfen.
// Reine Logik – Abruf und Senden in service.ts.

import { imageUrlsFromProduct } from "@/lib/ebay/keepa/keepa";

export const MAX_IMAGES = 24;

export type AmazonContent = {
  asin: string | null;
  title: string | null;
  images: string[];
  bullets: string[];
  description: string | null;
  /** Merkmale in eBay-Namen (Marke, Modell, Farbe …) – nur, was Amazon wirklich nennt. */
  aspects: Record<string, string>;
  amazonUrl: string | null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Keepa-Produkt → Inhalte fürs eBay-Angebot. */
export function amazonContentFrom(p: Record<string, unknown>): AmazonContent {
  const asin = str(p.asin);
  const features = Array.isArray(p.features) ? p.features.map(str).filter((x): x is string => Boolean(x)) : [];
  const aspects: Record<string, string> = {};
  const put = (name: string, v: unknown) => {
    const s = str(v);
    if (s && s.length <= 65) aspects[name] = s;
  };
  put("Marke", p.brand);
  put("Hersteller", p.manufacturer);
  put("Modell", p.model);
  put("Herstellernummer", p.partNumber);
  put("Farbe", p.color);
  put("Größe", p.size);
  put("Material", p.material);
  put("Stil", p.style);
  put("Anzahl der Einheiten", typeof p.numberOfItems === "number" && p.numberOfItems > 0 ? String(p.numberOfItems) : null);
  return {
    asin,
    title: str(p.title),
    images: imageUrlsFromProduct(p).slice(0, MAX_IMAGES),
    bullets: features.slice(0, 10),
    description: str(p.description),
    aspects,
    amazonUrl: asin ? `https://www.amazon.de/dp/${asin}` : null,
  };
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Schlichte, mobil lesbare Beschreibung aus Überschrift, Stichpunkten und Text (ohne aktive Inhalte). */
export function descriptionFromParts(p: { heading?: string | null; bullets?: string[]; text?: string | null }): string {
  const parts: string[] = [];
  if (p.heading) parts.push(`<h2>${escHtml(p.heading)}</h2>`);
  if (p.bullets?.length) parts.push(`<ul>${p.bullets.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>`);
  if (p.text) parts.push(...p.text.split(/\n{2,}/).map((t) => `<p>${escHtml(t.trim()).replace(/\n/g, "<br>")}</p>`).filter((t) => t !== "<p></p>"));
  return parts.join("\n");
}

// Mit Inhalt entfernen (Skripte, eingebettete Seiten, Formularfelder) bzw. nur das Tag entfernen (Text bleibt).
const DROP_BLOCK = /<\s*(script|iframe|object|applet|noscript|textarea|select)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const DROP_TAG = /<\s*\/?\s*(script|iframe|object|applet|noscript|textarea|select|option|form|input|button|embed|frame|frameset|link|meta|base)\b[^>]*>/gi;

/**
 * Beschreibung säubern: Skripte, eingebettete Seiten, Formulare und Ereignis-Attribute entfernen
 * (eBay lehnt „aktive Inhalte“ ab), Größe begrenzen. Normales HTML (Absätze, Listen, Fett, Bilder, CSS) bleibt.
 */
export function sanitizeDescription(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(DROP_BLOCK, "")
    .replace(DROP_TAG, "")
    .replace(/<[a-z][^>]*>/gi, (tag) =>
      tag
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/(href|src|action)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "$1=$2#$2")
        .replace(/(href|src|action)\s*=\s*javascript:[^\s>]*/gi, '$1="#"'),
    )
    .trim()
    .slice(0, 500_000);
}

/** Bilderliste: nur https/eBay-Adressen, keine Doppelten, höchstens 24. */
export function cleanImages(list: string[]): { images: string[]; dropped: string[] } {
  const seen = new Set<string>();
  const images: string[] = [];
  const dropped: string[] = [];
  for (const raw of list) {
    const u = raw.trim();
    if (!u) continue;
    if (!/^https:\/\//i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u)) {
      dropped.push(u);
      continue;
    }
    if (seen.has(u)) continue;
    seen.add(u);
    images.push(u);
  }
  return { images: images.slice(0, MAX_IMAGES), dropped: [...dropped, ...images.slice(MAX_IMAGES)] };
}

/** Bei eBay gehostet (EPS) – muss nicht erst hochgeladen werden. */
export const isEbayHosted = (u: string) => /^https:\/\/i\.ebayimg\.com\//i.test(u) || /\/img\/eps-/.test(u);
