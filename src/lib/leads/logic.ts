// Großhändler finden – reine Logik ohne Datenbank und Netz, damit sie sich testen lässt.
// Grundlage: Das Verpackungsregister (LUCID) listet jede Firma, die Ware einer Marke in
// Deutschland erstmals in Verkehr bringt – also auch Importeure und Großhändler. Viele
// Marken im eigenen Eintrag sprechen für einen Händler/Distributor.

import type { LEAD_KINDS } from "@/db/schema";

export type LeadKind = (typeof LEAD_KINDS)[number];

/** Eintrag im Herstellerregister (LUCID), wie ihn die Suchmaske liefert. */
export type LucidProducer = {
  ManufacturerId: string;
  CompanyName: string;
  RegisterNumber?: string | null;
  Street?: string | null;
  StreetNumber?: string | null;
  ZipCode?: string | null;
  Location?: string | null;
  Country?: string | null;
  TelephoneNumber?: string | null;
  RegisterDate?: string | null;
  RegistrationEndDate?: string | null;
  IsForeignProducer?: boolean;
};

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
  return /^(deutschland|österreich|oesterreich|schweiz|liechtenstein|luxemburg|germany|austria|switzerland|de|at|ch|li|lu)$/i.test((country ?? "").trim()) ? "de" : "en";
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

// ---- Weitere Quellen: Amazon-/eBay-Verkäufer, GPSR-Angaben, Websuche ----------------------

/** Firmenname ohne Rechtsform und Satzzeichen – erkennt dieselbe Firma aus verschiedenen Quellen. */
export function nameKey(name: string): string {
  const base = fold(name).replace(/ß/g, "ss").replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const k = base
    .replace(/\b(gmbh|mbh|ug|haftungsbeschrankt|ag|kg|ohg|gbr|ek|e k|ev|e v|co|ltd|limited|llc|inc|corp|plc|srl|s r l|sl|sa|s a|sas|sarl|bv|b v|nv|n v|aps|sro|s r o|sp z o o|kft|doo|d o o|oy|spa|s p a)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return k.length >= 3 ? k : base.replace(/\s+/g, " ");
}

const COUNTRIES: Record<string, string> = {
  DE: "Deutschland", AT: "Österreich", CH: "Schweiz", LI: "Liechtenstein", LU: "Luxemburg", NL: "Niederlande", BE: "Belgien", FR: "Frankreich",
  IT: "Italien", ES: "Spanien", PT: "Portugal", PL: "Polen", CZ: "Tschechien", SK: "Slowakei", HU: "Ungarn", SI: "Slowenien", HR: "Kroatien",
  DK: "Dänemark", SE: "Schweden", FI: "Finnland", NO: "Norwegen", IE: "Irland", GB: "Vereinigtes Königreich", UK: "Vereinigtes Königreich",
  RO: "Rumänien", BG: "Bulgarien", GR: "Griechenland", LT: "Litauen", LV: "Lettland", EE: "Estland", CY: "Zypern", MT: "Malta",
  TR: "Türkei", CN: "China", HK: "Hongkong", US: "USA", AE: "Vereinigte Arabische Emirate",
};
/** Ländercode (DE) → Name wie im Verpackungsregister (Deutschland). */
export const countryName = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  if (!t) return null;
  return COUNTRIES[t.toUpperCase()] ?? t;
};

/** Adresszeilen (z. B. von Keepa: letzte Zeile = Ländercode) in Straße, PLZ, Ort, Land zerlegen. */
export function parseAddressLines(lines: string[] | null | undefined, companyName?: string): { street: string | null; zip: string | null; city: string | null; country: string | null } {
  const ls = (lines ?? []).map((l) => (l ?? "").trim()).filter(Boolean);
  let country: string | null = null;
  if (ls.length && /^[A-Za-z]{2}$/.test(ls[ls.length - 1])) country = countryName(ls.pop());
  let zip: string | null = null;
  let city: string | null = null;
  let zipIdx = -1;
  ls.forEach((l, i) => {
    const m = /^(?:[A-Z]{1,2}[- ])?(\d{4,5}(?:\s?[A-Z]{2})?)\s+(.+)$/.exec(l);
    if (m && zipIdx < 0) {
      zip = m[1];
      city = m[2];
      zipIdx = i;
    }
  });
  const own = companyName ? nameKey(companyName) : "";
  const rest = ls.filter((l, i) => i !== zipIdx && (!own || nameKey(l) !== own));
  const street = rest.find((l) => /\d/.test(l)) ?? rest[0] ?? null;
  return { street, zip, city, country };
}

