// B34.1 Scan-Modus: reine Logik (ohne Datenbank) – Rückvergütung, Teilen-Ziel, Tagessumme „Heute gescannt“.

import { leseCode } from "@/lib/deal-ampel/logic";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Effektiver EK nach Rückvergütung (Cashback, Kartenpunkte): Preis × (1 − p/100). 0–50 % zulässig. */
export function ekMitRueckverguetung(preis: number, prozent: number | null | undefined): number {
  const p = Math.min(50, Math.max(0, Number(prozent) || 0));
  return r2(preis * (1 - p / 100));
}

/** Preis aus Eingabe („12,99“, „12.99 €“, „1.299,00“) – null, wenn keiner erkennbar. */
export function preisAusText(t: string | null | undefined): number | null {
  if (!t) return null;
  const s = t.replace(/\s|€|EUR/gi, "");
  if (!s) return null;
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? r2(n) : null;
}

const KURZLINK = /^https?:\/\/(amzn\.(eu|to)|a\.co)\//i;
const AMAZON = /^https?:\/\/(www\.)?(amazon\.(de|fr|it|es|nl|com|co\.uk|pl|se|com\.be)|smile\.amazon\.\w+)\//i;

/** Code aus Scan/Eingabe: EAN, ASIN, Amazon-Link (auch Kurzlink, der später aufgelöst wird). */
export function scanCode(roh: string): { code: string; asin: string | null; ean: string | null; kurzlink: boolean } | null {
  const s = roh.trim();
  if (!s) return null;
  const c = leseCode(s);
  if (c) return { code: s.slice(0, 300), asin: "asin" in c ? c.asin : null, ean: "ean" in c ? c.ean : null, kurzlink: false };
  if (KURZLINK.test(s)) return { code: s.slice(0, 300), asin: null, ean: null, kurzlink: true };
  return null;
}

export type TeilenZiel = { modus: "online"; code: string | null; shop: string | null; preis: number | null };

/**
 * Geteilt aus der Shop- oder Amazon-App (Web Share Target): kurzer Text mit Amazon-Link/ASIN → Scan-Ergebnis;
 * Link eines bekannten Shops (Shop-Profil) → Scan im Modus Online mit Shop-Link. Alles andere (Deal-Posts mit
 * mehreren Zeilen, Dateien, Discord-Links) bleibt im Deal-Eingang.
 */
