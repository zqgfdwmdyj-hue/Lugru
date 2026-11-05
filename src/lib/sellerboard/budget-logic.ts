// B29: sellerboard-Aufrufbudget – reine Logik (tests/b29-sellerboard-budget.test.ts).
// sellerboard erlaubt je Kontoinhaber 125 MCP-Aufrufe am Tag (für alle Nutzer zusammen, also auch Ludwigs
// Morgenbericht und Nachfragen über Claude); Rücksetzung täglich 00:00 UTC. Die Automatik des Seller-Systems
// nimmt sich höchstens 80 davon, „Verkauf“ hat Vorrang, beim Limit-Fehler wird bis zur Rücksetzung pausiert.

import { berlinZeitpunkt, tagBerlin, zeitBerlin } from "@/lib/today/abruf-plan";

export const SB_TAGESLIMIT = 125;
export const SB_OBERGRENZE_AUTOMATIK = 80;
/** Die letzten Aufrufe des Tages bleiben immer für Claude (Morgenbericht, Nachfragen) frei. */
export const SB_MINDEST_FREI = 10;
/** Geschätzte Aufrufe je Verkaufs-Lauf – so viele bleiben je noch ausstehendem Verkaufs-Lauf frei (Vorrang). */
export const SB_KOSTEN_VERKAUF = 3;

/** Geplante Abrufgruppen: Verkauf (Pflicht), Gewinn je Produkt und Tag, Bestand + Sendungen, Tagesabrufe. */
export type SbScope = "verkauf" | "tage" | "bestand" | "taeglich";
/** verkauf = Vorrang; normal = übrige geplante Abrufe; hand = von Hand ausgelöst (zählt nicht zur Automatik). */
export type SbPrio = "verkauf" | "normal" | "hand";

/** B29.1: Uhrzeiten (Berlin). Verkauf alle 2 Std. 06–22 Uhr, nachts alle 4 Std.; Tagesabrufe ab 02:00 nacheinander. */
export const SB_SLOTS: Record<SbScope, string[]> = {
  verkauf: ["02:00", "06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"],
  tage: ["04:00", "13:00"],
  bestand: ["04:30", "16:30"],
  taeglich: ["02:00"],
};

/** Reihenfolge beim Nachholen (B29.2): Verkauf → Gewinn je Produkt → Rest. */
export const SB_REIHENFOLGE: SbScope[] = ["verkauf", "tage", "bestand", "taeglich"];

/**
 * Ein nachgeholter Lauf zählt auch für die nächste Uhrzeit, wenn er höchstens so viele Minuten davor lag –
 * sonst liefe z. B. nach der Rücksetzung um 01:00 alles nachgeholt und um 02:00/04:00 gleich noch einmal.
 */
export const SB_NACHHOL_FENSTER_MIN: Record<SbScope, number> = { verkauf: 60, tage: 210, bestand: 210, taeglich: 210 };

export const SB_SCOPE_NAME: Record<SbScope, string> = { verkauf: "Verkauf", tage: "Gewinn je Produkt und Tag", bestand: "FBA-Bestand und Sendungen", taeglich: "Tagesabrufe" };

/** Tag des Zählers: UTC (wie bei sellerboard). */
export const utcTag = (d: Date) => d.toISOString().slice(0, 10);

/** Nächste Rücksetzung: 00:00 UTC des Folgetags. */
export function naechsterReset(jetzt: Date): Date {
  return new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate() + 1));
}

/** „01:00 Uhr“ (Winter) bzw. „02:00 Uhr“ (Sommer) – die Rücksetzung in Berliner Zeit. */
export const uhrText = (d: Date) => `${zeitBerlin(d)} Uhr`;

/** Fehlertext von sellerboard „Tageslimit erreicht“. */
export const istLimitFehler = (e: unknown) => /used up today'?s MCP call limit|CALL_LIMIT_REACHED|daily (MCP )?call limit/i.test(e instanceof Error ? e.message : String(e ?? ""));

/** Fehler, der einen Abruf stoppt, ohne ein Fehler zu sein: Pause nach Limit oder Tagesbudget erschöpft. */
export class SbGestoppt extends Error {
  constructor(
    readonly art: "pausiert" | "tagesbudget",
    readonly bis: Date,
    message: string,
  ) {
    super(message);
    this.name = "SbGestoppt";
  }
}
export const istGestoppt = (e: unknown): e is SbGestoppt => e instanceof Error && e.name === "SbGestoppt" && "art" in e;

