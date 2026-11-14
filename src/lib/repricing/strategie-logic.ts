// Soll-Strategie je SKU und Land – unabhängig vom Repricer (seit der BQool-Ablösung: ProfitGuard). Reine Logik:
// Strategie je SKU/Land (Standard, Abverkauf, Liquidation, Schnelldreher). Der Soll-Min wird wie in ProfitGuard über
// die Mindestmarge je Altersstufe gerechnet (Break-even mit Marge, landeseigene USt und Gebühren des Landes) – nicht
// über einen festen Mindestgewinn in Euro –, damit Seller-System und ProfitGuard denselben Min haben. Höchstpreis =
// Min × Faktor bzw. Ziel-VK, Vergleich mit dem Ist im Repricer und Warnungen für die Freigabe-Seite.

export const EXPORT_LAENDER = ["DE", "FR", "IT", "ES"] as const;
export type ExportLand = (typeof EXPORT_LAENDER)[number];
export const UST: Record<ExportLand, number> = { DE: 0.19, FR: 0.2, IT: 0.22, ES: 0.21 };
export const istExportLand = (x: unknown): x is ExportLand => typeof x === "string" && (EXPORT_LAENDER as readonly string[]).includes(x);

const r2 = (n: number) => Math.round(n * 100) / 100;
const auf2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
/** Zahl mit zwei Nachkommastellen und Dezimalpunkt. */
export const zahl2 = (n: number) => n.toFixed(2);

// ---- Strategien -------------------------------------------------------------------------------------------------

/** Neutrale Soll-Strategien. Der Name im Repricer (ProfitGuard) wird in den Einstellungen je Strategie zugeordnet. */
export const STRATEGIEN = ["Standard", "Abverkauf", "Liquidation", "Schnelldreher"] as const;
export type Strategie = (typeof STRATEGIEN)[number];
export const STANDARD: Strategie = "Standard";
export const ABVERKAUF: Strategie = "Abverkauf";
export const LIQUIDATION: Strategie = "Liquidation";
export const SCHNELLDREHER: Strategie = "Schnelldreher";
export const istStrategie = (x: unknown): x is Strategie => typeof x === "string" && (STRATEGIEN as readonly string[]).includes(x);

/** Mindestmarge einer Altersstufe (Lagerdauer bis `bisTage`, null = darüber). */
export type MargeStufe = { bisTage: number | null; marge: number };

/** Altersbereich einer Stufe als Text: „0–30“, „31–60“, „> 365“. */
export function stufenBereich(stufen: MargeStufe[], i: number): string {
  const bis = stufen[i].bisTage;
  const von = i === 0 ? 0 : (stufen[i - 1].bisTage ?? 0) + 1;
  return bis === null ? `> ${von - 1}` : `${von}–${bis}`;
}

/** Marge einer Stufe als Text („10 %“). */
export const stufenText = (s: MargeStufe) => `${String(s.marge).replace(".", ",")} %`;

/** Staffel als Eingabetext und zurück: „30:10, 60:8, 90:7, :0“ (bis Tage : Marge in %). Weitere Angaben je Stufe werden ignoriert. */
export function staffelAlsText(stufen: MargeStufe[] | null | undefined): string {
  return (stufen ?? []).map((x) => `${x.bisTage ?? ""}:${x.marge}`).join(", ");
}

export function staffelAusText(text: string): MargeStufe[] | null {
  const teile = text.split(",").map((x) => x.trim()).filter(Boolean);
  if (!teile.length) return null;
  const stufen = teile.map((x) => {
    const [bis, rest = "0"] = x.replace(/\[[^\]]*\]/g, "").split(":").map((y) => y.trim());
    const marge = Number((rest.split(/\s+/)[0] ?? "0").replace(",", "."));
    return { bisTage: bis ? Number(bis) : null, marge: Number.isFinite(marge) ? marge : 0 };
  });
  return stufen.every((s) => s.bisTage === null || Number.isFinite(s.bisTage)) ? stufen : null;
}

/** Strategie „Standard“: Mindestmarge nach Lagerdauer 10/8/7/5/3/1/0 % (änderbar in den Einstellungen). */
export const MARGE_NACH_ALTER: MargeStufe[] = [
  { bisTage: 30, marge: 10 },
  { bisTage: 60, marge: 8 },
  { bisTage: 90, marge: 7 },
  { bisTage: 180, marge: 5 },
  { bisTage: 270, marge: 3 },
  { bisTage: 365, marge: 1 },
  { bisTage: null, marge: 0 },
];

