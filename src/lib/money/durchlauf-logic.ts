// B28.7 Eigene Durchlaufzeiten – reine Logik: je Einkauf Bestellung → Wareneingang → Versand an Amazon (Prep Center)
// → Amazon „Empfang abgeschlossen“ → Abverkauf (+ Auszahlung), Median je Lieferant/Quelle, Cash-to-Cash-Zyklus,
// Kapital ÷ Monatsumsatz. Grundlage für den Vorlauf in der Umschlagszeit des Deal-Eingangs (B28.6).

import { STANDARD_VORLAUF, type Vorlauf } from "@/lib/deal-eingang/umschlag-logic";

export const AUSZAHLUNG_TAGE = 14;
/** Ab so vielen Einkäufen mit Wert gilt der Median einer Phase (sonst Standardwert). */
export const MIN_BASIS = 3;

export type EinkaufDurchlauf = {
  id: string;
  /** Lieferant bzw. Quelle. */
  gruppe: string;
  bestellt: string | null;
  erhalten: string | null;
  /** FBA-Sendung erstellt (Versand an Amazon). */
  versandt: string | null;
  /** Amazon „Empfang abgeschlossen“ (Sendung geschlossen). */
  empfangen: string | null;
  /** Tage vom Empfang bei Amazon bis ≥ 90 % verkauft (Monatswerte, daher grob). */
  abverkaufTage: number | null;
};

const TAG = 86_400_000;
export function tageZwischen(von: string | null | undefined, bis: string | null | undefined): number | null {
  if (!von || !bis) return null;
  const d = Math.round((Date.parse(`${bis.slice(0, 10)}T00:00:00Z`) - Date.parse(`${von.slice(0, 10)}T00:00:00Z`)) / TAG);
  return Number.isFinite(d) && d >= 0 && d < 400 ? d : null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}

export type Phase = { median: number | null; n: number };
export type Phasen = { wareneingang: Phase; prep: Phase; amazonEingang: Phase; abverkauf: Phase; auszahlung: number };

function phasen(xs: EinkaufDurchlauf[]): Phasen {
  const p = (f: (e: EinkaufDurchlauf) => number | null): Phase => {
    const w = xs.map(f).filter((x): x is number => x !== null);
    return { median: median(w), n: w.length };
  };
  return {
    wareneingang: p((e) => tageZwischen(e.bestellt, e.erhalten)),
    prep: p((e) => tageZwischen(e.erhalten, e.versandt)),
    amazonEingang: p((e) => tageZwischen(e.versandt, e.empfangen)),
    abverkauf: p((e) => e.abverkaufTage),
    auszahlung: AUSZAHLUNG_TAGE,
  };
}

/** Cash-to-Cash: Summe der Mediane (fehlende Phase = Standardwert, Abverkauf fehlt = nicht berechenbar). */
export function cashToCash(p: Phasen): { tage: number | null; vollstaendig: boolean } {
  const s = STANDARD_VORLAUF;
  const teil = [p.wareneingang.median ?? s.wareneingang, p.prep.median ?? s.prep, p.amazonEingang.median ?? s.amazonEingang];
  const voll = p.wareneingang.median !== null && p.prep.median !== null && p.amazonEingang.median !== null && p.abverkauf.median !== null;
  if (p.abverkauf.median === null) return { tage: null, vollstaendig: false };
  return { tage: Math.round(teil.reduce((a, b) => a + b, 0) + p.abverkauf.median + p.auszahlung), vollstaendig: voll };
}

export function durchlaufAuswerten(einkaeufe: EinkaufDurchlauf[]) {
  const gruppen = new Map<string, EinkaufDurchlauf[]>();
  for (const e of einkaeufe) gruppen.set(e.gruppe, [...(gruppen.get(e.gruppe) ?? []), e]);
  const gesamt = phasen(einkaeufe);
  return {
    einkaeufe: einkaeufe.length,
    gesamt,
    cashToCash: cashToCash(gesamt),
    jeGruppe: [...gruppen.entries()].map(([gruppe, xs]) => ({ gruppe, n: xs.length, phasen: phasen(xs), cashToCash: cashToCash(phasen(xs)) })).sort((a, b) => b.n - a.n || a.gruppe.localeCompare(b.gruppe)),
  };
}

/** Vorlauf für die Umschlagszeit: Median je Phase ab MIN_BASIS Einkäufen, sonst Standardwert. */
export function vorlaufAus(p: Phasen | null | undefined): Vorlauf {
  if (!p) return STANDARD_VORLAUF;
  const s = STANDARD_VORLAUF;
  const nimm = (x: Phase, std: number) => (x.median !== null && x.n >= MIN_BASIS ? Math.round(x.median) : std);
  const eigen = [p.wareneingang, p.prep, p.amazonEingang].some((x) => x.median !== null && x.n >= MIN_BASIS);
  return { wareneingang: nimm(p.wareneingang, s.wareneingang), prep: nimm(p.prep, s.prep), amazonEingang: nimm(p.amazonEingang, s.amazonEingang), auszahlung: AUSZAHLUNG_TAGE, quelle: eigen ? "eigene Daten" : "Standard", basis: eigen ? Math.max(p.wareneingang.n, p.prep.n, p.amazonEingang.n) : undefined };
}

/**
 * Tage vom Empfang bei Amazon bis ≥ 90 % der Menge verkauft – aus Monatswerten (Monat des Empfangs zählt mit).
 * Ende des Monats, in dem die Schwelle erreicht wurde; null = noch nicht abverkauft.
 */
export function abverkaufTage(monate: { month: string; units: number | null }[], empfangen: string | null, menge: number | null): number | null {
  if (!empfangen || !menge || menge <= 0) return null;
  const ab = empfangen.slice(0, 7);
  let summe = 0;
  for (const m of [...monate].filter((x) => x.month >= ab).sort((a, b) => a.month.localeCompare(b.month))) {
    summe += m.units ?? 0;
    if (summe >= menge * 0.9) {
      const [j, mo] = m.month.split("-").map(Number);
      const ende = new Date(Date.UTC(j, mo, 0)).toISOString().slice(0, 10);
      return Math.max(1, tageZwischen(empfangen, ende) ?? 1);
    }
  }
  return null;
}

/** Kapital ÷ Monatsumsatz in Monaten (z. B. Lagerwert 3,5 Monatsumsätze). */
export function kapitalMonate(lagerwert: number | null, monatsumsatz: number | null): number | null {
  if (lagerwert === null || !monatsumsatz || monatsumsatz <= 0) return null;
  return Math.round((lagerwert / monatsumsatz) * 10) / 10;
}

/** Offene Einkäufe, die zu lange weder erhalten noch storniert sind (verfälschen die Zeiten). */
export const BEREINIGEN_TAGE = 45;
export function zuBereinigen<T extends { status: string; orderDate: string | null }>(pos: T[], heute: string, tage = BEREINIGEN_TAGE): T[] {
  const grenze = new Date(Date.parse(`${heute}T00:00:00Z`) - tage * TAG).toISOString().slice(0, 10);
  return pos.filter((p) => ["ordered", "shipped", "partial"].includes(p.status) && !!p.orderDate && p.orderDate < grenze);
}
