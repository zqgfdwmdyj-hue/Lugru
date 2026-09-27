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

function detectDelimiter(firstLine: string): string {
  const counts = ["\t", ";", ",", "|"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** CSV/TSV mit Anführungszeichen, doppelten Anführungszeichen und Zeilenumbrüchen in Feldern. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const d = delimiter ?? detectDelimiter(firstLine);
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
  return { headers: matrix[0], rows: matrix.slice(1) };
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
