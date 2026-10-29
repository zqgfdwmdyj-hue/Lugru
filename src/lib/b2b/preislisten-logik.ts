// Preislisten für B2B-Deals – reine Logik ohne Datenbank: KI-Spaltenzuordnung (Prompt + Antwort prüfen),
// Ampel und Kundenpreis-Vorschlag je Angebot.

import type { FeedMapping } from "@/db/schema";
import { MWST } from "./logic";

const FELDER = ["ean", "asin", "supplierSku", "title", "price", "stock", "moq", "url"] as const;

export function kiSpaltenPrompt(headers: string[], beispiel: string[][]): string {
  return [
    "Ordne die Spalten einer Großhändler-Preisliste zu. Antworte nur mit JSON, ohne Text drumherum:",
    '{"ean": <Spaltenname|null>, "asin": …, "supplierSku": …, "title": …, "price": …, "stock": …, "moq": …, "url": …}',
    "ean = EAN/GTIN/Barcode; supplierSku = Artikelnummer des Lieferanten; title = Produktname; price = Einkaufspreis je Einheit (netto, nicht UVP/VK);",
    "stock = Bestand; moq = Mindestabnahme/VPE; url = Produktlink. Nur Spaltennamen genau wie unten, sonst null.",
    "",
    `Spalten: ${JSON.stringify(headers)}`,
    "Beispielzeilen:",
    ...beispiel.map((r) => JSON.stringify(r.slice(0, headers.length))),
  ].join("\n");
}

/** KI-Antwort prüfen: nur bekannte Felder, nur vorhandene Spaltennamen, keine doppelt vergebenen. */
export function leseKiSpalten(text: string, headers: string[]): FeedMapping | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const out: FeedMapping = {};
  const vergeben = new Set<string>();
  for (const f of FELDER) {
    const v = j[f];
    if (typeof v === "string" && headers.includes(v) && !vergeben.has(v)) {
      out[f] = v;
      vergeben.add(v);
    }
  }
  if (!out.supplierSku && out.ean) out.supplierSku = out.ean;
  return Object.keys(out).length ? out : null;
}

export type Ampel = "gruen" | "gelb" | "rot";

/**
 * Kundenpreis-Vorschlag: höchster Preis, bei dem der Kunde im Land noch den Mindest-ROI erreicht
 * (VK netto − Gebühren) / (1 + ROI) − Prep. Ampel: grün = Vorschlag lässt uns die Mindestmarge und der Markt ist
 * nicht von Amazon besetzt; gelb = knapp oder Amazon häufig in der Buy Box; rot = kein Spielraum.
 */
export function kundenpreisVorschlag(o: { vkEur: number | null; land: string; gebuehren: number | null; minRoi: number; prep: number; ek: number; versandAnteil: number; minMargeProzent: number; amazonProzent: number | null }): { preis: number | null; marge: number | null; ampel: Ampel } {
  if (o.vkEur === null || o.gebuehren === null || o.ek <= 0) return { preis: null, marge: null, ampel: "rot" };
  const netto = o.vkEur / (1 + (MWST[o.land] ?? 0.19));
  const preis = Math.floor(((netto - o.gebuehren) / (1 + o.minRoi) - o.prep) * 100) / 100;
  const marge = Math.round(((preis - o.ek - o.versandAnteil) / o.ek) * 10000) / 100;
  if (preis <= 0 || marge < 0) return { preis: preis > 0 ? preis : null, marge, ampel: "rot" };
  const amazonStark = (o.amazonProzent ?? 0) >= 50;
  return { preis, marge, ampel: marge >= o.minMargeProzent && !amazonStark ? "gruen" : "gelb" };
}