export type SellerAssessInput = {
  companyName: string;
  source: "amazon" | "ebay" | "gpsr" | "web" | "messe";
  /** Messe: Name und Kategorien/Beschreibung des Ausstellers. */
  fair?: string;
  categories?: string[];
  description?: string | null;
  /** Wie viele Produkte der Marke der Verkäufer anbietet. */
  offers?: number;
  email?: string | null;
  role?: "manufacturer" | "responsible" | "distributor" | "wholesaler" | "retailer" | null;
  searchBrand: string;
};

/** Vorab-Einschätzung für Funde außerhalb des Registers. */
export function assessFinding(i: SellerAssessInput): { kind: LeadKind; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let kind: LeadKind = "unklar";
  let score = 35;
  if (i.source === "amazon" || i.source === "ebay") {
    kind = "haendler";
    const where = i.source === "amazon" ? "Amazon" : "eBay";
    if ((i.offers ?? 0) >= 5) {
      score += 20;
      reasons.push(`verkauft ${i.offers} Produkte der Marke auf ${where} – kauft größere Mengen ein`);
    } else if (i.offers) {
      score += 5 + i.offers * 2;
      reasons.push(`verkauft ${i.offers} Produkt(e) der Marke auf ${where}`);
    }
  }
  if (i.source === "gpsr") {
    if (i.role === "manufacturer") {
      kind = "hersteller";
      score += 5;
      reasons.push("Hersteller laut Produktsicherheitsangaben (GPSR) – nach Distributoren in Deutschland fragen");
    } else {
      score += 25;
      reasons.push("EU-Verantwortlicher laut GPSR – oft Importeur oder Distributor der Marke");
    }
  }
  if (i.source === "web") {
    if (i.role === "distributor" || i.role === "wholesaler") {
      kind = "grosshandel";
      score += 30;
      reasons.push("laut Websuche Distributor/Großhändler der Marke");
    } else if (i.role === "manufacturer") {
      kind = "hersteller";
      reasons.push("laut Websuche Hersteller/Markeninhaber");
    } else if (i.role === "retailer") {
      kind = "haendler";
      reasons.push("laut Websuche Händler");
    }
  }
  if (i.source === "messe") {
    const about = `${(i.categories ?? []).join(" ")} ${i.description ?? ""}`;
    if (/dienstleist|agentur|fotograf|software|logistik|beratung|sourcing|marketing|service/i.test(about) && !/großhandel|grosshandel|wholesale|import|distribut/i.test(about)) {
      score -= 15;
      reasons.push(`Aussteller auf ${i.fair ?? "der Messe"} – eher Dienstleister`);
    } else {
      score += 20;
      reasons.push(`Aussteller auf ${i.fair ?? "der Messe"} – verkauft an Händler`);
    }
    if (/großhandel|grosshandel|wholesale|import|distribut|restposten|sonderposten/i.test(about)) {
      kind = "grosshandel";
      score += 10;
      reasons.push("beschreibt sich als Importeur/Großhändler");
    } else if (/eigenmarke|hersteller|manufactur|produzent|private label/i.test(about)) {
      kind = "hersteller";
      reasons.push("Hersteller/Eigenmarken");
    }
  }
  if (validEmail(i.email)) score += 10;
  if (isCompanyName(i.companyName)) score += 5;
  if (i.searchBrand && fold(i.companyName).includes(fold(i.searchBrand)) && i.source !== "web" && i.role !== "responsible") {
    kind = "hersteller";
    reasons.push("Firmenname enthält die Marke – vermutlich Markeninhaber");
  }
  if (looksLikePerson(i.companyName)) {
    kind = "privat";
    score -= 30;
    reasons.push("Name einer Einzelperson");
  }
  if (isMarketplaceName(i.companyName)) {
    kind = "marktplatz";
    score -= 60;
    reasons.push("Marktplatz/Handelskette");
  }
  return { kind, score: Math.max(0, Math.min(100, score)), reasons };
}

export type Distributor = { name: string; website: string | null; email: string | null; phone: string | null; city: string | null; country: string | null; role: "distributor" | "wholesaler" | "manufacturer" | "retailer" | null; note: string | null; url: string | null };