/** Strategie „Abverkauf“: niedrigere Margen nach Lagerdauer (änderbar). */
export const ABVERKAUF_NACH_ALTER: MargeStufe[] = [
  { bisTage: 30, marge: 5 },
  { bisTage: 60, marge: 4 },
  { bisTage: 90, marge: 3 },
  { bisTage: 180, marge: 1 },
  { bisTage: null, marge: 0 },
];

export function stufeNachAlter(tage: number | null, stufen: MargeStufe[] = MARGE_NACH_ALTER): MargeStufe | null {
  const t = tage ?? 0;
  for (const s of stufen) if (s.bisTage === null || t <= s.bisTage) return s;
  return null;
}

export function margeNachAlter(tage: number | null, stufen: MargeStufe[] = MARGE_NACH_ALTER): number {
  return stufeNachAlter(tage, stufen)?.marge ?? 0;
}

/** Eine Strategie mit ihrer Logik (Margen-Staffel bzw. feste Untergrenze). */
export type KatalogRegel = {
  name: Strategie;
  /** Kurzbeschreibung für die Oberfläche. */
  strategie: string;
  /** Mindestmarge nach Lagerdauer; null = keine Margen-Staffel (Liquidation). */
  staffel: MargeStufe[] | null;
  /** Min je SKU und Land fest vorgegeben (Liquidation). */
  festeUntergrenze: boolean;
  hinweis: string;
};

/** Strategie-Katalog aus den Einstellungen (Staffeln für Standard/Abverkauf, Boden-Marge für Schnelldreher). */
export function strategieKatalog(o: { standard?: MargeStufe[] | null; abverkauf?: MargeStufe[] | null; schnellBoden?: number } = {}): KatalogRegel[] {
  const boden = o.schnellBoden ?? 7;
  return [
    { name: STANDARD, strategie: "Mindestmarge nach Lagerdauer", staffel: o.standard?.length ? o.standard : MARGE_NACH_ALTER, festeUntergrenze: false, hinweis: "Standard für neue Ware." },
    { name: ABVERKAUF, strategie: "niedrigere Mindestmarge nach Lagerdauer", staffel: o.abverkauf?.length ? o.abverkauf : ABVERKAUF_NACH_ALTER, festeUntergrenze: false, hinweis: "Stufe 2 der Regel-Leiter, gebrauchte Ware." },
    { name: LIQUIDATION, strategie: "fester Min je SKU und Land", staffel: null, festeUntergrenze: true, hinweis: "Stufe 3: Min fest, nie unter Break-even ohne Freigabe „Verlust akzeptiert bis x €“." },
    { name: SCHNELLDREHER, strategie: `alle Stufen ${boden} % Mindestmarge`, staffel: MARGE_NACH_ALTER.map((s) => ({ bisTage: s.bisTage, marge: boden })), festeUntergrenze: false, hinweis: "Schutz für Schnelldreher – kein Abverkauf, keine Liquidation." },
  ];
}
export const KATALOG_STANDARD: KatalogRegel[] = strategieKatalog();

/**
 * Neutrale Strategie zu einem (auch alten) Namen: „Liquidation“/„AI Win …“ → Liquidation, „Abverkauf …“ → Abverkauf,
 * „Schnell…“ (bzw. der eingestellte Schnelldreher-Name) → Schnelldreher, sonst Standard; leer → null.
 */
export function neutraleStrategie(name: string | null | undefined, schnellName?: string | null): Strategie | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  const exakt = STRATEGIEN.find((s) => s.toLowerCase() === n);
  if (exakt) return exakt;
  if (n.includes("liquidation") || n.startsWith("ai win")) return LIQUIDATION;
  if (n.startsWith("abverkauf")) return ABVERKAUF;
  if ((schnellName && n === schnellName.trim().toLowerCase()) || n.includes("schnell")) return SCHNELLDREHER;
  return STANDARD;
}

export const katalogRegel = (katalog: KatalogRegel[], name: string | null | undefined): KatalogRegel | null => {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  return katalog.find((k) => k.name.toLowerCase() === n) ?? null;
};

/** Name der Liquidations-Strategie. */
export function liquidationsName(_katalog?: KatalogRegel[]): Strategie {
  return LIQUIDATION;
}