export type BudgetStand = {
  /** Aufrufe der geplanten Abrufe heute (UTC-Tag). */
  automatik: number;
  /** Von Hand ausgelöste Abrufe heute („Jetzt abgleichen“, Verbinden). */
  hand: number;
  /** Laut sellerboard (usage_quota, kostenlos) beim letzten Blick – zählt auch Claude und andere Nutzer. */
  quotaGenutzt: number | null;
  quotaLimit: number | null;
  /** automatik + hand beim letzten Blick auf usage_quota. */
  systemBeiQuota: number;
  pausiertBis: Date | null;
  /** Obergrenze der Automatik (80; zum Testen künstlich niedriger). */
  obergrenze: number;
};

export const leererStand = (obergrenze = SB_OBERGRENZE_AUTOMATIK): BudgetStand => ({ automatik: 0, hand: 0, quotaGenutzt: null, quotaLimit: null, systemBeiQuota: 0, pausiertBis: null, obergrenze });

/** Limit laut sellerboard (0 = ohne Limit → null), sonst 125. */
export const limitVon = (s: Pick<BudgetStand, "quotaLimit">) => (s.quotaLimit === null ? SB_TAGESLIMIT : s.quotaLimit > 0 ? s.quotaLimit : null);

/** Heute verbraucht (geschätzt): letzter Stand laut sellerboard plus eigene Aufrufe seitdem; mindestens die eigenen. */
export function genutztHeute(s: BudgetStand): number {
  const system = s.automatik + s.hand;
  if (s.quotaGenutzt === null) return system;
  return Math.max(system, s.quotaGenutzt + Math.max(0, system - s.systemBeiQuota));
}

/** Noch ausstehende Verkaufs-Läufe bis zur Rücksetzung × geschätzte Kosten – so viel bleibt für „Verkauf“ frei. */
export function verkaufVorrang(jetzt: Date): number {
  const reset = naechsterReset(jetzt);
  const tage = [tagBerlin(jetzt), tagBerlin(new Date(jetzt.getTime() + 86_400_000))];
  const offen = new Set(tage.flatMap((t) => SB_SLOTS.verkauf.map((u) => berlinZeitpunkt(t, u).getTime())).filter((x) => x > jetzt.getTime() && x < reset.getTime()));
  return offen.size * SB_KOSTEN_VERKAUF;
}

export type BudgetEntscheidung = { ok: true } | { ok: false; art: "pausiert" | "tagesbudget"; grund: string; bis: Date };

/**
 * Darf der nächste sellerboard-Aufruf laufen? Pause (nach Limit-Fehler) gilt für alle. Von Hand: nur die Pause.
 * Geplant: höchstens Obergrenze (80); übrige Abrufe lassen den noch ausstehenden Verkaufs-Läufen Platz;
 * die letzten SB_MINDEST_FREI Aufrufe des Tages bleiben für Claude.
 */
export function budgetEntscheidung(s: BudgetStand, prio: SbPrio, jetzt: Date): BudgetEntscheidung {
  const reset = naechsterReset(jetzt);
  if (s.pausiertBis && s.pausiertBis > jetzt) return { ok: false, art: "pausiert", grund: `sellerboard-Tageslimit erreicht – pausiert bis ${uhrText(s.pausiertBis)}`, bis: s.pausiertBis };
  if (prio === "hand") return { ok: true };
  const vorrang = prio === "verkauf" ? 0 : verkaufVorrang(jetzt);
  const grenze = Math.max(0, s.obergrenze - vorrang);
  if (s.automatik >= grenze)
    return {
      ok: false,
      art: "tagesbudget",
      grund: vorrang && s.automatik < s.obergrenze ? `Tagesbudget: ${s.automatik} von ${s.obergrenze} Aufrufen verbraucht, ${vorrang} bleiben für die restlichen Verkaufs-Abrufe` : `Tagesbudget: ${s.automatik} von ${s.obergrenze} Aufrufen der Automatik verbraucht`,
      bis: reset,
    };
  const limit = limitVon(s);
  if (limit !== null && s.quotaGenutzt !== null && limit - genutztHeute(s) <= SB_MINDEST_FREI)
    return { ok: false, art: "tagesbudget", grund: `Tagesbudget: laut sellerboard nur noch ${Math.max(0, limit - genutztHeute(s))} Aufrufe frei – die bleiben für Claude (Morgenbericht, Nachfragen)`, bis: reset };
  return { ok: true };
}

