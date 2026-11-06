// B30: ArbitrageOne-Export „Einkäufe“ (ArbitrageOne_PurchaseOrders_Export_<Datum>.xls) = Bestellliste, eine Zeile je
// Einkaufsposition – keine Kostenliste. Reine Logik (tests/b30-ao-bestellungen.test.ts): Kopfzeile und Spalten finden,
// Positionen lesen, zu Bestellungen gruppieren, Status zuordnen, EK je SKU aus den Lieferungen ableiten.
//
// Die Spaltennamen kommen aus der Datei: Gefunden wird je Feld der erste passende Name; fehlt eine Pflichtspalte, nennt
// die Meldung alle gefundenen Spalten („gefunden: …, fehlt: …“). Wie jede Spalte gelesen wurde, steht im Ergebnis.

import { parseAmount, parseDate } from "@/lib/numbers";
import { normSpalte } from "./logic";

/**
 * Stand des Parsers: Mit älterem Stand gescheiterte Bestelllisten verarbeitet der stündliche Nachlauf noch einmal
 * (Spalten nachgebessert → beim nächsten Lauf automatisch neu). Bei jeder Änderung an den Spaltennamen anheben.
 */
export const AO_BESTELL_PARSER_STAND = "2026-11-06T09:00:00Z";

export type AoBestellFeld = "bestellnummer" | "positionsId" | "datum" | "lieferant" | "asin" | "sku" | "fnsku" | "titel" | "menge" | "ekNetto" | "ekBrutto" | "ek" | "gesamtNetto" | "gesamtBrutto" | "gesamt" | "ust" | "versand" | "status" | "lager" | "charge" | "waehrung";

/** Spaltennamen je Feld (klein, Umlaute als ae/oe/ue, Sonderzeichen als Leerzeichen) – erster Treffer gewinnt. */
export const AO_BESTELL_SPALTEN: Record<AoBestellFeld, string[]> = {
  bestellnummer: ["bestellnummer", "bestell nr", "bestellnr", "bestell id", "bestellungs id", "bestellung nr", "bestellung", "auftragsnummer", "auftrags nr", "auftrag", "shop bestellnummer", "order id", "order number", "order no", "order nr", "purchase order number", "purchase order id", "purchase order", "po number", "po nr", "po id", "po"],
  positionsId: ["positions id", "position id", "positionsnummer", "pos nr", "item id", "line item id", "order item id", "purchase order item id", "line id"],
  datum: ["bestelldatum", "kaufdatum", "einkaufsdatum", "bestellt am", "gekauft am", "eingekauft am", "datum der bestellung", "order date", "purchase date", "po date", "purchase order date", "date of purchase", "erstellt am", "angelegt am", "created at", "created", "datum", "date"],
  lieferant: ["lieferant", "lieferant name", "lieferantenname", "shop", "shop name", "haendler", "bezugsquelle", "quelle", "verkaeufer", "supplier", "supplier name", "vendor", "store", "source"],
  asin: ["asin", "amazon asin", "asin de"],
  sku: ["seller sku", "sku", "msku", "haendler sku", "merchant sku", "amazon sku"],
  fnsku: ["fnsku"],
  titel: ["produktname", "produkt name", "titel", "artikelname", "artikelbezeichnung", "bezeichnung", "produkt", "artikel", "product name", "product title", "title", "name"],
  menge: ["bestellmenge", "bestellte menge", "menge bestellt", "menge eingekauft", "einkaufsmenge", "gekaufte menge", "menge", "anzahl", "stueckzahl", "stueck", "stk", "einheiten", "ordered quantity", "quantity ordered", "qty ordered", "units ordered", "purchased quantity", "purchase quantity", "quantity", "qty", "units"],
  ekNetto: ["ek netto pro stueck", "ek netto je stueck", "ek pro stueck netto", "ek stueck netto", "einkaufspreis netto", "einzelpreis netto", "stueckpreis netto", "netto einzelpreis", "netto ek", "preis netto", "unit price net", "unit cost net", "net unit price", "net price", "ek netto"],
  ekBrutto: ["ek brutto pro stueck", "ek brutto je stueck", "ek pro stueck brutto", "ek stueck brutto", "einkaufspreis brutto", "einzelpreis brutto", "stueckpreis brutto", "brutto einzelpreis", "brutto ek", "preis brutto", "unit price gross", "unit cost gross", "gross unit price", "gross price", "ek brutto"],
  ek: ["ek pro stueck", "ek je stueck", "ek preis", "einkaufspreis", "einzelpreis", "stueckpreis", "preis pro stueck", "preis je stueck", "unit price", "unit cost", "price per unit", "cost per unit", "purchase price", "buy price", "ek", "preis", "price", "cost"],
  gesamtNetto: ["gesamt netto", "gesamtpreis netto", "summe netto", "netto gesamt", "total net", "net total"],
  gesamtBrutto: ["gesamt brutto", "gesamtpreis brutto", "summe brutto", "brutto gesamt", "total gross", "gross total"],
  gesamt: ["gesamtpreis", "gesamtbetrag", "gesamt", "summe", "total", "total price", "amount"],
  ust: ["ust satz", "ust", "mwst satz", "mwst", "steuersatz", "umsatzsteuer", "vat rate", "vat", "tax rate"],
  versand: ["versandkosten", "versand", "vsk", "porto", "lieferkosten", "shipping cost", "shipping costs", "shipping"],
  status: ["bestellstatus", "lieferstatus", "status", "order status", "po status", "state"],
  lager: ["lagerort", "lager", "standort", "ziellager", "lagerplatz", "warehouse", "location", "destination"],
  charge: ["chargennummer", "charge nr", "charge", "batch number", "batch", "lot number", "lot"],
  waehrung: ["waehrung", "currency"],
};