// ---- Gebühren je Land und Provision ------------------------------------------------------------------------------

/** Provision mit Preisstufen (z. B. Beauty: bis 10 € 8 %, darüber 15 %); `bis` = Preis brutto inklusive. */
export type ProvisionStufe = { bis: number | null; satz: number };
export type Provision = number | ProvisionStufe[];
/** Bekannte Amazon-Preisstufen je Kategorie (erkannt an der Kategorie aus Gebührenvorschau bzw. Repricer-Liste). */
export type ProvisionStaffel = { name: string; erkennen: string[]; stufen: ProvisionStufe[] };
export const PROVISION_STAFFELN_STANDARD: ProvisionStaffel[] = [
  { name: "Beauty, Drogerie, Gesundheit, Lebensmittel", erkennen: ["beauty", "drugstore", "health", "personal care", "grocery", "drogerie", "kosmetik", "gesundheit", "lebensmittel"], stufen: [{ bis: 10, satz: 0.08 }, { bis: null, satz: 0.15 }] },
  { name: "Bekleidung", erkennen: ["apparel", "clothing", "bekleidung"], stufen: [{ bis: 15, satz: 0.05 }, { bis: 20, satz: 0.1 }, { bis: null, satz: 0.15 }] },
];

/** Provisionssatz aus Betrag/Preis: auf 0,5-%-Schritte, wenn höchstens 0,15 Prozentpunkte daneben (Cent-Rundung), sonst 4 Stellen. */
export function satzRunden(r: number): number {
  const stufe = Math.round(r * 200) / 200;
  return Math.abs(stufe - r) <= 0.0015 ? stufe : Math.round(r * 10000) / 10000;
}

export function satzBeiPreis(preis: number, provision: Provision): number {
  if (typeof provision === "number") return provision;
  for (const s of provision) if (s.bis === null || preis <= s.bis + 1e-9) return s.satz;
  return provision[provision.length - 1]?.satz ?? 0;
}

/**
 * Kleinster Preis mit Marge ≥ m für Kosten K (netto, ohne Provision): P = K / (1/(1+v) − r − m). Mit Preisstufen wird
 * je Stufe gerechnet und der kleinste Preis genommen, der in seiner Stufe liegt.
 */
function preisFuerMarge(k: number, ust: number, provision: Provision, m: number): number | null {
  const stufen = typeof provision === "number" ? [{ bis: null, satz: provision }] : provision;
  let unten = 0;
  for (const s of stufen) {
    const nenner = 1 / (1 + ust) - s.satz - m;
    const p = nenner > 0 ? k / nenner : null;
    if (p !== null) {
      if (p <= unten + 1e-9) return unten + 0.01;
      if (s.bis === null || p <= s.bis + 1e-9) return p;
    }
    unten = s.bis ?? unten;
  }
  return null;
}

/** Preisstufen einer Kategorie – nur, wenn der beobachtete Satz zum Preis der Beobachtung passt (sonst gilt er pauschal). */
export function provisionFuer(o: { satz: number; preis: number | null; kategorie: string | null; staffeln?: ProvisionStaffel[] }): Provision {
  const kat = (o.kategorie ?? "").toLowerCase();
  if (!kat) return o.satz;
  const st = (o.staffeln ?? PROVISION_STAFFELN_STANDARD).find((x) => x.erkennen.some((e) => kat.includes(e.toLowerCase())));
  if (!st) return o.satz;
  if (o.preis !== null && o.preis > 0 && Math.abs(satzBeiPreis(o.preis, st.stufen) - o.satz) > 0.0025) return o.satz;
  return st.stufen;
}

export type GebuehrenQuelle = "liste" | "amazon" | "produkt";
export type LandGebuehren = { fba: number; provision: Provision; satz: number; quelle: GebuehrenQuelle; geschaetzt: boolean; kategorie: string | null };
export type GebuehrenBeobachtung = { fba: number | null; satz: number | null; preis: number | null; kategorie: string | null };

/**
 * Gebühren je Land: Repricer-Liste (Gebührenspalten im Export) → Amazon-Gebührenvorschau des Landes → Werte am Produkt
 * (DE). Außerhalb DE ist der Produktwert nur eine Schätzung.
 */
