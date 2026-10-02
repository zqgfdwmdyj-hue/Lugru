// Reine Logik für Collagen und Aushang – ohne Datenbank, damit sie auf Server und im Browser läuft.

import type { CollageSettings } from "@/db/schema";

export const DONATION_CATEGORIES = ["Babyprodukte", "Lebensmittel", "Getränke inkl. Pfand", "Drogerie & Haushalt", "Sonstiges"] as const;

export const COLLAGE_FORMATS: Record<CollageSettings["format"], { label: string; width: number; height: number }> = {
  "4:5": { label: "Hochformat 4:5 (Messenger, Instagram)", width: 1080, height: 1350 },
  "9:16": { label: "Handy-Bildschirm 9:16 (Status, Story)", width: 1080, height: 1920 },
  "1:1": { label: "Quadrat 1:1", width: 1080, height: 1080 },
  a4: { label: "A4 hoch (Drucken)", width: 1240, height: 1754 },
};

export const PER_PAGE_CHOICES = [4, 6, 8, 9, 12, 16, 20] as const;

export const DEFAULT_COLLAGE: CollageSettings = { perPage: 9, format: "4:5", fit: "contain", showName: false, header: false };

export function collageSettings(saved: Partial<CollageSettings> | null | undefined): CollageSettings {
  const s = { ...DEFAULT_COLLAGE, ...(saved ?? {}) };
  if (!(s.format in COLLAGE_FORMATS)) s.format = DEFAULT_COLLAGE.format;
  if (!Number.isInteger(s.perPage) || s.perPage < 1 || s.perPage > 30) s.perPage = DEFAULT_COLLAGE.perPage;
  if (s.fit !== "cover") s.fit = "contain";
  return s;
}

/**
 * Preis für die Collage: unter 1 € in Cent („60 Cent“), sonst in Euro („2 €“, „2,50 €“).
 * So steht es auch auf den bisherigen Bildern.
 */
export function collagePrice(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return "";
  if (price <= 0) return "gratis";
  const cents = Math.round(price * 100);
  if (cents < 100) return `${cents} Cent`;
  return `${euro(cents)} €`;
}

/** Preis für den Aushang: „0,30€“, „2€“, „5,40€“. */
export function flyerPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return "";
  if (price <= 0) return "gratis";
  return `${euro(Math.round(price * 100))}€`;
}

function euro(cents: number): string {
  const e = Math.floor(cents / 100);
  const c = cents % 100;
  return c === 0 ? String(e) : `${e},${String(c).padStart(2, "0")}`;
}

/**
 * Wählt Spalten und Zeilen so, dass n Bilder auf eine Seite (width × height) passen und
 * dabei möglichst groß und annähernd quadratisch sind. Leere Felder zählen als Nachteil.
 */
