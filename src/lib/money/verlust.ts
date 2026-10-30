// Verlust-Stopp – reine Logik: Welche Artikel verkaufen gerade mit Verlust? Auslöser: Gewinn aus dem Verkauf unter 0
// an 2 der letzten 3 abgeschlossenen Tage oder mindestens 5 Stück mit Verlust verkauft (in diesen 3 Tagen).
// Der Tagesgewinn wird zerlegt in a) Verkauf, b) Erstattungen/Rücksendungen, c) Abschreibung/Entfernung und
// d) Lager & Sonstiges – nur a) an Tagen mit verkauften Einheiten löst aus. b) geht an den Hebel „Viele Erstattungen“,
// c) an die Amazon-Fälle; Tage ohne Verkauf erscheinen getrennt als „Kosten ohne Verkauf“ ab einer Schwelle je Woche.

export const VERLUST_REGEL = { fenster: 3, tage: 2, stueck: 5 } as const;

export type TagWert = {
  day: string;
  sku: string;
  asin: string | null;
  name: string | null;
  units: number;
  netProfit: number | null;
  avgPrice: number | null;
  /** Erstattungskosten laut sellerboard (ProductRefunds, Betrag) – Rückfall, wenn kein Amazon-Transaktionsbericht da ist. */
  refundCost?: number | null;
};

/** Bestandteile aus dem Amazon-Transaktionsbericht je SKU und Tag (Beträge mit Vorzeichen, Kosten negativ). */
export type AmazonAnteile = { erstattungen: number; abschreibung: number; lager: number };

/** Zerlegung eines Tagesgewinns: a) Verkauf, b) Erstattungen/Rücksendungen, c) Abschreibung/Entfernung, d) Lager & Sonstiges. */
export type Zerlegung = { verkauf: number | null; erstattungen: number; abschreibung: number; lager: number };

/** Auf Cent runden, ohne „-0“. */
const r2z = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * Tagesgewinn zerlegen. Erstattungen aus dem Amazon-Bericht, sonst aus sellerboard (ProductRefunds); Abschreibung/
 * Entfernung und Lager nur aus dem Amazon-Bericht. Ohne Verkauf ist a) = 0 und der Rest steht unter d).
 */
export function zerlegeTag(t: { units: number; gewinn: number | null; refundCost?: number | null }, amz?: AmazonAnteile | null): Zerlegung {
  const erstattungen = r2z(amz && amz.erstattungen !== 0 ? amz.erstattungen : -Math.abs(t.refundCost ?? 0));
  const abschreibung = r2z(amz?.abschreibung ?? 0);
  const lager = r2z(amz?.lager ?? 0);
  if (t.gewinn === null) return { verkauf: null, erstattungen, abschreibung, lager };
  const rest = r2z(t.gewinn - erstattungen - abschreibung - lager);
  return t.units > 0 ? { verkauf: rest, erstattungen, abschreibung, lager } : { verkauf: 0, erstattungen, abschreibung, lager: r2z(lager + rest) };
}

export type TagZeile = { day: string; units: number; gewinn: number | null } & Zerlegung;

