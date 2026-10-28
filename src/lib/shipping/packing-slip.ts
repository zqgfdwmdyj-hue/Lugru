// Amazon-Lieferscheine (Seller Central → Bestellungen → Lieferschein drucken, eine Bestellung je Seite) lesen:
// Bestellnummer, Lieferadresse („Liefern an“) und Positionen mit Menge. Daraus die Versandart:
// 1 Stück → Warensendung (Deutsche Post), ab 2 Stück → DHL. Reine Logik ohne Server-Abhängigkeiten.

import type { Address } from "@/db/tables/core";
import { splitStreet } from "./countries";

export type SlipItem = { quantity: number; title: string; sku: string | null; asin: string | null; lineId: string | null };

export type SlipOrder = {
  orderNo: string;
  /** Bestelldatum (ISO), falls auf dem Lieferschein lesbar. */
  orderDate: string | null;
  shipTo: Address;
  items: SlipItem[];
  /** Stück insgesamt (Summe der Mengen). */
  quantity: number;
  /** Seiten im PDF (1-basiert). */
  pages: number[];
  /** Was nicht sicher gelesen werden konnte – dann nicht automatisch versenden. */
  warnings: string[];
};

export type ShipChoice = "warensendung" | "dhl" | "pruefen";

const COUNTRY: Record<string, string> = {
  deutschland: "DEU", germany: "DEU", österreich: "AUT", austria: "AUT", schweiz: "CHE", switzerland: "CHE", niederlande: "NLD",
  belgien: "BEL", luxemburg: "LUX", frankreich: "FRA", italien: "ITA", spanien: "ESP", polen: "POL", tschechien: "CZE",
  dänemark: "DNK", schweden: "SWE", liechtenstein: "LIE",
};

const ORDER_NO = /Bestellnummer:\s*(\d{3}-\d{7}-\d{7})/;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12 };

/** „Mi., 28. Okt. 2026“ → 2026-10-28 (null, wenn nicht lesbar). */
export function slipDate(text: string): string | null {
  const m = /\b(\d{1,2})\.\s*(Jan|Feb|Mär|Mar|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez)[a-zä]*\.?\s+(\d{4})\b/.exec(text);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  return month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
const ZIP_CITY = /^((?:[A-Z]{1,2}-)?\d{4,5}(?: ?[A-Z]{2})?)\s+(.+)$/;

/** Zeilen zwischen „Liefern an:“ und „Bestellnummer:“ (sonst der Block „Lieferanschrift:“) → Adresse. */
export function parseAddress(lines: string[]): { address: Address; warnings: string[] } {
  const warnings: string[] = [];
  const rows = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  let country = "DEU";
  const last = rows[rows.length - 1] ?? "";
  if (rows.length && !ZIP_CITY.test(last) && !/\d/.test(last)) {
    const known = COUNTRY[last.toLowerCase()];
    if (known) country = known;
    else {
      country = last;
      warnings.push(`Land „${last}“ nicht erkannt`);
    }
    rows.pop();
  }
  const zipAt = rows.findLastIndex((r) => ZIP_CITY.test(r));
  if (zipAt < 2) {
    warnings.push("Adresse unvollständig (Name, Straße oder PLZ/Ort fehlt)");
    return { address: { name1: rows[0], country }, warnings };
  }
  const [, zip, city] = ZIP_CITY.exec(rows[zipAt])!;
  const { street, houseNo } = splitStreet(rows[zipAt - 1]);
  const extra = rows.slice(1, zipAt - 1);
  const address: Address = { name1: rows[0], ...(extra.length ? { name2: extra.join(", ") } : {}), street, houseNo, zip: zip.replace(/^[A-Z]{1,2}-/, ""), city, country };
  if (!houseNo && !/packstation|postfiliale|postfach/i.test(street)) warnings.push("Hausnummer nicht erkannt");
  return { address, warnings };
}

/**
 * Positionen aus dem Tabellenteil: Eine Position beginnt mit „<Menge> <Titel>“ direkt nach der Kopfzeile oder
 * nach einer Betragszeile („… €“), danach folgen Titelzeilen, „SKU:“, „ASIN:“, „Bestellposten-ID:“ und der Preis.
 */
export function parseItems(lines: string[]): SlipItem[] {
  const items: SlipItem[] = [];
  let cur: SlipItem | null = null;
  let state: "seek" | "title" | "meta" = "seek";
  let wantLineId = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (state === "seek") {
      const m = /^(\d{1,3})\s+(\S.*)$/.exec(line);
      if (m && !/€/.test(line) && !/^\d{1,3}\s*(?:x|×)?\s*$/.test(line)) {
        cur = { quantity: Number(m[1]), title: m[2], sku: null, asin: null, lineId: null };
        items.push(cur);
        state = "title";
      }
      continue;
    }
    if (!cur) continue;
    const sku = /^SKU:\s*(\S.*)$/.exec(line);
    const asin = /^ASIN:\s*([A-Z0-9]{10})/.exec(line);
    if (sku) {
      cur.sku = sku[1].trim();
      state = "meta";
    } else if (asin) {
      cur.asin = asin[1];
      state = "meta";
    } else if (/^Bestellposten-ID:/.test(line)) {
      const id = /(\d{8,})/.exec(line);
      if (id) cur.lineId = id[1];
      else wantLineId = true;
      state = "meta";
    } else if (wantLineId && /^\d{8,}$/.test(line)) {
      cur.lineId = line;
      wantLineId = false;
    } else if (/€\s*$/.test(line)) {
      // Preis bzw. Summe: die Position ist zu Ende, die nächste kann beginnen.
      state = "seek";
      cur = null;
    } else if (state === "title") {
      cur.title = `${cur.title} ${line}`;
    }
  }
  return items;
}