const PFLICHT: { feld: AoBestellFeld | "preis"; text: string }[] = [
  { feld: "asin", text: "ASIN" },
  { feld: "menge", text: "Menge" },
  { feld: "datum", text: "Bestelldatum" },
  { feld: "preis", text: "EK (Einzelpreis oder Gesamtpreis)" },
];

/** Spalte zu Namen: genau, sonst „beginnt mit Name + Leerzeichen“ (z. B. „ek netto eur“). Summen-/Totalspalten nie als Einzelpreis. */
function spalteFuer(kopf: string[], namen: string[], vergeben: Set<number>, ohne?: RegExp): number {
  const frei = (i: number) => i > -1 && !vergeben.has(i) && !(ohne && ohne.test(kopf[i]));
  for (const n of namen) {
    const i = kopf.findIndex((k, j) => k === n && frei(j));
    if (i > -1) return i;
  }
  for (const n of namen) {
    if (n.length < 4) continue;
    const i = kopf.findIndex((k, j) => k.startsWith(`${n} `) && frei(j));
    if (i > -1) return i;
  }
  return -1;
}

export type AoBestellSpalten = Partial<Record<AoBestellFeld, number>>;

/** Spalten einer Kopfzeile zuordnen. Reihenfolge: eindeutige Felder zuerst, damit „ek“ nicht die Netto-Spalte nimmt. */
export function aoBestellSpalten(zeile: unknown[]): AoBestellSpalten {
  const kopf = zeile.map(normSpalte);
  const vergeben = new Set<number>();
  const c: AoBestellSpalten = {};
  const summe = /gesamt|summe|total|amount|betrag/;
  const reihenfolge: AoBestellFeld[] = ["asin", "fnsku", "sku", "positionsId", "bestellnummer", "datum", "menge", "ekNetto", "ekBrutto", "gesamtNetto", "gesamtBrutto", "ek", "gesamt", "ust", "versand", "status", "lieferant", "lager", "charge", "waehrung", "titel"];
  for (const f of reihenfolge) {
    const ohne =
      f === "ek" || f === "ekNetto" || f === "ekBrutto"
        ? summe
        : f === "lieferant"
          ? /sku|asin/
          : f === "datum"
            ? /liefer|eingang|versand|erwartet|update|geaendert/
            : f === "menge"
              ? /geliefert|erhalten|received|eingegangen|offen|storn|cancel/
              : f === "bestellnummer"
                ? /datum|date|status|menge|preis|summe|wert|lieferant|shop|position|item/
                : undefined;
    const i = spalteFuer(kopf, AO_BESTELL_SPALTEN[f], vergeben, ohne);
    if (i > -1) {
      c[f] = i;
      vergeben.add(i);
    }
  }
  return c;
}

