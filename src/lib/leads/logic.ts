// Großhändler finden – reine Logik ohne Datenbank und Netz, damit sie sich testen lässt.
// Grundlage: Das Verpackungsregister (LUCID) listet jede Firma, die Ware einer Marke in
// Deutschland erstmals in Verkehr bringt – also auch Importeure und Großhändler. Viele
// Marken im eigenen Eintrag sprechen für einen Händler/Distributor.

import type { LEAD_KINDS } from "@/db/schema";

export type LeadKind = (typeof LEAD_KINDS)[number];

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marke als ganzes Wort („Wella Professionals“ ja, „Pawella“ / „Welland“ nein). */
export function brandMatches(brands: string[], search: string): boolean {
  const q = fold(search);
  if (!q) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(q)}([^a-z0-9]|$)`);
  return brands.some((b) => re.test(fold(b)));
}

const LEGAL_FORM =
  /\b(gmbh|ug|ag|kg|ohg|gbr|e\.?\s?k\.?|e\.?\s?v\.?|ltd|limited|llc|inc|corp|plc|s\.?\s?r\.?\s?l\.?|s\.?\s?l\.?u?|s\.?\s?a\.?s?|sarl|b\.?\s?v\.?|n\.?\s?v\.?|a\/s|aps|s\.?\s?r\.?\s?o\.?|sp\.?\s?z\s?o\.?\s?o\.?|kft|d\.?\s?o\.?\s?o\.?|oy|ab|s\.?\s?p\.?\s?a\.?|spa|ou|uab|sia|eood|ood|bvba|sprl|ehf|as)\b/i;
const BUSINESS_WORD =
  /\b(company|holding|group|gruppe|trading|trade|handel|handels|vertrieb|distribution|distributie|import|export|cosmetic|cosmetics|kosmetik|beauty|store|shop|versand|international|global|europe|commerce|e-?commerce|supply|wholesale|großhandel|grosshandel|inhaber|services?|solutions|brands?|retail|lux)\b/i;
const SALON = /(salon|friseur|coiffeur|coiffure|barber|haarstudio|haardesign|hair\s?(studio|design|lounge)|cut\s?club|cutting|hairstyle|damen\s?und\s?herren)/i;

/** Große Marktplätze und Ketten – keine Bezugsquelle für Händler. */
const MARKETPLACES = [
  "amazon", "action", "rossmann", "dm-drogerie", "drogerie markt", "muller", "mueller", "douglas", "flaconi", "notino", "otto", "zalando",
  "kaufland", "lidl", "aldi", "edeka", "rewe", "netto", "penny", "tchibo", "ebay", "temu", "shein", "allegro", "lookfantastic", "parfumdreams",
  "costco", "metro", "tk maxx", "tjx", "primark", "galeria",
];

export const isCompanyName = (name: string) => LEGAL_FORM.test(name) || BUSINESS_WORD.test(name);
export const isSalonName = (name: string) => SALON.test(name);
export function isMarketplaceName(name: string) {
  const n = ` ${fold(name)} `;
  return MARKETPLACES.some((m) => n.includes(` ${m} `));
}

/** Sieht nach einer Privatperson aus (Vor- und Nachname ohne Firmenzusatz)? */
export function looksLikePerson(name: string): boolean {
  if (isCompanyName(name) || isSalonName(name) || /\d/.test(name)) return false;
  const words = name.trim().split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[\p{L}][\p{L}'.-]*$/u.test(w));
}

export type PreInput = {
  companyName: string;
  brands: string[] | null;
  searchBrand: string;
  registrationEnd?: string | null;
  /** Markenliste vollständig? Bei sehr großen Händlern gekürzt – dann zählt eine fehlende Marke nicht. */
  brandsComplete?: boolean;
};

/** Vorab-Einschätzung nur aus dem Registereintrag – vor jeder Websuche. */
export function preAssess(l: PreInput): { kind: LeadKind; score: number; exactBrand: boolean | null; reasons: string[] } {
  const reasons: string[] = [];
  const brands = l.brands ?? [];
  const found = l.brands ? brandMatches(brands, l.searchBrand) : null;
  const exactBrand = found === false && l.brandsComplete === false ? null : found;
  let score = 30;
  let kind: LeadKind = "unklar";

  if (exactBrand === true) {
    score += 20;
    reasons.push(`Marke „${l.searchBrand}“ eingetragen`);
  } else if (exactBrand === false) {
    score -= 40;
    reasons.push(`„${l.searchBrand}“ nur als Wortteil (z. B. in einem anderen Markennamen)`);
  }
  if (brands.length >= 3) {
    score += Math.min(30, brands.length * 4);
    reasons.push(`${brands.length} Marken gemeldet – spricht für Händler/Importeur`);
    kind = "haendler";
  }
  if (isCompanyName(l.companyName)) score += 10;

  const own = fold(l.companyName);
  if (own.includes(fold(l.searchBrand)) && brands.length <= 3 && exactBrand !== false) {
    kind = "hersteller";
    score -= 10;
    reasons.push("Firmenname enthält die Marke – vermutlich Markeninhaber");
  }
  if (isSalonName(l.companyName)) {
    kind = "salon";
    score -= 25;
    reasons.push("Friseursalon");
  } else if (looksLikePerson(l.companyName)) {
    kind = "privat";
    score -= 30;
    reasons.push("Name einer Einzelperson");
  }
  if (isMarketplaceName(l.companyName)) {
    kind = "marktplatz";
    score -= 60;
    reasons.push("Marktplatz/Handelskette");
  }
  if (l.registrationEnd) {
    score -= 30;
    reasons.push(`Registrierung beendet (${l.registrationEnd})`);
  }
  return { kind, score: Math.max(0, Math.min(100, score)), exactBrand, reasons };
}

/** Deutsch für DACH (und Luxemburg/Liechtenstein), sonst Englisch. */
export function mailLanguageFor(country: string | null | undefined): "de" | "en" {
  return /^(deutschland|österreich|oesterreich|schweiz|liechtenstein|luxemburg|germany|austria|switzerland)$/i.test((country ?? "").trim()) ? "de" : "en";
}

export const validEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(s.trim());

/** Wer darf angeschrieben werden? Nie Privatpersonen, Salons, Marktplätze, beendete Registrierungen oder doppelt. */
export function contactBlocker(l: { kind: LeadKind; email: string | null; mailedAt: Date | null; status: string; registrationEnd: string | null }): string | null {
  if (l.mailedAt) return "schon angeschrieben";
  if (l.status === "kein_interesse" || l.status === "ausgeschlossen") return "ausgeschlossen";
  if (l.kind === "privat") return "Privatperson – nicht anschreiben";
  if (l.kind === "salon" || l.kind === "marktplatz") return "kein Großhändler";
  if (l.registrationEnd) return "Registrierung beendet";
  if (!validEmail(l.email)) return "keine E-Mail-Adresse";
  return null;
}

export type ResearchResult = {
  website: string | null;
  email: string | null;
  phone: string | null;
  kind: LeadKind;
  wholesale: boolean | null;
  sellsBrand: boolean | null;
  b2bUrl: string | null;
  summary: string | null;
  evidence: { label: string; value: string; url?: string }[];
};

const KINDS: LeadKind[] = ["grosshandel", "haendler", "hersteller", "salon", "marktplatz", "privat", "unklar"];
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, max) : null);
const url = (v: unknown) => {
  const s = str(v, 500);
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
};
const bool = (v: unknown) => (v === true || v === false ? v : null);

/** KI-Antwort (JSON, ggf. mit Text drumherum) in ein sauberes Ergebnis übersetzen. */
export function parseResearch(text: string): ResearchResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const kind = KINDS.includes(o.kind as LeadKind) ? (o.kind as LeadKind) : o.wholesale === true ? "grosshandel" : "unklar";
  const email = str(o.email, 200);
  return {
    website: url(o.website),
    email: validEmail(email) ? email.toLowerCase() : null,
    phone: str(o.phone, 60),
    kind,
    wholesale: bool(o.wholesale),
    sellsBrand: bool(o.sellsBrand),
    b2bUrl: url(o.b2bUrl),
    summary: str(o.summary, 600),
    evidence: Array.isArray(o.evidence)
      ? o.evidence
          .flatMap((e) => {
            const r = e as Record<string, unknown>;
            const label = str(r.label, 80);
            const value = str(r.value, 300);
            return label && value ? [{ label, value, ...(url(r.url) ? { url: url(r.url)! } : {}) }] : [];
          })
          .slice(0, 6)
      : [],
  };
}

/** Kendo-Filter des Registers: Feld~contains~'Wert', mehrere mit ~and~. */
export function kendoFilter(fields: Record<string, string | undefined>): string {
  return Object.entries(fields)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}~contains~'${v!.trim().replace(/'/g, "''")}'`)
    .join("~and~");
}
