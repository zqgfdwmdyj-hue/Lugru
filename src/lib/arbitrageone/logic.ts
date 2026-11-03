// ArbitrageOne-Anbindung (Bauauftrag Datei-Import, Ergänzung 01.11.) – reine Logik, getestet in
// tests/arbitrageone.test.ts: welche Exporte wann fällig sind, Erkennung der Export-Formate (Einkäufe, Lagerbestand,
// AccountOne COG) an den Spalten und der Vergleich der ArbitrageOne-BQool-Datei mit dem Soll des Seller-Systems.
//
// ArbitrageOne hat keine öffentliche API und keine Export-Links mit Token (geprüft 01.11.: Doku nennt nur den
// Download-Knopf unter app.arbitrageone.de/export) – deshalb holt die Browser-Automatik die Dateien ab.

import { parseAmount, parseDate } from "@/lib/numbers";

export type AoTakt = "taeglich" | "woechentlich" | "monatlich";
export type AoExportKey = "einkaeufe" | "lagerbestand" | "sellerboard" | "bqool" | "reimbursement" | "accountone";

export type AoExport = {
  key: AoExportKey;
  /** Name der Karte auf der Export-Seite (Standard; in der Anbindung änderbar). */
  titel: string;
  takt: AoTakt;
  /** Import-Art im Seller-System (Datei-Import, gleiche Verarbeitung wie der Upload). */
  art: string;
  taktText: string;
  nutzen: string;
};

/** Reihenfolge = Abruf-Reihenfolge: Einkäufe vor dem sellerboard-COG (Bauauftrag: „täglich nach Einkäufe“). */
export const AO_EXPORTE: AoExport[] = [
  { key: "einkaeufe", titel: "Einkäufe", takt: "taeglich", art: "ek_liste", taktText: "täglich 05:30", nutzen: "EK je SKU, Lugru „gekauft“, Monatsrahmen, Wareneinkauf in der Liquidität" },
  { key: "lagerbestand", titel: "Lagerbestand", takt: "taeglich", art: "ao_lagerbestand", taktText: "täglich 05:30", nutzen: "Bestandsabgleich eigenes Lager ↔ Wawi, Lagerwert" },
  { key: "sellerboard", titel: "Sellerboard", takt: "taeglich", art: "ek_liste", taktText: "täglich nach den Einkäufen", nutzen: "EK je SKU; auf Wunsch unverändert an sellerboard weitergereicht" },
  { key: "bqool", titel: "BQool", takt: "taeglich", art: "ao_bqool_vergleich", taktText: "täglich – nur Vergleich", nutzen: "Abweichung ArbitrageOne ↔ Seller-System (wird nie übernommen oder hochgeladen)" },
  { key: "reimbursement", titel: "Inventory Reimbursement", takt: "woechentlich", art: "amazon_reimbursements", taktText: "wöchentlich montags", nutzen: "Erstattungs-Abgleich, Ansprüche" },
  { key: "accountone", titel: "AccountOne COG (NEU)", takt: "monatlich", art: "ao_accountone_cog", taktText: "monatlich am 1.", nutzen: "Monatsdatei für den Steuerberater (Stotax-Belegübergabe)" },
];

export const AO_UHRZEIT = "05:30";

const BERLIN = "Europe/Berlin";
const tagBerlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: BERLIN }).format(d);
const wochentagBerlin = (d: Date) => ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"].indexOf(new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, weekday: "short" }).format(d).slice(0, 2));

