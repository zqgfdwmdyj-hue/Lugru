import * as XLSX from "xlsx";
import { parseAmount, parseDate } from "@/lib/numbers";

// Liest die Exporte aus Arbitrage One. Erkannt werden:
//  - Sellerboard-Export (.xls):   ASIN | SKU | Cost
//  - AccountOne COG (.csv):       marketplace_article_nr | article_nr | ek_netto_euro [| source_account_id]
//  - Eigene Vorlage (.csv):       ASIN | Seller SKU | FNSKU | Produktname | Kaufdatum |
//                                 Menge (eingekauft) | EK netto (mit VSK) | Währung | EK netto (Standard)

export type ImportSource = "sellerboard" | "accountone" | "template";

export type ImportRow = {
  line: number;
  asin: string;
  sku: string;
  costNet: number | null;
  fnsku?: string | null;
  title?: string | null;
  purchaseDate?: string | null;
  quantity?: number | null;
  currency?: string | null;
};

export type ParsedImport = {
  source: ImportSource;
  rows: ImportRow[];
  skipped: { line: number; reason: string }[];
};

export class ImportFormatError extends Error {}

const norm = (h: unknown) =>
  String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i > -1) return i;
  }
  return -1;
}

function isSpreadsheetBinary(bytes: Uint8Array) {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b; // .xlsx
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0; // .xls
  return zip || ole;
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function readSheet(data: ArrayBuffer | Uint8Array): unknown[][] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // CSV selbst dekodieren und als Text einlesen, damit "86,50" nicht zu 8650 wird
  // und Umlaute in Spaltennamen erhalten bleiben.
  const wb = isSpreadsheetBinary(bytes)
    ? XLSX.read(bytes, { type: "array", cellDates: false })
    : XLSX.read(decodeText(bytes), { type: "string", raw: true });
  const first = wb.SheetNames[0];
  if (!first) throw new ImportFormatError("Die Datei enthält keine Tabelle.");
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
}

export function parseArbitrageOne(table: unknown[][]): ParsedImport {
  if (table.length === 0) throw new ImportFormatError("Die Datei ist leer.");
  const headers = table[0].map(norm);
  const body = table.slice(1);
  const skipped: ParsedImport["skipped"] = [];
  const rows: ImportRow[] = [];

  const str = (v: unknown) => String(v ?? "").trim();

  let source: ImportSource;
  let col: {
    asin: number;
    sku: number;
    cost: number;
    costFallback?: number;
    fnsku?: number;
    title?: number;
    date?: number;
    qty?: number;
    currency?: number;
  };

  if (headers.includes("marketplace_article_nr") && headers.includes("article_nr")) {
    source = "accountone";
    col = {
      asin: headers.indexOf("marketplace_article_nr"),
      sku: headers.indexOf("article_nr"),
      cost: headers.indexOf("ek_netto_euro"),
    };
  } else if (headers.includes("seller sku") || headers.includes("fnsku")) {
    source = "template";
    col = {
      asin: findCol(headers, "asin"),
      sku: findCol(headers, "seller sku", "sku"),
      cost: findCol(headers, "ek netto (mit vsk)"),
      costFallback: findCol(headers, "ek netto (standard)", "ek netto"),
      fnsku: findCol(headers, "fnsku"),
      title: findCol(headers, "produktname"),
      date: findCol(headers, "kaufdatum"),
      qty: findCol(headers, "menge (eingekauft)", "menge"),
      currency: findCol(headers, "währung", "waehrung"),
    };
  } else if (headers.includes("asin") && headers.includes("sku") && headers.includes("cost")) {
    source = "sellerboard";
    col = {
      asin: headers.indexOf("asin"),
      sku: headers.indexOf("sku"),
      cost: headers.indexOf("cost"),
    };
  } else {
    throw new ImportFormatError(
      "Format nicht erkannt. Unterstützt: Arbitrage-One-Export für Sellerboard, AccountOne COG oder die eigene Vorlage mit ASIN/Seller SKU/FNSKU.",
    );
  }

  if (col.asin < 0 || col.sku < 0 || (col.cost < 0 && (col.costFallback ?? -1) < 0)) {
    throw new ImportFormatError("Pflichtspalten fehlen (ASIN, SKU und EK).");
  }

  body.forEach((r, i) => {
    const line = i + 2;
    const asin = str(r[col.asin]).toUpperCase();
    const sku = str(r[col.sku]);
    if (!asin && !sku) return;
    if (!sku) return skipped.push({ line, reason: "SKU fehlt" });
    if (!asin) return skipped.push({ line, reason: "ASIN fehlt" });

    let costNet = col.cost >= 0 ? parseAmount(r[col.cost]) : null;
    if (costNet === null && col.costFallback !== undefined && col.costFallback >= 0) {
      costNet = parseAmount(r[col.costFallback]);
    }

    const row: ImportRow = { line, asin, sku, costNet };
    if (source === "template") {
      const get = (c?: number) => (c !== undefined && c >= 0 ? r[c] : undefined);
      row.fnsku = str(get(col.fnsku)) || null;
      row.title = str(get(col.title)) || null;
      row.purchaseDate = parseDate(get(col.date));
      const q = parseAmount(get(col.qty));
      row.quantity = q === null ? null : Math.round(q);
      row.currency = str(get(col.currency)).toUpperCase() || null;
    }
    rows.push(row);
  });

  return { source, rows, skipped };
}