export function teilenZiel(t: { title?: string | null; text?: string | null; url?: string | null; dateien?: number }, istShop: (url: string) => boolean): TeilenZiel | null {
  if ((t.dateien ?? 0) > 0) return null;
  const alles = [t.title, t.text, t.url].filter(Boolean).join("\n").trim();
  if (!alles || alles.length > 600) return null;
  const urls = [...alles.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));
  // Rest ohne Links und ohne Titel: bei Deal-Posts steht hier viel (Preise, ROI, mehrere Zeilen).
  const rest = [t.text, t.url].filter(Boolean).join("\n").replace(/https?:\/\/[^\s<>"')\]]+/gi, "").trim();
  const zeilen = rest.split(/\n+/).filter((z) => z.trim()).length;
  if (rest.length > 200 || zeilen > 3) return null;
  const preise = [...alles.replace(/https?:\/\/\S+/g, "").matchAll(/(\d{1,5}(?:[.,]\d{2}))\s*(?:€|EUR)|(?:€|EUR)\s*(\d{1,5}(?:[.,]\d{2}))/gi)].map((m) => preisAusText(m[1] ?? m[2]));
  const preis = preise.length === 1 ? preise[0] : null;
  const amazon = urls.find((u) => AMAZON.test(u) || KURZLINK.test(u));
  if (amazon) {
    // Amazon-Link aus der App: kurz als /dp/ASIN im selben Land – das Land gilt für Kauf-Link und Preis.
    const c = leseCode(amazon);
    const tld = /amazon\.([a-z.]+?)\//i.exec(amazon)?.[1]?.toLowerCase() ?? "de";
    return { modus: "online", code: c && "asin" in c ? `https://www.amazon.${tld}/dp/${c.asin}` : amazon.slice(0, 300), shop: null, preis };
  }
  if (!urls.length) {
    // Nur die ASIN (z. B. aus Keepa/SellerAmp kopiert), höchstens mit Preis – Deal-Texte mit ASIN bleiben im Eingang.
    const m = /^\s*(B0[A-Z0-9]{8})\s*(?:(\d{1,5}(?:[.,]\d{2})?)\s*(?:€|EUR)?)?\s*$/i.exec(alles);
    return m ? { modus: "online", code: m[1].toUpperCase(), shop: null, preis: m[2] ? preisAusText(m[2]) : null } : null;
  }
  const shop = urls.find((u) => istShop(u));
  return shop ? { modus: "online", code: null, shop: shop.slice(0, 500), preis } : null;
}

/** Ziel-URL der Scan-Seite für ein Teilen-Ziel. */
export function teilenUrl(z: TeilenZiel): string {
  const q = new URLSearchParams({ modus: z.modus });
  if (z.code) q.set("code", z.code);
  if (z.shop) q.set("shop", z.shop);
  if (z.preis) q.set("preis", String(z.preis).replace(".", ","));
  return `/scan?${q.toString()}`;
}

export type HeuteZeile = { ampel: string | null; aktion: string | null; listeMenge: number | null; listePreis: number | null; preis: number; rueckverguetung: number; empfohleneMenge: number | null; menge: number | null };

/**
 * „Heute gescannt“: Anzahl je Ampel und Summe der geplanten Einkäufe (Einkaufsliste und „Kauf vorbereitet“, Menge ×
 * Preis nach Rückvergütung). Verworfene zählen nicht; ohne Menge zählt die empfohlene, sonst 1.
 */
export function heuteSumme(z: HeuteZeile[]): { scans: number; gruen: number; gelb: number; rot: number; offen: number; geplant: number; geplantStueck: number; positionen: number } {
  const s = { scans: z.length, gruen: 0, gelb: 0, rot: 0, offen: 0, geplant: 0, geplantStueck: 0, positionen: 0 };
  for (const x of z) {
    if (x.ampel === "gruen") s.gruen++;
    else if (x.ampel === "gelb") s.gelb++;
    else if (x.ampel === "rot") s.rot++;
    else s.offen++;
    if (x.aktion !== "einkaufsliste" && x.aktion !== "kauf_vorbereitet" && x.aktion !== "gekauft") continue;
    const menge = x.listeMenge ?? x.menge ?? x.empfohleneMenge ?? 1;
    const preis = x.listePreis ?? ekMitRueckverguetung(x.preis, x.rueckverguetung);
    s.geplant += menge * preis;
    s.geplantStueck += menge;
    s.positionen++;
  }
  s.geplant = r2(s.geplant);
  return s;
}

/** Budget-Ampel für die geplanten Einkäufe: Rest = Tagesbudget − gekauft − geplant (0 = ohne Budget). */
export function budgetRest(o: { jeTag: number; gekauftHeute: number; geplant: number }): { rest: number | null; ampel: "gruen" | "gelb" | "rot" | null; text: string } {
  if (!(o.jeTag > 0)) return { rest: null, ampel: null, text: "Kein Tagesbudget eingestellt (Einstellungen → Deal-Eingang)." };
  const rest = r2(o.jeTag - o.gekauftHeute - o.geplant);
  const anteil = (o.gekauftHeute + o.geplant) / o.jeTag;
  const ampel = rest < 0 ? "rot" : anteil >= 0.8 ? "gelb" : "gruen";
  const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
  return { rest, ampel, text: rest < 0 ? `Tagesbudget um ${eur(-rest)} überschritten` : `Restbudget heute ${eur(rest)}` };
}

/** Satz zur Kapital-Ampel des eigenen Bestands (nur wenn das Produkt schon im Bestand ist). */
export function kapitalSatz(k: { ampel: string; reichweite: number | null; kapital: number | null } | null): string | null {
  if (!k) return null;
  const was = k.ampel === "rot" ? "Kapital-Ampel ROT – erst abverkaufen" : k.ampel === "gelb" ? "Kapital-Ampel GELB" : "Kapital-Ampel GRÜN";
  const rw = k.reichweite === null ? "" : k.reichweite >= 9999 ? ", keine Verkäufe" : `, Reichweite ${Math.round(k.reichweite)} Tage`;
  const kap = k.kapital !== null ? `, ${Math.round(k.kapital)} € gebunden` : "";
  return `${was}${rw}${kap}.`;
}