export function gebuehrenFuerLand(o: { land: ExportLand; liste?: GebuehrenBeobachtung | null; amazon?: GebuehrenBeobachtung | null; produkt: { fba: number; satz: number; geschaetzt?: boolean }; staffeln?: ProvisionStaffel[] }): LandGebuehren {
  const kategorie = o.liste?.kategorie ?? o.amazon?.kategorie ?? null;
  const prov = (satz: number, preis: number | null) => provisionFuer({ satz, preis, kategorie, staffeln: o.staffeln });
  const quellen: [GebuehrenQuelle, GebuehrenBeobachtung | null | undefined][] = [["liste", o.liste], ["amazon", o.amazon]];
  const fbaQ = quellen.find(([, b]) => b?.fba !== null && b?.fba !== undefined);
  const satzQ = quellen.find(([, b]) => b?.satz !== null && b?.satz !== undefined);
  const fba = fbaQ ? fbaQ[1]!.fba! : o.produkt.fba;
  const satz = satzQ ? satzQ[1]!.satz! : o.produkt.satz;
  const quelle: GebuehrenQuelle = fbaQ?.[0] ?? satzQ?.[0] ?? "produkt";
  const geschaetzt = !fbaQ || !satzQ ? o.land !== "DE" || !!o.produkt.geschaetzt : false;
  return { fba, satz, provision: prov(satz, satzQ ? satzQ[1]!.preis : null), quelle, geschaetzt, kategorie };
}

// ---- Mindest- und Höchstpreis ------------------------------------------------------------------------------------

/**
 * Break-even-Mindestpreis brutto je Land (eigene Kosten): P = (FBA + Fixgebühr + EK netto + Zusatzkosten) /
 * (1/(1+USt) − Provision − Zielmarge). Aufgerundet auf den Cent. null, wenn Provision + Marge zu hoch sind.
 */
export function breakEvenMin(o: { ek: number; fba: number; fix: number; zusatz: number; ust: number; provision: Provision; margeProzent: number }): number | null {
  const p = preisFuerMarge(o.fba + o.fix + o.ek + o.zusatz, o.ust, o.provision, o.margeProzent / 100);
  return p === null ? null : auf2(p);
}

/**
 * Klassischer Seller-System-Mindestpreis je Land (EK + FBA-Gebühr + Mindestgewinn in €) / (1/(1+USt) − Provision) –
 * nur noch Vergleichswert (Bestandsliste); der Soll-Min fürs Repricing kommt aus der Marge je Altersstufe.
 */
export function systemMinMax(o: { ek: number; fba: number; satz: number; ust: number; minGewinn: number; maxFaktor: number; zielVk: number | null }): { min: number; max: number } | null {
  const divisor = 1 / (1 + o.ust) - o.satz;
  if (divisor <= 0) return null;
  const min = Math.ceil(((o.ek + o.fba + o.minGewinn) / divisor) * 100 - 1e-9) / 100;
  const max = r2(Math.max(min * o.maxFaktor, o.zielVk ?? 0));
  return { min, max: Math.max(max, min) };
}

/** Höchstpreis: Min × Faktor bzw. Ziel-VK (der größere Wert), nie unter Min. */
export function maxPreis(o: { min: number; faktor: number; zielVk: number | null }): number {
  return r2(Math.max(o.min * o.faktor, o.zielVk ?? 0, o.min));
}

/** Marge in % vom Brutto-Preis bei diesem Preis – Umkehrung von breakEvenMin (eine Nachkommastelle). */
export function margeBeiPreis(o: { preis: number; ek: number; fba: number; fix: number; zusatz: number; ust: number; provision: Provision }): number | null {
  if (!(o.preis > 0)) return null;
  const netto = o.preis * (1 / (1 + o.ust) - satzBeiPreis(o.preis, o.provision));
  return Math.round(((netto - (o.fba + o.fix + o.ek + o.zusatz)) / o.preis) * 1000) / 10;
}

export type EffMin = {
  min: number | null;
  marge: number | null;
  art: "untergrenze" | "marge" | "unbekannte_regel";
  stufe: MargeStufe | null;
};

/**
 * Effektiver Mindestpreis (Soll-Min) je SKU/Land einer Strategie – wie in ProfitGuard über die Marge je Altersstufe:
 * Break-even mit der Mindestmarge der Altersstufe (Marge vom Brutto-Preis). Liquidation = feste Untergrenze.
 * Unbekannte Strategie = Break-even (0 %). Kein Boden aus dem Mindestgewinn in Euro.
 */
