// Rechnungshelfer ohne Webhook: Text der Discord-Nachricht („Rechnungshelfer“) einlesen –
// Pos 1 — Name / Menge: 3 | Netto: 480,00 | Brutto: 571,20 / … / Notiz: Ticket: acht-10001,
// [Pos1] Name: 900000000001 (3x) / Leistungszeitraum: 07.10.2026 / Zahlungsziel: Instant.
// Ergebnis hat dieselbe Form wie der JSON-Export und läuft durch dieselbe Prüfung.

const num = (s: string | undefined) => {
  if (!s) return null;
  const t = s.replace(/[€\s]/g, "");
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
};
const iso = (d: string) => {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(d);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : undefined;
};
// Discord kopiert Inline-Code mit Backticks, Embeds mit Sonderzeichen – vorher glätten.
const clean = (t: string) => t.replace(/`/g, "").replace(/\*\*/g, "").replace(/ /g, " ").replace(/\r/g, "");

export type ParsedText = Record<string, unknown> & { ticket: string; positions: { product_name: string; quantity: number; net_unit_price: number }[] };

export function parseRechnungshelferText(raw: string, opts: { now?: Date } = {}): { draft: ParsedText; notes: string[] } | null {
  const text = clean(raw);
  const notes: string[] = [];
  const blocks = text.split(/(?=\bPos\.?\s*\d+\s*[—–-]{1,2}\s)/i).filter((b) => /^Pos/i.test(b));
  const positions = blocks
    .map((b) => {
      const head = /^Pos\.?\s*(\d+)\s*[—–-]{1,2}\s*([^\n]+?)\s*(?:\n|Menge:)/i.exec(b + "\n");
      const qty = /Menge:\s*([\d.,]+)/i.exec(b);
      const net = /Menge:[^\n]*?Netto:\s*([\d.,]+)/i.exec(b) ?? /(?<!Gesamt )Netto:\s*([\d.,]+)/i.exec(b);
      if (!head || !qty || !net) return null;
      return { no: Number(head[1]), product_name: head[2].trim(), quantity: num(qty[1]) ?? 0, net_unit_price: num(net[1]) ?? NaN, tax_rate: 19 };
    })
    .filter((p): p is NonNullable<typeof p> => Boolean(p) && p!.quantity > 0 && Number.isFinite(p!.net_unit_price));
  if (!positions.length) return null;

  // Sendungen je Position aus der Notiz: „[Pos1] PS5 Slim Test: 900000000001 (3x)“.
  for (const m of text.matchAll(/\[Pos\s*(\d+)\]\s*[^:\n]*:\s*([^\n]+)/gi)) {
    const p = positions.find((x) => x.no === Number(m[1]));
    if (p) (p as Record<string, unknown>).description = m[2].trim();
  }

  const ticket = /Ticket:\s*([\w.-]+)/i.exec(text)?.[1];
  const now = opts.now ?? new Date();
  if (!ticket) notes.push("Kein Ticket im Text gefunden – bitte Referenz im Formular ergänzen.");
  const total = /Gesamt\s*[—–-]{1,2}\s*Netto:\s*([\d.,]+)\s*\|\s*Brutto:\s*([\d.,]+)/i.exec(text);
  const period = /Leistungszeitraum:\s*(\d{1,2}\.\d{1,2}\.\d{4})(?:\s*(?:-|–|bis)\s*(\d{1,2}\.\d{1,2}\.\d{4}))?/i.exec(text);
  const term = /Zahlungsziel:?\s*(Instant|Sofort|\d{1,3}\s*Tage?)/i.exec(text)?.[1] ?? /(Instant|\d{1,3}\s*Tage?)\s*\|\s*Netto:/i.exec(text)?.[1];

  return {
    notes,
    draft: {
      type: "invoice_draft",
      _source: "text",
      ticket: ticket ?? `discord-${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`,
      ...(term ? { payment_term: term } : {}),
      ...(/reverse[\s-]?charge/i.test(text) ? { is_reverse_charge: true } : {}),
      positions: positions.map(({ no: _no, ...p }) => p),
      ...(total ? { totals: { net: num(total[1]), gross: num(total[2]) } } : {}),
      ...(period ? { delivery: { date: iso(period[1]), date_until: period[2] ? iso(period[2]) : iso(period[1]) } } : {}),
    },
  };
}

/** Anweisung an die KI für Screenshots des Rechnungshelfers (ein oder mehrere Bilder). */
export const SCREENSHOT_PROMPT = `Die Bilder zeigen eine Discord-Nachricht „Rechnungshelfer“ (Ankauf, Rechnung an den Ankäufer), evtl. über mehrere Screenshots verteilt.
Lies NUR ab, was dort steht – nichts erfinden, nichts rechnen. Antworte ausschließlich mit JSON in genau dieser Form:
{"ticket":"acht-10001","payment_term":"Instant","is_reverse_charge":null,"positions":[{"product_name":"PS5 Slim Test","quantity":3,"net_unit_price":480.00,"description":"900000000001 (3x)"}],"totals":{"net":1440.00,"gross":1713.60},"delivery":{"date":"2026-10-07","date_until":"2026-10-07"}}
Regeln:
- positions: jede „Pos N — Name“ mit Menge und Netto (Einzelpreis netto, NICHT Gesamt Netto). Zahlen mit Punkt als Dezimaltrenner.
- description: die Sendungsnummern zu dieser Position aus „Lieferübersicht/Sendungsdaten“ ([PosN] …: 900000000001 (3x)), sonst null.
- ticket: aus „Ticket: …“ in der Notiz oder dem Kanalnamen oben (z. B. #acht-10001 → "acht-10001").
- totals: aus „Gesamt — Netto … | Brutto …“. delivery: „Leistungszeitraum“ als JJJJ-MM-TT (bis = von, wenn nur ein Datum).
- payment_term: „Instant“ oder „N Tage“, wenn erkennbar, sonst null. is_reverse_charge: true nur wenn „Reverse Charge“ ausdrücklich dasteht, sonst null.
- Ist kein Rechnungshelfer zu sehen: {"error":"kein Rechnungshelfer"}`;
