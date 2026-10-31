// Kapital-Ampel je Produkt – reine Logik: gebundenes Kapital, Gewinn 90 Tage, Umschlag, Jahresrendite auf das
// gebundene Kapital, Reichweite, Lageralter, Preis gegen Break-even → Ampel und Vorschläge.

export type KapitalZiele = { zielRendite: number; geringRendite: number; gruenReichweite: number; rotReichweite: number };
export const KAPITAL_ZIELE: KapitalZiele = { zielRendite: 0.3, geringRendite: 0.05, gruenReichweite: 60, rotReichweite: 120 };

export type Ampel = "gruen" | "gelb" | "rot";

const r2 = (n: number) => Math.round(n * 100) / 100;
const tageImMonat = (monat: string) => {
  const [j, m] = monat.split("-").map(Number);
  return new Date(Date.UTC(j, m, 0)).getUTCDate();
};

/**
 * Gewinn und Stück der letzten 90 Tage aus Monatswerten: laufender Monat (bis heute) + volle Vormonate, der
 * älteste nur anteilig, bis 90 Tage erreicht sind.
 */
export function letzte90(monate: { month: string; netProfit: number | null; units: number | null }[], heute: string): { gewinn: number; stueck: number; tage: number } {
  const jetzt = heute.slice(0, 7);
  const sortiert = [...monate].filter((m) => m.month <= jetzt).sort((a, b) => (a.month < b.month ? 1 : -1));
  let rest = 90;
  let gewinn = 0;
  let stueck = 0;
  for (const m of sortiert) {
    if (rest <= 0) break;
    const tage = m.month === jetzt ? Number(heute.slice(8, 10)) : tageImMonat(m.month);
    const anteil = Math.min(1, rest / tage);
    gewinn += (m.netProfit ?? 0) * anteil;
    stueck += (m.units ?? 0) * anteil;
    rest -= tage * anteil;
  }
  return { gewinn: r2(gewinn), stueck: Math.round(stueck), tage: 90 - Math.max(0, rest) };
}

/** Break-even-Preis brutto: EK + FBA gedeckt nach Provision (auf brutto) und USt. */
export function breakEven(o: { ek: number | null; fba: number | null; provision: number; mwst: number }): number | null {
  if (o.ek === null || o.fba === null) return null;
  const netto = 1 / (1 + o.mwst) - o.provision;
  return netto > 0 ? r2((o.ek + o.fba) / netto) : null;
}

/** Ältestes Altersband mit Bestand („0_90“ … „365_plus“) → Tage (Untergrenze). */
export function aeltesteTage(alter: Record<string, number>): number | null {
  let max: number | null = null;
  for (const [k, v] of Object.entries(alter)) {
    if (!(v > 0)) continue;
    const m = /(\d+)/.exec(k);
    if (!m) continue;
    const ab = Number(m[1]) === 0 ? 0 : Number(m[1]);
    if (max === null || ab > max) max = ab;
  }
  return max;
}

export type KapitalEingabe = {
  sku: string;
  asin: string | null;
  name: string | null;
  stueck: number;
  ek: number | null;
  gewinn90: number;
  stueck90: number;
  tageDaten: number;
  verkaufProTag: number | null;
  aeltesteTage: number | null;
  preis: number | null;
  breakEven: number | null;
  /** Break-even je Land mit dessen USt (DE 19, FR 20, IT 22, ES 21 %). */
  breakEvenLaender?: Partial<Record<"DE" | "FR" | "IT" | "ES", number | null>>;
  trendProzent: number | null;
};

/** USt je Land für den Break-even (wie BQool-Export). */
export const UST_LAND = { DE: 0.19, FR: 0.2, IT: 0.22, ES: 0.21 } as const;

export type KapitalZeile = KapitalEingabe & {
  kapital: number | null;
  rendite: number | null;
  umschlag: number | null;
  reichweite: number | null;
  unterBreakEven: boolean;
  /** Preis 0 (bzw. ≤ 0): kein aktives Angebot – nicht „unter Break-even“. */
  keinAngebot: boolean;
  ampel: Ampel;
  gruende: string[];
  vorschlaege: string[];
};

