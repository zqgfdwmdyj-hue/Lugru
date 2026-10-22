import "server-only";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { monthRange, monthlyBill } from "./billing";
import { getSettings } from "@/lib/settings";

/** Alle Paletten, die im Monat irgendwann eingelagert waren – mit Abrechnung je Kunde. */
export async function loadMonthBill(tenantId: string, month: string) {
  const P = schema.pallets;
  const { first, last } = monthRange(month);
  const rates = (await getSettings(tenantId)).pallets;
  const rows = await db
    .select()
    .from(P)
    .where(and(eq(P.tenantId, tenantId), lte(P.inAt, last), or(isNull(P.outAt), gte(P.outAt, first))))
    .orderBy(P.customer, P.inAt, P.code);
  return { rates, ...monthlyBill(rows, month, rates) };
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export function shiftMonth(m: string, delta: number): string {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
