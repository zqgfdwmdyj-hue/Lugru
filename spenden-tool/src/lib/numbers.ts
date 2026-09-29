/** Liest Beträge wie „0,50“, „2.5“, „1.234,56 €“. Gibt null zurück, wenn keine Zahl erkennbar ist. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.replace(/[€\s]/g, "").replace(/EUR/i, "");
  if (s === "") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lastComma > -1) s = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** „2026-09-12“ aus einem Datumsfeld; sonst null. */
export function parseIsoDate(value: unknown): string | null {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function formatEuro(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
