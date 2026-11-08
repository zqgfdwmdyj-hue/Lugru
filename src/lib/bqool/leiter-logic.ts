// B31.6a/b, B31.7, B31.8: Regel-Leiter je SKU (ia → Abverkauf → Liquidation → zurück auf Abverkauf), Dauer der
// Liquidation, Zustand der Ware (neu/gebraucht) mit eigenen Preisen und Schnelldreher-Schutz. Reine Logik – alle
// Wechsel sind Vorschläge, die Ludwig freigibt; danach kommen sie über den täglichen BQool-Lauf (B31.2) in die Datei.

import type { KatalogRegel } from "./export-logic";

const r2 = (n: number) => Math.round(n * 100) / 100;
const TAG = 86_400_000;
export const tageZwischen = (von: string, bis: string) => Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / TAG);
export const plusTage = (tag: string, n: number) => new Date(Date.parse(`${tag}T00:00:00Z`) + n * TAG).toISOString().slice(0, 10);

export type Zustand = "neu" | "neu_sonstige" | "wie_neu" | "sehr_gut" | "gut" | "akzeptabel" | "gebraucht" | "unbekannt";
export const ZUSTAENDE: Zustand[] = ["neu", "neu_sonstige", "wie_neu", "sehr_gut", "gut", "akzeptabel", "gebraucht", "unbekannt"];
export const ZUSTAND_TEXT: Record<Zustand, string> = {
  neu: "neu",
  neu_sonstige: "neu – sonstige (Verpackung offen/beschädigt)",
  wie_neu: "gebraucht – wie neu",
  sehr_gut: "gebraucht – sehr gut",
  gut: "gebraucht – gut",
  akzeptabel: "gebraucht – akzeptabel",
  gebraucht: "gebraucht (Grad unbekannt)",
  unbekannt: "unbekannt",
};
export type ZustandQuelle = "hand" | "sku_muster" | "arbitrageone" | "amazon" | "retouren_station" | "einkauf" | "keine";
export const istGebraucht = (z: Zustand | null | undefined) => !!z && z !== "neu" && z !== "unbekannt";

export type LeiterEinstellungen = {
  /** Standard: ia → Abverkauf → Liquidation (Liquidation = tiefster Boden); wahlweise Liquidation als kurze Brücke vor Abverkauf. */
  reihenfolge: "abverkauf_zuerst" | "liquidation_zuerst";
  reichweiteTage: number;
  alterTage12: number;
  kapital12: number;
  ueberTage: number;
  bbQuote12: number;
  alterTage23: number;
  kapital23: number;
  /** Buy Box minus x % als Liquidation-Min (nie unter Break-even, nie über dem effektiven Min der Stufe 2). */
  bbAbschlag: number;
  liquidationTage: number;
  /** Fester Endtermin statt Tagen (Q4-Vorschlag „bis 05.01.“), null = Tage. */
  liquidationBisFest: string | null;
  verlaengernTage: number;
  ablaufVorwarnTage: number;
  schnell: { verkaeufe30: number; reichweiteMax: number; alterMax: number; bbQuoteMin: number; margeBoden: number; ohneBuyboxTage: number; verkaeufeEnde: number; alterEnde: number; reichweiteEnde: number; verlaengernTage: number; regel: string | null };
  zustand: { faktoren: Record<Exclude<Zustand, "unbekannt">, number>; mindestmarge: number; maxFaktor: number; stillstandTage: number; ebayGebuehr: number; ebayVersand: number };
};

export const LEITER_STANDARD: LeiterEinstellungen = {
  reihenfolge: "abverkauf_zuerst",
  reichweiteTage: 90,
  alterTage12: 60,
  kapital12: 300,
  ueberTage: 7,
  bbQuote12: 10,
  alterTage23: 90,
  kapital23: 300,
  bbAbschlag: 1,
  liquidationTage: 45,
  liquidationBisFest: null,
  verlaengernTage: 30,
  ablaufVorwarnTage: 7,
  schnell: { verkaeufe30: 15, reichweiteMax: 45, alterMax: 60, bbQuoteMin: 30, margeBoden: 7, ohneBuyboxTage: 21, verkaeufeEnde: 5, alterEnde: 60, reichweiteEnde: 90, verlaengernTage: 14, regel: null },
  // Abschläge wie in ArbitrageOne (Retouren-Listing): neu 0 % · neu sonstige 10 % · wie neu 12 % · sehr gut 14 % · gut 16 % · akzeptabel 20 %
  zustand: { faktoren: { neu: 1, neu_sonstige: 0.9, wie_neu: 0.88, sehr_gut: 0.86, gut: 0.84, akzeptabel: 0.8, gebraucht: 0.84 }, mindestmarge: 3, maxFaktor: 1.1, stillstandTage: 14, ebayGebuehr: 5, ebayVersand: 5.49 },
};