export function bewerteKapital(e: KapitalEingabe, z: KapitalZiele = KAPITAL_ZIELE): KapitalZeile {
  const kapital = e.ek !== null ? r2(e.stueck * e.ek) : null;
  // Jahresrendite auf gebundenes Kapital: Gewinn 90 T hochgerechnet ÷ Kapital (aktueller Bestand als Ø).
  const rendite = kapital && kapital > 0 && e.tageDaten >= 30 ? r2((e.gewinn90 * (365 / Math.max(e.tageDaten, 1))) / kapital) : null;
  const umschlag = e.stueck > 0 && e.tageDaten >= 30 ? r2((e.stueck90 * (365 / Math.max(e.tageDaten, 1))) / e.stueck) : null;
  const reichweite = e.verkaufProTag && e.verkaufProTag > 0 ? Math.round(e.stueck / e.verkaufProTag) : e.stueck > 0 ? 9999 : 0;
  // Preis 0: es gibt gerade kein aktives Angebot (Buy Box/sellerboard ohne Preis) – das ist kein Verlustverkauf.
  const keinAngebot = e.preis !== null && e.preis <= 0;
  const unterBreakEven = !keinAngebot && e.preis !== null && e.breakEven !== null && e.preis < e.breakEven;
  const gruende: string[] = [];
  if (unterBreakEven) gruende.push(`Preis ${e.preis!.toFixed(2).replace(".", ",")} € unter Break-even ${e.breakEven!.toFixed(2).replace(".", ",")} €`);
  if (rendite !== null && rendite < z.geringRendite) gruende.push(rendite < 0 ? "negative Rendite" : `geringe Rendite (${Math.round(rendite * 100)} %/Jahr)`);
  if (reichweite > z.rotReichweite) gruende.push(reichweite >= 9999 ? "keine Verkäufe" : `Reichweite ${reichweite} Tage`);
  const rot = gruende.length > 0;
  const gruen = !rot && !keinAngebot && rendite !== null && rendite >= z.zielRendite && reichweite <= z.gruenReichweite;
  const ampel: Ampel = rot ? "rot" : gruen ? "gruen" : "gelb";
  // Hinweis, kein eigener Grund für Rot (Preis fehlt nur gerade).
  if (keinAngebot && e.stueck > 0) gruende.unshift("kein aktives Angebot (Preis 0)");
  if (!rot && !gruen) {
    if (rendite === null) gruende.push(e.ek === null ? "EK fehlt" : "zu wenig Verkaufsdaten");
    else if (rendite < z.zielRendite) gruende.push(`Rendite ${Math.round(rendite * 100)} % unter Ziel ${Math.round(z.zielRendite * 100)} %`);
    if (reichweite > z.gruenReichweite && reichweite <= z.rotReichweite) gruende.push(`Reichweite ${reichweite} Tage`);
  }
  const vorschlaege: string[] = [];
  if (rot) {
    vorschlaege.push("Nicht nachbestellen");
    if (keinAngebot) vorschlaege.push("Angebot prüfen und wieder aktivieren (Bestand ohne Angebot)");
    if (unterBreakEven) vorschlaege.push("Repricer-Untergrenze auf Break-even prüfen (BQool)");
    if (reichweite > z.rotReichweite) vorschlaege.push("Abverkauf-Regel im Repricer (schrittweise senken bis Break-even)");
    if ((e.aeltesteTage ?? 0) >= 180) vorschlaege.push("Liquidation/Abverkauf über Amazon (Lagerzuschlag droht)");
    if (e.stueck >= 5) vorschlaege.push("Teil über anderen Kanal verkaufen (eBay/B2B-Deal)");
  }
  if (!rot && keinAngebot && e.stueck > 0) vorschlaege.push("Angebot prüfen und wieder aktivieren (Bestand ohne Angebot)");
  return { ...e, kapital, rendite, umschlag, reichweite, unterBreakEven, keinAngebot, ampel, gruende, vorschlaege };
}