const hatPreis = (c: AoBestellSpalten) => [c.ekNetto, c.ekBrutto, c.ek, c.gesamtNetto, c.gesamtBrutto, c.gesamt].some((x) => x !== undefined);

/** Sieht die Zeile wie die Kopfzeile einer Bestellliste aus (ASIN + Menge + Datum oder Bestellnummer)? */
export const istBestellKopf = (zeile: unknown[]) => {
  const c = aoBestellSpalten(zeile);
  return c.asin !== undefined && c.menge !== undefined && (c.datum !== undefined || c.bestellnummer !== undefined);
};

export type AoStatus = "bestellt" | "versendet" | "teilweise" | "geliefert" | "storniert";

/** Status-Text der Datei → eigener Status; unbekannt → null (zählt wie „bestellt“, siehe poStatus). */
export function aoStatusAus(roh: unknown): AoStatus | null {
  const s = normSpalte(roh);
  if (!s) return null;
  if (/storn|cancel|abgebrochen|annull|abgelehnt|refund|erstattet/.test(s)) return "storniert";
  if (/teil|partial/.test(s)) return "teilweise";
  if (/geliefert|delivered|received|erhalten|eingegangen|eingetroffen|angekommen|zugestellt|abgeschlossen|completed|complete|done|fertig|eingelagert|im lager|wareneingang|closed/.test(s)) return "geliefert";
  if (/versand|versendet|verschickt|shipped|unterwegs|transit|in zustellung/.test(s)) return "versendet";
  if (/bestellt|ordered|offen|open|pending|neu|new|bezahlt|paid|bearbeitung|processing|warte|erwartet|placed/.test(s)) return "bestellt";
  return null;
}

/** Ohne bekannten Status gilt eine Position nach so vielen Tagen als geliefert (sonst stünde sie ewig „unterwegs“). */
export const OHNE_STATUS_GELIEFERT_TAGE = 21;

export type AoBestellPosition = {
  zeile: number;
  bestellnummer: string | null;
  positionsId: string | null;
  datum: string;
  lieferant: string | null;
  asin: string;
  sku: string | null;
  fnsku: string | null;
  titel: string | null;
  menge: number;
  /** EK je Stück netto bzw. brutto (aus Einzel- oder Gesamtpreis); null = in der Zeile kein Preis. */
  ekNetto: number | null;
  ekBrutto: number | null;
  ustSatz: number;
  versand: number | null;
  status: AoStatus | null;
  statusRoh: string | null;
  lager: string | null;
  charge: string | null;
  waehrung: string | null;
};

export type AoBestellLesen =
  | { ok: true; positionen: AoBestellPosition[]; uebersprungen: number; spalten: Record<string, string>; preisArt: "netto" | "brutto" | "netto angenommen"; statusWerte: Record<string, number> }
  | { ok: false; gefunden: string[]; fehlt: string[] };

const str = (v: unknown) => String(v ?? "").trim();
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** USt-Satz aus „19“, „19 %“, „0,19“ → 19. */
function ustAus(v: unknown): number | null {
  const n = parseAmount(typeof v === "string" ? v.replace("%", "") : v);
  if (n === null || n < 0) return null;
  return n > 0 && n < 1 ? r2(n * 100) : n;
}

