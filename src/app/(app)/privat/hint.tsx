import Link from "next/link";
import type { Session } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { addDays, taskState, type AppointmentEntry, type DiaryEntry, type TaskEntry } from "@/lib/private/logic";
import { loadEntries } from "@/lib/private/service";

/**
 * Kleiner Hinweis auf der Startseite – nur für Personen mit Privat-Zugang. Ist „Privat“ mit PIN
 * gesperrt, steht nur der Link da (keine Inhalte, falls das Handy in anderen Händen ist).
 */
export async function PrivateHint({ session }: { session: Session }) {
  if (!session.privateAccess) return null;
  const locked = session.privatePin && (session.privateUnlockedUntil?.getTime() ?? 0) <= Date.now();
  if (locked) {
    return <Link href="/privat" className="small" data-testid="private-hint" style={{ alignSelf: "flex-start" }}>🔒 Privat</Link>;
  }
  const today = todayIso();
  const [diary, tasks, appts] = await Promise.all([
    loadEntries<DiaryEntry>(session, ["tagebuch"]),
    loadEntries<TaskEntry>(session, ["aufgabe"]),
    loadEntries<AppointmentEntry>(session, ["termin"]),
  ]);
  const hasDiary = diary.some((e) => e.userId === session.userId);
  const diaryToday = diary.some((e) => e.userId === session.userId && e.data.day === today);
  const open = tasks.filter((t) => taskState(t.data, today).open).length;
  const soon = appts.filter((a) => a.data.day === today || a.data.day === addDays(today, 1)).sort((a, b) => a.data.day.localeCompare(b.data.day) || (a.data.time ?? "").localeCompare(b.data.time ?? ""))[0];
  const parts = [
    hasDiary && !diaryToday ? "Tagebuch heute noch offen" : null,
    open ? `${open} Aufgabe${open === 1 ? "" : "n"} offen` : null,
    soon ? `Termin ${soon.data.day === today ? "heute" : "morgen"}${soon.data.time ? ` ${soon.data.time}` : ""}` : null,
  ].filter(Boolean);
  return (
    <Link href="/privat" className="notice notice-info small" data-testid="private-hint" style={{ textDecoration: "none", color: "inherit" }}>
      🔒 <strong>Privat</strong>{parts.length ? `: ${parts.join(" · ")}` : " – alles erledigt"}
    </Link>
  );
}