export function leiterMitStandard(e: Partial<LeiterEinstellungen> | null | undefined): LeiterEinstellungen {
  const s = e ?? {};
  return {
    ...LEITER_STANDARD,
    ...s,
    schnell: { ...LEITER_STANDARD.schnell, ...(s.schnell ?? {}) },
    zustand: { ...LEITER_STANDARD.zustand, ...(s.zustand ?? {}), faktoren: { ...LEITER_STANDARD.zustand.faktoren, ...(s.zustand?.faktoren ?? {}) } },
  };
}

// ---- Stufen ---------------------------------------------------------------------------------------------------------

export type Stufe = 1 | 2 | 3;

/** Stufe einer BQool-Regel: Liquidation (feste Untergrenze) = 3, Abverkauf-Regel = 2, andere Margen-Regel (ia) = 1. */
export function stufeVonRegel(regel: string | null | undefined, katalog: KatalogRegel[], abverkauf: { DE: string; sonst: string }): Stufe | null {
  if (!regel) return null;
  const n = regel.trim().toLowerCase();
  const k = katalog.find((x) => x.name.toLowerCase() === n || (x.aliase ?? []).some((a) => a.toLowerCase() === n)) ?? null;
  if (k?.festeUntergrenze) return 3;
  if (n === abverkauf.DE.toLowerCase() || n === abverkauf.sonst.toLowerCase() || n.startsWith("abverkauf")) return 2;
  if (k?.staffel) return 1;
  return null;
}

export const abverkaufFuer = (land: string, abverkauf: { DE: string; sonst: string }) => (land === "DE" ? abverkauf.DE : abverkauf.sonst);

/** Rückkehr aus der Liquidation: auf Stufe 2 (Abverkauf), auf Stufe 1 nur mit frischem Nachschub (Lageralter 0–30 T). */
export function rueckkehrZiel(o: { land: string; alterTage: number | null; gebraucht: boolean; abverkauf: { DE: string; sonst: string }; standard: string }): { regel: string; stufe: Stufe; grund: string } {
  if (!o.gebraucht && o.alterTage !== null && o.alterTage <= 30) return { regel: o.standard, stufe: 1, grund: "Lageralter 0–30 Tage (Nachschub eingebucht)" };
  return { regel: abverkaufFuer(o.land, o.abverkauf), stufe: 2, grund: "zurück auf Stufe 2 (nie automatisch auf Stufe 1)" };
}

/** Liquidation-Min nach Stufe 2: max(Break-even, Buy Box − x %), nie über dem effektiven Min der Stufe 2; null = lohnt nicht. */
export function liquidationsMin(o: { breakEven: number | null; buybox: number | null; deckel: number | null; abschlag: number }): number | null {
  if (o.buybox === null) return null;
  const ziel = r2(o.buybox * (1 - o.abschlag / 100));
  const min = o.breakEven !== null ? Math.max(o.breakEven, ziel) : ziel;
  if (o.deckel !== null && min >= o.deckel - 0.005) return null;
  return r2(min);
}

export type LeiterEingabe = {
  land: string;
  stufe: Stufe | null;
  regel: string;
  effMin: number | null;
  effMinStufe1: number | null;
  effMinStufe2: number | null;
  breakEven: number | null;
  buybox: number | null;
  /** Seit wann der effektive Min der aktuellen Regel über der Buy Box liegt (Tag). */
  ueberSeit: string | null;
  heute: string;
  reichweite: number | null;
  alterTage: number | null;
  kapital: number | null;
  ladenhueter: boolean;
  /** Buy-Box-Quote in % (BQool Listing Performance), null = unbekannt. */
  bbQuote: number | null;
  schnelldreher: boolean;
  gebraucht: boolean;
};