export function bestGrid(n: number, width: number, height: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  let best = { cols: 1, rows: n, score: -Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // Eine Zeile weniger reicht? Dann ist die Aufteilung nicht sinnvoll (z. B. 4 Spalten für 5 Bilder).
    if (cols > 1 && Math.ceil(n / (cols - 1)) === rows) continue;
    const w = width / cols;
    const h = height / rows;
    const side = Math.min(w, h);
    const empty = cols * rows - n;
    // Fläche des größten Quadrats je Kachel, leicht abgewertet für leere Felder.
    const score = side * side * (1 - 0.08 * empty);
    if (score > best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

export function paginate<T>(items: T[], perPage: number): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/**
 * Verteilt n Bilder möglichst gleichmäßig auf Seiten mit höchstens perPage Bildern,
 * damit die letzte Seite nicht mit einem einzelnen Bild übrig bleibt (10 bei 9 → 5 + 5).
 */
export function balancedPages<T>(items: T[], perPage: number): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const count = Math.ceil(items.length / size);
  if (count <= 1) return items.length ? [items] : [];
  const base = Math.floor(items.length / count);
  let extra = items.length % count;
  const pages: T[][] = [];
  let i = 0;
  for (let p = 0; p < count; p++) {
    const n = base + (extra-- > 0 ? 1 : 0);
    pages.push(items.slice(i, i + n));
    i += n;
  }
  return pages;
}

export type FlyerItem = { name: string; variant: string | null; category: string; price: number | null; priceNote?: string | null; bestBefore?: string | null };
export type FlyerLine = { text: string; price: string; mhd: string; sub: { text: string; price: string; mhd: string }[] };

/** „MHD 12.10.26“ aus „2026-10-12“; leer, wenn kein Datum. */
export function mhdLabel(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `MHD ${m[3]}.${m[2]}.${m[1].slice(2)}` : "";
}
export type FlyerSection = { category: string; lines: FlyerLine[] };

/**
 * Gruppiert die Produkte für den Aushang nach Kategorie und Name.
 * Ein Produkt mit einer Variante: „Red Bull 14€“ + Unterpunkt „24er Pack“.
 * Mehrere Varianten: „Getrocknete Tomaten“ + Unterpunkte „2kg 5€“, „5kg 10€“.
 */
export function flyerSections(items: FlyerItem[]): FlyerSection[] {
  const byCat = new Map<string, Map<string, FlyerItem[]>>();
  for (const it of items) {
    const cat = it.category.trim() || "Sonstiges";
    if (!byCat.has(cat)) byCat.set(cat, new Map());
    const groups = byCat.get(cat)!;
    const key = it.name.trim().toLocaleLowerCase("de-DE");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  const order = (c: string) => {
    const i = (DONATION_CATEGORIES as readonly string[]).indexOf(c);
    // „Sonstiges“ immer ans Ende, eigene Kategorien davor.
    if (c === "Sonstiges") return 1000;
    return i === -1 ? 500 : i;
  };
  const cats = [...byCat.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b, "de"));
  return cats.map((category) => ({
    category,
    lines: [...byCat.get(category)!.values()].map((group) => {
      const withPrice = (it: FlyerItem) => [it.priceNote?.trim(), flyerPrice(it.price)].filter(Boolean).join(" ");
      if (group.length === 1) {
        const it = group[0];
        return { text: it.name.trim(), price: withPrice(it), mhd: mhdLabel(it.bestBefore), sub: it.variant?.trim() ? [{ text: it.variant.trim(), price: "", mhd: "" }] : [] };
      }
      return { text: group[0].name.trim(), price: "", mhd: "", sub: group.map((it) => ({ text: it.variant?.trim() || "–", price: withPrice(it), mhd: mhdLabel(it.bestBefore) })) };
    }),
  }));
}

/** „Sa, 12.09.2026“ */
export function eventDateLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const wd = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

/** Text zum Einfügen in WhatsApp/Signal/Telegram (Sternchen = fett). */
export function messengerText(event: { title: string; subtitle?: string | null; dateLabel: string; eventTime?: string | null; location?: string | null }, sections: FlyerSection[]): string {
  const out: string[] = [`*${event.title}*`];
  if (event.subtitle) out.push(event.subtitle);
  out.push(`📅 ${event.dateLabel}${event.eventTime ? `, ${event.eventTime}` : ""}${event.location ? ` · ${event.location}` : ""}`);
  for (const s of sections) {
    out.push("", `*${s.category}*`);
    for (const l of s.lines) {
      out.push(`• ${l.text}${l.price ? ` ${l.price}` : ""}${l.mhd ? ` (${l.mhd})` : ""}`);
      for (const sub of l.sub) out.push(`   ◦ ${sub.text}${sub.price ? ` ${sub.price}` : ""}${sub.mhd ? ` (${sub.mhd})` : ""}`);
    }
  }
  return out.join("\n");
}

export const PLACEHOLDER_NAME = "Neues Produkt";

/** Kamera- oder Systemnamen, die nichts über das Produkt sagen (IMG_1234, UUIDs vom iPhone, Zeitstempel …). */
function isCameraName(base: string): boolean {
  const compact = base.replace(/[\s_.-]+/g, "");
  if (/^[0-9a-f]{16,}$/i.test(compact) && /\d/.test(compact)) return true; // z. B. 21B33D03-B668-4E79-…
  if (/^\d+$/.test(compact)) return true; // nur Ziffern / Zeitstempel
  if (/^(img|image|photo|foto|bild|dsc|dscn|dcim|pxl|mvimg)[\s\d._e-]*$/i.test(base)) return true;
  if (/^(whatsapp|signal|telegram) (image|bild|foto)/i.test(base)) return true;
  if (/^(screenshot|bildschirmfoto)\b/i.test(base)) return true;
  return false;
}

/** Aus einem Dateinamen wie „kimchi-organics.jpeg“ einen Produktnamen raten – leer, wenn es ein Kameraname ist. */
export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").trim();
  if (!base || isCameraName(base)) return "";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Hat das Produkt noch keinen echten Namen? (Platzhalter oder ein früher übernommener Kameraname) */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return !n || n === PLACEHOLDER_NAME || isCameraName(n);
}
