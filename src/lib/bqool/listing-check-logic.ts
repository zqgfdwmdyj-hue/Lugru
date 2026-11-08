// B32 Listing-Check: regelmäßige Analyse aller Listings – reine Logik. Je SKU und Marktplatz mit Bestand werden neun
// Befunde geprüft (plus B32.4 „Verkaufspreis unter Min“); jeder Befund hat einen Vorschlag und ein geschätztes
// Euro-Potenzial je Monat zum Sortieren. Geändert wird nichts – Freigaben laufen über den BQool-Upload (B31.2).

const r2 = (n: number) => Math.round(n * 100) / 100;

export type CheckSchwellen = {
  /** Befund 1: Min über Buy Box und über dem 30-Tage-Schnitt minus x %. */
  minUeberBbAbschlag: number;
  /** Befund 4: keine eigenen Verkäufe in x Tagen trotz Nachfrage (Keepa „monatlich verkauft“ ≥ y). */
  ohneVerkaufTage: number;
  nachfrageMin: number;
  /** Befund 5: Buy Box seit x Tagen über Max. */
  maxTage: number;
  /** Befund 8: eigener Preis > Buy Box + x %, keine Buy Box seit y Tagen. */
  preisUeberMarkt: number;
  ohneBuyboxTage: number;
  /** Befund 9: Ladenhüter. */
  reichweite: number;
  lagerdauer: number;
  kapital: number;
  /** Push nur bei Befund 1/2 an Schnelldrehern oder Kapital über x €. */
  pushKapital: number;
  /** Stufe A täglich: so viele SKUs mit dem höchsten Wert (Kapital × Nachfrage). */
  stufeA: number;
  /** Keepa-Abrufe je Lauf höchstens; darunter bleibt bei Token-Mangel „Check unvollständig“. */
  keepaJeLauf: number;
  keepaTokenReserve: number;
};

export const CHECK_STANDARD: CheckSchwellen = { minUeberBbAbschlag: 3, ohneVerkaufTage: 7, nachfrageMin: 30, maxTage: 3, preisUeberMarkt: 5, ohneBuyboxTage: 7, reichweite: 90, lagerdauer: 60, kapital: 300, pushKapital: 1000, stufeA: 150, keepaJeLauf: 60, keepaTokenReserve: 20 };

export type CheckEingabe = {
  land: string;
  sku: string;
  asin: string | null;
  titel: string | null;
  bestand: number;
  status: "aktiv" | "pausiert" | string | null;
  minBqool: number | null;
  maxBqool: number | null;
  preis: number | null;
  buybox: number | null;
  bb30: number | null;
  rang: number | null;
  monatlichVerkauft: number | null;
  verkaeufe7: number | null;
  verkaeufe30: number | null;
  /** Tage, seit denen die Buy Box über dem Max liegt (0 = heute nicht). */
  bbUeberMaxTage: number;
  /** Tage ohne eigene Buy Box. */
  ohneBuyboxTage: number;
  breakEven: number | null;
  effMin: number | null;
  /** Min-Vorschlag: effektiver Min bzw. Break-even + Mindestmarge (Schnelldreher 7 %). */
  zielMin: number | null;
  liquidationFreigegeben: boolean;
  gebrauchtMitNeupreisMin: boolean;
  schnelldreher: boolean;
  schnelldreherKandidat: boolean;
  reichweite: number | null;
  lagerdauer: number | null;
  kapital: number | null;
  /** B32.4: Median der eigenen Verkaufspreise (14 Tage) und Anzahl. */
  verkaufspreisMedian: number | null;
  verkaufspreisAnzahl: number;
};

export type Befund = { nr: number; titel: string; vorschlag: string; potenzial: number; zahlen: Record<string, number | string | null>; aktion: "min" | "aktivieren" | "schnelldreher" | "max" | "leiter" | "hinweis" | "verlust" | "zustand"; wert: number | null };

