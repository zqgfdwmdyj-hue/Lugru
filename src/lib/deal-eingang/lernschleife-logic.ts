// B28.8 Monatliche Lernschleife Verlustprodukte – reine Logik: Am 3. des Monats die Produkte mit Verlust bzw. Marge
// unter 3 % im Vormonat (nur Einkäufe der letzten 6 Monate), Antworten „Nie wieder“ / „Pech“ / „Weiß nicht warum“,
// Abschlag bzw. Hinweis für ähnliche neue Deals, Trefferquote je Monat (Anteil Einkäufe mit Marge über Ziel).

export const LERN_ANTWORTEN = { nie_wieder: "Nie wieder kaufen", pech: "Würde ich wieder kaufen (Pech)", unklar: "Weiß nicht warum" } as const;
export type LernAntwort = keyof typeof LERN_ANTWORTEN;
export const istLernAntwort = (x: unknown): x is LernAntwort => typeof x === "string" && x in LERN_ANTWORTEN;
/** Zusätzlich zu den 👍/👎-Gründen (B28.3). */
export const LERN_GRUENDE_EXTRA = ["zu große Menge", "zu viele Anbieter", "Amazon kam zurück", "Preis eingebrochen", "Gebühren unterschätzt"] as const;
export const MARGE_GRENZE = 3;
export const LERN_TAG = 3;
export const EINKAUF_MONATE = 6;
export const TREFFER_ZIEL = 80;

const MONAT_NAME = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monatName = (ym: string) => `${MONAT_NAME[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

export function vormonat(heute: string): string {
  const [j, m] = heute.split("-").map(Number);
  return m === 1 ? `${j - 1}-12` : `${j}-${String(m - 1).padStart(2, "0")}`;
}

export const istLernTag = (heute: string) => Number(heute.slice(8, 10)) === LERN_TAG;

export type VerlustProdukt = { asin: string | null; skus: string[]; titel: string | null; units: number; umsatz: number; gewinn: number; marge: number | null };

/**
 * Verlustprodukte des Monats aus den sellerboard-Monatswerten je SKU: je ASIN (sonst SKU) zusammengefasst, Gewinn < 0
 * oder Marge (Gewinn ÷ Umsatz) unter 3 %, nur Artikel, die in den letzten 6 Monaten eingekauft wurden. Größter
 * Verlust zuerst.
 */
export function verlustProdukte(rows: { sku: string; asin: string | null; name: string | null; units: number | null; sales: number | null; netProfit: number | null }[], gekauft: { asins: ReadonlySet<string>; skus: ReadonlySet<string> }, grenze = MARGE_GRENZE): VerlustProdukt[] {
  const je = new Map<string, VerlustProdukt>();
  for (const r of rows) {
    if (r.netProfit === null && r.sales === null) continue;
    const key = r.asin ? `A|${r.asin}` : `S|${r.sku}`;
    const p = je.get(key) ?? { asin: r.asin, skus: [], titel: r.name, units: 0, umsatz: 0, gewinn: 0, marge: null };
    p.skus.push(r.sku);
    p.units += r.units ?? 0;
    p.umsatz += r.sales ?? 0;
    p.gewinn += r.netProfit ?? 0;
    p.titel ??= r.name;
    je.set(key, p);
  }
  return [...je.values()]
    .map((p) => ({ ...p, umsatz: Math.round(p.umsatz * 100) / 100, gewinn: Math.round(p.gewinn * 100) / 100, marge: p.umsatz > 0 ? Math.round((p.gewinn / p.umsatz) * 1000) / 10 : null }))
    .filter((p) => (p.asin ? gekauft.asins.has(p.asin) : false) || p.skus.some((s) => gekauft.skus.has(s)))
    .filter((p) => p.gewinn < 0 || (p.marge !== null && p.marge < grenze))
    .sort((a, b) => a.gewinn - b.gewinn);
}

export type Fehlkauf = { datum: string; titel: string | null; asin: string | null; marke: string | null; kategorie: string | null; quelle: string | null; angebote: number | null; antwort: LernAntwort };
type Beitrag = { punkte: number; text: string };

const gleich = (a: string | null | undefined, b: string | null | undefined) => {
  const n = (x: string | null | undefined) => (x ?? "").trim().toLowerCase();
  return n(a) !== "" && n(a) === n(b);
};
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Ähnliche frühere Fehlkäufe → Abschlag („Nie wieder“) bzw. Hinweis („Pech“, „Weiß nicht warum“). Ähnlich = gleiche
 * Marke; sonst gleiche Kategorie und Quelle; sonst gleiche Quelle bei ähnlicher Angebotszahl (±2, nur „Nie wieder“).
 * Höchstens −15 Punkte und drei Einträge.
 */
export function fehlkaufBeitraege(m: { marke?: string | null; kategorie?: string | null; quelle?: string | null; angebote?: number | null }, fehlkaeufe: Fehlkauf[]): Beitrag[] {
  const PUNKTE: Record<"marke" | "kategorie" | "angebote", Record<LernAntwort, number>> = {
    marke: { nie_wieder: -10, unklar: -4, pech: -1 },
    kategorie: { nie_wieder: -6, unklar: -2, pech: 0 },
    angebote: { nie_wieder: -3, unklar: 0, pech: 0 },
  };
  const out: Beitrag[] = [];
  for (const f of fehlkaeufe) {
    const warum = gleich(m.marke, f.marke) ? "marke" : gleich(m.kategorie, f.kategorie) && gleich(m.quelle, f.quelle) ? "kategorie" : f.antwort === "nie_wieder" && gleich(m.quelle, f.quelle) && m.angebote != null && f.angebote != null && Math.abs(m.angebote - f.angebote) <= 2 ? "angebote" : null;
    if (!warum) continue;
    const text = { marke: `gleiche Marke ${f.marke}`, kategorie: `gleiche Kategorie und Quelle`, angebote: `gleiche Quelle, ähnlich viele Angebote` }[warum];
    out.push({ punkte: PUNKTE[warum][f.antwort], text: `ähnlicher Fehlkauf am ${dmy(f.datum)}: ${(f.titel ?? f.asin ?? "Artikel").slice(0, 40)} – „${LERN_ANTWORTEN[f.antwort]}“ (${text})` });
  }
  out.sort((a, b) => a.punkte - b.punkte);
  let summe = 0;
  return out.slice(0, 3).map((b) => {
    const p = Math.max(b.punkte, -15 - summe);
    summe += p;
    return { ...b, punkte: p };
  });
}

/** Trefferquote je Einkaufsmonat: Anteil der Einkäufe (mit Verkaufsdaten) mit Marge über Ziel. */
export function trefferquoteMonate(einkaeufe: { monat: string; marge: number | null }[], zielMarge: number) {
  const je = new Map<string, { einkaeufe: number; ueberZiel: number }>();
  for (const e of einkaeufe) {
    if (e.marge === null) continue;
    const x = je.get(e.monat) ?? { einkaeufe: 0, ueberZiel: 0 };
    x.einkaeufe++;
    if (e.marge >= zielMarge) x.ueberZiel++;
    je.set(e.monat, x);
  }
  return [...je.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([monat, x]) => ({ monat, ...x, quote: Math.round((x.ueberZiel / x.einkaeufe) * 100) }));
}

/** Morgenbericht (einmal im Monat): „Trefferquote Oktober 2026: 72 % (Ziel 80 %)“. */
export function trefferZeile(t: { monat: string; quote: number } | null | undefined, ziel = TREFFER_ZIEL): string | null {
  return t ? `Trefferquote ${monatName(t.monat)}: ${t.quote} % (Ziel ${ziel} %)` : null;
}