export function effektiverMin(o: { regel: KatalogRegel | null; untergrenze: number | null; ek: number; fba: number; fix: number; zusatz: number; ust: number; provision: Provision; alterTage: number | null }): EffMin {
  const be = (marge: number) => breakEvenMin({ ek: o.ek, fba: o.fba, fix: o.fix, zusatz: o.zusatz, ust: o.ust, provision: o.provision, margeProzent: marge });
  if (o.regel?.festeUntergrenze) return { min: o.untergrenze, marge: null, art: "untergrenze", stufe: null };
  if (!o.regel?.staffel) return { min: be(0), marge: 0, art: "unbekannte_regel", stufe: null };
  const stufe = stufeNachAlter(o.alterTage, o.regel.staffel);
  const marge = stufe?.marge ?? 0;
  return { min: be(marge), marge, art: "marge", stufe };
}

// ---- Strategie je SKU und Land -----------------------------------------------------------------------------------

export type Zuweisung = { regel: string; untergrenze: number | null; quelle: "vorlage" | "hand" | "kapital" | "leiter" };
export type MarkenRegel = { marke: string; land: ExportLand | null; regel: string };

/** Marke als ganzes Wort im Titel (Produkte haben kein eigenes Markenfeld). */
export function titelHatMarke(titel: string | null, marke: string): boolean {
  const m = marke.trim();
  if (!titel || !m) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(titel);
}

/** Ausnahme trifft: ASIN genau (z. B. „B0…“) oder Marke/Produktname als Wort im Titel. */
export function ausnahmeTrifft(r: MarkenRegel, asin: string | null, titel: string | null): boolean {
  const m = r.marke.trim();
  return /^B0[A-Z0-9]{8}$/i.test(m) ? (asin ?? "").toUpperCase() === m.toUpperCase() : titelHatMarke(titel, m);
}

/**
 * Soll-Strategie je SKU und Land. Reihenfolge: feste Zuweisung (von Hand, Regel-Leiter, freigegebener Kapital-Vorschlag)
 * → Markenregel → Abverkaufs-Liste (Elektronik-Marken) → Standard. Der Repricer-Ist bestimmt die Soll-Strategie nicht
 * mehr (früher BQool-Ist); Liquidation entsteht nur über Zuweisung bzw. Regel-Leiter mit Freigabe.
 */
export function regelFuer(o: {
  land: ExportLand;
  titel: string | null;
  asin?: string | null;
  zuweisung: Zuweisung | null;
  markenRegeln: MarkenRegel[];
  aufAbverkaufsListe: boolean;
}): { regel: Strategie; quelle: "zuweisung" | "marke" | "abverkauf" | "standard"; untergrenze: number | null } {
  if (o.zuweisung) return { regel: neutraleStrategie(o.zuweisung.regel) ?? STANDARD, quelle: "zuweisung", untergrenze: o.zuweisung.untergrenze };
  const mr = o.markenRegeln.find((r) => (r.land === null || r.land === o.land) && ausnahmeTrifft(r, o.asin ?? null, o.titel));
  if (mr) return { regel: neutraleStrategie(mr.regel) ?? STANDARD, quelle: "marke", untergrenze: null };
  if (o.aufAbverkaufsListe) return { regel: ABVERKAUF, quelle: "abverkauf", untergrenze: null };
  return { regel: STANDARD, quelle: "standard", untergrenze: null };
}

// ---- Vergleich mit dem Ist und Warnungen -------------------------------------------------------------------------

/** Soll-Zeile je SKU und Land (Inhalt der Repricer-Datei). */
export type SollZeile = { land: ExportLand; sku: string; regel: Strategie; min: number; max: number; /** Im Repricing aktiv (nach Freigabe „aktivieren“ bzw. wie im Ist). */ aktiv: boolean };
export type IstStand = { regel: string | null; min: number | null; max: number | null };
export type Aenderung = { sku: string; art: "neu" | "geaendert" | "gleich"; regelWechsel: boolean; minAlt: number | null; minNeu: number; minDiff: number | null };

