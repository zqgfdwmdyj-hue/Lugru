import { parseAmount, parseDate } from "@/lib/numbers";

// Liest Eckdaten aus Rechnungen: Dateiname (Invoice Fetcher) und PDF-Text.

/** "2026-09-27-amazon-business-api-LU123.pdf" → { date, sourceKey: "amazon-business-api" } */
export function parseInvoiceFileName(name: string): { date: string | null; sourceKey: string | null } {
  const base = name.replace(/\.pdf$/i, "");
  const m = /^(\d{4}-\d{2}-\d{2})[-_ ](.*)$/.exec(base);
  if (!m) return { date: null, sourceKey: null };
  const tokens = m[2].split("-");
  const key: string[] = [];
  for (const t of tokens) {
    if (!/^[a-z]+$/.test(t)) break;
    key.push(t);
  }
  return { date: m[1], sourceKey: key.length ? key.join("-") : null };
}

export type InvoiceFacts = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  orderNumber: string | null;
  totalGross: number | null;
  totalNet: number | null;
  asins: string[];
};

const AMOUNT = String.raw`(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:[.,]\d{2}))\s*(?:€|EUR)?`;

function lastAmountAfter(text: string, labels: RegExp): number | null {
  const re = new RegExp(`(?:${labels.source})[^\\n\\d-]{0,40}${AMOUNT}`, "gi");
  let found: number | null = null;
  for (const m of text.matchAll(re)) {
    const v = parseAmount(m[1].replace(/\s/g, ""));
    if (v !== null) found = v;
  }
  return found;
}

export function extractInvoiceFacts(text: string): InvoiceFacts {
  const t = text.replace(/ /g, " ");
  const num = /(?:rechnungs(?:-|\s)?(?:nummer|nr\.?)|invoice\s*(?:no\.?|number|#))[:\s#]*([A-Z0-9][A-Z0-9\-/]{3,30})/i.exec(t)?.[1] ?? null;
  const dateRaw = /(?:rechnungsdatum|invoice date|datum der rechnung|lieferdatum|datum)[:\s]*(\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i.exec(t)?.[1];
  const order =
    /\b(\d{3}-\d{7}-\d{7})\b/.exec(t)?.[1] ??
    /(?:bestell(?:ung|nummer|-nr\.?|nr\.?)|auftrags(?:nummer|nr\.?)|order\s*(?:no\.?|number|#|id))[:\s#]*([A-Z0-9][A-Z0-9\-/]{3,30})/i.exec(t)?.[1] ??
    null;
  const gross = lastAmountAfter(t, /gesamtbetrag|rechnungsbetrag|endbetrag|zu zahlen(?:der betrag)?|gesamtsumme|summe brutto|brutto(?:betrag)?|total(?: amount)?|zahlbetrag/);
  const net = lastAmountAfter(t, /nettobetrag|summe netto|zwischensumme(?: netto)?|gesamt netto|netto|subtotal|net amount/);
  const asins = [...new Set([...t.matchAll(/\bB0[A-Z0-9]{8}\b/g)].map((m) => m[0]))];
  return {
    invoiceNumber: num,
    invoiceDate: dateRaw ? parseDate(dateRaw) : null,
    orderNumber: order,
    totalGross: gross,
    totalNet: net,
    asins,
  };
}

/** Grobe Einordnung nach Quelle, bis eine Regel gespeichert ist. */
export function guessKind(sourceKey: string | null): "goods" | "expense" | "unknown" {
  const k = (sourceKey ?? "").toLowerCase();
  if (!k) return "unknown";
  if (/amazon-business|smyth|mediamarkt|saturn|otto|kaufland|lidl|aldi|mueller|muller|douglas|flaconi|notino|rossmann|thalia|lego|wmf|ibood|alza|conrad|galaxus|toom|obi|bauhaus|xxxlutz|tchibo|metro|netto/.test(k)) return "goods";
  if (/telekom|vodafone|o2|ionos|1und1|adobe|hd-plus|tesla|dhl|google|microsoft|apple|strato|hetzner|shopify|sellerboard|arbitrage|bqool|keepa|helium|jungle|sky|netflix|spotify|versicherung|allianz|tank|shell|aral/.test(k)) return "expense";
  return "unknown";
}

/**
 * Sucht die Kombination von Chargen, deren Summe dem Rechnungsbetrag entspricht
 * (Toleranz 2 % bzw. 0,50 €). Liefert nur ein eindeutiges Ergebnis.
 */
export function matchBySum<T extends { id: string; gross: number }>(candidates: T[], total: number, maxSize = 5): T[] | null {
  const tol = Math.max(0.5, total * 0.02);
  const list = candidates.slice(0, 14);
  const hits: T[][] = [];
  const walk = (start: number, chosen: T[], sum: number) => {
    if (chosen.length && Math.abs(sum - total) <= tol) hits.push([...chosen]);
    if (chosen.length >= maxSize || hits.length > 1) return;
    for (let i = start; i < list.length; i++) {
      if (sum + list[i].gross > total + tol) continue;
      chosen.push(list[i]);
      walk(i + 1, chosen, sum + list[i].gross);
      chosen.pop();
    }
  };
  walk(0, [], 0);
  return hits.length === 1 ? hits[0] : null;
}
