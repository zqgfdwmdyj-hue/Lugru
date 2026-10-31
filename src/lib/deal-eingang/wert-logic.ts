// Abschnitt 11 „Lernender Deal-Wert“ – reine Logik. Neben der festen Ampel ein persönlicher Wert (0–100): Start
// nachvollziehbar mit gewichteten Kennzahlen + „ähnlichen früheren Deals“ (nächste Nachbarn); ab 100 eigenen Deals
// mit Ergebnis zusätzlich ein einfaches Lernmodell (logistische Regression). Immer mit Begründung. Rot-Kriterien der
// Ampel gelten immer – der Wert ersetzt keine Prüfung. Reaktionen der Lugru-Gruppe sind ein schwaches, positives
// Signal (nur Anzahl, keine Mitglieder); eine fehlende Reaktion heißt nicht „nicht gekauft“.

import type { DealAehnlich, DealMerkmale, DealWert } from "@/db/tables/deal-eingang";

type Verlauf = [tag: string, buybox: number | null, amazon: number | null, angebote: number | null, rang: number | null];
export type KeepaLite = {
  aktuell: { buybox: number | null; angebote_neu: number | null; angebote_fba: number | null; angebote_fbm: number | null; verkaufsrang: number | null; monatlich_verkauft: number | null };
  kennzahlen: Record<"30" | "90" | "180", { buybox: { schnitt: number | null }; rang: { schnitt: number | null }; amazon_nicht_auf_lager_prozent: number | null }>;
  verlauf: Verlauf[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? r1((a / b - 1) * 100) : null);
const mittel = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null);
const TAG = 86_400_000;