/**
 * Bestellliste lesen. Pflicht: ASIN, Menge, Bestelldatum und ein Preis (Einzel- oder Gesamtpreis). Netto/Brutto aus
 * dem Spaltennamen; heißt er nur „EK“/„Preis“, gilt netto (wie in den übrigen ArbitrageOne-Exporten) – das steht
 * dann als „netto angenommen“ im Ergebnis.
 */
export function aoBestellungenLesen(roh: unknown[][]): AoBestellLesen {
  // Keine vollständige Kopfzeile (z. B. Menge fehlt): für „gefunden: …“ die Zeile mit ASIN-Spalte nehmen, sonst die
  // erste mit mindestens 3 Textzellen – nicht die Titelzeile darüber.
  const passt = (f: (z: unknown[]) => boolean) => roh.slice(0, 25).findIndex((z) => f(z ?? []));
  const textzellen = (z: unknown[]) => z.filter((x) => typeof x === "string" && x.trim() && !/^[\d.,\s€%-]+$/.test(x)).length >= 3;
  const k = [passt(istBestellKopf), passt((z) => aoBestellSpalten(z).asin !== undefined), passt(textzellen), 0].find((i) => i >= 0)!;
  const kopfRoh = (roh[k] ?? []).map((x) => str(x));
  const c = aoBestellSpalten(roh[k] ?? []);
  const fehlt = PFLICHT.filter((p) => (p.feld === "preis" ? !hatPreis(c) : c[p.feld] === undefined)).map((p) => p.text);
  if (fehlt.length) return { ok: false, gefunden: kopfRoh.filter(Boolean).slice(0, 40), fehlt };
  const preisArt = c.ekNetto !== undefined || c.gesamtNetto !== undefined ? "netto" : c.ekBrutto !== undefined || c.gesamtBrutto !== undefined ? "brutto" : "netto angenommen";
  const spalten: Record<string, string> = {};
  for (const [f, i] of Object.entries(c)) if (i !== undefined) spalten[f] = kopfRoh[i];
  const get = (r: unknown[], f: AoBestellFeld) => (c[f] === undefined ? undefined : r[c[f]!]);
  const positionen: AoBestellPosition[] = [];
  const statusWerte: Record<string, number> = {};
  let uebersprungen = 0;
  roh.slice(k + 1).forEach((r, i) => {
    const asin = str(get(r, "asin")).toUpperCase();
    const datum = parseDate(get(r, "datum"));
    const menge = parseAmount(get(r, "menge"));
    if (!asin && menge === null && !datum) return; // Leer- oder Summenzeile
    if (!/^[A-Z0-9]{10}$/.test(asin) || !datum || menge === null || menge <= 0) {
      uebersprungen++;
      return;
    }
    const ust = ustAus(get(r, "ust")) ?? 19;
    const faktor = 1 + ust / 100;
    const stueck = (f: AoBestellFeld) => parseAmount(get(r, f));
    const gesamt = (f: AoBestellFeld) => {
      const g = parseAmount(get(r, f));
      return g === null ? null : g / menge;
    };
    let netto = stueck("ekNetto") ?? gesamt("gesamtNetto");
    let brutto = stueck("ekBrutto") ?? gesamt("gesamtBrutto");
    if (netto === null && brutto === null) {
      const neutral = stueck("ek") ?? gesamt("gesamt");
      if (neutral !== null) netto = neutral; // „EK“/„Preis“ ohne Angabe: netto (ArbitrageOne rechnet netto)
    }
    if (netto === null && brutto !== null) netto = brutto / faktor;
    if (brutto === null && netto !== null) brutto = netto * faktor;
    const statusRoh = str(get(r, "status")) || null;
    if (statusRoh) statusWerte[statusRoh] = (statusWerte[statusRoh] ?? 0) + 1;
    positionen.push({
      zeile: k + i + 2,
      bestellnummer: str(get(r, "bestellnummer")).slice(0, 120) || null,
      positionsId: str(get(r, "positionsId")).slice(0, 120) || null,
      datum,
      lieferant: str(get(r, "lieferant")).slice(0, 120) || null,
      asin,
      sku: str(get(r, "sku")).slice(0, 120) || null,
      fnsku: str(get(r, "fnsku")).slice(0, 40) || null,
      titel: str(get(r, "titel")).slice(0, 300) || null,
      menge: Math.round(menge),
      ekNetto: netto === null ? null : r4(netto),
      ekBrutto: brutto === null ? null : r4(brutto),
      ustSatz: ust,
      versand: parseAmount(get(r, "versand")),
      status: aoStatusAus(statusRoh),
      statusRoh,
      lager: str(get(r, "lager")).slice(0, 120) || null,
      charge: str(get(r, "charge")).slice(0, 120) || null,
      waehrung: str(get(r, "waehrung")).toUpperCase().slice(0, 8) || null,
    });
  });
  return { ok: true, positionen, uebersprungen, spalten, preisArt, statusWerte };
}