export const BEFUND_TITEL: Record<number, string> = {
  1: "Min über Buy Box",
  2: "Pausiert trotz Bestand und Nachfrage",
  3: "Schnelldreher",
  4: "Keine Verkäufe trotz gutem Markt",
  5: "Max zu niedrig",
  6: "Unter Break-even",
  7: "Gebraucht mit Neupreis-Min",
  8: "Preis über Markt",
  9: "Ladenhüter",
  10: "Verkaufspreis dauerhaft unter Min",
};

/** Nachfrage in Stück je Monat, die wir realistisch abbekommen (Keepa-Mindestwert, höchstens Bestand). */
function nachfrage(e: CheckEingabe): number {
  const markt = e.monatlichVerkauft ?? (e.rang !== null && e.rang > 0 && e.rang < 20000 ? 30 : 0);
  return Math.max(0, Math.min(e.bestand, markt));
}

function margeJeStueck(e: CheckEingabe, preis: number | null): number {
  if (preis === null || e.breakEven === null) return 0;
  return Math.max(0, preis - e.breakEven);
}

export function befundePruefen(e: CheckEingabe, s: CheckSchwellen = CHECK_STANDARD): Befund[] {
  const b: Befund[] = [];
  const v30 = e.verkaeufe30 ?? 0;
  const fehlend = Math.max(0, nachfrage(e) - v30);
  // 1 Min über Buy Box (und über dem 30-Tage-Schnitt minus 3 %)
  if (e.minBqool !== null && e.buybox !== null && e.minBqool > e.buybox + 0.005 && (e.bb30 === null || e.minBqool > e.bb30 * (1 - s.minUeberBbAbschlag / 100))) {
    const ziel = e.zielMin;
    b.push({ nr: 1, titel: BEFUND_TITEL[1], vorschlag: ziel !== null ? `Min senken auf ${ziel.toFixed(2)} (${e.schnelldreher || e.schnelldreherKandidat ? "Break-even + 7 %, nie unter effektivem Min" : "effektiver Min"})` : "Min senken auf effektiven Min", potenzial: r2(fehlend * margeJeStueck(e, e.buybox)), zahlen: { min: e.minBqool, buybox: e.buybox, bb30: e.bb30, ziel_min: ziel }, aktion: "min", wert: ziel });
  }
  // 2 Pausiert trotz Bestand und Nachfrage
  if (e.status === "pausiert" && e.bestand > 0 && (nachfrage(e) > 0 || (e.rang !== null && e.rang > 0 && e.rang < 50000))) {
    b.push({ nr: 2, titel: BEFUND_TITEL[2], vorschlag: "Aktivieren nach Min-Korrektur", potenzial: r2(fehlend * margeJeStueck(e, e.buybox ?? e.preis)), zahlen: { bestand: e.bestand, rang: e.rang, monatlich_verkauft: e.monatlichVerkauft }, aktion: "aktivieren", wert: null });
  }
  // 3 Schnelldreher (Kriterien B31.8a)
  if (e.schnelldreherKandidat && !e.schnelldreher) {
    b.push({ nr: 3, titel: BEFUND_TITEL[3], vorschlag: "Kennzeichen setzen: Boden 7 %, Abverkauf sperren", potenzial: r2(v30 * Math.max(0, (e.buybox ?? 0) * 0.02)), zahlen: { verkaeufe_30: e.verkaeufe30, lagerdauer: e.lagerdauer }, aktion: "schnelldreher", wert: null });
  }
  // 4 Keine Verkäufe trotz gutem Markt
  if ((e.verkaeufe7 ?? 0) === 0 && e.bestand > 0 && (e.monatlichVerkauft ?? 0) >= s.nachfrageMin) {
    const ursachen = [e.minBqool !== null && e.buybox !== null && e.minBqool > e.buybox ? "Min über Buy Box" : null, e.status === "pausiert" ? "pausiert" : null, e.ohneBuyboxTage >= s.ohneBuyboxTage ? "keine Buy Box" : null].filter(Boolean);
    b.push({ nr: 4, titel: BEFUND_TITEL[4], vorschlag: `Ursache klären: ${ursachen.length ? ursachen.join(", ") : "Min, Pause, Buy-Box-Quote, Listing gesperrt?"}`, potenzial: r2(fehlend * margeJeStueck(e, e.buybox)), zahlen: { monatlich_verkauft: e.monatlichVerkauft, verkaeufe_7: e.verkaeufe7 ?? 0 }, aktion: "hinweis", wert: null });
  }
  // 5 Max zu niedrig
  if (e.maxBqool !== null && e.buybox !== null && e.buybox > e.maxBqool + 0.005 && e.bbUeberMaxTage >= s.maxTage) {
    const neu = r2(e.buybox * 1.1);
    b.push({ nr: 5, titel: BEFUND_TITEL[5], vorschlag: `Max anheben auf ${neu.toFixed(2)}`, potenzial: r2(v30 * (e.buybox - e.maxBqool)), zahlen: { max: e.maxBqool, buybox: e.buybox, tage: e.bbUeberMaxTage }, aktion: "max", wert: neu });
  }
  // 6 Unter Break-even (ohne Liquidation-Freigabe)
  const unter = (x: number | null) => x !== null && e.breakEven !== null && x < e.breakEven - 0.005;
  if (!e.liquidationFreigegeben && (unter(e.preis) || unter(e.minBqool))) {
    b.push({ nr: 6, titel: BEFUND_TITEL[6], vorschlag: "Verlust-Stopp: Min auf Break-even oder Liquidation freigeben", potenzial: r2(v30 * Math.max(0, (e.breakEven ?? 0) - (e.preis ?? e.minBqool ?? 0))), zahlen: { preis: e.preis, min: e.minBqool, break_even: e.breakEven }, aktion: "verlust", wert: null });
  }
  // 7 Gebraucht mit Neupreis-Min
  if (e.gebrauchtMitNeupreisMin) b.push({ nr: 7, titel: BEFUND_TITEL[7], vorschlag: "Zustand prüfen, Gebraucht-Preis setzen (B31.7)", potenzial: r2(e.bestand * 1), zahlen: { min: e.minBqool }, aktion: "zustand", wert: null });
  // 8 Preis über Markt
  if (e.preis !== null && e.buybox !== null && e.preis > e.buybox * (1 + s.preisUeberMarkt / 100) && e.ohneBuyboxTage >= s.ohneBuyboxTage) {
    b.push({ nr: 8, titel: BEFUND_TITEL[8], vorschlag: "Hinweis: Preis liegt über dem Markt, keine Buy Box", potenzial: r2(fehlend * margeJeStueck(e, e.buybox) * 0.5), zahlen: { preis: e.preis, buybox: e.buybox, tage_ohne_buybox: e.ohneBuyboxTage }, aktion: "hinweis", wert: null });
  }
  // 9 Ladenhüter
  if ((e.reichweite !== null && e.reichweite > s.reichweite) || (e.lagerdauer !== null && e.lagerdauer > s.lagerdauer && (e.kapital ?? 0) > s.kapital)) {
    b.push({ nr: 9, titel: BEFUND_TITEL[9], vorschlag: "Regel-Leiter: auf Abverkauf (Stufe 2)", potenzial: r2((e.kapital ?? 0) * 0.01), zahlen: { reichweite: e.reichweite, lagerdauer: e.lagerdauer, kapital: e.kapital }, aktion: "leiter", wert: null });
  }
  // 10 (B32.4) eigener Verkaufspreis dauerhaft unter dem Min der Datei
  if (e.verkaufspreisMedian !== null && e.verkaufspreisAnzahl >= 3 && e.minBqool !== null && e.verkaufspreisMedian < e.minBqool * 0.99) {
    b.push({ nr: 10, titel: BEFUND_TITEL[10], vorschlag: `Min ${e.minBqool.toFixed(2)} zu hoch angelegt (verkauft zu ${e.verkaufspreisMedian.toFixed(2)}) oder BQool unterschreitet ihn`, potenzial: 0, zahlen: { min: e.minBqool, verkaufspreis: e.verkaufspreisMedian, verkaeufe: e.verkaufspreisAnzahl }, aktion: "hinweis", wert: null });
  }
  return b;
}

