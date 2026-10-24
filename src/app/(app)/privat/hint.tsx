import Link from "next/link";
import type { Session } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { addDays, dateReminder, dateStats, medStock, taskState, type AppointmentEntry, type DateEntry, type DiaryEntry, type TaskEntry } from "@/lib/private/logic";
import { loadEntries, myMedPlan, privateSettings } from "@/lib/private/service";

/**
 * Kleiner Hinweis auf der Startseite – nur für Personen mit Privat-Zugang. Ist „Privat“ mit PIN
 * gesperrt, steht nur der Link da (keine Inhalte, falls das Handy in anderen Händen ist).
 */
export async function PrivateHint({ session }: { session: Session }) {
  if (!session.privateAccess) return null;
  const mode = (await privateSettings(session.tenantId)).startHint[session.userId] ?? "link";
  if (mode === "aus") return null;
  const locked = session.privatePin && (session.privateUnlockedUntil?.getTime() ?? 0) <= Date.now();
  // Standard: nur der Link, ohne Inhalte. Hinweise nur, wenn ausdrücklich gewählt (und nicht mit PIN gesperrt).
  if (locked || mode === "link" || session.privateScope === "familie") {
    return <Link href="/privat" className="small" data-testid="private-hint" style={{ alignSelf: "flex-start" }}>🔒 Privat</Link>;
  }
  const today = todayIso();
  const [diary, tasks, appts, dates, settings, med] = await Promise.all([
    loadEntries<DiaryEntry>(session, ["tagebuch"]),
    loadEntries<TaskEntry>(session, ["aufgabe"]),
    loadEntries<AppointmentEntry>(session, ["termin"]),
    loadEntries<DateEntry>(session, ["paarzeit"]),
    privateSettings(session.tenantId),
    myMedPlan(session),
  ]);
  const stock = medStock(med.plan, diary.filter((e) => e.userId === session.userId).map((e) => e.data));
  const remind = dateReminder(dateStats(dates.map((e) => e.data), today.slice(0, 7), today).last, today, settings.dateReminderDays);
  const hasDiary = diary.some((e) => e.userId === session.userId);
  const diaryToday = diary.some((e) => e.userId === session.userId && e.data.day === today);
  const open = tasks.filter((t) => taskState(t.data, today).open).length;
  const soon = appts.filter((a) => a.data.day === today || a.data.day === addDays(today, 1)).sort((a, b) => a.data.day.localeCompare(b.data.day) || (a.data.time ?? "").localeCompare(b.data.time ?? ""))[0];
  const parts = [
    hasDiary && !diaryToday ? "Tagebuch heute noch offen" : null,
    open ? `${open} Aufgabe${open === 1 ? "" : "n"} offen` : null,
    soon ? `Termin ${soon.data.day === today ? "heute" : "morgen"}${soon.data.time ? ` ${soon.data.time}` : ""}` : null,
    stock?.low ? `Vorrat reicht noch ${stock.daysLeft} Tage – Rezept besorgen` : null,
    remind !== null ? `letztes Date vor ${remind} Tagen` : null,
  ].filter(Boolean);
  return (
    <Link href="/privat" className="notice notice-info small" data-testid="private-hint" style={{ textDecoration: "none", color: "inherit" }}>
      🔒 <strong>Privat</strong>{parts.length ? `: ${parts.join(" · ")}` : " – keine offenen Aufgaben, Termine oder Hinweise"}
    </Link>
  );
}
