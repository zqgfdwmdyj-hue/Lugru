// Versandgewicht einer Sendung – reine Logik, testbar. Vorrang: einmal eingetragenes Versandgewicht je Artikel
// (inkl. Verpackung, × Stück) → Artikelgewicht aus den Produktdaten + Verpackung → Schätzwert je Stück.

export type WeightItem = { quantity: number; title?: string | null; shipGrams: number | null; productGrams: number | null };
export type WeightSource = "hinterlegt" | "artikeldaten" | "geschaetzt";
export type ShipWeight = { kg: number; source: WeightSource; note: string };

const kg = (g: number) => `${(Math.round(g) / 1000).toLocaleString("de-DE", { maximumFractionDigits: 3 })} kg`;

export function shipWeight(items: WeightItem[], opts: { defaultGrams: number; packagingGrams: number }): ShipWeight {
  const list = items.filter((i) => i.quantity > 0);
  if (!list.length) {
    const g = opts.defaultGrams + opts.packagingGrams;
    return { kg: Math.round(g) / 1000, source: "geschaetzt", note: `geschätzt ${kg(g)}` };
  }
  let total = 0;
  let packaging = false;
  let estimated = false;
  const parts: string[] = [];
  for (const i of list) {
    const per = i.shipGrams ?? i.productGrams ?? opts.defaultGrams;
    if (i.shipGrams === null) packaging = true;
    if (i.shipGrams === null && i.productGrams === null) estimated = true;
    total += i.quantity * per;
    parts.push(`${i.quantity} × ${kg(per)}`);
  }
  if (packaging) total += opts.packagingGrams;
  const sum = Math.round(total);
  const note = `${parts.join(" + ")}${packaging ? ` + ${kg(opts.packagingGrams)} Verpackung` : ""} = ${kg(sum)}${estimated ? " (geschätzt)" : ""}`;
  return { kg: sum / 1000, source: estimated ? "geschaetzt" : packaging ? "artikeldaten" : "hinterlegt", note };
}

/** „0,3“ / „0.3“ / „300 g“ → Gramm (null bei ungültig, 0 = löschen). */
export function parseWeightInput(v: string): number | null {
  const t = v.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  const m = /^(\d+(?:[.,]\d+)?)(kg|g)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const grams = m[2] === "g" ? n : n * 1000;
  return grams >= 0 && grams <= 31500 ? Math.round(grams) : null;
}