/** Vergleich mit dem Ist-Stand im Repricer bzw. dem letzten eigenen Export. Cent-genau. */
export function vergleiche(neu: SollZeile[], ist: Map<string, IstStand>): Aenderung[] {
  return neu.map((z) => {
    const a = ist.get(z.sku);
    if (!a) return { sku: z.sku, art: "neu", regelWechsel: false, minAlt: null, minNeu: z.min, minDiff: null };
    const regelWechsel = (a.regel ?? "").trim().toLowerCase() !== z.regel.trim().toLowerCase();
    const gleich = !regelWechsel && a.min !== null && Math.abs(a.min - z.min) < 0.005 && a.max !== null && Math.abs(a.max - z.max) < 0.005;
    return { sku: z.sku, art: gleich ? "gleich" : "geaendert", regelWechsel, minAlt: a.min, minNeu: z.min, minDiff: a.min !== null ? r2(z.min - a.min) : null };
  });
}

/** Warnungen je Zeile: Min über Buy Box × 1,2 (verliert die Buy Box), Min unter Break-even, Max unter Min. */
export function warnungen(z: Pick<SollZeile, "min" | "max">, o: { buybox: number | null; breakEven: number | null; bbFaktor?: number }): string[] {
  const w: string[] = [];
  const f = o.bbFaktor ?? 1.2;
  if (o.buybox !== null && o.buybox > 0 && z.min > o.buybox * f) w.push(`Min ${zahl2(z.min)} über Buy Box ${zahl2(o.buybox)} × ${String(f).replace(".", ",")} – verliert die Buy Box`);
  if (o.breakEven !== null && z.min < o.breakEven - 0.005) w.push(`Min ${zahl2(z.min)} unter Break-even ${zahl2(o.breakEven)}`);
  if (z.max < z.min) w.push("Max unter Min");
  return w;
}

/** Kapital-Ampel-Vorschlag: Rot und Reichweite über der Grenze → „Abverkauf“ (gilt erst nach Freigabe). */
export function abverkaufVorschlagen(k: { ampel: "gruen" | "gelb" | "rot"; reichweite: number | null } | null, rotReichweite: number): boolean {
  return !!k && k.ampel === "rot" && k.reichweite !== null && k.reichweite > rotReichweite;
}

// ---- Liquidation: Min unter Marge nur mit Freigabe -----------------------------------------------------------------

/** Buy Box so viel über dem effektiven Min der ursprünglichen Strategie … */
export const RUECKKEHR_AUFSCHLAG = 0.03;
/** … und so viele Tage am Stück → Vorschlag „zurück auf die ursprüngliche Strategie“. */
export const RUECKKEHR_TAGE = 14;

export type MinEntscheidung = {
  regel: Strategie;
  min: number | null;
  /** marge = Margen-Strategie, Min ≥ effektiver Min · liquidation_neu = wegen Min unter Marge auf Liquidation · liquidation = schon Liquidation · sonst = unbekannt. */
  art: "marge" | "liquidation_neu" | "liquidation" | "sonst";
  regelVorher: Strategie | null;
  /** Gewünschter Min lag unter Break-even und wurde ohne Freigabe auf Break-even angehoben. */
  angehoben: boolean;
  unterBreakEven: boolean;
  /** Min unter Break-even ist als „Abverkauf mit Verlust“ freigegeben (Verlust je Stück bis verlustBis). */
  verlustFreigegeben: boolean;
  /** Gewünschter Min unter dem effektiven Min, aber kein Strategiewechsel: Buy Box darüber bzw. unbekannt, oder Schnelldreher. */
  keinWechsel: null | "buybox_ueber" | "buybox_unbekannt" | "schnelldreher";
};

/**
 * Min und Strategie für die Datei:
 * 1. Gewünschter Min ≥ effektiver Min der Margen-Strategie → Strategie bleibt (ohne Wunsch: effektiver Min).
 * 2. Gewünschter Min < effektiver Min und Buy Box darunter → „Liquidation“, Min fest; Untergrenze Break-even (EK + FBA +
 *    Provision, ohne Mindestgewinn), darunter nur mit Freigabe „Verlust akzeptiert bis x €“ je Stück.
 * Strategie ist schon Liquidation → Min = gewünschter Min (Untergrenze), sonst Break-even; unter Break-even nur warnen.
 */
