// Einkaufsliste für eine Box: aus den Bestandteilen und der geplanten Stückzahl, in ganzen Kartons.
// Ohne Server-Abhängigkeiten.

import type { BoxComponent } from "@/db/tables/brands";

/** „4× Warheads Extreme Sour (12 x 28g) (je 0,79 €)“ → Menge und Titel. */
export function parseContentLine(line: string): { qty: number; title: string } | null {
  const m = line.trim().match(/^(\d+)\s*[×x]\s+(.+?)(?:\s*\(je [^)]*\))?$/i);
  if (!m) return null;
  return { qty: Number(m[1]), title: m[2].trim() };
}

export type ShoppingRow = BoxComponent & { unitsNeeded: number; cases: number; orderUnits: number; cost: number | null };

export function shoppingList(components: BoxComponent[], boxes: number): { rows: ShoppingRow[]; total: number; bySupplier: Record<string, number> } {
  const rows = components.map((c) => {
    const unitsNeeded = c.qty * boxes;
    const cases = Math.max(1, Math.ceil(unitsNeeded / Math.max(1, c.caseQty)));
    const cost = c.casePrice === null ? null : Math.round(cases * c.casePrice * 100) / 100;
    return { ...c, unitsNeeded, cases, orderUnits: cases * Math.max(1, c.caseQty), cost };
  });
  const bySupplier: Record<string, number> = {};
  for (const r of rows) if (r.cost !== null) bySupplier[r.feedName] = Math.round(((bySupplier[r.feedName] ?? 0) + r.cost) * 100) / 100;
  return { rows, total: Math.round(rows.reduce((s, r) => s + (r.cost ?? 0), 0) * 100) / 100, bySupplier };
}

/** Text zum Kopieren (z. B. für eine Bestellung per Mail oder den Warenkorb). */
export function shoppingText(title: string, boxes: number, rows: ShoppingRow[]): string {
  return [`Einkauf für ${boxes}× „${title}“`, ...rows.map((r) => `${r.cases} Karton${r.cases === 1 ? "" : "s"} – ${r.title}${r.supplierSku ? ` [${r.supplierSku}]` : ""}${r.url ? ` – ${r.url}` : ""}`)].join("\n");
}
