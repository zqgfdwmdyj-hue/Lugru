import { addDaysIso } from "@/lib/dates";

// Zeiträume für Gewinn und Korrekturliste.

export const RANGES = { "30": "Letzte 30 Tage", monat: "Dieser Monat", vormonat: "Letzter Monat", "90": "Letzte 90 Tage", jahr: "Dieses Jahr" } as const;
export type Range = keyof typeof RANGES;

export function rangeOf(r: Range, today: string): [string, string] {
  const [y, m] = today.split("-").map(Number);
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  switch (r) {
    case "monat": return [first(y, m), today];
    case "vormonat": { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return [first(py, pm), addDaysIso(first(y, m), -1)]; }
    case "90": return [addDaysIso(today, -89), today];
    case "jahr": return [`${y}-01-01`, today];
    default: return [addDaysIso(today, -29), today];
  }
}