/** Montag der Woche (Berlin) als Tag „JJJJ-MM-TT“. */
export function wochenMontag(jetzt: Date): string {
  const tag = tagBerlin(jetzt);
  const wt = wochentagBerlin(jetzt); // 0 = So
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((wt + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Ist ein Export fällig? Täglich: heute (Berlin) noch nicht erfolgreich geholt. Wöchentlich: seit Montag nicht.
 * Monatlich: seit dem 1. nicht. Fehlgeschlagene Läufe holen am nächsten Tag nach (es zählt nur der Erfolg).
 */
export function exportFaellig(takt: AoTakt, letzterErfolg: Date | null, jetzt = new Date()): boolean {
  const heute = tagBerlin(jetzt);
  // B27.2: Zeitplan „wöchentlich montags“ – nur montags (vorher holte ein nie geglückter Export jeden Tag nach);
  // „monatlich am 1.“ – am 1., bei Fehlschlag bis zum 7. nachholen.
  if (takt === "woechentlich" && wochentagBerlin(jetzt) !== 1) return false;
  if (takt === "monatlich" && Number(heute.slice(8, 10)) > 7) return false;
  if (!letzterErfolg) return true;
  const zuletzt = tagBerlin(letzterErfolg);
  if (takt === "taeglich") return zuletzt < heute;
  if (takt === "woechentlich") return zuletzt < wochenMontag(jetzt);
  return zuletzt < `${heute.slice(0, 7)}-01`;
}

/** Fällige Exporte in Abruf-Reihenfolge; `nur` = einzelne Exporte (Knopf „Jetzt abholen“ bzw. Test). */
export function faelligeExporte(letzte: Partial<Record<AoExportKey, Date | null>>, jetzt = new Date(), o: { alle?: boolean; nur?: AoExportKey[] } = {}): AoExport[] {
  return AO_EXPORTE.filter((e) => (o.nur ? o.nur.includes(e.key) : o.alle || exportFaellig(e.takt, letzte[e.key] ?? null, jetzt)));
}

/** Monat der AccountOne-COG-Datei: am 1. geholt = Stand Ende des Vormonats. */
export function accountoneMonat(jetzt = new Date()): string {
  const tag = tagBerlin(jetzt);
  const [j, m] = tag.split("-").map(Number);
  return m === 1 ? `${j - 1}-12` : `${j}-${String(m - 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------
// Formate an den Spalten erkennen (Dateiname zählt nicht – Exporte heißen je nach Download anders).

export const normSpalte = (h: unknown) =>
  String(h ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SP = {
  asin: ["asin", "amazon asin", "asin de"],
  sku: ["seller sku", "sku", "msku", "haendler sku", "merchant sku"],
  datum: ["kaufdatum", "einkaufsdatum", "bestelldatum", "kauf datum", "einkauf datum", "purchase date", "order date", "po date", "purchase order date", "bestellt am", "gekauft am", "eingekauft am", "einkauf am", "date of purchase", "datum der bestellung", "datum", "date"],
  menge: ["menge eingekauft", "menge", "anzahl", "stueck", "stk", "einkaufsmenge", "gekaufte menge", "bestellmenge", "bestellte menge", "menge bestellt", "stueckzahl", "einheiten", "quantity", "qty", "units", "ordered quantity", "quantity ordered", "qty ordered", "units ordered", "purchased quantity", "purchase quantity"],
  ek: ["ek netto mit vsk", "ek netto", "ek netto standard", "ek netto euro", "ek netto pro stueck", "ek pro stueck", "ek pro einheit", "ek preis", "einkaufspreis netto", "einkaufspreis pro stueck", "netto ek", "stueckpreis netto", "einzelpreis netto", "netto einzelpreis", "preis netto", "einkaufspreis", "einzelpreis", "stueckpreis", "ek", "unit cost", "unit price", "unit price net", "price per unit", "cost per unit", "purchase price", "buy price", "buy cost", "cost", "cog"],
  lieferant: ["lieferant", "lieferant name", "shop", "shop name", "haendler", "supplier", "vendor", "bezugsquelle", "quelle", "verkaeufer", "store", "source"],
  rechnung: ["rechnungsnummer", "rechnungs nr", "rechnung nr", "rechnung", "bestellnummer", "bestell nr", "auftragsnummer", "order id", "order number", "po number", "purchase order number", "purchase order", "invoice", "invoice number", "belegnummer"],
  titel: ["produktname", "titel", "produkt", "artikelname", "artikel", "product name", "title", "name"],
  waehrung: ["waehrung", "currency"],
  bestand: ["lagerbestand", "bestand", "bestand stichtag", "bestand gesamt", "gesamtbestand", "physischer bestand", "menge auf lager", "anzahl auf lager", "auf lager", "stueck auf lager", "lagermenge", "verfuegbare menge", "verfuegbarer bestand", "verfuegbar", "stock", "in stock", "on hand", "quantity on hand", "quantity in stock", "available", "inventory"],
  wert: ["lagerwert", "bestandswert", "warenwert", "gesamtwert", "wert", "value", "stock value", "inventory value"],
  lagerort: ["lagerort", "lager", "standort", "warehouse", "lagerplatz"],
  stichtag: ["stichtag", "stand", "datum stichtag"],
} as const;

/** Index der ersten passenden Spalte (genau, sonst „beginnt mit“). */
function spalte(kopf: string[], namen: readonly string[]): number {
  for (const n of namen) {
    const i = kopf.indexOf(n);
    if (i > -1) return i;
  }
  for (const n of namen) {
    if (n.length < 4) continue;
    const i = kopf.findIndex((k) => k.startsWith(`${n} `));
    if (i > -1) return i;
  }
  return -1;
}

export type AoFormat = "einkaeufe" | "lagerbestand" | "accountone" | "sellerboard";

/**
 * B27.1: Zeile mit den Spaltennamen suchen – Exporte haben oft Titel-, Datums- oder Leerzeilen davor. Geprüft werden
 * die ersten 25 Zeilen; ohne Treffer bleibt es bei Zeile 1 (wie bisher).
 */
export function kopfzeile(table: unknown[][], passt: (zeile: unknown[]) => boolean): number {
  for (let i = 0; i < Math.min(25, table.length); i++) if (passt(table[i] ?? [])) return i;
  return 0;
}

/** Tabelle ab der Kopfzeile (Zeilen davor weg). */
export const abKopfzeile = (table: unknown[][], passt: (zeile: unknown[]) => boolean): unknown[][] => {
  const i = kopfzeile(table, passt);
  return i ? table.slice(i) : table;
};

/** Spaltennamen der wahrscheinlichen Kopfzeile (für Fehlermeldungen; nur Namen, keine Werte). */
export function spaltenNamen(table: unknown[][]): string[] {
  const i = kopfzeile(table, (z) => z.filter((x) => typeof x === "string" && x.trim() && !/^[\d.,\s€%-]+$/.test(x)).length >= 3);
  return (table[i] ?? []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 30);
}

/** Welches ArbitrageOne-Format, auch wenn die Spaltennamen nicht in Zeile 1 stehen? Dazu die Tabelle ab der Kopfzeile. */
export function aoFormatSuchen(table: unknown[][]): { format: AoFormat; tabelle: unknown[][] } | null {
  for (let i = 0; i < Math.min(25, table.length); i++) {
    const f = aoFormat(table[i] ?? []);
    if (f) return { format: f, tabelle: i ? table.slice(i) : table };
  }
  return null;
}

/** Spalten für Einkäufe (ASIN + Datum + Menge) bzw. Lagerbestand (ASIN/SKU + Bestand oder Menge) vorhanden? */
export const hatEinkaufSpalten = (zeile: unknown[]) => {
  const k = zeile.map(normSpalte);
  return spalte(k, SP.asin) > -1 && spalte(k, SP.datum) > -1 && spalte(k, SP.menge) > -1;
};
export const hatBestandSpalten = (zeile: unknown[]) => {
  const k = zeile.map(normSpalte);
  return (spalte(k, SP.asin) > -1 || spalte(k, SP.sku) > -1) && (spalte(k, SP.bestand) > -1 || spalte(k, SP.menge) > -1);
};

/** Welches ArbitrageOne-Format? null = keines davon. */
export function aoFormat(headers: unknown[]): AoFormat | null {
  const k = headers.map(normSpalte);
  if (k.includes("marketplace article nr") || (k.includes("article nr") && k.some((x) => x.startsWith("ek netto")))) return "accountone";
  const asin = spalte(k, SP.asin) > -1;
  const sku = spalte(k, SP.sku) > -1;
  const bestand = spalte(k, SP.bestand) > -1;
  const datum = spalte(k, ["kaufdatum", "einkaufsdatum", "bestelldatum", "kauf datum", "einkauf datum", "purchase date", "order date"]) > -1;
  const ek = spalte(k, SP.ek) > -1;
  const wert = spalte(k, SP.wert) > -1 || spalte(k, SP.stichtag) > -1;
  if (asin && bestand && !datum && (ek || wert)) return "lagerbestand";
  if (asin && (datum || spalte(k, ["datum", "date"]) > -1) && spalte(k, SP.menge) > -1 && ek) return "einkaeufe";
  if (k.length <= 4 && asin && sku && k.includes("cost")) return "sellerboard";
  return null;
}

const str = (v: unknown) => String(v ?? "").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;

export type AoEinkauf = { asin: string; sku: string | null; titel: string | null; kaufdatum: string; menge: number; ekNetto: number | null; waehrung: string | null; lieferant: string | null; rechnung: string | null };

/** Einkäufe (auch die eigene Vorlage mit Kaufdatum + Menge): je Zeile ein Einkauf. Ohne ASIN, Datum oder Menge → übersprungen. */
export function einkaeufeAus(roh: unknown[][]): { zeilen: AoEinkauf[]; uebersprungen: number } {
  const table = abKopfzeile(roh, hatEinkaufSpalten);
  if (!table.length) return { zeilen: [], uebersprungen: 0 };
  const k = table[0].map(normSpalte);
  const c = { asin: spalte(k, SP.asin), sku: spalte(k, SP.sku), datum: spalte(k, SP.datum), menge: spalte(k, SP.menge), ek: spalte(k, SP.ek), lieferant: spalte(k, SP.lieferant), rechnung: spalte(k, SP.rechnung), titel: spalte(k, SP.titel), waehrung: spalte(k, SP.waehrung) };
  if (c.asin < 0 || c.datum < 0 || c.menge < 0) return { zeilen: [], uebersprungen: Math.max(0, table.length - 1) };
  const get = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
  const zeilen: AoEinkauf[] = [];
  let uebersprungen = 0;
  for (const r of table.slice(1)) {
    const asin = str(get(r, c.asin)).toUpperCase();
    const kaufdatum = parseDate(get(r, c.datum));
    const menge = parseAmount(get(r, c.menge));
    if (!asin && !kaufdatum && menge === null) continue; // Leerzeile
    if (!/^[A-Z0-9]{10}$/.test(asin) || !kaufdatum || menge === null || menge <= 0) {
      uebersprungen++;
      continue;
    }
    const ek = parseAmount(get(r, c.ek));
    zeilen.push({ asin, sku: str(get(r, c.sku)) || null, titel: str(get(r, c.titel)).slice(0, 300) || null, kaufdatum, menge: Math.round(menge), ekNetto: ek === null ? null : r2(ek), waehrung: str(get(r, c.waehrung)).toUpperCase() || null, lieferant: str(get(r, c.lieferant)).slice(0, 120) || null, rechnung: str(get(r, c.rechnung)).slice(0, 120) || null });
  }
  return { zeilen, uebersprungen };
}

/** Schlüssel einer Einkaufszeile – dieselbe Zeile aus einer zweiten Datei wird übersprungen. */
export function einkaufSchluessel(e: AoEinkauf): string {
  return [e.asin, e.sku ?? "", e.kaufdatum, e.menge, e.ekNetto ?? "", (e.lieferant ?? "").toLowerCase(), (e.rechnung ?? "").toLowerCase()].join("|");
}

export type AoBestand = { sku: string | null; asin: string | null; titel: string | null; menge: number; ekNetto: number | null; wert: number | null; lagerort: string | null };

/** Stichtag aus Spalte, Dateiname (TT.MM.JJJJ / JJJJ-MM-TT) oder heute. */
export function stichtagAus(dateiname: string, spaltenWert: unknown, heute: string): string {
  const s = parseDate(spaltenWert);
  if (s) return s;
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(dateiname) ?? null;
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(dateiname);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : heute;
}

export function lagerbestandAus(roh: unknown[][], dateiname: string, heute: string): { stichtag: string; zeilen: AoBestand[]; uebersprungen: number } {
  const table = abKopfzeile(roh, hatBestandSpalten);
  if (!table.length) return { stichtag: heute, zeilen: [], uebersprungen: 0 };
  const k = table[0].map(normSpalte);
  // Bestand: eigene Spalte, sonst „Menge“ (Lagerbestand je Einkauf/Charge).
  const bestand = spalte(k, SP.bestand);
  const c = { asin: spalte(k, SP.asin), sku: spalte(k, SP.sku), titel: spalte(k, SP.titel), menge: bestand > -1 ? bestand : spalte(k, SP.menge), ek: spalte(k, SP.ek), wert: spalte(k, SP.wert), lagerort: spalte(k, SP.lagerort), stichtag: spalte(k, SP.stichtag) };
  const get = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
  const body = table.slice(1);
  const stichtag = stichtagAus(dateiname, body.length ? get(body[0], c.stichtag) : undefined, heute);
  const zeilen: AoBestand[] = [];
  let uebersprungen = 0;
  const je = new Map<string, AoBestand>();
  for (const r of body) {
    const asin = str(get(r, c.asin)).toUpperCase() || null;
    const sku = str(get(r, c.sku)) || null;
    const menge = parseAmount(get(r, c.menge));
    if (!asin && !sku && menge === null) continue;
    if ((!asin && !sku) || menge === null) {
      uebersprungen++;
      continue;
    }
    const ek = parseAmount(get(r, c.ek));
    const wertSpalte = parseAmount(get(r, c.wert));
    // Wert der Zeile: Spalte „Lagerwert“, sonst EK × Menge.
    const wert = wertSpalte !== null ? r2(wertSpalte) : ek !== null ? r2(ek * menge) : null;
    const lagerort = str(get(r, c.lagerort)).slice(0, 120) || null;
    // Gleiche SKU/ASIN am gleichen Lagerort mehrfach: Mengen und Werte addieren.
    const schluessel = `${sku ?? asin}|${lagerort ?? ""}`;
    const vorher = je.get(schluessel);
    if (vorher) {
      vorher.menge += Math.round(menge);
      vorher.wert = vorher.wert !== null || wert !== null ? r2((vorher.wert ?? 0) + (wert ?? 0)) : null;
      continue;
    }
    const z: AoBestand = { sku, asin, titel: str(get(r, c.titel)).slice(0, 300) || null, menge: Math.round(menge), ekNetto: ek === null ? null : r2(ek), wert, lagerort };
    je.set(schluessel, z);
    zeilen.push(z);
  }
  return { stichtag, zeilen, uebersprungen };
}

export type AoCog = { asin: string; sku: string; ekNetto: number | null };

/** AccountOne COG (alt: marketplace_article_nr | article_nr | ek_netto_euro; NEU mit zusätzlichen Spalten). */
export function accountoneAus(table: unknown[][]): { zeilen: AoCog[]; spalten: string[] } {
  if (!table.length) return { zeilen: [], spalten: [] };
  const k = table[0].map(normSpalte);
  const asin = spalte(k, ["marketplace article nr", "asin"]);
  const sku = spalte(k, ["article nr", "sku", "seller sku"]);
  const ek = spalte(k, ["ek netto euro", "ek netto", "cog", "cost"]);
  const zeilen: AoCog[] = [];
  for (const r of table.slice(1)) {
    const s = str(r[sku]);
    if (!s) continue;
    const e = ek >= 0 ? parseAmount(r[ek]) : null;
    zeilen.push({ asin: str(r[asin]).toUpperCase(), sku: s, ekNetto: e === null ? null : r2(e) });
  }
  return { zeilen, spalten: table[0].map((x) => str(x)) };
}

// ---------------------------------------------------------------------------------------------------------
// BQool-Datei aus ArbitrageOne: nur Vergleich mit dem Soll des Seller-Systems – nie übernehmen, nie hochladen
// (zwei Quellen würden sich widersprechen).

export type BqVergleichZeile = { sku: string; regel: string | null; min: number | null; max: number | null };
export type BqAbweichung = { sku: string; art: "nur_arbitrageone" | "nur_system" | "regel" | "min" | "max"; arbitrageone: string; system: string };

const geld = (n: number | null) => (n === null ? "–" : n.toFixed(2));

export function bqoolVergleich(ao: BqVergleichZeile[], soll: BqVergleichZeile[]): { abweichend: number; jeArt: Record<BqAbweichung["art"], number>; beispiele: BqAbweichung[]; aoSkus: number; systemSkus: number } {
  const a = new Map(ao.map((z) => [z.sku, z]));
  const s = new Map(soll.map((z) => [z.sku, z]));
  const liste: BqAbweichung[] = [];
  for (const [sku, x] of a) {
    const y = s.get(sku);
    if (!y) {
      liste.push({ sku, art: "nur_arbitrageone", arbitrageone: `${x.regel ?? "–"} ${geld(x.min)}–${geld(x.max)}`, system: "nicht im Soll" });
      continue;
    }
    if ((x.regel ?? "").trim().toLowerCase() !== (y.regel ?? "").trim().toLowerCase()) liste.push({ sku, art: "regel", arbitrageone: x.regel ?? "–", system: y.regel ?? "–" });
    else if (x.min !== null && y.min !== null && Math.abs(x.min - y.min) >= 0.01) liste.push({ sku, art: "min", arbitrageone: geld(x.min), system: geld(y.min) });
    else if (x.max !== null && y.max !== null && Math.abs(x.max - y.max) >= 0.01) liste.push({ sku, art: "max", arbitrageone: geld(x.max), system: geld(y.max) });
  }
  for (const [sku, y] of s) if (!a.has(sku)) liste.push({ sku, art: "nur_system", arbitrageone: "nicht in der Datei", system: `${y.regel ?? "–"} ${geld(y.min)}–${geld(y.max)}` });
  const jeArt = { nur_arbitrageone: 0, nur_system: 0, regel: 0, min: 0, max: 0 } as Record<BqAbweichung["art"], number>;
  for (const x of liste) jeArt[x.art]++;
  return { abweichend: new Set(liste.map((x) => x.sku)).size, jeArt, beispiele: liste.slice(0, 25), aoSkus: a.size, systemSkus: s.size };
}

/** „Abweichung ArbitrageOne ↔ Seller-System: 35 SKUs (12 andere Regel, 20 Min, 3 nur in ArbitrageOne)“ */
export function bqoolVergleichText(v: { abweichend: number; jeArt: Record<BqAbweichung["art"], number> }): string {
  if (!v.abweichend) return "Keine Abweichung ArbitrageOne ↔ Seller-System.";
  const teile = [
    v.jeArt.regel && `${v.jeArt.regel} andere Regel`,
    v.jeArt.min && `${v.jeArt.min} anderer Min-Preis`,
    v.jeArt.max && `${v.jeArt.max} anderer Max-Preis`,
    v.jeArt.nur_arbitrageone && `${v.jeArt.nur_arbitrageone} nur in ArbitrageOne`,
    v.jeArt.nur_system && `${v.jeArt.nur_system} nur im Seller-System`,
  ].filter(Boolean);
  return `Abweichung ArbitrageOne ↔ Seller-System: ${v.abweichend} SKU${v.abweichend === 1 ? "" : "s"} (${teile.join(", ")}).`;
}

/** Zusammenfassung eines Abruf-Laufs für Anbindungen und Aufgabe. */
export type AoExportErgebnis = {
  key: AoExportKey;
  titel: string;
  ok: boolean;
  datei?: string;
  importId?: string;
  /** Kurztext (eine Zeile, ohne Browser-Protokoll). */
  text: string;
  /** B27.2: bei Fehlern Bildschirmfoto (/import/debug/…), Seite (ohne Abfrageteil) und Seitentitel. */
  bild?: string;
  seite?: string;
  seitentitel?: string;
  /** B27.6: Rohmeldung (nur im Detail). */
  roh?: string;
};

/**
 * B27.6: Fehlermeldung für die Übersicht kürzen – erste Zeile, ohne Playwright-Protokoll („=== logs ===“,
 * „Call log:“, Trennlinien); Zeitüberschreitungen als „keine Datei nach x s“.
 */
export function kurzFehler(roh: string): string {
  const erste = roh.split(/\n|={3,}|Call log:/)[0].replace(/^(page|locator|download)\.[a-zA-Z]+:\s*/, "").trim();
  const t = /Timeout (\d+)ms exceeded/i.exec(erste);
  if (t) {
    const sek = Math.round(Number(t[1]) / 1000);
    return /waitForEvent\("download"\)|download/i.test(roh) ? `keine Datei nach ${sek} s` : `Zeitüberschreitung nach ${sek} s`;
  }
  return erste.slice(0, 200) || "Fehler";
}

/** B27.6: je Export eine Zeile „Name · Status (ok/übersprungen/Fehler) · Kurztext · Bildschirmfoto“. */
export function laufZeilen(e: { titel: string; ok: boolean; text: string; bild?: string; uebersprungen?: boolean }[]): string[] {
  return e.map((x) => `${x.titel} · ${x.uebersprungen ? "übersprungen" : x.ok ? "ok" : "Fehler"} · ${x.text}${x.bild ? ` · Bildschirmfoto ${x.bild}` : ""}`);
}

export function laufText(e: AoExportErgebnis[]): string {
  if (!e.length) return "Nichts fällig.";
  return e.map((x) => `${x.titel}: ${x.ok ? x.text : `Fehler – ${x.text}`}`).join(" · ");
}