export type LeiterVorschlag = { von: Stufe; nach: Stufe; regel: string; min: number | null; gruende: string[] };

/**
 * Täglich je SKU/Land: Wechsel 1 → 2 (Ladenhüter), 2 → 3 (Stufe 2 kommt nicht in die Buy Box), 2 → 1 (Nachschub).
 * Schnelldreher (B31.8) sind für 1 → 2 und 2 → 3 gesperrt; gebrauchte Ware läuft nie mit ia (B31.7c).
 */
export function leiterPruefen(i: LeiterEingabe, e: LeiterEinstellungen, abverkauf: { DE: string; sonst: string }, liquidation: string, standard: string): LeiterVorschlag | null {
  const ueberTage = i.ueberSeit ? tageZwischen(i.ueberSeit, i.heute) : 0;
  const abv = abverkaufFuer(i.land, abverkauf);
  if (i.stufe === 1) {
    if (i.schnelldreher) return null;
    const g: string[] = [];
    if (i.gebraucht) g.push("gebrauchte Ware läuft nicht mit Neupreis-Marge (ia)");
    if (i.reichweite !== null && i.reichweite > e.reichweiteTage) g.push(i.reichweite >= 9999 ? "keine Verkäufe" : `Reichweite ${i.reichweite} Tage (> ${e.reichweiteTage})`);
    if (i.alterTage !== null && i.alterTage > e.alterTage12 && i.kapital !== null && i.kapital > e.kapital12) g.push(`Lagerdauer ${i.alterTage} Tage mit ${Math.round(i.kapital)} € Kapital`);
    if (i.ladenhueter) g.push("Hebel-Liste „Ladenhüter abverkaufen“");
    if (ueberTage >= e.ueberTage && i.bbQuote !== null && i.bbQuote < e.bbQuote12) g.push(`effektiver Min seit ${ueberTage} Tagen über der Buy Box, Buy-Box-Quote ${Math.round(i.bbQuote)} %`);
    if (!g.length) return null;
    // Liquidation als Brücke: nur, wenn die Buy Box unter dem effektiven Min der aktuellen Regel liegt.
    if (e.reihenfolge === "liquidation_zuerst" && i.buybox !== null && i.effMin !== null && i.buybox < i.effMin - 0.005) {
      const min = liquidationsMin({ breakEven: i.breakEven, buybox: i.buybox, deckel: i.effMin, abschlag: e.bbAbschlag });
      if (min !== null) return { von: 1, nach: 3, regel: liquidation, min, gruende: [...g, "Liquidation als kurze Brücke (Einstellung)"] };
    }
    return { von: 1, nach: 2, regel: abv, min: null, gruende: g };
  }
  if (i.stufe === 2) {
    if (!i.gebraucht && i.alterTage !== null && i.alterTage <= 30) return { von: 2, nach: 1, regel: standard, min: null, gruende: [`Lageralter ${i.alterTage} Tage (Nachschub eingebucht)`] };
    if (i.schnelldreher || i.buybox === null || i.effMin === null || i.buybox >= i.effMin - 0.005) return null;
    const noetig = i.gebraucht ? e.zustand.stillstandTage : e.ueberTage;
    if (ueberTage < noetig) return null;
    const kapOk = i.kapital !== null && i.kapital > e.kapital23;
    const altOk = i.alterTage !== null && i.alterTage > e.alterTage23;
    if (!i.gebraucht && !kapOk && !altOk) return null;
    const min = liquidationsMin({ breakEven: i.breakEven, buybox: i.buybox, deckel: i.effMinStufe2 ?? i.effMin, abschlag: e.bbAbschlag });
    if (min === null) return null;
    const g = [`effektiver Min der Stufe 2 seit ${ueberTage} Tagen über der Buy Box`];
    if (kapOk) g.push(`${Math.round(i.kapital!)} € Kapital`);
    if (altOk) g.push(`Lagerdauer ${i.alterTage} Tage`);
    if (i.gebraucht) g.push(`gebraucht, Stillstand ${ueberTage} Tage`);
    return { von: 2, nach: 3, regel: liquidation, min, gruende: g };
  }
  return null;
}

