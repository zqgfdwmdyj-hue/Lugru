// Amazon SAS-Programm: Fahrplan, Markenauswahl für den Authorized-Reseller-Audit, Deal-Rechner.
// Reine Logik (ohne DB/Netz). Ablauf laut Programm-Unterlagen; Namen/Kontakte stehen nicht im Code.

export type SasModule = "reseller" | "deals" | "portfolio" | "paneu" | "support" | "termin" | "sonstiges";
export type SasWaiting = "ich" | "consultant" | "amazon";

export const MODULE_LABEL: Record<SasModule, string> = {
  reseller: "Authorized Reseller (Audit)",
  deals: "Black Week & Deals",
  portfolio: "Portfolioerweiterung",
  paneu: "PanEU / weitere Marktplätze",
  support: "Support (PSTAM, Account Health)",
  termin: "Termine & Business-Plan",
  sonstiges: "Sonstiges",
};
export const WAITING_LABEL: Record<SasWaiting, string> = { ich: "Ich bin dran", consultant: "Wartet auf Consultant", amazon: "Wartet auf Amazon" };

export type FahrplanStep = { key: string; module: SasModule; title: string; notes: string; waitingOn: SasWaiting; priority: "critical" | "normal" | "low"; due: (ctx: FahrplanCtx) => string | null };
export type FahrplanCtx = { today: string; dealDeadline: string | null; nextMeeting: string | null };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Standard-Fahrplan des Programms (Reihenfolge = Anzeige). */
export const FAHRPLAN: FahrplanStep[] = [
  { key: "ar-auswahl", module: "reseller", title: "10 Marken für den Authorized-Reseller-Audit auswählen und an den Consultant schicken", notes: "Nur Marken, deren legitimen Einkauf du belegen kannst (Rechnungen vom Hersteller/Großhändler). Hilfe: Reiter „Marken“ – Vorschlag nach Belegen und Umsatz, Mail-Text zum Kopieren.", waitingOn: "ich", priority: "critical", due: (c) => addDays(c.today, 3) },
  { key: "ar-appeal-mail", module: "reseller", title: "Mail vom Appeal Team abwarten (wohin die Audit-Unterlagen gehen)", notes: "Kommt laut Consultant innerhalb von etwa zwei Wochen nach der Einreichung der Marken.", waitingOn: "amazon", priority: "normal", due: () => null },
  { key: "ar-dokumente", module: "reseller", title: "Audit-Unterlagen je Marke einreichen (Rechnungen, Lieferkette)", notes: "Rechnungen der letzten Monate je Marke, Lieferantendaten. Belege findest du unter Einkauf → Eingangsrechnungen; im Reiter „Marken“ steht je Marke, wie viele Belege es gibt.", waitingOn: "ich", priority: "normal", due: () => null },
  { key: "ar-rolle", module: "reseller", title: "Authorized-Reseller-Rolle bestätigt? (ca. 3–4 Wochen nach Einreichung)", notes: "Kein Automatismus – das Audit kann auch abgelehnt werden. Danach: Erweiterung auf alle Marken.", waitingOn: "amazon", priority: "normal", due: () => null },
  { key: "ar-alle", module: "reseller", title: "Erweiterung der Rolle auf alle vertriebenen Marken anstoßen", notes: "Nach erfolgreichem Pilot mit dem Consultant besprechen.", waitingOn: "consultant", priority: "low", due: () => null },
  { key: "bw-liste", module: "deals", title: "Liste berechtigter ASINs + Mindestrabatte für Managed Best Deals anfordern", notes: "Der Consultant schickt die ASINs aus deinem Portfolio, die für Managed Best Deals in Frage kommen, mit dem nötigen Mindestrabatt. Liste dann im Reiter „Black Week“ einlesen – dort steht der Gewinn je Stück nach Rabatt.", waitingOn: "ich", priority: "critical", due: (c) => c.today },
  { key: "bw-einreichen", module: "deals", title: "Black-Week-Angebote einreichen (Coupons, Self-Service-Deals, Managed Best Deals)", notes: "Managed Best Deals über den Consultant sind im Programm kostenfrei, die ASINs müssen berechtigt sein und den Mindestrabatt erfüllen. Nur Deals mit Gewinn nach Rabatt und genug Bestand.", waitingOn: "ich", priority: "critical", due: (c) => c.dealDeadline },
  { key: "portfolio", module: "portfolio", title: "Portfolioanalyse mit dem Consultant: ASINs mit großem Potenzial", notes: "Nach dem Audit gemeinsam ansehen, welche Produkte/ASINs das Portfolio sinnvoll erweitern.", waitingOn: "consultant", priority: "normal", due: () => null },
  { key: "paneu", module: "paneu", title: "Weitere Marktplätze und PanEU-Strategie prüfen", notes: "Potenziale für internationale Expansion analysieren.", waitingOn: "ich", priority: "low", due: () => null },
  { key: "pstam", module: "support", title: "Technische/operative Probleme für den PSTAM sammeln", notes: "Erst Fall im Seller Central (Premium Support); ist er nach 2 Tagen nicht gelöst, über den Primary Case beim PSTAM eskalieren. Sperrungen/Account Health: Account Health Support, danach EPS-Formular.", waitingOn: "ich", priority: "normal", due: () => null },
  { key: "termin-bp", module: "termin", title: "Business-Plan-Update für den nächsten Termin vorbereiten (KPIs, offene Themen)", notes: "Alle 2–3 Monate per Videocall. Zahlen: Startseite „Verkäufe“, Hebel, Gewinn.", waitingOn: "ich", priority: "normal", due: (c) => (c.nextMeeting ? addDays(c.nextMeeting, -2) : null) },
];