/** Hinweis an einem übersprungenen Abruf (kein Fehler). */
export const uebersprungenText = (e: { art: "pausiert" | "tagesbudget"; bis: Date; grund?: string }) =>
  e.art === "tagesbudget" ? `übersprungen (Tagesbudget) – wird nach der Rücksetzung um ${uhrText(e.bis)} nachgeholt` : `übersprungen (pausiert bis ${uhrText(e.bis)})`;

/** Der eine Eintrag statt vieler Fehlerzeilen. */
export const pauseText = (bis: Date) => `pausiert bis ${uhrText(bis)} – sellerboard-Tageslimit erreicht; danach automatisch nachholen (Verkauf → Gewinn je Produkt → Rest)`;

export type Zaehler = { gesamt: number; limit: number | null; automatik: number; hand: number; andere: number | null; reserve: number | null; frei: number | null; text: string };

/** „sellerboard-Aufrufe heute: n/125 (Automatik n, Reserve n)“ – Reserve = was Claude & Morgenbericht noch bleibt. */
export function zaehler(s: BudgetStand): Zaehler {
  const gesamt = genutztHeute(s);
  const limit = limitVon(s);
  const andere = s.quotaGenutzt === null ? null : Math.max(0, gesamt - s.automatik - s.hand);
  const frei = limit === null ? null : Math.max(0, limit - gesamt);
  const reserve = limit === null ? null : Math.max(0, limit - gesamt - Math.max(0, s.obergrenze - s.automatik));
  const text = `sellerboard-Aufrufe heute: ${gesamt}/${limit ?? "∞"} (Automatik ${s.automatik}${s.hand ? `, von Hand ${s.hand}` : ""}, Reserve ${reserve ?? "∞"})`;
  return { gesamt, limit, automatik: s.automatik, hand: s.hand, andere, reserve, frei, text };
}

