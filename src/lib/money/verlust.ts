// Verlust-Stopp – reine Logik: Welche Artikel verkaufen gerade mit Verlust? Auslöser: Ist-Gewinn unter 0 an 2
// der letzten 3 abgeschlossenen Tage oder mindestens 5 Stück mit Verlust verkauft (in diesen 3 Tagen).
// Nur Tage mit verkauften Einheiten zählen: ein Minus ohne Verkauf (Lagergebühr, Erstattungskosten …) ist kein
// Verlustverkauf, sondern erscheint getrennt als „Kosten ohne Verkauf“ ab einer einstellbaren Schwelle je Woche.

export const VERLUST_REGEL = { fenster: 3, tage: 2, stueck: 5 } as const;

export type TagWert = { day: string; sku: string; asin: string | null; name: string | null; units: number; netProfit: number | null; avgPrice: number | null };

export type VerlustFall = {
  sku: string;
  asin: string | null;
  name: string | null;
  tage: { day: string; units: number; gewinn: number | null }[];
  verlustTage: number;
  stueckMitVerlust: number;
  summe: number;
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

/** Je SKU (Kanäle zusammengezählt) prüfen, ob die Regel greift. „tage“: festes Fenster (sonst Tage mit Daten). */
export function pruefeVerlust(werte: TagWert[], heute: string, regel: { fenster: number; tage: number; stueck: number } = VERLUST_REGEL, festeTage?: string[]): VerlustFall[] {
  const tage = festeTage ?? fensterMitDaten(werte, heute, regel.fenster);
  const imFenster = werte.filter((w) => tage.includes(w.day));
  const jeSku = new Map<string, TagWert[]>();
  for (const w of imFenster) jeSku.set(w.sku, [...(jeSku.get(w.sku) ?? []), w]);
  const out: VerlustFall[] = [];
  for (const [sku, rows] of jeSku) {
    const jeTag = tage.map((day) => {
      const r = rows.filter((x) => x.day === day);
      const units = r.reduce((n, x) => n + x.units, 0);
      const mitWert = r.filter((x) => x.netProfit !== null);
      return { day, units, gewinn: mitWert.length ? r2(mitWert.reduce((n, x) => n + (x.netProfit ?? 0), 0)) : null };
    });
    const verlust = jeTag.filter((t) => t.units > 0 && t.gewinn !== null && t.gewinn < 0);
    const verlustTage = verlust.length;
    const stueckMitVerlust = verlust.reduce((n, t) => n + t.units, 0);
    const summe = r2(jeTag.reduce((n, t) => n + (t.gewinn ?? 0), 0));
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
      preis: stueck > 0 ? r2(umsatz / stueck) : null,
      grund: [nachTagen ? `${verlustTage} von ${regel.fenster} Tagen im Minus` : null, nachStueck ? `${stueckMitVerlust} Stück mit Verlust` : null].filter(Boolean).join(" · "),
    });
  }
  return out.sort((a, b) => a.summe - b.summe);
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
    `Auslöser: ${f.grund} (${f.tage.map((t) => `${t.day.slice(8, 10)}.${t.day.slice(5, 7)}.: ${t.gewinn === null ? "–" : e(t.gewinn)}${t.units ? `, ${t.units} St.` : ""}`).join(" · ")}).`,
    f.preis !== null ? `Ø Verkaufspreis ${e(f.preis)}.` : null,
    x.breakEven !== null ? `Break-even ${e(x.breakEven)}${f.preis !== null && f.preis < x.breakEven ? " – Preis liegt darunter" : ""}.` : "Break-even unbekannt (EK oder Gebühren fehlen).",
    x.buybox ? `Buy Box ${x.buybox.preis !== null ? e(x.buybox.preis) : "keine"}${x.buybox.amazon ? " (Amazon selbst)" : ""} laut ${x.buybox.quelle}.` : "Buy Box: keine Keepa-Daten.",
    x.bqool
      ? `BQool ${x.bqool.marktplatz}: Regel ${x.bqool.regel ?? "–"}, Min ${x.bqool.min !== null ? e(x.bqool.min) : "–"}, Max ${x.bqool.max !== null ? e(x.bqool.max) : "–"}${x.breakEven !== null && x.bqool.min !== null && x.bqool.min < x.breakEven ? " – Min liegt unter Break-even" : ""}.`
      : x.bqoolExport === false
        ? "BQool: noch kein Export hochgeladen – unter Amazon → Repricer (BQool) die Datei „Manage Listings“ je Land hochladen."
        : "BQool: SKU nicht im letzten Export.",
    "Prüfen: Min-Preis im Repricer auf Break-even, Gebühren/EK richtig? Bewusster Abverkauf → als Ausnahme markieren.",
  ];
  return { titel: `Verlust-Stopp: ${f.name ?? f.sku} – ${f.grund}`.slice(0, 200), notiz: zeilen.filter(Boolean).join("\n") };
}
