/**
 * Liest Zahlen aus Exporten robust ein: 84.03, "84,03", "1.234,56", "1,234.56", "84,03 €".
 * Gibt null zurück, wenn keine Zahl erkennbar ist.
 */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.replace(/[€\s]/g, "").replace(/EUR/i, "");
  if (s === "") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Das spätere Zeichen ist das Dezimaltrennzeichen.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Datum aus "27.09.2026", "2026-09-27", "27.09.26" oder Excel-Seriennummer → ISO. */
export function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:[ T].*)?$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // Amerikanisch (Amazon-Reports): MM/DD/YYYY – außer der erste Teil ist > 12.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/.exec(s);
  if (m) {
    let [mo, d] = [Number(m[1]), Number(m[2])];
    if (mo > 12) [mo, d] = [d, mo];
    return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Zeitpunkt aus ISO oder "27.09.2026 10:11:12 UTC"; ohne Zone als UTC. */
export function parseDateTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const day = parseDate(s);
  if (!day) return null;
  const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s.slice(8));
  const time = t ? `${t[1].padStart(2, "0")}:${t[2]}:${t[3] ?? "00"}` : "00:00:00";
  const d = new Date(`${day}T${time}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatEuro(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "–";
  const n = typeof value === "string" ? Number(value) : value;
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