/** Stufe A (täglich): höchster Wert = Kapital × Nachfrage, dazu alle Schnelldreher und SKUs mit offenem Befund. */
export function stufeA<T extends { key: string; kapital: number | null; nachfrage: number; schnelldreher: boolean; offen: boolean }>(zeilen: T[], n: number): Set<string> {
  const a = new Set(zeilen.filter((z) => z.schnelldreher || z.offen).map((z) => z.key));
  const rest = zeilen.filter((z) => !a.has(z.key)).sort((x, y) => (y.kapital ?? 0) * Math.max(1, y.nachfrage) - (x.kapital ?? 0) * Math.max(1, x.nachfrage));
  for (const z of rest.slice(0, Math.max(0, n))) a.add(z.key);
  return a;
}

/** Stufe je SKU: A täglich, B wöchentlich (Montag bzw. 7 Tage nicht geprüft), C ohne Bestand monatlich (nur Min aus Datei). */
export function stufeFuer(o: { inA: boolean; bestand: number; zuletzt: string | null; heute: string }): "A" | "B" | "C" | null {
  if (o.inA && o.bestand > 0) return "A";
  const tage = o.zuletzt ? Math.round((Date.parse(`${o.heute}T00:00:00Z`) - Date.parse(`${o.zuletzt}T00:00:00Z`)) / 86_400_000) : 999;
  if (o.bestand > 0) return tage >= 7 ? "B" : null;
  return tage >= 30 ? "C" : null;
}