/** Fehlertext „gefunden: …, fehlt: …“ (B30.2). */
export const spaltenFehlerText = (f: { gefunden: string[]; fehlt: string[] }) => `ArbitrageOne – Bestellungen: Spalten fehlen – gefunden: ${f.gefunden.join(", ") || "keine Kopfzeile"}; fehlt: ${f.fehlt.join(", ")}.`;

// ---- Bestellungen ------------------------------------------------------------------------------------

export type PoStatusAo = "ordered" | "shipped" | "partial" | "received" | "cancelled";

/** Status einer Position fürs Seller-System; ohne bekannten Status nach OHNE_STATUS_GELIEFERT_TAGE als geliefert. */
export function positionGeliefert(p: Pick<AoBestellPosition, "status" | "datum">, heute: string): boolean {
  if (p.status === "geliefert") return true;
  if (p.status) return false;
  return Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${p.datum}T00:00:00Z`) >= OHNE_STATUS_GELIEFERT_TAGE * 86_400_000;
}

/** Status der Bestellung aus ihren Positionen. */
export function poStatusAus(pos: Pick<AoBestellPosition, "status" | "datum">[], heute: string): PoStatusAo {
  const aktiv = pos.filter((p) => p.status !== "storniert");
  if (!aktiv.length) return "cancelled";
  const geliefert = aktiv.filter((p) => positionGeliefert(p, heute)).length;
  if (geliefert === aktiv.length) return "received";
  if (geliefert > 0 || aktiv.some((p) => p.status === "teilweise")) return "partial";
  if (aktiv.some((p) => p.status === "versendet")) return "shipped";
  return "ordered";
}

export type AoBestellung = {
  /** Eindeutig je Bestellung: Bestellnummer, sonst Lieferant + Datum. */
  schluessel: string;
  nummer: string;
  bestellnummer: string | null;
  lieferant: string;
  datum: string;
  versand: number | null;
  positionen: (AoBestellPosition & { schluessel: string })[];
};

const kurzHash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
};

/**
 * Positionen zu Bestellungen gruppieren. Schlüssel je Position: Positions-ID, sonst Bestellung + ASIN + SKU + n-tes
 * Vorkommen – so erkennt die nächste Tagesdatei dieselbe Position wieder (auch wenn sich Status oder Preis ändern).
 */
export function aoBestellungenGruppieren(positionen: AoBestellPosition[]): AoBestellung[] {
  const m = new Map<string, AoBestellung>();
  for (const p of positionen) {
    const lieferant = p.lieferant ?? "ArbitrageOne";
    const schluessel = p.bestellnummer ? `nr:${p.bestellnummer.toLowerCase()}` : `ld:${lieferant.toLowerCase()}|${p.datum}`;
    let b = m.get(schluessel);
    if (!b) {
      const nummer = p.bestellnummer ? `AO-${p.bestellnummer.replace(/\s+/g, "")}`.slice(0, 60) : `AO-${p.datum.replace(/-/g, "")}-${kurzHash(schluessel)}`;
      b = { schluessel, nummer, bestellnummer: p.bestellnummer, lieferant, datum: p.datum, versand: null, positionen: [] };
      m.set(schluessel, b);
    }
    if (p.datum < b.datum) b.datum = p.datum;
    const gleiche = b.positionen.filter((x) => x.asin === p.asin && (x.sku ?? "") === (p.sku ?? "")).length;
    const ps = p.positionsId ? `pid:${p.positionsId.toLowerCase()}` : `${schluessel}|${p.asin}|${(p.sku ?? "").toLowerCase()}|${gleiche + 1}`;
    b.positionen.push({ ...p, schluessel: ps });
  }
  // Versandkosten: steht in allen Zeilen derselbe Wert, gilt er einmal je Bestellung, sonst je Position (Summe).
  for (const b of m.values()) {
    const v = b.positionen.map((p) => p.versand).filter((x): x is number => x !== null && x > 0);
    if (!v.length) continue;
    b.versand = r2(v.every((x) => x === v[0]) && v.length === b.positionen.length ? v[0] : v.reduce((s, x) => s + x, 0));
  }
  return [...m.values()];
}

// ---- EK je SKU aus den Lieferungen -------------------------------------------------------------------

export const EK_LIEFERUNGEN = 3;
export const SB_COG_WARN_PROZENT = 10;

/**
 * B30.1.3: EK netto je SKU als mengengewichteter Durchschnitt der letzten EK_LIEFERUNGEN gelieferten Positionen
 * (ohne stornierte, ohne Positionen ohne Preis).
 */
export function ekAusLieferungen(pos: AoBestellPosition[], heute: string): { sku: string; asin: string; ekNetto: number; lieferungen: number; stueck: number; letzte: string }[] {
  const je = new Map<string, AoBestellPosition[]>();
  for (const p of pos) {
    if (!p.sku || p.ekNetto === null || p.ekNetto <= 0 || p.status === "storniert" || !positionGeliefert(p, heute)) continue;
    je.set(p.sku, [...(je.get(p.sku) ?? []), p]);
  }
  const out: { sku: string; asin: string; ekNetto: number; lieferungen: number; stueck: number; letzte: string }[] = [];
  for (const [sku, liste] of je) {
    const letzte = [...liste].sort((a, b) => b.datum.localeCompare(a.datum) || b.zeile - a.zeile).slice(0, EK_LIEFERUNGEN);
    const stueck = letzte.reduce((s, p) => s + p.menge, 0);
    if (!stueck) continue;
    out.push({ sku, asin: letzte[0].asin, ekNetto: r2(letzte.reduce((s, p) => s + p.menge * p.ekNetto!, 0) / stueck), lieferungen: letzte.length, stueck, letzte: letzte[0].datum });
  }
  return out.sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Warnung, wenn der EK aus den Lieferungen mehr als 10 % vom sellerboard-COG abweicht. */
export function sbCogWarnung(ek: number, cog: number | null | undefined): string | null {
  if (cog === null || cog === undefined || cog <= 0.011) return null;
  const p = ((ek - cog) / cog) * 100;
  if (Math.abs(p) <= SB_COG_WARN_PROZENT) return null;
  return `weicht ${p > 0 ? "+" : ""}${(Math.round(p * 10) / 10).toLocaleString("de-DE")} % vom sellerboard-COG (${cog.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €) ab`;
}

/** Kurztext für Ergebnis und Lauf: „n Bestellungen, m Positionen, k ohne Zuordnung“. */
export const bestellText = (o: { bestellungen: number; positionen: number; ohneZuordnung: number }) => `${o.bestellungen} Bestellung${o.bestellungen === 1 ? "" : "en"}, ${o.positionen} Position${o.positionen === 1 ? "" : "en"}, ${o.ohneZuordnung} ohne Zuordnung`;
