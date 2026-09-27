import * as XLSX from "xlsx";

// Liest Tabellen aus CSV, TSV (Amazon-Reports), XLS und XLSX in ein einheitliches Format.

export type Table = { headers: string[]; rows: string[][] };

function isSpreadsheetBinary(b: Uint8Array) {
  const zip = b[0] === 0x50 && b[1] === 0x4b;
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  return zip || ole;
}

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Trennzeichen außerhalb von Anführungszeichen zählen. */
function countOutsideQuotes(line: string, d: string) {
  let n = 0;
  let q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === d && !q) n++;
  }
  return n;
}

/**
 * Trennzeichen aus der ersten Zeile, die eines enthält. Manche Reports (Transaktionsbericht)
 * haben vor der Kopfzeile Hinweiszeilen in Anführungszeichen.
 */
function detectDelimiter(head: string): string {
  for (const line of head.split(/\r?\n/).slice(0, 20)) {
    const counts = ["\t", ";", ",", "|"].map((d) => [d, countOutsideQuotes(line, d)] as const).sort((a, b) => b[1] - a[1]);
    if (counts[0][1] > 0) return counts[0][0];
  }
  return ",";
}

/** CSV/TSV mit Anführungszeichen, doppelten Anführungszeichen und Zeilenumbrüchen in Feldern. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? detectDelimiter(text.slice(0, 20000));
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") inQuotes = true;
    else if (c === d) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  return rows;
}

export function readTable(data: ArrayBuffer | Uint8Array): Table {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let matrix: string[][];
  if (isSpreadsheetBinary(bytes)) {
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    matrix = XLSX.utils
      .sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", blankrows: false })
      .map((r) => r.map((v) => String(v ?? "").trim()));
  } else {
    matrix = parseDelimited(decodeText(bytes)).map((r) => r.map((v) => v.trim()));
  }
  if (matrix.length === 0) return { headers: [], rows: [] };
  const h = headerRow(matrix);
  return { headers: matrix[h], rows: matrix.slice(h + 1) };
}

/**
 * Index der Kopfzeile. Normalerweise die erste Zeile; Amazons Transaktionsbericht hat
 * davor einige Hinweiszeilen mit nur einem Feld.
 */
function headerRow(matrix: string[][]): number {
  const filled = (r: string[]) => r.filter((v) => v !== "").length;
  if (filled(matrix[0]) >= 3) return 0;
  const head = matrix.slice(0, 20);
  const max = Math.max(...head.map(filled));
  const i = head.findIndex((r) => filled(r) >= Math.max(3, max * 0.6));
  return i < 0 ? 0 : i;
}

/** Vereinheitlicht Spaltennamen: "Event Type" / "event-type" / "event_type" → "event-type". */
export const normHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[()]/g, "");

/** Zugriff auf Spalten über mehrere mögliche Namen. */
export function columnAccessor(headers: string[]) {
  const idx = new Map<string, number>();
  headers.forEach((h, i) => {
    const k = normHeader(h);
    if (!idx.has(k)) idx.set(k, i);
  });
  const find = (...names: string[]) => {
    for (const n of names) {
      const i = idx.get(normHeader(n));
      if (i !== undefined) return i;
    }
    return -1;
  };
  return {
    has: (...names: string[]) => names.every((n) => idx.has(normHeader(n))),
    hasAny: (...names: string[]) => names.some((n) => idx.has(normHeader(n))),
    get: (row: string[], ...names: string[]) => {
      const i = find(...names);
      return i >= 0 ? (row[i] ?? "").trim() : "";
    },
  };
}