export type VerlustFall = {
  sku: string;
  asin: string | null;
  name: string | null;
  tage: TagZeile[];
  verlustTage: number;
  stueckMitVerlust: number;
  /** Gewinn im Fenster insgesamt und nur aus dem Verkauf (a). */
  summe: number;
  summeVerkauf: number;
  /** b) Erstattungen und c) Abschreibung/Entfernung im Fenster – lösen nicht aus, nur Hinweis. */
  erstattungen: number;
  abschreibung: number;
  /** Ø Verkaufspreis (brutto) im Fenster. */
  preis: number | null;
  grund: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const minusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Die letzten n abgeschlossenen Tage vor heute (ältester zuerst). */
export function fensterTage(heute: string, n: number = VERLUST_REGEL.fenster): string[] {
  return Array.from({ length: n }, (_, i) => minusTage(heute, n - i));
}

/**
 * Das Prüffenster: die letzten n Tage vor heute, für die es Tageswerte gibt (höchstens 7 Tage zurück). sellerboard
 * liefert manchmal einen Tag später – dann rutscht das Fenster mit, statt leer zu bleiben. Ohne Daten: Kalendertage.
 */
export function fensterMitDaten(werte: { day: string }[], heute: string, n: number = VERLUST_REGEL.fenster): string[] {
  const moeglich = new Set(fensterTage(heute, 7));
  const tage = [...new Set(werte.map((w) => w.day))].filter((d) => moeglich.has(d)).sort();
  return tage.length ? tage.slice(-n) : fensterTage(heute, n);
}

const anteilKey = (sku: string, day: string) => `${sku}|${day}`;

/** Je SKU (Kanäle zusammengezählt) prüfen, ob die Regel greift. „tage“: festes Fenster (sonst Tage mit Daten). */
export function pruefeVerlust(
  werte: TagWert[],
  heute: string,
  regel: { fenster: number; tage: number; stueck: number } = VERLUST_REGEL,
  festeTage?: string[],
  amazon: Map<string, AmazonAnteile> = new Map(),
): VerlustFall[] {
  const tage = festeTage ?? fensterMitDaten(werte, heute, regel.fenster);
  const imFenster = werte.filter((w) => tage.includes(w.day));
  const jeSku = new Map<string, TagWert[]>();
  for (const w of imFenster) jeSku.set(w.sku, [...(jeSku.get(w.sku) ?? []), w]);
  const out: VerlustFall[] = [];
  for (const [sku, rows] of jeSku) {
    const jeTag: TagZeile[] = tage.map((day) => {
      const r = rows.filter((x) => x.day === day);
      const units = r.reduce((n, x) => n + x.units, 0);
      const mitWert = r.filter((x) => x.netProfit !== null);
      const gewinn = mitWert.length ? r2(mitWert.reduce((n, x) => n + (x.netProfit ?? 0), 0)) : null;
      const refundCost = r.some((x) => x.refundCost !== null && x.refundCost !== undefined) ? r.reduce((n, x) => n + Math.abs(x.refundCost ?? 0), 0) : null;
      return { day, units, gewinn, ...zerlegeTag({ units, gewinn, refundCost }, amazon.get(anteilKey(sku, day))) };
    });
    // Nur der Verkauf (a) an Tagen mit verkauften Einheiten zählt.
    const verlust = jeTag.filter((t) => t.units > 0 && t.verkauf !== null && t.verkauf < 0);
    const verlustTage = verlust.length;
    const stueckMitVerlust = verlust.reduce((n, t) => n + t.units, 0);
    const summe = r2(jeTag.reduce((n, t) => n + (t.gewinn ?? 0), 0));
    const summeVerkauf = r2(jeTag.reduce((n, t) => n + (t.verkauf ?? 0), 0));
    const nachTagen = verlustTage >= regel.tage;
    const nachStueck = stueckMitVerlust >= regel.stueck;
    if (!nachTagen && !nachStueck) continue;
    const umsatz = rows.reduce((n, x) => n + (x.avgPrice ?? 0) * x.units, 0);
    const stueck = rows.filter((x) => x.avgPrice !== null).reduce((n, x) => n + x.units, 0);
    const erster = rows.find((x) => x.name) ?? rows[0];
    out.push({
      sku,
      asin: rows.find((x) => x.asin)?.asin ?? null,
      name: erster.name,
      tage: jeTag,
      verlustTage,
      stueckMitVerlust,
      summe,
      summeVerkauf,
      erstattungen: r2(jeTag.reduce((n, t) => n + t.erstattungen, 0)),
      abschreibung: r2(jeTag.reduce((n, t) => n + t.abschreibung, 0)),
      preis: stueck > 0 ? r2(umsatz / stueck) : null,
      grund: [nachTagen ? `${verlustTage} von ${regel.fenster} Tagen im Minus` : null, nachStueck ? `${stueckMitVerlust} Stück mit Verlust` : null].filter(Boolean).join(" · "),
    });
  }
  return out.sort((a, b) => a.summeVerkauf - b.summeVerkauf);
}

export type KostenOhneVerkauf = { sku: string; asin: string | null; name: string | null; summe: number; tage: { day: string; kosten: number }[] };

/**
 * Kosten ohne Verkauf: Tage mit 0 verkauften Einheiten und negativem Gewinn (Lagergebühren, Erstattungskosten …) in
 * den letzten 7 abgeschlossenen Tagen, je SKU summiert; nur ab `schwelle` € (Betrag) je Woche.
 */
export function kostenOhneVerkauf(werte: TagWert[], heute: string, schwelle: number): KostenOhneVerkauf[] {
  const tage = new Set(fensterTage(heute, 7));
  const jeSkuTag = new Map<string, Map<string, { units: number; gewinn: number; mitWert: boolean }>>();
  const info = new Map<string, { asin: string | null; name: string | null }>();
  for (const w of werte) {
    if (!tage.has(w.day)) continue;
    const m = jeSkuTag.get(w.sku) ?? new Map();
    const t = m.get(w.day) ?? { units: 0, gewinn: 0, mitWert: false };
    t.units += w.units;
    if (w.netProfit !== null) {
      t.gewinn += w.netProfit;
      t.mitWert = true;
    }
    m.set(w.day, t);
    jeSkuTag.set(w.sku, m);
    const i = info.get(w.sku) ?? { asin: null, name: null };
    info.set(w.sku, { asin: i.asin ?? w.asin, name: i.name ?? w.name });
  }
  const out: KostenOhneVerkauf[] = [];
  for (const [sku, m] of jeSkuTag) {
    const k = [...m.entries()].filter(([, t]) => t.units === 0 && t.mitWert && t.gewinn < 0).map(([day, t]) => ({ day, kosten: r2(t.gewinn) })).sort((a, b) => a.day.localeCompare(b.day));
    const summe = r2(k.reduce((n, x) => n + x.kosten, 0));
    if (k.length && -summe >= schwelle) out.push({ sku, ...info.get(sku)!, summe, tage: k });
  }
  return out.sort((a, b) => a.summe - b.summe);
}

export type NichtVerkauf = { sku: string; asin: string | null; name: string | null; erstattungen: number; abschreibung: number; lager: number; ziele: ("hebel_erstattungen" | "amazon_faelle")[] };

/**
 * b) Erstattungen/Rücksendungen und c) Abschreibung/Entfernung der letzten 7 Tage je SKU (an allen Tagen, auch mit
 * Verkauf) – lösen keinen Verlust-Stopp aus, sondern gehen an den Hebel „Viele Erstattungen“ bzw. an die Amazon-Fälle
 * (Entfernung/Entsorgung prüfen, ggf. Erstattung beantragen). Nur ab `schwelle` € (Betrag) je Bestandteil.
 */
export function nichtVerkaufAnteile(werte: TagWert[], heute: string, schwelle: number, amazon: Map<string, AmazonAnteile> = new Map()): NichtVerkauf[] {
  const tage = new Set(fensterTage(heute, 7));
  const jeSkuTag = new Map<string, Map<string, { units: number; gewinn: number | null; refundCost: number | null }>>();
  const info = new Map<string, { asin: string | null; name: string | null }>();
  for (const w of werte) {
    if (!tage.has(w.day)) continue;
    const m = jeSkuTag.get(w.sku) ?? new Map();
    const t = m.get(w.day) ?? { units: 0, gewinn: null, refundCost: null };
    t.units += w.units;
    if (w.netProfit !== null) t.gewinn = (t.gewinn ?? 0) + w.netProfit;
    if (w.refundCost !== null && w.refundCost !== undefined) t.refundCost = (t.refundCost ?? 0) + Math.abs(w.refundCost);
    m.set(w.day, t);
    jeSkuTag.set(w.sku, m);
    const i = info.get(w.sku) ?? { asin: null, name: null };
    info.set(w.sku, { asin: i.asin ?? w.asin, name: i.name ?? w.name });
  }
  // Amazon-Anteile auch für Tage ohne sellerboard-Zeile
  for (const k of amazon.keys()) {
    const [sku, day] = k.split("|");
    if (!tage.has(day)) continue;
    const m = jeSkuTag.get(sku) ?? new Map();
    if (!m.has(day)) m.set(day, { units: 0, gewinn: null, refundCost: null });
    jeSkuTag.set(sku, m);
    if (!info.has(sku)) info.set(sku, { asin: null, name: null });
  }
  const out: NichtVerkauf[] = [];
  for (const [sku, m] of jeSkuTag) {
    const z = [...m.entries()].map(([day, t]) => zerlegeTag(t, amazon.get(anteilKey(sku, day))));
    const erstattungen = r2(z.reduce((n, x) => n + x.erstattungen, 0));
    const abschreibung = r2(z.reduce((n, x) => n + x.abschreibung, 0));
    const lager = r2(z.reduce((n, x) => n + x.lager, 0));
    const ziele: NichtVerkauf["ziele"] = [];
    if (-erstattungen >= schwelle && erstattungen < 0) ziele.push("hebel_erstattungen");
    if (-abschreibung >= schwelle && abschreibung < 0) ziele.push("amazon_faelle");
    if (ziele.length) out.push({ sku, ...info.get(sku)!, erstattungen, abschreibung, lager, ziele });
  }
  return out.sort((a, b) => a.erstattungen + a.abschreibung - (b.erstattungen + b.abschreibung));
}

/** Amazon-Transaktion → Bestandteil (Erstattung, Abschreibung/Entfernung, Lager) oder null (Verkauf u. a.). */
export function anteilVonTransaktion(t: { kind: string; type: string | null; description: string | null }): keyof AmazonAnteile | null {
  const text = `${t.type ?? ""} ${t.description ?? ""}`;
  if (t.kind === "refund" || /^(refund|erstattung|rückerstattung)$/i.test(t.type ?? "")) return "erstattungen";
  if (/disposal|removal|entsorg|remission|rücksendung an (den )?verkäufer|liquidat|write.?off|abschreib|verlust.*lager|damaged|beschädigt/i.test(text)) return "abschreibung";
  if (/storage|lagergebühr|lagerung|lagerkosten|inventory fee/i.test(text)) return "lager";
  return null;
}

/** Summen je SKU und Tag aus Amazon-Transaktionen. */
export function amazonAnteile(rows: { date: string | null; sku: string | null; kind: string; type: string | null; description: string | null; total: number | null }[]): Map<string, AmazonAnteile> {
  const out = new Map<string, AmazonAnteile>();
  for (const r of rows) {
    if (!r.date || !r.sku || r.total === null) continue;
    const art = anteilVonTransaktion(r);
    if (!art) continue;
    const k = anteilKey(r.sku, r.date);
    const a = out.get(k) ?? { erstattungen: 0, abschreibung: 0, lager: 0 };
    a[art] = r2(a[art] + r.total);
    out.set(k, a);
  }
  return out;
}

/** BQool-Regel „Liquidation“/Abverkauf → bewusster Verlustverkauf, als Ausnahme vorschlagen. */
export const istLiquidation = (regel: string | null | undefined) => Boolean(regel && /liquidat|abverkauf|clearance|räumung/i.test(regel));

/** Gewinn einer SKU in den letzten 7 abgeschlossenen Tagen (für die Ausnahme-Liste). */
export function wochenSumme(werte: TagWert[], sku: string, heute: string): { summe: number; stueck: number; tageMitDaten: number } {
  const tage = new Set(fensterTage(heute, 7));
  const r = werte.filter((w) => w.sku === sku && tage.has(w.day));
  return { summe: r2(r.reduce((n, w) => n + (w.netProfit ?? 0), 0)), stueck: r.reduce((n, w) => n + w.units, 0), tageMitDaten: new Set(r.map((w) => w.day)).size };
}

/** Ausnahme gilt heute? (bis einschließlich; leer = unbefristet) */
export const ausnahmeAktiv = (a: { bis: string | null }, heute: string) => !a.bis || a.bis >= heute;

/** Aufgabentext: was tun, mit Break-even, Buy Box und Repricer-Regel. */
export function verlustAufgabe(
  f: VerlustFall,
  x: { breakEven: number | null; buybox: { preis: number | null; quelle: string; amazon?: boolean } | null; bqool: { regel: string | null; min: number | null; max: number | null; marktplatz: string } | null; bqoolExport?: boolean },
): { titel: string; notiz: string } {
  const e = (n: number) => n.toFixed(2).replace(".", ",") + " €";
  const zeilen = [
    `Auslöser: ${f.grund} – Gewinn aus dem Verkauf (${f.tage.map((t) => `${t.day.slice(8, 10)}.${t.day.slice(5, 7)}.: ${t.verkauf === null ? "–" : e(t.verkauf)}${t.units ? `, ${t.units} St.` : ""}`).join(" · ")}).`,
    f.erstattungen < 0 || f.abschreibung < 0 ? `Nicht mitgezählt: Erstattungen ${e(f.erstattungen)}, Abschreibung/Entfernung ${e(f.abschreibung)}.` : null,
    f.preis !== null ? `Ø Verkaufspreis ${e(f.preis)}.` : null,
    x.breakEven !== null ? `Break-even ${e(x.breakEven)}${f.preis !== null && f.preis < x.breakEven ? " – Preis liegt darunter" : ""}.` : "Break-even unbekannt (EK oder Gebühren fehlen).",
    x.buybox ? `Buy Box ${x.buybox.preis !== null ? e(x.buybox.preis) : "keine"}${x.buybox.amazon ? " (Amazon selbst)" : ""} laut ${x.buybox.quelle}.` : "Buy Box: keine Keepa-Daten.",
    x.bqool
      ? `BQool ${x.bqool.marktplatz}: Regel ${x.bqool.regel ?? "–"}, Min ${x.bqool.min !== null ? e(x.bqool.min) : "–"}, Max ${x.bqool.max !== null ? e(x.bqool.max) : "–"}${x.breakEven !== null && x.bqool.min !== null && x.bqool.min < x.breakEven ? " – Min liegt unter Break-even" : ""}.`
      : x.bqoolExport === false
        ? "BQool: noch kein Export hochgeladen – unter Amazon → Repricer (BQool) die Datei „Manage Listings“ je Land hochladen."
        : "BQool: SKU nicht im letzten Export.",
    istLiquidation(x.bqool?.regel) ? "BQool-Regel ist Liquidation/Abverkauf – vermutlich bewusst: auf der Seite Verlust-Stopp als Ausnahme übernehmen." : null,
    "Prüfen: Min-Preis im Repricer auf Break-even, Gebühren/EK richtig? Bewusster Abverkauf → als Ausnahme markieren.",
  ];
  return { titel: `Verlust-Stopp: ${f.name ?? f.sku} – ${f.grund}`.slice(0, 200), notiz: zeilen.filter(Boolean).join("\n") };
}