// ---- Markenliste und Auswahl für den Audit

export const brandKey = (b: string) => b.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Marken aus einer Liste (eine Spalte oder Text, je Zeile eine Marke); Kopfzeilen und Doppel raus. */
export function parseBrandList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const b = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!b || /^(brand[_ ]?name|marke|marken|brand)$/i.test(b)) continue;
    const k = brandKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Marke als ganzes Wort (Groß/klein egal) – „DJI“ trifft „DJI Mini“, nicht „Djibouti“. */
export function brandRegex(brand: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(brandKey(brand))}($|[^\\p{L}\\p{N}])`, "iu");
}

export type BrandFacts = { products: number; sales30: number; units30: number; invoices: number; supplierOffers: number };

/**
 * Rechnungstext ohne Bankverbindung und Fußzeile: „BIC: COBADEFF…“, IBAN, SWIFT, Steuer- und Registerangaben
 * sind keine Markenbelege (die Marke „BiC“ traf sonst fast jede Rechnung).
 */
export function invoiceTextForBrands(text: string): string {
  // BIC/SWIFT nur mit echtem Code (Großbuchstaben, Länderkennung, 8 oder 11 Zeichen) – „BIC Cristal“ bleibt.
  const country = "(?:DE|AT|CH|NL|BE|LU|FR|IT|ES|PT|PL|CZ|DK|SE|FI|NO|GB|IE|HU|SK|SI|HR|RO|BG|GR|LT|LV|EE|US|CN|HK|TR)";
  const bic = new RegExp(`(?:[Ss][Ww][Ii][Ff][Tt][\\s-]*)?(?:[Bb][Ii][Cc]|[Ss][Ww][Ii][Ff][Tt])(?:\\s*[-/]?\\s*[Cc]ode)?\\s*[:.]?\\s*[A-Z]{4}${country}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\\b`, "g");
  return text
    .replace(bic, " ")
    .replace(/\biban\s*[:.]?\s*[A-Z]{2}\d{2}(\s?[A-Z0-9]{2,4}){2,8}/gi, " ")
    .replace(/\b(bankverbindung|bank\s*name|kontoinhaber|ust[-.\s]*id(nr|-nr)?\.?|steuer[-\s]*nr\.?|steuernummer|hrb\s*\d+|amtsgericht|registergericht|geschäftsführer(in)?)\b[^\n·|]{0,60}/gi, " ");
}

/** Wo eine Marke in einem Beleg vorkommt (Ausschnitt) – zum Nachprüfen der Zuordnung. */
export function brandSnippet(brand: string, text: string, width = 50): string | null {
  const clean = invoiceTextForBrands(text);
  const m = brandRegex(brand).exec(clean);
  if (!m) return null;
  const at = m.index + m[1].length;
  const from = Math.max(0, at - width);
  const to = Math.min(clean.length, at + brandKey(brand).length + width);
  return `${from > 0 ? "…" : ""}${clean.slice(from, to).replace(/\s+/g, " ").trim()}${to < clean.length ? "…" : ""}`;
}

/** Kennzahlen je Marke aus Produktnamen (sellerboard), 30-Tage-Werten, Rechnungstexten und Lieferanten-Angeboten. */
export function brandFacts(
  brands: string[],
  data: { products: { name: string | null }[]; stats: { name: string | null; sales: number | null; units: number }[]; invoices: { text: string }[]; offers: { title: string | null }[] },
): Map<string, BrandFacts> {
  const low = (s: string | null) => (s ?? "").toLowerCase();
  const products = data.products.map((p) => low(p.name));
  const stats = data.stats.map((s) => ({ name: low(s.name), sales: s.sales ?? 0, units: s.units }));
  const invoices = data.invoices.map((i) => invoiceTextForBrands(i.text).toLowerCase());
  const offers = data.offers.map((o) => low(o.title));
  const out = new Map<string, BrandFacts>();
  for (const b of brands) {
    const k = brandKey(b);
    if (k.length < 2) continue;
    const re = brandRegex(b);
    const hit = (s: string) => s.includes(k) && re.test(s);
    let sales = 0;
    let units = 0;
    for (const s of stats) if (hit(s.name)) {
      sales += s.sales;
      units += s.units;
    }
    out.set(k, { products: products.filter(hit).length, sales30: Math.round(sales * 100) / 100, units30: units, invoices: invoices.filter(hit).length, supplierOffers: offers.filter(hit).length });
  }
  return out;
}

/**
 * Vorschlag für den Audit: zuerst Marken mit Belegen (Rechnungen), dann nach Umsatz; höchstens n.
 * Ohne Umsatzdaten (sellerboard) zählen nur Belege und Lieferanten – der Aufrufer muss das kennzeichnen.
 */
export function suggestBrands<T extends { brand: string; invoices: number | null; supplierOffers: number | null; sales30: number | null }>(brands: T[], n = 10): T[] {
  const ev = (b: T) => ((b.invoices ?? 0) > 0 ? 2 : 0) + ((b.supplierOffers ?? 0) > 0 ? 1 : 0);
  return [...brands]
    .filter((b) => (b.sales30 ?? 0) > 0 || ev(b) > 0)
    .sort((a, b) => ev(b) - ev(a) || (b.sales30 ?? 0) - (a.sales30 ?? 0) || a.brand.localeCompare(b.brand, "de"))
    .slice(0, n);
}

/** Mail an den Consultant mit der Markenauswahl. */
export function auditMail(brands: string[], consultantName: string | null): { subject: string; body: string } {
  const first = consultantName?.trim().split(/\s+/)[0];
  return {
    subject: "Authorized Reseller Pilot – meine 10 Marken für den Audit",
    body: [
      `Hallo ${first || ""}`.trim() + ",",
      "",
      "danke dir für die Unterlagen. Für den Audit im Rahmen des Authorized Reseller Piloten möchte ich diese Marken anmelden:",
      "",
      ...brands.map((b, i) => `${i + 1}. ${b}`),
      "",
      "Die Einkaufsbelege liegen mir vor und ich reiche sie ein, sobald das Appeal Team sich meldet.",
      "",
      "Außerdem gerne die Liste der für Managed Best Deals berechtigten ASINs mit den jeweiligen Mindestrabatten für die Black Week.",
      "",
      "Viele Grüße",
    ].join("\n"),
  };
}

// ---- Deals (Black Week)

export type DealRow = { asin: string; title: string | null; minDiscountPct: number | null; dealType: string | null };

const ASIN = /^B0[A-Z0-9]{8}$/;
const pctOf = (v: string) => {
  const s = v.replace(/\s/g, "").replace(",", ".").replace("%", "");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
};

/** Liste berechtigter ASINs: Spalten erkennen (ASIN, Rabatt/Discount, Typ, Titel), auch ohne Kopfzeile. */
export function parseDealList(headers: string[], rows: string[][]): DealRow[] {
  const h = headers.map((x) => x.toLowerCase());
  const col = (re: RegExp) => h.findIndex((x) => re.test(x));
  let iAsin = col(/asin/);
  const iPct = col(/rabatt|discount|%|nachlass|abschlag/);
  const iType = col(/typ|type|deal/);
  const iTitle = col(/titel|title|name|produkt|product|bezeichnung/);
  const all = [headers, ...rows];
  if (iAsin < 0) {
    // ohne Kopfzeile: erste Spalte, in der ASINs stehen
    const width = Math.max(...all.map((r) => r.length));
    iAsin = Array.from({ length: width }, (_, i) => i).find((i) => all.some((r) => ASIN.test((r[i] ?? "").trim().toUpperCase()))) ?? -1;
  }
  if (iAsin < 0) return [];
  const body = ASIN.test((headers[iAsin] ?? "").trim().toUpperCase()) ? all : rows;
  const seen = new Set<string>();
  const out: DealRow[] = [];
  for (const r of body) {
    const asin = (r[iAsin] ?? "").trim().toUpperCase();
    if (!ASIN.test(asin) || seen.has(asin)) continue;
    seen.add(asin);
    out.push({ asin, title: iTitle >= 0 ? r[iTitle]?.trim() || null : null, minDiscountPct: iPct >= 0 ? pctOf(r[iPct] ?? "") : null, dealType: iType >= 0 && iType !== iPct ? r[iType]?.trim() || null : null });
  }
  return out;
}

export type DealInput = { price: number | null; vatPct: number | null; referralRate: number | null; fbaFee: number | null; ek: number | null; discountPct: number | null };
export type DealResult = { dealPrice: number | null; profit: number | null; profitNow: number | null; margin: number | null; verdict: "lohnt" | "knapp" | "verlust" | "unklar"; reason: string };

/**
 * Gewinn je Stück zum Deal-Preis (FBA): Preis brutto ohne USt, minus Provision (Anteil vom Preis), FBA-Gebühr
 * und EK. „lohnt“ ab 0,50 € und 3 % Marge, „knapp“ darunter, sonst Verlust.
 */
export function dealCalc(d: DealInput): DealResult {
  if (d.price === null || d.price <= 0) return { dealPrice: null, profit: null, profitNow: null, margin: null, verdict: "unklar", reason: "Kein aktueller Preis bekannt." };
  const disc = d.discountPct ?? 0;
  const dealPrice = Math.round(d.price * (1 - disc / 100) * 100) / 100;
  if (d.ek === null) return { dealPrice, profit: null, profitNow: null, margin: null, verdict: "unklar", reason: "EK fehlt – Gewinn nicht berechenbar." };
  const vat = (d.vatPct ?? 19) / 100;
  const rate = d.referralRate ?? 0.15;
  const fba = d.fbaFee ?? 0;
  const p = (price: number) => Math.round((price / (1 + vat) - rate * price - fba - d.ek!) * 100) / 100;
  const profit = p(dealPrice);
  const margin = Math.round((profit / dealPrice) * 1000) / 10;
  const verdict = profit < 0 ? "verlust" : profit >= 0.5 && margin >= 3 ? "lohnt" : "knapp";
  const reason = verdict === "verlust" ? `Mit ${disc} % Rabatt ${profit.toFixed(2).replace(".", ",")} € je Stück – nicht einreichen.` : verdict === "knapp" ? "Kaum Gewinn nach Rabatt – nur für Ranking/Abverkauf." : "Gewinn auch nach Rabatt.";
  return { dealPrice, profit, profitNow: p(d.price), margin, verdict, reason };
}

/** Tage bis zu einem Datum (negativ = vorbei). */
export function daysUntil(today: string, iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}
