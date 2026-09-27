// Cash-Flow-Vorschau: geplante Posten, wiederkehrende Posten und geschätzte Amazon-Auszahlungen
// werden auf Wochen verteilt. Reine Logik – die Daten liefert die Seite.

import { addDaysIso } from "@/lib/dates";

export type CashItem = { date: string; amount: number; description: string; category: string; recurrence: "none" | "weekly" | "monthly"; endDate: string | null };
export type Payout = { date: string; amount: number };

export type Week = { start: string; inflow: number; outflow: number; entries: { date: string; amount: number; label: string; kind: "plan" | "payout" }[] };

/** Montag der Woche. */
export function weekStart(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function addMonthsIso(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Erwartete nächste Auszahlungen aus dem bisherigen Rhythmus (Abstand + Ø der letzten 4). */
export function projectPayouts(history: Payout[], today: string, until: string): Payout[] {
  const h = [...history].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-5);
  if (h.length < 2) return [];
  const gaps = h.slice(1).map((p, i) => (Date.parse(p.date) - Date.parse(h[i].date)) / 86400_000);
  const gap = Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));
  const recent = h.slice(-4);
  const avg = Math.round((recent.reduce((a, p) => a + p.amount, 0) / recent.length) * 100) / 100;
  const out: Payout[] = [];
  let next = addDaysIso(h[h.length - 1].date, gap);
  while (next <= until) {
    if (next >= today) out.push({ date: next, amount: avg });
    next = addDaysIso(next, gap);
  }
  return out;
}

export function buildWeeks(opts: { today: string; weeks: number; items: CashItem[]; payouts: Payout[] }): Week[] {
  const first = weekStart(opts.today);
  const weeks: Week[] = Array.from({ length: opts.weeks }, (_, i) => ({ start: addDaysIso(first, i * 7), inflow: 0, outflow: 0, entries: [] }));
  const end = addDaysIso(first, opts.weeks * 7 - 1);
  const put = (date: string, amount: number, label: string, kind: "plan" | "payout") => {
    if (date < opts.today || date > end) return;
    const w = weeks.find((x) => date >= x.start && date <= addDaysIso(x.start, 6));
    if (!w) return;
    if (amount >= 0) w.inflow += amount;
    else w.outflow += -amount;
    w.entries.push({ date, amount, label, kind });
  };
  for (const it of opts.items) {
    if (it.recurrence === "none") put(it.date, it.amount, it.description, "plan");
    else {
      let d = it.date;
      let n = 0;
      while (d <= end && n < 400) {
        if (!it.endDate || d <= it.endDate) put(d, it.amount, it.description, "plan");
        n++;
        d = it.recurrence === "weekly" ? addDaysIso(it.date, 7 * n) : addMonthsIso(it.date, n);
      }
    }
  }
  for (const p of opts.payouts) put(p.date, p.amount, "Amazon-Auszahlung (geschätzt)", "payout");
  return weeks;
}
