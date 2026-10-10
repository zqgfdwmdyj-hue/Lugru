// Amazon Business → Beschaffungsanalyse → Bericht „Sendungen“ (DE/FR/ES/IT/EN) für den Ankauf-Server
// bereinigen: nur Bestellungen, die an die Ankauf-Adresse (z. B. Bremerhaven) gehen, bleiben drin –
// alle anderen Lieferungen (eigene Adresse, Kunden) fliegen raus, bevor die Datei in Discord landet.
// Läuft im Browser: die Datei verlässt das Gerät nicht. Kein "server-only".

export type Role = "order" | "tracking" | "date" | "qty" | "address" | "asin" | "title";

/** Pflichtspalten laut Anleitung des Ankauf-Servers, je Sprache des Amazon-Berichts. */
const HEADERS: Record<Role, string[]> = {
  order: ["Bestellnummer", "Order ID", "Numéro de la commande", "Número de pedido", "Numero dell'ordine"],
  tracking: ["Sendungsverfolgung", "Carrier Tracking #", "Numéro de suivi du transporteur", "Seguimiento del transportista #", "N. di tracciabilità del corriere"],
  date: ["Lieferdatum", "Shipment Date", "Date d'expédition", "Fecha de envío", "Data spedizione"],
  qty: ["Liefermenge", "Shipment Quantity", "Quantité expédiée", "Cantidad del envío", "Quantità spedizione"],
  address: ["Versandadresse", "Shipping Address", "Adresse d'expédition", "Dirección de envío", "Indirizzo di spedizione"],
  asin: ["ASIN"],
  title: ["Titel", "Title", "Titre", "Título", "Titolo"],
};
export const ROLE_LABEL: Record<Role, string> = {
  order: "Bestellnummer",
  tracking: "Sendungsverfolgung",
  date: "Lieferdatum",
  qty: "Liefermenge",
  address: "Versandadresse",
  asin: "ASIN",
  title: "Titel",
};
const LANG = ["DE", "EN", "FR", "ES", "IT"] as const;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** CSV lesen: Trennzeichen , ; oder Tab, Anführungszeichen, Zeilenumbrüche in Feldern, BOM. */
export function parseCsv(text: string): { rows: string[][]; delimiter: string; bom: boolean; eol: string } {
  const bom = text.charCodeAt(0) === 0xfeff;
  const t = bom ? text.slice(1) : text;
  const firstLine = t.slice(0, t.search(/\r?\n/) === -1 ? t.length : t.search(/\r?\n/));
  const count = (d: string) => firstLine.replace(/"[^"]*"/g, "").split(d).length - 1;
  const delimiter = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return { rows, delimiter, bom, eol: /\r\n/.test(t) ? "\r\n" : "\n" };
}

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

export type CleanResult = {
  language: (typeof LANG)[number] | null;
  /** Fehlende Pflichtspalten (im Amazon-Bericht ergänzen). */
  missing: Role[];
  total: number;
  kept: number;
  /** Bestellungen an andere Adressen – entfernt. */
  removed: number;
  withoutTracking: number;
  preview: Record<Role, string>[];
  /** Bereinigte Datei – gleiche Spalten, Sprache und Trennzeichen wie das Original. */
  csv: string;
};

/**
 * Nur Bestellungen an die Ankauf-Adresse behalten. Eine Bestellung zählt, wenn irgendeine ihrer
 * Zeilen an die Adresse geht – dann bleiben alle ihre Zeilen drin (auch stornierte ohne Adresse).
 */
export function cleanReport(text: string, addressTerms: string[]): CleanResult {
  const { rows, delimiter, bom, eol } = parseCsv(text);
  const header = rows[0] ?? [];
  const idx = {} as Record<Role, number>;
  let language: CleanResult["language"] = null;
  for (const role of Object.keys(HEADERS) as Role[]) {
    const names = HEADERS[role].map(norm);
    idx[role] = header.findIndex((h) => names.some((n) => norm(h) === n || (n.length > 6 && norm(h).startsWith(n))));
    if (idx[role] >= 0 && role !== "asin" && !language) {
      const at = names.findIndex((n) => norm(header[idx[role]]) === n || norm(header[idx[role]]).startsWith(n));
      language = HEADERS[role].length === 5 ? LANG[at] : null;
    }
  }
  const missing = (Object.keys(HEADERS) as Role[]).filter((r) => idx[r] < 0);
  const body = rows.slice(1);
  const terms = addressTerms.map(norm).filter(Boolean);
  const get = (r: string[], role: Role) => (idx[role] >= 0 ? (r[idx[role]] ?? "").trim() : "");
  const matches = (r: string[]) => terms.length > 0 && terms.some((t) => norm(get(r, "address")).includes(t));
  // Ohne Adressspalte lässt sich nichts sicher bereinigen → nichts herausgeben.
  const ours = idx.address < 0 ? new Set<string>() : new Set(body.filter(matches).map((r) => get(r, "order")));
  const kept = idx.address < 0 ? [] : body.filter((r) => matches(r) || (idx.order >= 0 && get(r, "order") !== "" && ours.has(get(r, "order"))));
  const csv = (bom ? "﻿" : "") + [header, ...kept].map((r) => header.map((_, i) => quote(r[i] ?? "")).join(delimiter)).join(eol) + eol;
  return {
    language,
    missing,
    total: body.length,
    kept: kept.length,
    removed: body.length - kept.length,
    withoutTracking: kept.filter((r) => !get(r, "tracking")).length,
    preview: kept.slice(0, 200).map((r) => Object.fromEntries((Object.keys(HEADERS) as Role[]).map((role) => [role, get(r, role)])) as Record<Role, string>),
    csv,
  };
}
