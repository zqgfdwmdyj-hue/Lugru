// ProfitPath über Discord – reine Logik: aus einer Bot-Nachricht (Text, Embeds mit Feldern, Links) ein Angebot lesen.
// ProfitPath meldet Einkaufspreis (Shop, brutto), Verkaufspreis, Gewinn, Marge, ROI; die ASIN steckt im Amazon-Link.

import type { DealAngebot } from "@/db/tables/deal-eingang";

export type PpEmbed = { title?: string; url?: string; description?: string; fields?: { name: string; value: string }[]; footer?: { text?: string } };
export type PpNachricht = { id: string; content?: string; embeds?: PpEmbed[] };

export type PpAngebot = { angebot: DealAngebot; text: string; vk: number | null; gewinn: number | null; roi: number | null; marge: number | null; shop: string | null; unsicher: boolean };

/** Geldbetrag aus „€12,34“, „12.34 €“, „EUR 1.234,50“, „£9.99“ → Zahl. */
export function betrag(roh: string | null | undefined): number | null {
  if (!roh) return null;
  const m = /(-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)/.exec(roh.replace(/\*\*/g, ""));
  if (!m) return null;
  let s = m[1].replace(/\s/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}(?!\d)/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const prozent = (roh: string | null | undefined) => {
  const n = betrag(roh);
  return n === null ? null : Math.round(n * 10) / 10;
};

const FELD = {
  ek: /(buy\s*(cost|price)|einkauf|kaufpreis|source\s*price|purchase|cost\s*price|^cost$|^ek\b)/i,
  vk: /(sell(ing)?\s*price|verkauf|amazon\s*price|buy\s*box|^vk\b|^price$)/i,
  gewinn: /(profit|gewinn)/i,
  roi: /\broi\b/i,
  marge: /(margin|marge)/i,
  asin: /\basin\b/i,
  ean: /\b(ean|barcode|gtin)\b/i,
  shop: /(store|shop|source|quelle|händler|retailer)/i,
};

/** ASIN aus Amazon-Links (…/dp/ASIN, …/gp/product/ASIN) oder „ASIN: B0…“. */
export function asinAus(text: string): string | null {
  const l = /amazon\.[a-z.]{2,6}\/(?:[^\s/]+\/)?(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i.exec(text)?.[1];
  if (l) return l.toUpperCase();
  return /\bASIN[:\s]*\**\s*(B0[A-Z0-9]{8})\b/i.exec(text)?.[1]?.toUpperCase() ?? null;
}

export function profitPathAngebot(m: PpNachricht): PpAngebot | null {
  const teile: string[] = [];
  if (m.content?.trim()) teile.push(m.content.trim());
  const felder: { name: string; value: string }[] = [];
  let titel: string | null = null;
  for (const e of m.embeds ?? []) {
    if (e.title) {
      titel ??= e.title.trim();
      teile.push(e.title.trim());
    }
    if (e.url) teile.push(e.url);
    if (e.description) teile.push(e.description.trim());
    for (const f of e.fields ?? []) {
      felder.push(f);
      teile.push(`${f.name}: ${f.value}`);
    }
    if (e.footer?.text) teile.push(e.footer.text);
  }
  // Auch „Buy Cost: €12,34“-Zeilen im Text/der Beschreibung als Felder lesen.
  for (const z of teile.join("\n").split("\n")) {
    const kv = /^\s*\**([A-Za-zÄÖÜäöü .\/()-]{2,30})\**\s*[:：]\s*(.+)$/.exec(z);
    if (kv && !felder.some((f) => f.name.trim() === kv[1].trim())) felder.push({ name: kv[1].trim(), value: kv[2].trim() });
  }
  const text = teile.join("\n").slice(0, 8000);
  const feld = (re: RegExp) => felder.find((f) => re.test(f.name.trim()))?.value ?? null;
  const asin = asinAus(text) ?? (feld(FELD.asin) ? asinAus(`ASIN ${feld(FELD.asin)}`) : null);
  const ek = betrag(feld(FELD.ek));
  if (!asin && ek === null) return null;
  const ean = feld(FELD.ean)?.replace(/\D/g, "") || null;
  return {
    angebot: {
      asin,
      ean: ean && /^\d{8,14}$/.test(ean) ? ean : null,
      name: titel?.slice(0, 200) ?? null,
      marke: null,
      ek,
      // Shop-Preise (Online-Arbitrage) sind Endkundenpreise → brutto.
      ekNetto: ek === null ? null : false,
      waehrung: "EUR",
      menge: null,
      moq: null,
      staffel: null,
      versand: null,
      lieferzeit: null,
      zahlung: null,
      gueltigBis: null,
      zustand: "neu",
      packung: null,
    },
    text,
    vk: betrag(feld(FELD.vk)),
    gewinn: betrag(feld(FELD.gewinn)),
    roi: prozent(feld(FELD.roi)),
    marge: prozent(feld(FELD.marge)),
    shop: feld(FELD.shop)?.replace(/\*\*/g, "").trim().slice(0, 60) ?? null,
    unsicher: !asin,
  };
}

/** Kanalname → Modul („dealwatch-drogerie“ → „Dealwatch“). */
export function modulAus(kanal: string): string {
  const k = kanal.toLowerCase();
  if (k.includes("dealwatch") || k.includes("deal-watch")) return "Dealwatch";
  if (k.includes("spy")) return "SpySearch";
  if (k.includes("a2a")) return "A2A Search";
  return kanal;
}