/** Median (für das Preisband der eigenen Verkäufe). */
export function median(werte: number[]): number | null {
  if (!werte.length) return null;
  const s = [...werte].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return r2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

/** Push nur bei Befund 1/2 an Schnelldrehern oder bei gebundenem Kapital über x €. */
export function pushNoetig(b: Befund, e: Pick<CheckEingabe, "schnelldreher" | "schnelldreherKandidat" | "kapital">, s: CheckSchwellen = CHECK_STANDARD): boolean {
  return (b.nr === 1 || b.nr === 2) && (e.schnelldreher || e.schnelldreherKandidat || (e.kapital ?? 0) > s.pushKapital);
}

export type CheckStand = { am: string; dauerMs: number; geprueft: number; stufeA: number; stufeB: number; stufeC: number; keepaAbrufe: number; unvollstaendig: number; neu: number; offen: number; bqoolAlt: boolean; bqoolStand: string | null; top: { land: string; sku: string; asin: string | null; titel: string; potenzial: number }[] };

/** Morgenbericht: „Listing-Check: n neue Befunde, größte 5 …“ (nur lesen). */
export function checkMorgenZeile(st: CheckStand | null | undefined): string | null {
  if (!st || (!st.neu && !st.offen && !st.unvollstaendig && !st.bqoolAlt)) return null;
  const top = st.top.slice(0, 5).map((t) => `${t.asin ?? t.sku} ${t.titel} ${Math.round(t.potenzial)} €`).join("; ");
  return `Listing-Check: ${st.neu} neue Befund${st.neu === 1 ? "" : "e"}${st.offen ? ` (${st.offen} offen)` : ""}${top ? ` – ${top}` : ""}${st.unvollstaendig ? ` · Check unvollständig (${st.unvollstaendig} ohne frische Keepa-Daten)` : ""}${st.bqoolAlt ? " · BQool-Stand alt" : ""}`;
}