export function minEntscheidung(o: { regelName: Strategie; regel: KatalogRegel | null; gewuenscht: number | null; effMin: number | null; breakEven: number | null; verlustBis?: number | null; buybox?: number | null; boden?: number | null; schnelldreher?: boolean; laeuft?: boolean }): MinEntscheidung {
  const be = o.breakEven;
  const vb = o.verlustBis !== null && o.verlustBis !== undefined && o.verlustBis > 0 ? o.verlustBis : null;
  const unter = (m: number | null) => m !== null && be !== null && m < be - 0.005;
  const freigegeben = (m: number | null) => unter(m) && vb !== null && be !== null && m! >= r2(be - vb) - 0.005;
  const boden = o.boden ?? null;
  const mitBoden = (m: number | null) => (m !== null && boden !== null ? Math.max(m, boden) : m);
  const leer = { regelVorher: null, angehoben: false, keinWechsel: null } as const;
  if (o.regel?.festeUntergrenze) {
    const min = o.gewuenscht ?? (o.schnelldreher && boden !== null ? boden : be);
    return { ...leer, regel: o.regelName, min, art: "liquidation", unterBreakEven: unter(min), verlustFreigegeben: freigegeben(min) };
  }
  if (o.regel?.staffel) {
    const basis = o.effMin !== null ? (be !== null ? Math.max(o.effMin, be) : o.effMin) : be;
    if (o.gewuenscht !== null && o.effMin !== null && o.gewuenscht < o.effMin - 0.005) {
      const bb = o.buybox ?? null;
      const keinWechsel = o.schnelldreher ? "schnelldreher" : o.laeuft ? null : bb === null ? "buybox_unbekannt" : bb >= o.effMin - 0.005 ? "buybox_ueber" : null;
      if (!keinWechsel) {
        const unten = be === null ? null : vb !== null ? r2(be - vb) : be;
        const min = unten !== null ? Math.max(o.gewuenscht, unten) : o.gewuenscht;
        return { regel: LIQUIDATION, min: r2(min), art: "liquidation_neu", regelVorher: o.regelName, angehoben: unten !== null && o.gewuenscht < unten - 0.005, unterBreakEven: unter(min), verlustFreigegeben: freigegeben(min), keinWechsel: null };
      }
      return { ...leer, regel: o.regelName, min: mitBoden(basis), art: "marge", unterBreakEven: false, verlustFreigegeben: false, keinWechsel };
    }
    const min = o.gewuenscht !== null ? (basis !== null ? Math.max(o.gewuenscht, basis) : o.gewuenscht) : basis;
    return { ...leer, regel: o.regelName, min: mitBoden(min), art: "marge", unterBreakEven: false, verlustFreigegeben: false };
  }
  const min = mitBoden(o.gewuenscht ?? be);
  return { ...leer, regel: o.regelName, min, art: "sonst", unterBreakEven: unter(min), verlustFreigegeben: freigegeben(min) };
}

const tageSeit = (von: string, bis: string) => Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);

/**
 * Rückkehr nach Liquidation: Buy Box über effektivem Min der ursprünglichen Strategie + 3 %, 14 Tage am Stück →
 * Vorschlag. Ohne Buy Box heute bleibt der Zähler stehen, darunter fängt er neu an.
 */
export function rueckkehrStand(o: { buybox: number | null; effMinVorher: number | null; ueberSeit: string | null; heute: string; aufschlag?: number; tage?: number }): { ueberSeit: string | null; tage: number; vorschlagen: boolean; schwelle: number | null } {
  if (o.effMinVorher === null) return { ueberSeit: o.ueberSeit, tage: 0, vorschlagen: false, schwelle: null };
  const schwelle = r2(o.effMinVorher * (1 + (o.aufschlag ?? RUECKKEHR_AUFSCHLAG)));
  if (o.buybox === null) return { ueberSeit: o.ueberSeit, tage: o.ueberSeit ? tageSeit(o.ueberSeit, o.heute) : 0, vorschlagen: false, schwelle };
  if (o.buybox <= schwelle) return { ueberSeit: null, tage: 0, vorschlagen: false, schwelle };
  const seit = o.ueberSeit ?? o.heute;
  const tage = tageSeit(seit, o.heute);
  return { ueberSeit: seit, tage, vorschlagen: tage >= (o.tage ?? RUECKKEHR_TAGE), schwelle };
}

/** Zeile für Kapital-Ampel und Morgenbericht: „3 SKUs auf Liquidation (Min unter Marge), davon 1 unter Break-even“. */
export function liquidationsZeile(st: { anzahl: number; unterBreakEven: number }): string | null {
  if (!st.anzahl) return null;
  return `${st.anzahl} SKU${st.anzahl === 1 ? "" : "s"} auf Liquidation (Min unter Marge), davon ${st.unterBreakEven} unter Break-even`;
}