/** „Effektiver Min über Buy Box seit“ fortschreiben: darüber → Datum behalten/setzen, sonst löschen; ohne Buy Box bleibt es. */
export function ueberSeitFortschreiben(o: { effMin: number | null; buybox: number | null; ueberSeit: string | null; heute: string }): string | null {
  if (o.buybox === null || o.effMin === null) return o.ueberSeit;
  return o.effMin > o.buybox + 0.005 ? (o.ueberSeit ?? o.heute) : null;
}

// ---- B31.6a Dauer der Liquidation -------------------------------------------------------------------------------------

/** „Liquidation bis“: fester Termin (wenn später als der Start), sonst Start + Standarddauer. */
export function liquidationBis(start: string, e: Pick<LeiterEinstellungen, "liquidationTage" | "liquidationBisFest">): string {
  if (e.liquidationBisFest && e.liquidationBisFest > start) return e.liquidationBisFest;
  return plusTage(start, e.liquidationTage);
}

export type AblaufStand = "laeuft" | "bald" | "abgelaufen" | "dauerhaft" | "ohne";
export function ablaufStand(o: { bis: string | null; dauerhaft: boolean; heute: string; vorwarnTage: number }): { stand: AblaufStand; restTage: number | null } {
  if (o.dauerhaft) return { stand: "dauerhaft", restTage: null };
  if (!o.bis) return { stand: "ohne", restTage: null };
  const rest = tageZwischen(o.heute, o.bis);
  return { stand: rest < 0 ? "abgelaufen" : rest <= o.vorwarnTage ? "bald" : "laeuft", restTage: rest };
}

/** Frühere Rückkehr (B31.6a): Bestand 0, Margen-Min der Stufe 2 nicht mehr über der Buy Box, Buy Box 14 Tage darüber. */
export function fruehereRueckkehr(o: { bestand: number | null; effMinZiel: number | null; buybox: number | null; rueckkehr14: boolean; leiter?: boolean }): string | null {
  if (o.bestand !== null && o.bestand <= 0) return "Bestand 0 (FBA + Lager)";
  if (o.effMinZiel !== null && o.buybox !== null && o.effMinZiel <= o.buybox + 0.005) return o.leiter ? "effektiver Min der Stufe 2 liegt nicht mehr über der Buy Box" : "Margen-Min der Regel liegt nicht mehr über der Buy Box (Lageralter-Stufe weitergewandert)";
  if (o.rueckkehr14) return "Buy Box seit 14 Tagen über effektivem Min + 3 %";
  return null;
}

// ---- B31.8 Schnelldreher ------------------------------------------------------------------------------------------------

export function schnelldreherKandidat(o: { verkaeufe30: number | null; reichweite: number | null; alterTage: number | null; bbQuote: number | null }, e: LeiterEinstellungen["schnell"]): boolean {
  const viel = (o.verkaeufe30 !== null && o.verkaeufe30 >= e.verkaeufe30) || (o.reichweite !== null && o.reichweite <= e.reichweiteMax && o.reichweite > 0);
  return viel && o.alterTage !== null && o.alterTage <= e.alterMax && o.bbQuote !== null && o.bbQuote > e.bbQuoteMin;
}

/** Ende des Schutzes (Vorschlag): 21 Tage ohne Buy Box, < 5 Verkäufe in 30 Tagen, alt und langsam. */
export function schnelldreherEnde(o: { ohneBuyboxSeit: string | null; heute: string; verkaeufe30: number | null; alterTage: number | null; reichweite: number | null }, e: LeiterEinstellungen["schnell"]): string | null {
  if (o.ohneBuyboxSeit && tageZwischen(o.ohneBuyboxSeit, o.heute) >= e.ohneBuyboxTage) return `${tageZwischen(o.ohneBuyboxSeit, o.heute)} Tage ohne Buy Box`;
  if (o.verkaeufe30 !== null && o.verkaeufe30 < e.verkaeufeEnde) return `nur ${o.verkaeufe30} Verkäufe in 30 Tagen`;
  if (o.alterTage !== null && o.alterTage > e.alterEnde && o.reichweite !== null && o.reichweite > e.reichweiteEnde) return `Lageralter ${o.alterTage} Tage, Reichweite ${o.reichweite >= 9999 ? "ohne Verkäufe" : `${o.reichweite} Tage`}`;
  return null;
}

// ---- B31.7 Zustand ------------------------------------------------------------------------------------------------------

