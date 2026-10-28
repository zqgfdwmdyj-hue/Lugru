import { shipmentShortages } from "@/lib/sellerboard/parse";

// Bestandsabweichungen an einer Stelle (reine Logik, ohne Datenbank): wo Soll und Ist nicht zusammenpassen.
// Nur anzeigen – korrigiert wird nichts automatisch.

export const DISCREPANCY_KINDS = ["fba_sendung", "inventur", "negativ", "amazon_klaerung", "amazon_unverkaeuflich", "zuordnung"] as const;
export type DiscrepancyKind = (typeof DISCREPANCY_KINDS)[number];

export const DISCREPANCY_LABEL: Record<DiscrepancyKind, string> = {
  fba_sendung: "FBA-Sendung: weniger empfangen als verschickt",
  inventur: "Inventur: gezählt ≠ Bestand laut System",
  negativ: "Eigenes Lager negativ",
  amazon_klaerung: "Amazon sucht Ware (in Klärung)",
  amazon_unverkaeuflich: "Unverkäuflich bei Amazon",
  zuordnung: "Bestand nicht abgleichbar (Zuordnung fehlt)",
};

export type Discrepancy = {
  kind: DiscrepancyKind;
  sku: string;
  title: string | null;
  /** Soll (verschickt / laut System), Ist (empfangen / gezählt) – wo es das gibt. */
  expected: number | null;
  actual: number | null;
  /** Ist − Soll (negativ = fehlt) bzw. betroffene Menge. */
  diff: number;
  detail: string;
  since: string | null;
  href: string;
};

export type DiscrepancyInput = {
  today: string;
  shipments: { name: string | null; amazonId: string | null; status: string; lastUpdate: string | null; lines: { sku: string; name: string | null; units: number; received: number }[] }[];
  /** Offene Inventuren: Zeilen mit Soll und gezählter Menge. */
  countLines: { countId: string; countName: string; sku: string; expected: number; counted: number }[];
  ownStock: { sku: string; quantity: number }[];
  amazon: { sku: string; title: string | null; unsellable: number; researching: number; unsellableSince: string | null }[];
  /** Zuordnungsprobleme aus der Arbeitsliste (Angebot ohne Lager, verkaufte SKU ohne Zuordnung). */
  mapping: { kind: string; sku: string; title: string | null; detail: string; href: string }[];
  /** Tage ohne Änderung, ab denen eine Sendung in Annahme als abgeschlossen gilt. */
  graceDays?: number;
};

export function stockDiscrepancies(i: DiscrepancyInput): Discrepancy[] {
  const out: Discrepancy[] = [];
  for (const s of i.shipments) {
    for (const l of shipmentShortages(s, i.today, i.graceDays ?? 14)) {
      out.push({ kind: "fba_sendung", sku: l.sku, title: l.name, expected: l.units, actual: l.received, diff: -l.missing, detail: `${s.name ?? "Sendung"}${s.amazonId ? ` (${s.amazonId})` : ""} · Status ${s.status}`, since: s.lastUpdate, href: "/inbound" });
    }
  }
  for (const c of i.countLines) {
    if (c.counted === c.expected) continue;
    out.push({ kind: "inventur", sku: c.sku, title: null, expected: c.expected, actual: c.counted, diff: c.counted - c.expected, detail: `Inventur „${c.countName}“ (noch nicht gebucht)`, since: null, href: `/bestand/inventur/${c.countId}` });
  }
  for (const o of i.ownStock) {
    if (o.quantity >= 0) continue;
    out.push({ kind: "negativ", sku: o.sku, title: null, expected: 0, actual: o.quantity, diff: o.quantity, detail: "Mehr ausgebucht als eingebucht – Wareneingang oder Verkauf fehlt/doppelt?", since: null, href: `/bestand?q=${encodeURIComponent(o.sku)}` });
  }
  for (const a of i.amazon) {
    if (a.researching > 0) out.push({ kind: "amazon_klaerung", sku: a.sku, title: a.title, expected: null, actual: null, diff: -a.researching, detail: `${a.researching} Stück sucht Amazon gerade – wird nach 30 Tagen ohne Fund zum Anspruch`, since: null, href: "/ansprueche" });
    if (a.unsellable > 0) out.push({ kind: "amazon_unverkaeuflich", sku: a.sku, title: a.title, expected: null, actual: null, diff: -a.unsellable, detail: `${a.unsellable} Stück unverkäuflich – Rücksendung oder Entsorgung beauftragen`, since: a.unsellableSince, href: "/bestand" });
  }
  for (const m of i.mapping) {
    if (m.kind !== "angebot-ohne-lager" && m.kind !== "verkauft-unbekannt") continue;
    out.push({ kind: "zuordnung", sku: m.sku, title: m.title, expected: null, actual: null, diff: 0, detail: m.detail, since: null, href: m.href });
  }
  const order = (k: DiscrepancyKind) => DISCREPANCY_KINDS.indexOf(k);
  return out.sort((a, b) => order(a.kind) - order(b.kind) || Math.abs(b.diff) - Math.abs(a.diff) || a.sku.localeCompare(b.sku));
}

/** Tage bis zu einer Frist (negativ = vorbei). */
export function daysLeft(today: string, deadline: string | null): number | null {
  if (!deadline) return null;
  return Math.round((Date.parse(`${deadline}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}
