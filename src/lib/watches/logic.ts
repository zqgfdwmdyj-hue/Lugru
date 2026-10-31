// Uhren Buy & Flip: Deals, Prüflisten, Marktpreise, Auswertung. Reine Logik, testbar.

import { daysBetween, flipCalc, type FlipResult, type TaxMode } from "./calc";

export const DEAL_STATUSES = ["beobachtet", "verhandlung", "gekauft", "inserat", "verkauft", "verworfen"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  beobachtet: "Beobachtet",
  verhandlung: "In Verhandlung",
  gekauft: "Gekauft / Aufbereitung",
  inserat: "Zum Verkauf",
  verkauft: "Verkauft",
  verworfen: "Verworfen",
};
/** Geld steckt in der Uhr (gekauft, noch nicht verkauft). */
export const HOLDING: DealStatus[] = ["gekauft", "inserat"];

export const CONDITIONS = ["gebraucht", "neu"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const SETS = ["komplett", "box", "papiere", "ohne"] as const;
export type WatchSet = (typeof SETS)[number];
export const SET_LABEL: Record<WatchSet, string> = { komplett: "Full Set (Box + Papiere)", box: "nur Box", papiere: "nur Papiere", ohne: "ohne Box und Papiere" };

export const CHANNELS = ["Kleinanzeigen", "eBay", "Chrono24", "Händler-Ankauf", "Forum / Community", "Uhrenbörse", "Bekanntenkreis", "Sonstiges"] as const;
export const SOURCES = ["Kleinanzeigen", "eBay", "Chrono24", "Konzessionär", "Graumarkt-Händler", "Auktion", "Pfandleiher", "Erbschaft / Haushalt", "Forum / Community", "Bekanntenkreis", "Sonstiges"] as const;

export type CheckItem = { text: string; done: boolean };

/** Ankauf-Prüfliste – was vor dem Bezahlen geklärt sein sollte. */
export function defaultChecklist(condition: Condition): CheckItem[] {
  const used = [
    "Referenz und Seriennummer notiert – passen zu Papieren und Box",
    "Seriennummer auf Diebstahl prüfen lassen (Uhrenregister / Polizei)",
    "Echtheit geprüft (Uhrmacher, Händler oder Werk gesehen)",
    "Gangwerte gemessen (Zeitwaage oder App) und Aufzug geprüft",
    "Alle Funktionen geprüft (Datum, Chronograph, Lünette, Krone)",
    "Zustand fotografiert: Gehäuse, Glas, Zifferblatt, Band, Schließe",
    "Bandlänge und Ersatzglieder geklärt",
    "Letzte Revision bekannt (Beleg) – sonst Revisionskosten eingeplant",
    "Set geprüft: Box, Papiere, Rechnung, Zubehör",
    "Mindestens 3 verkaufte Vergleichspreise erfasst",
    "Höchsten Ankaufspreis im Rechner bestimmt",
    "Kaufvertrag mit Ausweisdaten des Verkäufers",
  ];
  const fresh = [
    "Händler seriös (Konzessionär oder Impressum, Bewertungen, Erfahrungen)",
    "Rechnung mit ausgewiesener Umsatzsteuer (für Vorsteuer, wenn gewerblich)",
    "Garantiekarte: Datum, Händlerstempel, Seriennummer passt zur Uhr",
    "Ungetragen: Schutzfolien, Anhänger, Box, Anleitung vollständig",
    "Kaufbedingungen gelesen (Klauseln zum Wiederverkauf?)",
    "Mindestens 3 verkaufte Vergleichspreise (neu / ungetragen) erfasst",
    "Höchsten Ankaufspreis im Rechner bestimmt",
  ];
  return (condition === "neu" ? fresh : used).map((text) => ({ text, done: false }));
}

/** Referenz vergleichbar machen: Groß, ohne Leerzeichen (116610 LN = 116610LN). */
export const normRef = (ref: string | null | undefined) => (ref ?? "").toUpperCase().replace(/\s+/g, "").slice(0, 60);

export type DealLike = {
  status: DealStatus;
  practice: boolean;
  taxMode: TaxMode;
  buyPrice: number | null;
  buyDate: string | null;
  costs: number;
  sellPrice: number | null;
  sellDate: string | null;
  targetSell: number | null;
  feePct: number;
  feeFixed: number;
  shipping: number;
};

/** Ergebnis eines Deals: verkauft = tatsächlich, sonst geplant (mit Ziel-Verkaufspreis). */
export function dealResult(d: DealLike, today?: string): (FlipResult & { planned: boolean; days: number | null }) | null {
  if (d.buyPrice === null) return null;
  const sold = d.status === "verkauft" && d.sellPrice !== null;
  const sell = sold ? d.sellPrice : d.targetSell;
  if (sell === null) return null;
  const days = sold ? daysBetween(d.buyDate, d.sellDate) : daysBetween(d.buyDate, today ?? null);
  const r = flipCalc({ mode: d.taxMode, buy: d.buyPrice, costs: d.costs, sell, feePct: d.feePct, feeFixed: d.feeFixed, shipping: d.shipping, days: sold ? days : null });
  return { ...r, planned: !sold, days };
}

export type DealStats = {
  sold: number;
  profit: number;
  avgMarginPct: number | null;
  avgDays: number | null;
  /** Gebundenes Geld in gekauften, noch nicht verkauften Uhren. */
  openCapital: number;
  open: number;
  losses: number;
  best: number | null;
  worst: number | null;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
};

export function dealStats(deals: DealLike[]): DealStats {
  const sold = deals.map((d) => ({ d, r: d.status === "verkauft" ? dealResult(d) : null })).filter((x): x is { d: DealLike; r: NonNullable<ReturnType<typeof dealResult>> } => Boolean(x.r));
  const open = deals.filter((d) => HOLDING.includes(d.status) && d.buyPrice !== null);
  const profits = sold.map((x) => x.r.profit);
  const margins = sold.map((x) => x.r.marginPct).filter((m): m is number => m !== null);
  const days = sold.map((x) => x.r.days).filter((n): n is number => n !== null);
  return {
    sold: sold.length,
    profit: Math.round(profits.reduce((s, p) => s + p, 0) * 100) / 100,
    avgMarginPct: margins.length ? Math.round((margins.reduce((s, m) => s + m, 0) / margins.length) * 10) / 10 : null,
    avgDays: days.length ? Math.round(days.reduce((s, n) => s + n, 0) / days.length) : null,
    openCapital: Math.round(open.reduce((s, d) => s + (d.buyPrice ?? 0) + d.costs, 0) * 100) / 100,
    open: open.length,
    losses: profits.filter((p) => p < 0).length,
    best: profits.length ? Math.max(...profits) : null,
    worst: profits.length ? Math.min(...profits) : null,
  };
}

// ---- Marktpreise -------------------------------------------------------------------------------------

export const PRICE_KINDS = ["verkauft", "angeboten", "ankauf"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];
export const PRICE_KIND_LABEL: Record<PriceKind, string> = { verkauft: "verkauft (tatsächlich bezahlt)", angeboten: "angeboten (Wunschpreis)", ankauf: "Händler-Ankauf (sofort)" };

export type PriceNote = { reference: string; kind: PriceKind; price: number; day: string; condition: Condition; fullSet: boolean };
export type PriceSummary = { n: number; min: number; median: number; max: number; last: string };

/** Spanne je Art (verkauft / angeboten / Händler-Ankauf) für eine Referenz – optional nur gleicher Zustand bzw. Set. */
export function priceSummary(notes: PriceNote[], ref: string, f: { condition?: Condition; fullSet?: boolean; sinceDay?: string } = {}): Partial<Record<PriceKind, PriceSummary>> {
  const key = normRef(ref);
  const out: Partial<Record<PriceKind, PriceSummary>> = {};
  if (!key) return out;
  for (const kind of PRICE_KINDS) {
    const list = notes.filter((n) => normRef(n.reference) === key && n.kind === kind && (!f.condition || n.condition === f.condition) && (f.fullSet === undefined || n.fullSet === f.fullSet) && (!f.sinceDay || n.day >= f.sinceDay));
    if (!list.length) continue;
    const prices = list.map((n) => n.price);
    out[kind] = { n: list.length, min: Math.min(...prices), median: median(prices)!, max: Math.max(...prices), last: list.map((n) => n.day).sort().pop()! };
  }
  return out;
}

/**
 * Lern-Hinweise zu einem Deal: was fehlt noch, wo liegt ein typischer Anfängerfehler? Nur aus den Angaben
 * selbst – keine Marktpreise erfunden.
 */
export function dealHints(d: DealLike & { checklist: CheckItem[]; reference: string | null }, prices: Partial<Record<PriceKind, PriceSummary>>): string[] {
  const out: string[] = [];
  if (!d.reference) out.push("Referenznummer eintragen – ohne sie lassen sich Preise nicht sauber vergleichen.");
  const sold = prices.verkauft;
  if (!sold || sold.n < 3) out.push(`Erst ${sold ? `${3 - sold.n} weitere` : "3"} verkaufte Vergleichspreise unter „Marktpreise“ erfassen – Angebotspreise allein sind zu optimistisch.`);
  const target = d.status === "verkauft" ? d.sellPrice : d.targetSell;
  if (target !== null && sold && sold.n >= 3 && target > sold.median * 1.05) out.push(`Dein Ziel-Verkaufspreis liegt über dem Median der verkauften Vergleiche (${Math.round(sold.median).toLocaleString("de-DE")} €) – vorsichtiger planen.`);
  if (target !== null && prices.angeboten && !sold && target >= prices.angeboten.median) out.push("Der Ziel-Verkaufspreis orientiert sich an Angeboten – verkaufte Preise liegen meist darunter.");
  const open = d.checklist.filter((c) => !c.done).length;
  if (["beobachtet", "verhandlung"].includes(d.status) && open) out.push(`${open} Punkte der Ankauf-Prüfliste sind noch offen – vor dem Bezahlen klären.`);
  if (d.buyPrice !== null && d.targetSell !== null && d.status !== "verkauft") {
    const r = dealResult({ ...d, status: "beobachtet" });
    if (r && r.profit <= 0) out.push("Mit diesen Zahlen bleibt kein Gewinn – Ankaufspreis senken oder Finger weg.");
    else if (r && r.marginPct !== null && r.marginPct < 5) out.push("Weniger als 5 % Gewinn vom Verkaufspreis – wenig Puffer für Überraschungen (Revision, Preisrutsch, Rücksendung).");
  }
  if (d.taxMode === "regel" && d.status !== "verkauft") out.push("Regelbesteuerung: Beim Verkauf fallen 19 % auf den vollen Preis an – die Vorsteuer aus dem Einkauf bekommst du nur mit ordentlicher Rechnung zurück.");
  return out;
}

// ---- Eingaben ----------------------------------------------------------------------------------------

/** Euro-Betrag aus einer Eingabe: „4.000“, „4000“, „4.250,50“, „4,250.50“, „1.299 €“. Leer/ungültig → null. */
export function parseEuro(v: unknown, max = 10_000_000): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[€\s]|EUR/gi, "");
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= max ? Math.round(n * 100) / 100 : null;
}

