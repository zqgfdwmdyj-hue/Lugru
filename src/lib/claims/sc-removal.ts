// Seller-Central-Seiten der Remissionsaufträge auslesen (vom Lesezeichen erfasst oder eingefügt).
// Reine Logik ohne Datenbank: Text rein → Aufträge mit Paketen, FNSKU × Anzahl und Sendungsverfolgung raus.

export type ScPage = { url: string; orderId?: string | null; rowText?: string | null; text: string };
export type ScCapture = { scRemoval: 1; from?: string; at?: string; pages: ScPage[] };

export type ScPackage = {
  tracking: string;
  carrier: string | null;
  shipmentDate: string | null;
  items: { fnsku: string | null; quantity: number }[];
  lastEvent: string | null;
  lastEventAt: string | null;
};
export type ScOrder = { orderId: string; url: string; requestDate: string | null; packages: ScPackage[] };

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mär: 3, märz: 3, mar: 3, march: 3, maerz: 3, apr: 4, april: 4,
  mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, dez: 12, dezember: 12, dec: 12, december: 12,
};
const iso = (y: number, m: number, d: number) =>
  y > 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;

const DATE_PATTERNS: { re: RegExp; f: (m: RegExpMatchArray) => string | null }[] = [
  { re: /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/, f: (m) => iso(+m[1], +m[2], +m[3]) },
  { re: /\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/, f: (m) => iso(+m[3], +m[2], +m[1]) },
  { re: /\b(\d{1,2})\.?\s+([A-Za-zäÄ]{3,9})\.?\s+(20\d{2})\b/, f: (m) => (MONTHS[m[2].toLowerCase()] ? iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) : null) },
  { re: /\b([A-Za-zäÄ]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})\b/, f: (m) => (MONTHS[m[1].toLowerCase()] ? iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) : null) },
];

/** Erstes Datum im Text (ISO, 31.07.2026, 31. Juli 2026, Jul 31, 2026). */
export function parseLooseDate(s: string): string | null {
  let best: { at: number; v: string } | null = null;
  for (const p of DATE_PATTERNS) {
    const m = s.match(p.re);
    const v = m ? p.f(m) : null;
    if (m && v && (!best || m.index! < best.at)) best = { at: m.index!, v };
  }
  return best?.v ?? null;
}

const FNSKU = /\b(X0[0-9A-Z]{8}|B0[0-9A-Z]{8})\b/;
const TRACK_WITH_CARRIER = /([A-Z0-9][A-Z0-9-]{5,34})\s*\(\s*([A-Z][A-Z0-9_]{2,40})\s*\)/g;
const TRACK_LABEL = /(?:Sendungsverfolgungsnummer(?:\(n\))?|Sendungsnummer|Tracking[- ]?(?:number|ID)s?(?:\(s\))?)\s*:?\s*([A-Z0-9][A-Z0-9-]{7,34})/gi;
const TIME = /\b\d{1,2}:\d{2}\b/;

function orderIdOf(p: ScPage): string | null {
  if (p.orderId?.trim()) return p.orderId.trim();
  const m = p.text.match(/(?:Remissionsauftrags?-?(?:nummer|ID)|Removal[- ]order[- ]ID|Auftrags-?(?:nummer|ID)|Order ID)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{5,29})/i);
  if (m) return m[1];
  try {
    const u = new URL(p.url);
    for (const k of ["orderId", "removalOrderId", "orderID", "id"]) {
      const v = u.searchParams.get(k);
      if (v && /^[A-Za-z0-9-]{6,30}$/.test(v)) return v;
    }
  } catch {
    /* keine URL */
  }
  return null;
}

function requestDateOf(p: ScPage): string | null {
  if (p.rowText) {
    const d = parseLooseDate(p.rowText);
    if (d) return d;
  }
  const m = p.text.match(/(?:Anforderungsdatum|Angefordert am|Erstellt am|Erstellungsdatum|Auftragsdatum|Request(?:ed)? date|Created(?: on)?|Order date)\s*:?\s*([^\n]{0,40})/i);
  return m ? parseLooseDate(m[1]) : null;
}

const standaloneQty = (s: string) => (/^\d{1,5}$/.test(s.trim()) ? Number(s.trim()) : null);

function itemsOf(lines: string[]): ScPackage["items"] {
  const byKey = new Map<string, number>();
  lines.forEach((line, i) => {
    const f = line.match(FNSKU);
    if (!f) return;
    const cells = line.split(/\t| {2,}|\|/).map((c) => c.trim()).filter(Boolean);
    let qty: number | null = null;
    for (let k = cells.length - 1; k >= 0 && qty === null; k--) if (!FNSKU.test(cells[k])) qty = standaloneQty(cells[k]);
    // Zellen untereinander (z. B. aus Web-Komponenten): die nächste reine Zahl gehört dazu.
    for (let k = i + 1; k <= i + 5 && qty === null && k < lines.length; k++) {
      if (FNSKU.test(lines[k])) break;
      qty = standaloneQty(lines[k]);
    }
    if (qty === null || qty <= 0) return;
    // Doppelt erfasste Zeilen nicht addieren.
    byKey.set(f[1], Math.max(byKey.get(f[1]) ?? 0, qty));
  });
  const items = [...byKey].map(([fnsku, quantity]) => ({ fnsku, quantity }));
  if (items.length) return items;
  const idx = lines.findIndex((l) => /Versandte St(ü|ue)ckzahl|Shipped (quantity|units)/i.test(l));
  if (idx >= 0) {
    for (let k = idx; k < Math.min(lines.length, idx + 6); k++) {
      const q = k === idx ? standaloneQty(lines[k].split(/\t/).pop() ?? "") : standaloneQty(lines[k]);
      if (q) return [{ fnsku: null, quantity: q }];
    }
  }
  return [];
}