/** KI-Antwort der Distributoren-Suche (JSON mit „companies“) auswerten. */
export function parseDistributors(text: string): Distributor[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let o: { companies?: unknown };
  try {
    o = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(o.companies)) return [];
  const roles = ["distributor", "wholesaler", "manufacturer", "retailer"] as const;
  const seen = new Set<string>();
  return o.companies
    .flatMap((c) => {
      const r = c as Record<string, unknown>;
      const name = str(r.name, 160);
      if (!name || seen.has(nameKey(name))) return [];
      seen.add(nameKey(name));
      const email = str(r.email, 200);
      return [{
        name,
        website: url(r.website),
        email: validEmail(email) ? email.toLowerCase() : null,
        phone: str(r.phone, 60),
        city: str(r.city, 80),
        country: countryName(str(r.country, 60)),
        role: roles.includes(r.role as (typeof roles)[number]) ? (r.role as Distributor["role"]) : null,
        note: str(r.note, 300),
        url: url(r.sourceUrl ?? r.url),
      }];
    })
    .slice(0, 25);
}

export type LucidImportProducer = LucidProducer & { brands: string[] | null; brandsComplete: boolean };

/** Daten vom Register-Lesezeichen prüfen – kommen aus dem Browser, also nichts ungeprüft übernehmen. */
export function parseLucidPayload(raw: string): { ok: true; mode: "full" | "brands"; brand: string; total: number; producers: LucidImportProducer[] } | { ok: false; message: string } {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.trim());
  } catch {
    return { ok: false, message: "Keine gültigen Register-Daten (bitte das Lesezeichen erneut auf der Registerseite klicken)." };
  }
  if (o.lucidImport !== 1) return { ok: false, message: "Das sind keine Daten vom Register-Lesezeichen." };
  // „brands“: nur Markenlisten zu schon bekannten Firmen (fehlende nachladen).
  const mode = o.mode === "brands" ? "brands" : "full";
  const brand = str(o.brand, 80) ?? "";
  if (mode === "full" && brand.length < 2) return { ok: false, message: "Marke fehlt." };
  if (!Array.isArray(o.producers)) return { ok: false, message: "Keine Firmen in den Daten." };
  const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) || null : typeof v === "number" ? String(v) : null);
  const producers: LucidImportProducer[] = o.producers.slice(0, 2000).flatMap((x) => {
    const p = x as Record<string, unknown>;
    const id = s(p.ManufacturerId, 80);
    const name = s(p.CompanyName, 300) ?? (mode === "brands" ? "" : null);
    if (!id || name === null) return [];
    const brands = Array.isArray(p.brands) ? [...new Set(p.brands.filter((b): b is string => typeof b === "string").map((b) => b.trim().slice(0, 150)).filter(Boolean))].slice(0, 5000) : null;
    return [{
      ManufacturerId: id,
      CompanyName: name,
      RegisterNumber: s(p.RegisterNumber, 40),
      Street: s(p.Street),
      StreetNumber: s(p.StreetNumber, 20),
      ZipCode: s(p.ZipCode, 20),
      Location: s(p.Location, 120),
      Country: s(p.Country, 80),
      TelephoneNumber: s(p.TelephoneNumber, 60),
      RegisterDate: s(p.RegisterDate, 40),
      RegistrationEndDate: s(p.RegistrationEndDate, 40),
      IsForeignProducer: p.IsForeignProducer === true,
      brands,
      brandsComplete: p.brandsComplete !== false,
    }];
  });
  const total = typeof o.total === "number" && o.total >= 0 ? Math.round(o.total) : producers.length;
  return { ok: true, mode, brand, total, producers };
}

// ---- Verpackungsregister nicht erreichbar ------------------------------------------------------

const VIA_BROWSER = "Sofort geht es unten über „Verpackungsregister über deinen Browser abfragen“.";

/** Hinweis an Kontakten, deren Markenliste noch fehlt, weil das Register drosselt. */
export const BRANDS_WAITING = "Markenliste wartet: Das Verpackungsregister drosselt gerade – sie wird automatisch nachgeladen.";
/** Fehlertext zur Markenliste (alt: „Marken nicht geladen: …“) – wird beim erfolgreichen Nachladen gelöscht. */
export const isBrandNote = (s: string | null | undefined) => !!s && /^Marken(liste)? /.test(s);