/** Nutzung laut usage_quota – Feldnamen sind nicht dokumentiert, daher großzügig gelesen (auch „12 of 125“). */
export function quotaAus(o: unknown, text = ""): { genutzt: number; limit: number; reset: string | null } | null {
  const werte = new Map<string, unknown>();
  const lauf = (x: unknown, tiefe: number) => {
    if (!x || typeof x !== "object" || tiefe > 3) return;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      const key = k.toLowerCase().replace(/[^a-z]/g, "");
      if (!werte.has(key)) werte.set(key, v);
      if (v && typeof v === "object") lauf(v, tiefe + 1);
    }
  };
  lauf(o, 0);
  const zahl = (...keys: string[]) => {
    for (const k of keys) {
      const v = werte.get(k);
      const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  let genutzt = zahl("used", "callsused", "usedtoday", "callstoday", "callsmade", "count", "usage");
  let limit = zahl("limit", "dailylimit", "callslimit", "calllimit", "max", "quota");
  const frei = zahl("remaining", "left", "callsremaining", "callsleft");
  if (genutzt === null && limit !== null && frei !== null) genutzt = limit - frei;
  if (limit === null && genutzt !== null && frei !== null) limit = genutzt + frei;
  if (genutzt === null || limit === null) {
    const m = /(\d+)\s*(?:of|von|\/)\s*(\d+)/i.exec(text);
    if (!m) return null;
    genutzt = Number(m[1]);
    limit = Number(m[2]);
  }
  const r = werte.get("resetsat") ?? werte.get("resetat") ?? werte.get("reset") ?? werte.get("resets");
  return { genutzt, limit, reset: typeof r === "string" ? r : typeof r === "number" ? new Date(r > 1e12 ? r : r * 1000).toISOString() : null };
}

// ---- Zeitplan ----------------------------------------------------------------------------------------

/** Letzte Uhrzeit ≤ jetzt (heute oder gestern) als Zeitpunkt. */
export function letzterSlot(uhrzeiten: string[], jetzt: Date): Date {
  const tage = [tagBerlin(new Date(jetzt.getTime() - 86_400_000)), tagBerlin(jetzt)];
  const vorbei = tage.flatMap((t) => uhrzeiten.map((u) => berlinZeitpunkt(t, u))).filter((d) => d <= jetzt);
  return new Date(Math.max(...vorbei.map((d) => d.getTime())));
}

/** Nächste Uhrzeit > jetzt. */
export function naechsterSlot(uhrzeiten: string[], jetzt: Date): Date {
  const tage = [tagBerlin(jetzt), tagBerlin(new Date(jetzt.getTime() + 86_400_000)), tagBerlin(new Date(jetzt.getTime() + 2 * 86_400_000))];
  const kommend = tage.flatMap((t) => uhrzeiten.map((u) => berlinZeitpunkt(t, u))).filter((d) => d > jetzt);
  return new Date(Math.min(...kommend.map((d) => d.getTime())));
}

/** Fällig, wenn seit der letzten Uhrzeit (minus Nachhol-Fenster) kein Lauf war. Übersprungene Läufe zählen nicht. */
export function scopeFaellig(scope: SbScope, letzterLauf: Date | null, jetzt: Date): boolean {
  if (!letzterLauf) return true;
  const slot = letzterSlot(SB_SLOTS[scope], jetzt);
  return letzterLauf.getTime() < slot.getTime() - SB_NACHHOL_FENSTER_MIN[scope] * 60_000;
}

/** Fällige Gruppen in der Nachhol-Reihenfolge. */
export const faelligeScopes = (laeufe: Partial<Record<SbScope, Date | null>>, jetzt: Date) => SB_REIHENFOLGE.filter((s) => scopeFaellig(s, laeufe[s] ?? null, jetzt));

/**
 * Was ein Verkaufs-Lauf außer den Kennzahlen (je Kanal 1 Aufruf) noch liest: Top-Produkte heute um 14 und 20 Uhr,
 * eBay-Bestellmengen von gestern um 06:00 (fertig) und von heute um 20:00. Top-Produkte von gestern kommen ohne
 * eigenen Aufruf aus „Gewinn je Produkt und Tag“.
 */
export function verkaufUmfang(jetzt: Date): { topHeute: boolean; ebayGestern: boolean; ebayHeute: boolean } {
  const s = zeitBerlin(letzterSlot(SB_SLOTS.verkauf, jetzt));
  return { topHeute: s === "14:00" || s === "20:00", ebayGestern: s === "06:00", ebayHeute: s === "20:00" };
}

/** Tage, die „Gewinn je Produkt und Tag“ liest: um 04:00 gestern + vorgestern, um 13:00 nur gestern; fehlende bis 3 Tage zurück. */
export function tageZuLesen(jetzt: Date, vorhanden: Set<number>): number[] {
  const s = zeitBerlin(letzterSlot(SB_SLOTS.tage, jetzt));
  const basis = s === "13:00" ? [1] : [1, 2];
  return [...new Set([...basis, ...[2, 3].filter((b) => !vorhanden.has(b))])].sort((a, b) => b - a);
}

/** Höchstens so viele Seiten „Produkte & EK“ je Tag (35 Produkte je Seite) – große Kataloge laufen über mehrere Tage. */
export const SB_PRODUKTE_SEITEN = 10;

/** Geschätzte Aufrufe eines Tages nach Plan (für die Abnahme-Rechnung; echte Zahlen zeigt der Zähler). */
export function tagesSchaetzung(g: { kanaele: number; fbaMitBestand: number; produkte: number; skus30: number; skusTag: number; sendungenSeiten: number }, bis = "24:00") {
  const vor = (u: string) => u < bis;
  const seiten = (n: number, je: number) => Math.max(1, Math.ceil(n / je));
  let summe = 0;
  for (const u of SB_SLOTS.verkauf.filter(vor)) {
    summe += g.kanaele;
    if (u === "14:00" || u === "20:00") summe += g.kanaele; // Top heute
    if (g.kanaele > 1 && (u === "06:00" || u === "20:00")) summe += 1; // eBay-Bestellmengen
  }
  for (const u of SB_SLOTS.tage.filter(vor)) summe += g.kanaele * (1 + (u === "13:00" ? 1 : 2) * seiten(g.skusTag, 200));
  // Bestand: Seiten mit Bestand + 1 Seite ausverkaufte mit Abverkauf + geänderte Sendungen
  for (const _ of SB_SLOTS.bestand.filter(vor)) summe += seiten(g.fbaMitBestand, 35) + 1 + g.sendungenSeiten;
  // Tagesabrufe: Produkte (gedeckelt), Monatswerte (12 Monate + laufender Monat), Fixkosten, 30 Tage je Kanal
  if (vor("02:00")) summe += Math.min(SB_PRODUKTE_SEITEN, seiten(g.produkte, 35)) + 1 + 2 + 1 + g.kanaele * (1 + seiten(g.skus30, 100));
  return summe;
}