/** Eine Seite: Bestellnummer, Adresse, Positionen. Seiten ohne Bestellnummer gehören zur vorigen Bestellung. */
export function parseSlipPage(text: string): { orderNo: string | null; orderDate: string | null; address: Address | null; addressWarnings: string[]; items: SlipItem[] } {
  const lines = text.split(/\r?\n/);
  const orderNo = ORDER_NO.exec(text)?.[1] ?? null;
  const shipAt = lines.findIndex((l) => /^Liefern an:/.test(l.trim()));
  const orderAt = lines.findIndex((l) => ORDER_NO.test(l));
  let block: string[] = [];
  if (shipAt >= 0 && orderAt > shipAt) block = lines.slice(shipAt + 1, orderAt);
  else {
    const alt = lines.findIndex((l) => /^Lieferanschrift:/.test(l.trim()));
    if (alt >= 0) {
      const end = lines.findIndex((l, i) => i > alt && /^(Bestellt am:|Versandart:)/.test(l.trim()));
      block = lines.slice(alt + 1, end > alt ? end : alt + 6);
    }
  }
  const parsed = block.length ? parseAddress(block) : null;
  const head = lines.findIndex((l) => /^Menge\s+Produktdetails/.test(l.trim()));
  const tail = lines.findIndex((l, i) => i > head && /^Gesamtbetrag:/.test(l.trim()));
  const items = head >= 0 ? parseItems(lines.slice(head + 1, tail > head ? tail : undefined)) : [];
  return { orderNo, orderDate: slipDate(text), address: parsed?.address ?? null, addressWarnings: parsed?.warnings ?? [], items };
}

/** Alle Seiten eines Lieferschein-PDFs → Bestellungen (gleiche Bestellnummer über mehrere Seiten zusammengefasst). */
export function parsePackingSlip(pages: string[]): SlipOrder[] {
  const out: SlipOrder[] = [];
  const byNo = new Map<string, SlipOrder>();
  let prev: SlipOrder | null = null;
  pages.forEach((text, i) => {
    const p = parseSlipPage(text);
    const target = p.orderNo ? byNo.get(p.orderNo) : prev;
    if (!p.orderNo && !target) return; // Deckblatt o. Ä.
    if (target) {
      // Fortsetzung: Positionen ergänzen (gleiche Posten-ID nur einmal).
      for (const it of p.items) if (!it.lineId || !target.items.some((x) => x.lineId === it.lineId)) target.items.push(it);
      target.pages.push(i + 1);
      if (!target.shipTo.street && p.address?.street) target.shipTo = p.address;
      prev = target;
      return;
    }
    const order: SlipOrder = { orderNo: p.orderNo!, orderDate: p.orderDate, shipTo: p.address ?? {}, items: [...p.items], quantity: 0, pages: [i + 1], warnings: [...p.addressWarnings] };
    if (!p.address) order.warnings.push("Lieferadresse nicht gefunden");
    byNo.set(order.orderNo, order);
    out.push(order);
    prev = order;
  });
  for (const o of out) {
    o.quantity = o.items.reduce((n, it) => n + it.quantity, 0);
    if (!o.items.length) o.warnings.push("Positionen/Menge nicht erkannt");
    else if (o.items.some((it) => !it.sku)) o.warnings.push("SKU nicht bei jeder Position erkannt");
  }
  return out;
}

/**
 * Versandart nach Stückzahl: 1 Stück → Warensendung, ab 2 → DHL. Warensendung gibt es nur innerhalb
 * Deutschlands; bei unsicher gelesenen Daten lieber prüfen lassen.
 */
export function shipChoice(o: Pick<SlipOrder, "quantity" | "shipTo" | "warnings">): ShipChoice {
  if (o.quantity < 1 || o.warnings.some((w) => /Adresse|Positionen|Land/.test(w))) return "pruefen";
  if (o.quantity === 1) return (o.shipTo.country ?? "DEU") === "DEU" ? "warensendung" : "dhl";
  return "dhl";
}

export const SHIP_CHOICE_LABEL: Record<ShipChoice, string> = { warensendung: "Warensendung (Deutsche Post)", dhl: "DHL-Paket", pruefen: "bitte prüfen" };
