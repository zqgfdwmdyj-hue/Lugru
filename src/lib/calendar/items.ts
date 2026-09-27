import "server-only";
import { and, eq, gte, inArray, isNotNull, lte, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { addMonthsIso } from "@/lib/money/cashflow";
import { formatEuro } from "@/lib/numbers";

/** Ein Termin, den das System im Kalender haben möchte. */
export type Desired = {
  key: string;
  title: string;
  date: string;
  description: string;
  link: string;
  category: string;
  taskId?: string;
  /** Erinnerung um 9 Uhr – bei allem, was an dem Tag erledigt sein muss. */
  remind: boolean;
};

/** System-Aufgaben, die im Kalender schon genauer stehen (je Tag statt „in den nächsten 7 Tagen"). */
const COVERED_BY_CALENDAR = ["claims-deadline", "claims-expired", "claims-open", "cases-deadline"];

const berlinDay = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

/** Alles mit Datum, was ansteht: Aufgaben, Fristen, Versand, Ansprüche, geplante Zahlungen. */
export async function collectDesired(tenantId: string, today = todayIso()): Promise<Desired[]> {
  const t = tenantId;
  const from = addDaysIso(today, -60);
  const to = addDaysIso(today, 180);
  const out: Desired[] = [];

  const T = schema.tasks;
  const tasks = await db
    .select()
    .from(T)
    .where(and(eq(T.tenantId, t), eq(T.status, "open"), isNotNull(T.dueDate), gte(T.dueDate, from), lte(T.dueDate, to), or(sql`${T.systemKey} is null`, notInArray(T.systemKey, COVERED_BY_CALENDAR))));
  for (const k of tasks) {
    out.push({
      key: `task:${k.id}`,
      title: (k.priority === "critical" ? "‼ " : "") + k.title,
      date: k.dueDate!,
      description: [k.notes, "Aufgabe im Seller-System. Im Kalender verschieben ändert das Fälligkeitsdatum, löschen hakt sie ab."].filter(Boolean).join("\n\n"),
      link: k.link ?? "/",
      category: "Aufgabe",
      taskId: k.id,
      remind: true,
    });
  }

  const C = schema.cases;
  const cases = await db
    .select()
    .from(C)
    .where(and(eq(C.tenantId, t), inArray(C.status, ["open", "waiting"]), isNotNull(C.deadline), gte(C.deadline, from), lte(C.deadline, to)));
  for (const c of cases) {
    out.push({
      key: `case:${c.id}`,
      title: `Frist: ${c.title}`,
      date: c.deadline!,
      description: [c.orderRef ? `Bestellung ${c.orderRef}` : null, c.customer, c.amount !== null ? formatEuro(c.amount) : null].filter(Boolean).join(" · "),
      link: `/faelle?id=${c.id}`,
      category: "Fall",
      remind: true,
    });
  }

  const A = schema.claims;
  const claims = await db
    .select({ deadline: A.deadline, title: A.title, amount: A.expectedAmount })
    .from(A)
    .where(and(eq(A.tenantId, t), inArray(A.status, ["detected", "queued"]), isNotNull(A.deadline), gte(A.deadline, today), lte(A.deadline, to)));
  const byDay = new Map<string, typeof claims>();
  for (const c of claims) byDay.set(c.deadline!, [...(byDay.get(c.deadline!) ?? []), c]);
  for (const [day, list] of byDay) {
    const sum = list.reduce((s, c) => s + (c.amount ?? 0), 0);
    out.push({
      key: `claims:${day}`,
      title: `${list.length === 1 ? "1 Anspruch" : `${list.length} Ansprüche`}: Frist läuft ab (${formatEuro(sum)})`,
      date: day,
      description: list.slice(0, 15).map((c) => `• ${c.title}`).join("\n") + (list.length > 15 ? `\n… und ${list.length - 15} weitere` : ""),
      link: "/ansprueche?ansicht=fristen",
      category: "Ansprüche",
      remind: true,
    });
  }

  const O = schema.orders;
  const orders = await db
    .select({ shipBy: O.shipBy, channel: O.channel, externalId: O.externalId })
    .from(O)
    .where(and(eq(O.tenantId, t), eq(O.fulfillment, "FBM"), inArray(O.status, ["open", "label_created"])));
  const shipDays = new Map<string, typeof orders>();
  for (const o of orders) {
    // Ohne Versandfrist: heute. Überfällige ebenfalls heute – sie müssen raus.
    const day = o.shipBy ? berlinDay(o.shipBy) : today;
    const d = day < today ? today : day;
    shipDays.set(d, [...(shipDays.get(d) ?? []), o]);
  }
  for (const [day, list] of shipDays) {
    const channels = [...new Set(list.map((o) => o.channel))].join(", ");
    out.push({
      key: `ship:${day}`,
      title: `Versand: ${list.length === 1 ? "1 Sendung" : `${list.length} Sendungen`} (${channels})`,
      date: day,
      description: list.slice(0, 20).map((o) => `• ${o.channel} ${o.externalId}`).join("\n"),
      link: "/auftraege",
      category: "Versand",
      remind: true,
    });
  }

  const M = schema.cashItems;
  const cash = await db.select().from(M).where(and(eq(M.tenantId, t), lte(M.date, addDaysIso(today, 60))));
  for (const c of cash) {
    const dates: string[] = [];
    if (c.recurrence === "none") {
      if (c.date >= today) dates.push(c.date);
    } else {
      // Wiederkehrende Posten: die Termine der nächsten 60 Tage (wie im Cash Flow gerechnet).
      for (let n = 0; n < 1000; n++) {
        const d = c.recurrence === "weekly" ? addDaysIso(c.date, 7 * n) : addMonthsIso(c.date, n);
        if (d > addDaysIso(today, 60) || (c.endDate && d > c.endDate)) break;
        if (d >= today) dates.push(d);
      }
    }
    for (const d of dates) {
      out.push({
        key: c.recurrence === "none" ? `cash:${c.id}` : `cash:${c.id}:${d}`,
        title: `${c.amount < 0 ? "Zahlung" : "Eingang"}: ${c.description} (${formatEuro(c.amount)})`,
        date: d,
        description: `Geplanter Posten im Cash Flow (${c.category}).`,
        link: "/cashflow",
        category: "Geld",
        remind: c.amount < 0,
      });
    }
  }

  return out;
}