/** Merkmale beim Eingang aus Keepa (Verlauf bis 365 Tage), Rechnung der Deal-Ampel und Kontext. */
export function merkmaleAus(
  k: KeepaLite | null,
  z: { land: string | null; ekNetto: number | null; roi: number | null; marge: number | null; amazonProzent: number | null; angebote: number | null },
  kontext: { marke: string | null; kategorie: string | null; quelle: string | null; weg: string; jetzt: Date; kapitalAmpel: "gruen" | "gelb" | "rot" | null; bestand: number | null },
): DealMerkmale {
  const jetzt = kontext.jetzt.getTime();
  const tagVor = (n: number) => new Date(jetzt - n * TAG).toISOString().slice(0, 10);
  const v = k?.verlauf ?? [];
  const bbIn = (von: number, bis = 0) => v.filter((r) => r[0] >= tagVor(von) && r[0] <= tagVor(bis) && r[1] !== null).map((r) => r[1]!);
  const bbJetzt = k?.aktuell.buybox ?? (v.length ? v[v.length - 1][1] : null);
  const bb90 = k?.kennzahlen["90"].buybox.schnitt ?? mittel(bbIn(90));
  // Schwankung: Variationskoeffizient der Tageswerte (90 T)
  const b90 = bbIn(90);
  const m90 = mittel(b90);
  const schwankung90 = m90 && b90.length >= 10 ? r1((Math.sqrt(b90.reduce((n, x) => n + (x - m90) ** 2, 0) / b90.length) / m90) * 100) : null;
  // Einbrüche: Phasen mit Preis ≥ 15 % unter dem Schnitt der 30 Tage davor (180 T)
  let einbrueche180: number | null = null;
  if (v.length >= 60) {
    einbrueche180 = 0;
    let drin = false;
    const tage = v.filter((r) => r[0] >= tagVor(180));
    for (const r of tage) {
      if (r[1] === null) continue;
      const davor = v.filter((x) => x[0] < r[0] && x[0] >= new Date(Date.parse(r[0]) - 30 * TAG).toISOString().slice(0, 10) && x[1] !== null).map((x) => x[1]!);
      const m = mittel(davor);
      const unten = m !== null && davor.length >= 7 && r[1] < m * 0.85;
      if (unten && !drin) einbrueche180++;
      drin = unten;
    }
  }
  const alleBb = v.filter((r) => r[1] !== null).map((r) => r[1]!);
  const tief12 = alleBb.length ? Math.min(...alleBb) : null;
  const angebote = k?.aktuell.angebote_neu ?? z.angebote ?? null;
  const vor30 = v.filter((r) => r[0] <= tagVor(28) && r[0] >= tagVor(35) && r[3] !== null).map((r) => r[3]!);
  const fba = k?.aktuell.angebote_fba ?? null;
  const fbm = k?.aktuell.angebote_fbm ?? null;
  const rang = k?.aktuell.verkaufsrang ?? null;
  // Saison: Rang im kommenden Monat des Vorjahres ÷ Ø Rang des Vorjahres (unter 1 = dann besser verkauft)
  const rVorjahr = v.filter((r) => r[0] >= tagVor(365) && r[0] <= tagVor(335) && r[4] !== null).map((r) => r[4]!);
  const rAlle = v.filter((r) => r[4] !== null).map((r) => r[4]!);
  const saison = rVorjahr.length >= 10 && rAlle.length >= 120 ? r1((mittel(rVorjahr)! / mittel(rAlle)!) * 100) / 100 : null;
  const jt = new Date(kontext.jetzt.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  return {
    land: z.land,
    bbJetzt,
    bb30: k?.kennzahlen["30"].buybox.schnitt ?? null,
    bb90: bb90 ?? null,
    bb180: k?.kennzahlen["180"].buybox.schnitt ?? null,
    bbAbweichung90: pct(bbJetzt, bb90 ?? null),
    schwankung90,
    einbrueche180,
    tief12,
    ekZuTief: z.ekNetto !== null && tief12 ? r1((z.ekNetto / tief12) * 100) : null,
    angebote,
    angeboteTrend30: vor30.length ? pct(angebote, mittel(vor30)) : null,
    fbaAnteil: fba !== null && fbm !== null && fba + fbm > 0 ? r1((fba / (fba + fbm)) * 100) : null,
    amazonAnteil: z.amazonProzent,
    amazonOos90: k?.kennzahlen["90"].amazon_nicht_auf_lager_prozent ?? null,
    rang,
    rangTrend: pct(rang, k?.kennzahlen["90"].rang.schnitt ?? null),
    monatlichVerkauft: k?.aktuell.monatlich_verkauft ?? null,
    saison,
    roi: z.roi,
    marge: z.marge,
    marke: kontext.marke,
    kategorie: kontext.kategorie,
    quelle: kontext.quelle,
    weg: kontext.weg,
    wochentag: jt.getDay(),
    stunde: jt.getHours(),
    kapitalAmpel: kontext.kapitalAmpel,
    bestand: kontext.bestand,
  };
}

// ---- Gewichtete Kennzahlen ---------------------------------------------------------------------------------------

type Beitrag = { punkte: number; text: string };

/** Startwert 50, je Kennzahl Zu-/Abschläge mit Text (für „dafür/dagegen“). */
export function kennzahlenWert(m: Partial<DealMerkmale>, zielRoi: number): { wert: number; beitraege: Beitrag[] } {
  const b: Beitrag[] = [];
  const add = (punkte: number, text: string) => b.push({ punkte, text });
  if (m.roi !== null && m.roi !== undefined) {
    if (m.roi >= zielRoi) add(Math.min(20, (m.roi - zielRoi) * 0.8 + 4), `ROI ${Math.round(m.roi)} %`);
    else add(-Math.min(25, (zielRoi - m.roi) * 1.2 + 4), `ROI nur ${Math.round(m.roi)} %`);
  }
  if (m.schwankung90 != null) {
    if (m.schwankung90 < 8) add(8, "Chart stabil");
    else if (m.schwankung90 > 20) add(-10, `Chart schwankt (${Math.round(m.schwankung90)} %)`);
  }
  if (m.einbrueche180 != null) {
    if (m.einbrueche180 === 0) add(4, "keine Preiseinbrüche");
    else if (m.einbrueche180 >= 3) add(-8, `${m.einbrueche180} Preiseinbrüche in 180 T`);
  }
  if (m.angeboteTrend30 != null) {
    if (m.angeboteTrend30 > 30) add(-10, `Angebote +${Math.round(m.angeboteTrend30)} % in 30 T`);
    else if (m.angeboteTrend30 < -10) add(5, `Angebote ${Math.round(m.angeboteTrend30)} % in 30 T`);
  }
  if (m.amazonAnteil != null) {
    if (m.amazonAnteil >= 50) add(-15, `Amazon ${Math.round(m.amazonAnteil)} % in der Buy Box`);
    else if (m.amazonAnteil >= 20) add(-6, `Amazon ${Math.round(m.amazonAnteil)} % in der Buy Box`);
    else if (m.amazonAnteil === 0) add(4, "Amazon nicht drin");
  }
  if (m.bbAbweichung90 != null) {
    if (m.bbAbweichung90 < -15) add(-6, `Buy Box ${Math.round(m.bbAbweichung90)} % unter Ø 90 T`);
    else if (m.bbAbweichung90 > 10) add(-4, `Buy Box +${Math.round(m.bbAbweichung90)} % über Ø 90 T`);
  }
  if (m.ekZuTief != null) {
    if (m.ekZuTief <= 50) add(6, "EK weit unter dem 12-Monats-Tief");
    else if (m.ekZuTief >= 80) add(-6, "EK nah am 12-Monats-Tief");
  }
  if (m.rangTrend != null) {
    if (m.rangTrend < -20) add(4, "Rang verbessert sich");
    else if (m.rangTrend > 30) add(-5, "Rang verschlechtert sich");
  }
  if (m.monatlichVerkauft != null) {
    if (m.monatlichVerkauft >= 100) add(5, `${m.monatlichVerkauft}+ im Monat gekauft`);
    else if (m.monatlichVerkauft < 10) add(-5, "kaum Verkäufe");
  }
  if (m.saison != null) {
    if (m.saison < 0.8) add(4, "Saison steht bevor (Vorjahr)");
    else if (m.saison > 1.3) add(-4, "Saison vorbei (Vorjahr)");
  }
  if (m.kapitalAmpel === "rot") add(-15, "eigener Bestand mit roter Kapital-Ampel");
  const wert = Math.max(0, Math.min(100, Math.round(50 + b.reduce((n, x) => n + x.punkte, 0))));
  return { wert, beitraege: b };
}

// ---- Ähnliche frühere Deals --------------------------------------------------------------------------------------

/** Ein früherer Deal mit Ergebnis: label 1 = gelohnt/gewollt, 0 = nicht; gewicht = wie verlässlich das Signal ist. */
export type HistorieDeal = { id: string | null; quelle: "eigen" | "lugru"; titel: string | null; asin: string | null; datum: string; merkmale: Partial<DealMerkmale>; label: number; gewicht: number; ergebnis: string; realerRoi?: number | null; kaeufe?: number };

const DIMS: { k: keyof DealMerkmale; f: (x: number) => number }[] = [
  { k: "roi", f: (x) => x / 100 },
  { k: "marge", f: (x) => x / 50 },
  { k: "schwankung90", f: (x) => x / 40 },
  { k: "angeboteTrend30", f: (x) => Math.max(-1, Math.min(2, x / 100)) },
  { k: "amazonAnteil", f: (x) => x / 100 },
  { k: "bbAbweichung90", f: (x) => x / 40 },
  { k: "ekZuTief", f: (x) => x / 100 },
  { k: "rang", f: (x) => Math.log10(x + 1) / 7 },
  { k: "monatlichVerkauft", f: (x) => Math.log10(x + 1) / 4 },
  { k: "fbaAnteil", f: (x) => x / 100 },
];

/** Abstand über gemeinsame Merkmale (fehlende zählen nicht); null = zu wenig gemeinsam (unter 2 Merkmale). */
export function abstand(a: Partial<DealMerkmale>, b: Partial<DealMerkmale>): number | null {
  let s = 0;
  let n = 0;
  for (const d of DIMS) {
    const x = a[d.k];
    const y = b[d.k];
    if (typeof x !== "number" || typeof y !== "number") continue;
    s += (d.f(x) - d.f(y)) ** 2;
    n++;
  }
  return n >= 2 ? Math.sqrt(s / n) : null;
}

export function aehnliche(m: Partial<DealMerkmale>, historie: HistorieDeal[], k = 8): (HistorieDeal & { abstand: number })[] {
  return historie
    .map((h) => ({ ...h, abstand: abstand(m, h.merkmale) }))
    .filter((h): h is HistorieDeal & { abstand: number } => h.abstand !== null)
    .sort((x, y) => x.abstand - y.abstand)
    .slice(0, k);
}

// ---- Lernmodell (ab 100 eigenen Deals mit Ergebnis) --------------------------------------------------------------

export type Modell = { gewichte: number[]; bias: number; mittel: number[]; streuung: number[]; n: number };

const vektor = (m: Partial<DealMerkmale>, mit: number[]) => DIMS.map((d, i) => (typeof m[d.k] === "number" ? d.f(m[d.k] as number) : mit[i]));

/** Logistische Regression (Gradientenabstieg, L2) auf standardisierten Merkmalen; fehlende = Mittelwert. */
export function modellLernen(daten: { merkmale: Partial<DealMerkmale>; label: number; gewicht: number }[], runden = 400, rate = 0.3, l2 = 0.01): Modell | null {
  if (daten.length < 100) return null;
  const roh = DIMS.map((d) => daten.map((x) => x.merkmale[d.k]).filter((v): v is number => typeof v === "number").map(d.f));
  const mit = roh.map((xs) => mittel(xs) ?? 0);
  const X0 = daten.map((x) => vektor(x.merkmale, mit));
  const std = DIMS.map((_, i) => Math.sqrt(X0.reduce((n, r) => n + (r[i] - mit[i]) ** 2, 0) / X0.length) || 1);
  const X = X0.map((r) => r.map((v, i) => (v - mit[i]) / std[i]));
  const w = DIMS.map(() => 0);
  let b = 0;
  const gSum = daten.reduce((n, x) => n + x.gewicht, 0) || 1;
  for (let t = 0; t < runden; t++) {
    const gw = w.map(() => 0);
    let gb = 0;
    for (let j = 0; j < X.length; j++) {
      const z = X[j].reduce((n, v, i) => n + v * w[i], b);
      const p = 1 / (1 + Math.exp(-z));
      const e = (p - daten[j].label) * daten[j].gewicht;
      for (let i = 0; i < w.length; i++) gw[i] += e * X[j][i];
      gb += e;
    }
    for (let i = 0; i < w.length; i++) w[i] -= rate * (gw[i] / gSum + l2 * w[i]);
    b -= rate * (gb / gSum);
  }
  return { gewichte: w, bias: b, mittel: mit, streuung: std, n: daten.length };
}

export function modellWahrscheinlichkeit(mo: Modell, m: Partial<DealMerkmale>): number {
  const x = vektor(m, mo.mittel).map((v, i) => (v - mo.mittel[i]) / mo.streuung[i]);
  return 1 / (1 + Math.exp(-x.reduce((n, v, i) => n + v * mo.gewichte[i], mo.bias)));
}

/** Welche Merkmale zählen am meisten (Betrag des Gewichts)? */
export const modellMerkmale = (mo: Modell) => DIMS.map((d, i) => ({ merkmal: d.k, gewicht: Math.round(mo.gewichte[i] * 100) / 100 })).sort((a, b) => Math.abs(b.gewicht) - Math.abs(a.gewicht));

// ---- Deal-Wert ---------------------------------------------------------------------------------------------------

/**
 * Deal-Wert: Kennzahlen (Gewicht 0,5–0,75) + ähnliche frühere Deals (0,25–0,5), ab 100 eigenen Deals mit Ergebnis
 * zusätzlich das Lernmodell. Ampel rot → höchstens 30 (gedeckelt).
 */
export function dealWert(m: Partial<DealMerkmale>, o: { zielRoi: number; ampel: "gruen" | "gelb" | "rot"; historie: HistorieDeal[]; modell?: Modell | null }): DealWert {
  const kz = kennzahlenWert(m, o.zielRoi);
  const nb = aehnliche(m, o.historie);
  const eigen = nb.filter((x) => x.quelle === "eigen");
  const lugru = nb.filter((x) => x.quelle === "lugru");
  let knn: number | null = null;
  if (nb.length) {
    let s = 0;
    let g = 0;
    for (const x of nb) {
      const w = x.gewicht / (x.abstand + 0.1);
      s += w * x.label;
      g += w;
    }
    knn = g > 0 ? (s / g) * 100 : null;
  }
  const anteilKnn = knn === null ? 0 : eigen.length >= 3 ? 0.5 : 0.25;
  let wert = kz.wert * (1 - anteilKnn) + (knn ?? 0) * anteilKnn;
  let verfahren: DealWert["verfahren"] = "kennzahlen";
  if (o.modell) {
    wert = wert * 0.7 + modellWahrscheinlichkeit(o.modell, m) * 100 * 0.3;
    verfahren = "modell";
  }
  wert = Math.round(Math.max(0, Math.min(100, wert)));
  const gedeckelt = o.ampel === "rot" && wert > 30;
  if (gedeckelt) wert = 30;

  // Reihenfolge wie im Beispiel des Bauauftrags: erst ähnliche eigene Deals, dann die Lugru-Gruppe, dann Kennzahlen.
  const gekauft = eigen.filter((x) => x.label >= 0.5);
  const rois = gekauft.map((x) => x.realerRoi).filter((v): v is number => typeof v === "number");
  const lk = lugru.reduce((n, x) => n + (x.kaeufe ?? 0), 0);
  const dafuer = [
    ...(eigen.length ? [`${gekauft.length} von ${eigen.length} ähnlichen Deals gekauft/gut${rois.length ? `, Ø realer ROI ${Math.round(mittel(rois)!)} %` : ""}`] : []),
    ...(lk ? [`Lugru-Gruppe: ${lk} Käufe bei ähnlichen Deals`] : []),
    ...kz.beitraege.filter((x) => x.punkte > 0).sort((a, b) => b.punkte - a.punkte).map((x) => x.text),
  ];
  const dagegen = kz.beitraege.filter((x) => x.punkte < 0).sort((a, b) => a.punkte - b.punkte).map((x) => x.text);
  if (gedeckelt) dagegen.unshift("Ampel rot – der Deal-Wert ersetzt keine Prüfung");
  const begruendung = `Passt zu dir (${wert}/100)${dafuer.length ? `: ${dafuer.slice(0, 3).join(", ")}` : ""}.${dagegen.length ? ` Gegen: ${dagegen.slice(0, 2).join(", ")}.` : ""}`;
  const aehnlicheListe: DealAehnlich[] = nb.slice(0, 5).map((x) => ({ id: x.id, quelle: x.quelle, titel: x.titel, asin: x.asin, datum: x.datum, ergebnis: x.ergebnis, abstand: Math.round(x.abstand * 1000) / 1000 }));
  return { wert, begruendung, dafuer: dafuer.slice(0, 5), dagegen: dagegen.slice(0, 5), aehnliche: aehnlicheListe, verfahren, gedeckelt };
}

// ---- Historie aufbereiten ----------------------------------------------------------------------------------------

/** Eigener Deal → Label: gekauft + realer ROI ≥ Ziel (bzw. noch offen und nicht 👎) = 1; 👎/verworfen/Verlust = 0. */
export function eigenesLabel(d: { status: string; daumen: "hoch" | "runter" | null; realerRoi: number | null }, zielRoi: number): { label: number; gewicht: number; ergebnis: string } | null {
  if (d.status === "gekauft") {
    if (d.realerRoi !== null) return d.realerRoi >= zielRoi ? { label: 1, gewicht: 1.5, ergebnis: `gekauft, realer ROI ${d.realerRoi} %` } : d.realerRoi < 0 ? { label: 0, gewicht: 1.5, ergebnis: `gekauft, Verlust (ROI ${d.realerRoi} %)` } : { label: 0.5, gewicht: 1.2, ergebnis: `gekauft, realer ROI ${d.realerRoi} %` };
    return d.daumen === "runter" ? { label: 0.3, gewicht: 1, ergebnis: "gekauft, 👎" } : { label: 0.85, gewicht: 1, ergebnis: "gekauft (Ergebnis offen)" };
  }
  if (d.daumen === "hoch") return { label: 0.8, gewicht: 0.8, ergebnis: "👍" };
  if (d.daumen === "runter") return { label: 0, gewicht: 0.8, ergebnis: "👎" };
  if (d.status === "verworfen") return { label: 0.1, gewicht: 0.6, ergebnis: "verworfen" };
  return null;
}

/**
 * Lugru-Deal → schwaches positives Signal: nur mit ✅-Reaktionen (Anzahl, keine Personen). Bewährt (Preis hielt,
 * Angebote stiegen nicht stark) stärkt, nicht bewährt schwächt. Ohne Reaktion: kein Eintrag (≠ „nicht gekauft“).
 */
export function lugruLabel(d: { kaeufe: number; bewaehrt: boolean | null }): { label: number; gewicht: number; ergebnis: string } | null {
  if (!(d.kaeufe > 0)) return null;
  const basis = 0.3 + 0.05 * Math.min(d.kaeufe, 6);
  if (d.bewaehrt === false) return { label: 0.4, gewicht: basis * 0.7, ergebnis: `${d.kaeufe}× ✅, danach nicht bewährt` };
  return { label: d.bewaehrt ? 0.9 : 0.75, gewicht: d.bewaehrt ? basis + 0.2 : basis, ergebnis: `${d.kaeufe}× ✅ in der Gruppe${d.bewaehrt ? ", bewährt" : ""}` };
}

/** Lugru-Deal-Zahlen → vergleichbare Merkmale (ROI aus Gewinn ÷ EK netto, Marge, Verkäufe/Monat). */
export function lugruMerkmale(d: { ekEur: number | null; gewinnEur: number | null; margeProzent: number | null; verkaeufeMonat: number | null }): Partial<DealMerkmale> {
  const ekNetto = d.ekEur ? d.ekEur / 1.19 : null;
  return { roi: ekNetto && d.gewinnEur !== null ? r1((d.gewinnEur / ekNetto) * 100) : null, marge: d.margeProzent, monatlichVerkauft: d.verkaeufeMonat };
}

/** Hat sich ein geposteter Deal bewährt? Buy Box hielt (≥ 90 % des damaligen VK) und Angebote stiegen < 50 %. */
export function bewaehrt(d: { vkEur: number | null; gepostetAm: string }, k: Pick<KeepaLite, "aktuell" | "verlauf">): { bewaehrt: boolean | null; grund: string } {
  const tag = d.gepostetAm.slice(0, 10);
  const damals = k.verlauf.filter((r) => r[0] <= tag).slice(-3);
  const angDamals = mittel(damals.map((r) => r[3]).filter((x): x is number => x !== null));
  const bbJetzt = k.aktuell.buybox;
  if (bbJetzt === null || !d.vkEur) return { bewaehrt: null, grund: "keine Keepa-Werte" };
  const preisHielt = bbJetzt >= d.vkEur * 0.9;
  const angJetzt = k.aktuell.angebote_neu;
  const angStieg = angDamals && angJetzt !== null ? angJetzt / angDamals - 1 : null;
  if (!preisHielt) return { bewaehrt: false, grund: `Buy Box ${Math.round((bbJetzt / d.vkEur - 1) * 100)} % gegenüber damals` };
  if (angStieg !== null && angStieg >= 0.5) return { bewaehrt: false, grund: `Angebote +${Math.round(angStieg * 100)} %` };
  return { bewaehrt: true, grund: "Preis hielt" };
}

// ---- Monatsbericht -----------------------------------------------------------------------------------------------

export type BerichtDeal = { id: string; titel: string | null; datum: string; wert: number | null; status: string; daumen: "hoch" | "runter" | null; realerRoi: number | null };

/** „Wie gut lag der Deal-Wert?“: Trefferquote, verpasste gute Deals, Fehlkäufe. */
export function lernBericht(deals: BerichtDeal[], o: { schwelle: number; zielRoi: number }) {
  const mitWert = deals.filter((d) => d.wert !== null);
  const gut = (d: BerichtDeal) => (d.status === "gekauft" && (d.realerRoi === null ? d.daumen !== "runter" : d.realerRoi >= o.zielRoi)) || (d.status !== "gekauft" && d.daumen === "hoch");
  const hoch = mitWert.filter((d) => d.wert! >= o.schwelle);
  const mitErgebnis = hoch.filter((d) => d.status === "gekauft" || d.daumen !== null || d.status === "verworfen");
  const treffer = mitErgebnis.filter(gut).length;
  const verpasst = mitWert.filter((d) => d.wert! < 50 && gut(d));
  const fehlkaeufe = deals.filter((d) => d.status === "gekauft" && d.realerRoi !== null && d.realerRoi < 0);
  return {
    deals: deals.length,
    mitWert: mitWert.length,
    ueberSchwelle: hoch.length,
    trefferquote: mitErgebnis.length ? Math.round((treffer / mitErgebnis.length) * 100) : null,
    trefferBasis: mitErgebnis.length,
    verpasst: verpasst.slice(0, 10),
    fehlkaeufe: fehlkaeufe.slice(0, 10),
  };
}
