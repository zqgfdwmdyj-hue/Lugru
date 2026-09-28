import "server-only";
import { DEFAULT_CALENDAR_NAME, syncCalendar } from "@/lib/calendar/sync";
import { parseFeedList } from "@/lib/calendar/feeds";
import { registerTester } from "../test";

registerTester("apple_calendar", async (v, tenantId) => {
  const hasApple = Boolean(v.appleId && v.appPassword);
  if (!hasApple && parseFeedList(v.icsUrls ?? "").length === 0) {
    throw new Error("Apple-ID und app-spezifisches Passwort angeben – oder mindestens einen Kalender-Link.");
  }
  const r = await syncCalendar(tenantId);
  if (!r) throw new Error("Nichts zum Abgleichen eingerichtet.");
  const parts: string[] = [];
  if (hasApple) {
    const name = v.calendarName || DEFAULT_CALENDAR_NAME;
    parts.push(`iCloud verbunden. „${name}“: ${r.created} neu, ${r.updated} geändert, ${r.removed} entfernt.`);
  }
  if (r.unknownNames.length) {
    parts.push(`⚠ Diese Kalender gibt es nicht: ${r.unknownNames.map((n) => `„${n}“`).join(", ")} – vorhanden sind: ${r.available.join(", ") || "–"}.${r.read.length ? "" : ""} Feld leer lassen = alle lesen.`);
  }
  parts.push(
    r.read.length
      ? `Gelesen: ${r.read.map((x) => `${x.name} (${x.error ? `Fehler: ${x.error}` : `${x.events} Termine`})`).join(", ")}.`
      : "Keine eigenen Kalender gelesen.",
  );
  if (r.appointments === 0) {
    parts.push("Keine eigenen Termine gefunden. Liegen deine Termine in einem Google- oder Outlook-Kalender (auf dem iPhone unter einem anderen Account als iCloud), unten den iCal-Link des Kalenders eintragen.");
  }
  return parts.join(" ");
});