/** Verständliche Meldung, warum das Register nicht antwortet – mit dem Weg über den Browser. */
export function lucidFailureMessage(status: number | null, cause?: unknown): string {
  if (status === 401 || status === 403) return `Das Verpackungsregister lehnt Anfragen von diesem Server ab (HTTP ${status}) – Rechenzentrums-Adressen werden dort offenbar gesperrt. ${VIA_BROWSER}`;
  if (status === 429 || status === 503) return `Das Verpackungsregister drosselt gerade die Anfragen dieses Servers (HTTP ${status}) – nach vielen Abfragen in kurzer Zeit sperrt es für eine Weile (meist 15–60 Minuten). ${VIA_BROWSER}`;
  if (status !== null && status >= 500) return `Das Verpackungsregister meldet einen Serverfehler (HTTP ${status}) – oft Wartung, später erneut versuchen. ${VIA_BROWSER}`;
  if (status !== null) return `Verpackungsregister nicht erreichbar (HTTP ${status}). ${VIA_BROWSER}`;
  const c = cause as { name?: string; message?: string; cause?: { code?: string; message?: string } } | undefined;
  const code = c?.cause?.code ?? (c?.name === "TimeoutError" ? "TIMEOUT" : "");
  const why =
    /TIMEOUT|ETIMEDOUT/.test(code) ? "Zeitüberschreitung"
    : code === "ENOTFOUND" || code === "EAI_AGAIN" ? "Adresse nicht auflösbar (DNS)"
    : code === "ECONNREFUSED" || code === "ECONNRESET" ? "Verbindung abgewiesen"
    : /CERT|SSL|TLS/i.test(`${code} ${c?.cause?.message ?? ""}`) ? "Zertifikatsfehler"
    : c?.cause?.message || c?.message || "Netzwerkfehler";
  return `Verpackungsregister nicht erreichbar (${why}). ${VIA_BROWSER}`;
}

// ---- Nicht doppelt anschreiben ----------------------------------------------------------------

/** Freemailer: gleiche Domain heißt hier nicht gleiche Firma. */
export const isGenericMailDomain = (domain: string) =>
  /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|gmx|web|t-online|icloud|me|aol|mail|freenet|arcor|posteo|mailbox|protonmail|proton|yandex|qq|163|126)\./i.test(domain);

const mailDomain = (email: string | null | undefined) => (email && email.includes("@") ? email.split("@")[1]!.trim().toLowerCase() : null);
const webHost = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

export type ContactRef = { id: string; companyName: string; email: string | null; website: string | null; mailedAt: Date | null; mailedTo: string | null; searchBrands: string[] };

/**
 * Wurde dieselbe Firma schon angeschrieben – über eine andere Marke, eine andere Quelle oder
 * unter anderem Namen (gleiche E-Mail, Firmen-Domain, Website oder gleicher Firmenname)?
 * Oder ist sie schon als Lieferant angelegt?
 */
export function priorContact(
  lead: Pick<ContactRef, "id" | "companyName" | "email" | "website"> & { supplierId?: string | null },
  contacted: ContactRef[],
  supplierNames: string[] = [],
): string | null {
  const key = nameKey(lead.companyName);
  const email = lead.email?.trim().toLowerCase() || null;
  const dom = mailDomain(email);
  const host = webHost(lead.website);
  for (const o of contacted) {
    if (o.id === lead.id || !o.mailedAt) continue;
    const oMail = (o.mailedTo ?? o.email)?.trim().toLowerCase() || null;
    const oDom = mailDomain(oMail);
    const why =
      email && oMail === email ? "gleiche E-Mail-Adresse"
      : dom && oDom === dom && !isGenericMailDomain(dom) ? `gleiche Firmen-Domain (@${dom})`
      : host && webHost(o.website) === host ? `gleiche Website (${host})`
      : key.length >= 4 && nameKey(o.companyName) === key ? "gleicher Firmenname"
      : null;
    if (why) {
      const when = o.mailedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
      const brands = o.searchBrands.filter(Boolean);
      return `schon angeschrieben am ${when} als „${o.companyName}“${brands.length ? ` (${brands.join(", ")})` : ""} – ${why}`;
    }
  }
  if (!lead.supplierId && key.length >= 4 && supplierNames.some((n) => nameKey(n) === key)) return "ist schon als Lieferant angelegt (Einkauf)";
  return null;
}

/** Kein Treffer im Register: Marken sind dort oft anders gemeldet (z. B. „BOSS“ statt „Hugo Boss“). */
export function noRegisterHit(brand: string): string {
  const words = brand.trim().split(/\s+/).filter((w) => w.length >= 3);
  const tip = words.length > 1 ? ` Im Register ist die Marke oft anders gemeldet – mit einem Teil suchen, z. B. „${words.sort((a, b) => b.length - a.length)[0]}“.` : " Schreibweise prüfen oder eine andere Quelle (Amazon, eBay, KI-Websuche) ankreuzen.";
  return `Keine Einträge zu „${brand}“ im Verpackungsregister.${tip}`;
}