/** Prozent (0–100) aus „6,5“, „6.5“, „6,5 %“. */
export function parsePct(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v.replace(/[%\s]/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
}

/** Nebenkosten aus Zeilen „Revision: 350“, „Anreise 25 €“, „Echtheitsprüfung; 80“. Zeilen ohne Betrag werden gemeldet. */
export function parseCosts(text: string): { items: { label: string; amount: number }[]; bad: string[] } {
  const items: { label: string; amount: number }[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)[\s:;=]*([\d.,]+)\s*(€|EUR)?$/i.exec(line);
    const amount = m ? parseEuro(m[2]) : null;
    if (!m || amount === null) {
      bad.push(line.slice(0, 60));
      continue;
    }
    items.push({ label: (m[1].replace(/[\s:;=–-]+$/, "").trim() || "Kosten").slice(0, 80), amount });
  }
  return { items: items.slice(0, 30), bad };
}

export const costsText = (costs: { label: string; amount: number }[]) => costs.map((c) => `${c.label}: ${String(c.amount).replace(".", ",")}`).join("\n");

export const DEAL_FILTERS = ["offen", "verkauft", "verworfen", "uebung", "alle"] as const;
export type DealFilter = (typeof DEAL_FILTERS)[number];

/**
 * Deals für Listen, Zähler und Kennzahlen: Übungs-Deals (nur auf dem Papier) zählen nirgends mit – außer sie werden
 * ausdrücklich eingeblendet (`mitUebung`) oder der Filter „Übung“ ist gewählt.
 */
export function filterDeals<T extends { status: string; practice: boolean }>(deals: T[], f: DealFilter, mitUebung = false): T[] {
  return deals.filter((d) => {
    if (f === "uebung") return d.practice;
    if (d.practice && !mitUebung) return false;
    if (f === "alle") return true;
    if (f === "offen") return d.status !== "verkauft" && d.status !== "verworfen";
    return d.status === f;
  });
}
