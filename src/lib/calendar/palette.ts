import "server-only";
import { eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import { KIND_STYLE } from "@/lib/private/kind-style";
import { SYSTEM_CATEGORIES, calendarAbbreviations, distinctCalendarColors } from "./colors";

/**
 * Farbe und Kürzel je eigenem Kalender – einmal über alle Kalender der Firma berechnet, damit „Privat“ im
 * Geschäftskalender, auf der Startseite und im Privatkalender gleich aussieht (unabhängig vom Monat).
 */
export const calendarPalette = cache(async (tenantId: string) => {
  const E = schema.calendarEvents;
  const rows = await db
    .select({ name: E.calendarName, color: sql<string | null>`max(${E.color})` })
    .from(E)
    .where(eq(E.tenantId, tenantId))
    .groupBy(E.calendarName);
  const reserved = [...Object.values(SYSTEM_CATEGORIES).map((c) => c.color), ...Object.values(KIND_STYLE).map((k) => k.color)];
  return { colors: distinctCalendarColors(rows, reserved), abbr: calendarAbbreviations(rows.map((r) => r.name)) };
});
