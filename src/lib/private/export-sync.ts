import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration } from "@/lib/integrations/store";
import { EXPORTABLE_KINDS, exportCalendarProblem, neutralExportItems } from "./export-logic";

/** Standardname des geschäftlichen System-Kalenders (wie in calendar/sync.ts). */
const DEFAULT_CALENDAR_NAME = "Seller-System";
import { privateSettings } from "./service";

/**
 * Für den Kalender-Abgleich: ist der private Export eingeschaltet, welche neutralen Termine gehören hinein?
 * Liest nur die exportierbaren Arten dieser Firma; Inhalte verlassen das System nicht (nur Datum + „Privater Termin“).
 */
export async function privateExport(tenantId: string, from: string, to: string) {
  const s = await privateSettings(tenantId);
  if (!s.externSync.enabled) return { enabled: false as const, calendar: s.externSync.calendar, items: [] };
  const E = schema.privateEntries;
  const rows = await db.select({ id: E.id, kind: E.kind, data: E.data }).from(E).where(and(eq(E.tenantId, tenantId), inArray(E.kind, [...EXPORTABLE_KINDS])));
  return { enabled: true as const, calendar: s.externSync.calendar, items: neutralExportItems(rows, from, to) };
}

/** Name des privaten Export-Kalenders (auch wenn aus) – damit er nie als Familienkalender zurückgelesen wird. */
export async function privateExportCalendar(tenantId: string) {
  const s = await privateSettings(tenantId);
  return s.externSync.enabled ? s.externSync.calendar : null;
}

/** Prüft den gewünschten Export-Kalender gegen den System-Kalender und die Mitarbeiter-Kalender dieser Firma. */
export async function exportTargetProblem(tenantId: string, name: string): Promise<string | null> {
  const [cfg, tenant] = await Promise.all([
    getIntegration(tenantId, "apple_calendar"),
    db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)),
  ]);
  return exportCalendarProblem(name, cfg?.calendarName || DEFAULT_CALENDAR_NAME, tenant[0]?.settings.calendar?.staffCalendars);
}