/** Zustandstext aus Amazon-Berichten, ArbitrageOne oder eigenen Feldern (englisch/deutsch, mit/ohne Leerzeichen). */
export function zustandAusText(t: string | null | undefined): Zustand | null {
  if (!t) return null;
  const s = t.toLowerCase().replace(/[_\-–]+/g, " ").replace(/\s+/g, " ").trim();
  if (/like ?new|wie ?neu/.test(s)) return "wie_neu";
  if (/very ?good|sehr ?gut/.test(s)) return "sehr_gut";
  if (/acceptable|akzeptabel/.test(s)) return "akzeptabel";
  if (/^(used|gebraucht)\s*(good|gut)$|\bused good\b|usedgood|gebraucht gut/.test(s)) return "gut";
  if (/^(neu|new|newitem|new item|11)$/.test(s)) return "neu";
  if (/open ?box|neu.*sonstig|new.*other|damaged packag|verpackung/.test(s)) return "neu_sonstige";
  if (/^(used|gebraucht|refurbished|collectible)/.test(s)) return "gebraucht";
  if (/^(1)$/.test(s)) return "wie_neu";
  if (/^(2)$/.test(s)) return "sehr_gut";
  if (/^(3)$/.test(s)) return "gut";
  if (/^(4)$/.test(s)) return "akzeptabel";
  return null;
}

/** Befund der Retouren-Station → Zustand (leer/falsches Produkt = nichts zu verkaufen → unbekannt mit Aufgabe). */
export function zustandAusBefund(befund: string | null | undefined): Zustand | null {
  if (!befund) return null;
  const b = befund.toLowerCase();
  if (b === "ok") return "wie_neu";
  if (b === "benutzt") return "gut";
  if (b === "beschaedigt" || b === "unvollstaendig") return "akzeptabel";
  if (b === "leer" || b === "falsches_produkt") return "unbekannt";
  if (/defekt|kaputt|unverkäuflich/.test(b)) return "unbekannt";
  if (/original ?verpackt|einwandfrei|in ordnung|versiegelt/.test(b)) return "wie_neu";
  if (/geöffnet|offen|ausgepackt/.test(b)) return "sehr_gut";
  if (/gebrauchsspur|kratzer/.test(b)) return "gut";
  return null;
}

/** Zustand je SKU in fester Reihenfolge: von Hand → SKU-Muster RET_/LPN (mit Grad aus AO/Amazon/Station) → Berichte → Einkauf → unbekannt. */
export function zustandBestimmen(o: { hand: Zustand | null; sku: string; arbitrageone: Zustand | null; amazon: Zustand | null; station: Zustand | null; einkaufNeu: boolean; retoureCharge: boolean }): { zustand: Zustand; quelle: ZustandQuelle } {
  if (o.hand) return { zustand: o.hand, quelle: "hand" };
  const retoure = /^RET_/i.test(o.sku.trim()) || /_LPN/i.test(o.sku) || o.retoureCharge;
  const grad = (z: Zustand | null) => (z && z !== "neu" ? z : null);
  if (retoure) {
    const g = grad(o.arbitrageone) ?? grad(o.amazon) ?? grad(o.station);
    if (g) return { zustand: g, quelle: o.arbitrageone && grad(o.arbitrageone) ? "arbitrageone" : o.amazon && grad(o.amazon) ? "amazon" : "retouren_station" };
    return { zustand: "gebraucht", quelle: "sku_muster" };
  }
  if (o.arbitrageone) return { zustand: o.arbitrageone, quelle: "arbitrageone" };
  if (o.amazon) return { zustand: o.amazon, quelle: "amazon" };
  if (o.station) return { zustand: o.station, quelle: "retouren_station" };
  if (o.einkaufNeu) return { zustand: "neu", quelle: "einkauf" };
  return { zustand: "unbekannt", quelle: "keine" };
}

export type KeepaGebraucht = { wie_neu: number | null; sehr_gut: number | null; gut: number | null; akzeptabel: number | null; buybox: number | null };