function eventsOf(lines: string[]) {
  let last: { at: string; text: string } | null = null;
  for (const line of lines) {
    if (!TIME.test(line)) continue;
    const at = parseLooseDate(line);
    if (!at) continue;
    const text = line
      .replace(/^[A-Za-z]{2,3},\s*/, "")
      .replace(/\b[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+20\d{2}\b|\b\d{1,2}\.\d{1,2}\.20\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b/, "")
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?\s*(CES?T|UTC|GMT|MES?Z)?/i, "")
      .split(/\t| {2,}/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" · ")
      .slice(0, 200);
    if (!last || at > last.at) last = { at, text };
  }
  return last;
}

function packagesOf(text: string): ScPackage[] {
  const starts: { at: number; end: number; tracking: string; carrier: string | null }[] = [];
  for (const m of text.matchAll(TRACK_WITH_CARRIER)) {
    if ((m[1].match(/\d/g) ?? []).length < 5) continue;
    starts.push({ at: m.index!, end: m.index! + m[0].length, tracking: m[1], carrier: m[2] });
  }
  if (!starts.length) {
    for (const m of text.matchAll(TRACK_LABEL)) {
      if ((m[1].match(/\d/g) ?? []).length < 5) continue;
      starts.push({ at: m.index!, end: m.index! + m[0].length, tracking: m[1], carrier: null });
    }
  }
  const out = new Map<string, ScPackage>();
  starts.forEach((s, i) => {
    const block = text.slice(s.end, starts[i + 1]?.at ?? text.length);
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const shipM = block.match(/(?:Versanddatum|Versandt am|Ship(?:ment|ped)? date)\s*:?\s*([^\n]{0,40})/i);
    const ev = eventsOf(lines);
    const prev = out.get(s.tracking);
    const pkg: ScPackage = prev ?? { tracking: s.tracking, carrier: s.carrier, shipmentDate: shipM ? parseLooseDate(shipM[1]) : null, items: [], lastEvent: null, lastEventAt: null };
    for (const it of itemsOf(lines)) {
      const same = pkg.items.find((x) => x.fnsku === it.fnsku);
      if (same) same.quantity = Math.max(same.quantity, it.quantity);
      else pkg.items.push(it);
    }
    if (ev && (!pkg.lastEventAt || ev.at > pkg.lastEventAt)) {
      pkg.lastEventAt = ev.at;
      pkg.lastEvent = ev.text;
    }
    out.set(s.tracking, pkg);
  });
  return [...out.values()];
}

export function parseScPage(p: ScPage): ScOrder | null {
  const orderId = orderIdOf(p);
  if (!orderId) return null;
  return { orderId, url: p.url, requestDate: requestDateOf(p), packages: packagesOf(p.text.replace(/\r/g, "")) };
}

/** Eingefügten Inhalt deuten: JSON vom Lesezeichen oder einfach kopierter Seitentext (Strg+A, Strg+C). */
export function readScInput(raw: string): ScPage[] {
  const t = raw.trim();
  if (t.startsWith("{")) {
    try {
      const c = JSON.parse(t) as Partial<ScCapture>;
      if (c.scRemoval === 1 && Array.isArray(c.pages))
        return c.pages.filter((p) => p && typeof p.text === "string").map((p) => ({ url: String(p.url ?? ""), orderId: p.orderId ?? null, rowText: p.rowText ?? null, text: p.text.slice(0, 60000) }));
    } catch {
      /* kein JSON */
    }
  }
  return t ? [{ url: "", text: t.slice(0, 200000) }] : [];
}

/** Link auf den Seller-Central-Bericht „Remissionsauftragsdetails“, gefiltert auf abgeschlossene Aufträge. */
export function sellerCentralRemovalUrl(from: string, to: string, host = "sellercentral.amazon.de") {
  const f = (d: string) => d.replace(/-/g, "/");
  const q = JSON.stringify({ filters: ["", "", "", "", "COMPLETE"], pageOffset: 1, searchDays: -1, startDate: f(from), endDate: f(to) });
  return `https://${host}/reportcentral/REMOVAL_ORDER_DETAIL/0/${encodeURIComponent(q)}`;
}

/** KI-Auftrag, falls das Muster auf einer Seite nichts findet (Layout geändert). */
export function scAiPrompt(text: string) {
  return [
    "Das ist der Text einer Amazon-Seller-Central-Seite zu einem Remissionsauftrag. Liste alle Pakete auf.",
    "Pro Paket: tracking (Sendungsverfolgungsnummer), carrier (Kürzel in Klammern dahinter, z. B. TENDRON_VRETURN, sonst null), items (FNSKU und versandte Stückzahl), lastEvent (letzter Eintrag der Sendungsverfolgung, falls sichtbar), lastEventAt (dessen Datum als YYYY-MM-DD).",
    "Nichts erfinden, fehlende Angaben null. Antworte NUR mit JSON:",
    '{"orderId":"…","packages":[{"tracking":"123456789","carrier":"TENDRON_VRETURN","items":[{"fnsku":"X00…","quantity":1}],"lastEvent":null,"lastEventAt":null}]}',
    "--- SEITE ---",
    text.slice(0, 30000),
  ].join("\n");
}

/** JSON-Objekt aus einer KI-Antwort holen (auch aus Codeblöcken). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
