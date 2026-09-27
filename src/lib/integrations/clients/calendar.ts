import "server-only";
import { CalDavClient } from "@/lib/calendar/caldav";
import { DEFAULT_CALENDAR_NAME, syncCalendar } from "@/lib/calendar/sync";
import { registerTester } from "../test";

registerTester("apple_calendar", async (v, tenantId) => {
  if (!v.appleId || !v.appPassword) throw new Error("Apple-ID und app-spezifisches Passwort angeben.");
  const client = new CalDavClient({ server: v.server || "https://caldav.icloud.com", username: v.appleId, password: v.appPassword });
  const { calendars } = await client.listCalendars();
  const names = calendars.filter((c) => c.components.length === 0 || c.components.includes("VEVENT")).map((c) => c.name);
  const r = await syncCalendar(tenantId);
  const name = v.calendarName || DEFAULT_CALENDAR_NAME;
  return `Verbunden. Kalender: ${names.join(", ") || "–"}. „${name}“: ${r?.created ?? 0} neu, ${r?.updated ?? 0} geändert, ${r?.removed ?? 0} entfernt; ${r?.appointments ?? 0} eigene Termine gelesen.`;
});