/** Zielpreis gebraucht: Keepa-Gebrauchtpreis des Grades, sonst Neupreis (Buy Box) × Faktor. */
export function zielpreisGebraucht(o: { zustand: Zustand; keepa: KeepaGebraucht | null; neuBuybox: number | null; faktoren: LeiterEinstellungen["zustand"]["faktoren"] }): { preis: number | null; quelle: string } {
  if (o.zustand === "unbekannt" || o.zustand === "neu") return { preis: null, quelle: "–" };
  const k = o.keepa;
  const grad = o.zustand === "wie_neu" || o.zustand === "neu_sonstige" ? k?.wie_neu : o.zustand === "sehr_gut" ? k?.sehr_gut : o.zustand === "gut" ? k?.gut : o.zustand === "akzeptabel" ? k?.akzeptabel : (k?.buybox ?? k?.gut);
  if (grad && grad > 0 && o.zustand !== "neu_sonstige") return { preis: r2(grad), quelle: "Keepa Gebrauchtpreis" };
  if (o.neuBuybox && o.neuBuybox > 0) {
    const f = o.faktoren[o.zustand as Exclude<Zustand, "unbekannt">] ?? o.faktoren.gebraucht;
    return { preis: r2(o.neuBuybox * f), quelle: `Neupreis × ${String(f).replace(".", ",")}` };
  }
  return { preis: null, quelle: "kein Neupreis" };
}

/** Netto-Vergleich Amazon gegen eBay für gebrauchte Ware unter dem Amazon-Break-even (Vorschlag „auf eBay verkaufen“). */
export function ebayVergleich(o: { preis: number; ust: number; provision: number; fba: number; ebayGebuehr: number; ebayVersand: number }): { amazon: number; ebay: number; besser: "ebay" | "amazon" } {
  const netto = o.preis / (1 + o.ust);
  const amazon = r2(netto - o.preis * o.provision - o.fba);
  const ebay = r2(netto - o.preis * (o.ebayGebuehr / 100) - o.ebayVersand);
  return { amazon, ebay, besser: ebay > amazon ? "ebay" : "amazon" };
}

export type LeiterStand = { am: string; stufe2: number; stufe3: number; unterBe: number; ueberfaellig: number; verlaengert: number; schnellUnterMin: number; schnellUnterMinTage: number; gebrauchtNeupreis: number; zustandUnbekannt: number; vorschlaege: number };

/** Morgenbericht-Zeilen des Leiter-Laufs (nur Inhaber). */
export function leiterMorgenZeilen(st: LeiterStand | null | undefined): string[] {
  if (!st) return [];
  const z: string[] = [];
  const stufen = stufenZeile(st);
  if (stufen) z.push(stufen);
  if (st.vorschlaege) z.push(`Regel-Leiter: ${st.vorschlaege} Vorschl${st.vorschlaege === 1 ? "ag" : "äge"} zur Freigabe`);
  if (st.ueberfaellig) z.push(`Liquidation überfällig: ${st.ueberfaellig} SKU${st.ueberfaellig === 1 ? "" : "s"}`);
  if (st.verlaengert) z.push(`Liquidation um ${LEITER_STANDARD.verlaengernTage} Tage verlängert: ${st.verlaengert} SKU${st.verlaengert === 1 ? "" : "s"} (Stufe 2 läge noch über der Buy Box)`);
  if (st.schnellUnterMin) z.push(`Schnelldreher unter Min: ${st.schnellUnterMin} SKU${st.schnellUnterMin === 1 ? "" : "s"}, Buy Box seit ${st.schnellUnterMinTage} Tag${st.schnellUnterMinTage === 1 ? "" : "en"} darunter`);
  if (st.gebrauchtNeupreis) z.push(`${st.gebrauchtNeupreis} gebrauchte SKU${st.gebrauchtNeupreis === 1 ? " wird" : "s werden"} mit Neupreis-Min geführt`);
  if (st.zustandUnbekannt) z.push(`Zustand prüfen: ${st.zustandUnbekannt} SKU${st.zustandUnbekannt === 1 ? "" : "s"} ohne Zustand (kein Upload)`);
  return z;
}

/** Morgenbericht-Zeile der Leiter: „Stufe 2: n SKUs, Stufe 3: m SKUs, davon k unter Break-even“. */
export function stufenZeile(z: { stufe2: number; stufe3: number; unterBe: number }): string | null {
  if (!z.stufe2 && !z.stufe3) return null;
  return `Stufe 2: ${z.stufe2} SKU${z.stufe2 === 1 ? "" : "s"}, Stufe 3: ${z.stufe3} SKU${z.stufe3 === 1 ? "" : "s"}, davon ${z.unterBe} unter Break-even`;
}
