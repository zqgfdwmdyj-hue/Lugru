import "server-only";
import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { upsertSystemTask } from "@/lib/tasks/system";
import { DEFAULT_CALENDAR_NAME } from "./sync";
import { kalenderTodo, vornamen, type TodoPerson } from "./kalender-todo";

// Familienkalender → To-do-Liste: Termine „To do <Name>: …“ der letzten 3 und nächsten 14 Tage werden zur Aufgabe
// dieser Person (Priorität „wichtig“, Frist = Termintag; neue wichtige Aufgaben melden sich per Push). Je Termin
// (bei Serien je Vorkommen) genau eine Aufgabe, danach nie wieder überschrieben (erledigt bleibt erledigt, eigene
// Änderungen bleiben). Der Kalender selbst wird nicht geändert.

const berlinZeit = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

export async function kalenderTodosUebernehmen(tenantId: string, heute = todayIso()): Promise<number> {
  // Personen: Inhaber und Konten mit Privat-Zugang – Vorname aus dem Konto und aus den Privat-Einstellungen.
  const M = schema.memberships;
  const mitglieder = await db
    .select({ userId: M.userId, name: schema.users.name })
    .from(M)
    .innerJoin(schema.users, eq(schema.users.id, M.userId))
    .where(and(eq(M.tenantId, tenantId), isNull(M.deaktiviertAm), or(eq(M.role, "owner"), eq(M.privateAccess, true))));
  if (!mitglieder.length) return 0;
  const { privateSettings } = await import("@/lib/private/service");
  const ps = await privateSettings(tenantId);
  const personen: TodoPerson[] = mitglieder.map((m) => {
    const key = ps.userPartner[m.userId];
    return { userId: m.userId, namen: vornamen(m.name, key ? ps.partners[key] : null) };
  });

  // Alle Kalender außer dem eigenen „Seller-System“-Kalender (dort stehen die Aufgaben selbst) und dem Privat-Export.
  const push = ((await getIntegration(tenantId, "apple_calendar").catch(() => null))?.calendarName || DEFAULT_CALENDAR_NAME).trim().toLowerCase();
  const exportName = ps.externSync.enabled ? ps.externSync.calendar.trim().toLowerCase() : null;
  const E = schema.calendarEvents;
  const events = await db
    .select({ uid: E.uid, title: E.title, startsAt: E.startsAt, allDay: E.allDay, day: E.day, calendarName: E.calendarName, location: E.location, notes: E.notes })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), gte(E.day, addDaysIso(heute, -3)), lte(E.day, addDaysIso(heute, 14)), sql`lower(${E.title}) ~ '(to.?do|aufgabe|erledigen)'`));
  // Schon übernommen → nicht mehr anfassen (eigene Änderungen an Titel/Priorität bleiben, erledigt bleibt erledigt).
  const T = schema.tasks;
  const schonDa = new Set(
    (await db.select({ k: T.systemKey }).from(T).where(and(eq(T.tenantId, tenantId), sql`${T.systemKey} like 'kalender-todo:%'`, gte(T.createdAt, new Date(Date.now() - 60 * 86_400_000))))).map((r) => r.k),
  );
  let n = 0;
  for (const ev of events) {
    const kal = ev.calendarName.trim().toLowerCase();
    if (kal === push || (exportName && kal === exportName)) continue;
    const todo = kalenderTodo(ev.title, personen);
    if (!todo) continue;
    const key = `kalender-todo:${ev.uid}|${ev.startsAt.toISOString()}`;
    if (schonDa.has(key)) continue;
    const wann = `${dm(ev.day)}${ev.allDay ? "" : ` ${berlinZeit(ev.startsAt)}`}`;
    await upsertSystemTask(db, tenantId, key, {
      title: todo.text,
      notes: [`Aus dem Kalender „${ev.calendarName}“ (${wann}): „${ev.title}“`, ev.location ? `Ort: ${ev.location}` : null, ev.notes ? ev.notes.slice(0, 300) : null].filter(Boolean).join("\n"),
      priority: "critical",
      category: "eigene",
      link: "/kalender",
      dueDate: ev.day,
    });
    // Zuständig: die genannte Person (nur setzen, wenn noch niemand eingetragen ist).
    await db.update(schema.tasks).set({ assigneeId: todo.userId }).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.systemKey, key), isNull(schema.tasks.assigneeId)));
    n++;
  }
  return n;
}
