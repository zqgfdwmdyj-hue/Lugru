"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { SIDE_EFFECTS, clip, isDay, isTime, num, rating, type DiaryEntry, type KidsEntry, type PartnerKey, type TaskEntry } from "@/lib/private/logic";
import { addEntry, deleteEntry, loadEntries, lockPrivate, privateMembers, privateSettings, requirePrivate, savePrivateSettings, setPin, unlockPrivate, updateEntry, type PrivateKind } from "@/lib/private/service";

export type FormState = { ok: boolean; message: string } | null;
const done = (message: string): FormState => {
  revalidatePath("/privat", "layout");
  return { ok: true, message };
};
const fail = (message: string): FormState => ({ ok: false, message });
const uuid = z.string().uuid();
const partner = (v: unknown): PartnerKey | undefined => (v === "a" || v === "b" ? v : undefined);
const dayOr = (v: unknown) => (isDay(v) ? (v as string) : todayIso());
const time = (v: unknown) => (isTime(v) ? (v as string).padStart(5, "0") : undefined);
/** Leere Felder weglassen, damit die Einträge klein bleiben. */
const compact = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))) as T;

// ---- PIN / Sperre ------------------------------------------------------------------------------------

export async function unlockAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requireSession();
  if (!session.privateAccess) return fail("Kein Zugang.");
  const err = await unlockPrivate(session, String(fd.get("pin") ?? ""));
  if (err) return fail(err);
  const back = String(fd.get("back") ?? "");
  redirect(back.startsWith("/privat") && !back.startsWith("/privat/entsperren") ? back : "/privat");
}

export async function lockAction() {
  const session = await requirePrivate({ allowLocked: true });
  await lockPrivate(session);
  redirect("/");
}

export async function savePinAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const next = String(fd.get("pin") ?? "").trim();
  if (next !== String(fd.get("pin2") ?? "").trim()) return fail("Die beiden PINs sind nicht gleich.");
  const err = await setPin(session, String(fd.get("current") ?? "").trim(), next);
  if (err) return fail(err);
  return done(next ? "PIN gespeichert – „Privat“ fragt ab jetzt danach (30 Minuten offen, dann wieder gesperrt)." : "PIN entfernt.");
}

export async function saveSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const cur = await privateSettings(session.tenantId);
  const a = clip(fd.get("partnerA"), 40);
  const b = clip(fd.get("partnerB"), 40);
  if (!a || !b) return fail("Bitte beide Namen angeben.");
  const kids = String(fd.get("kids") ?? "")
    .split(/[,;\n]/)
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((k) => k.slice(0, 30));
  const me = partner(fd.get("me"));
  const share = fd.get("shareDiary") === "on";
  await savePrivateSettings(session, {
    partners: { a, b },
    kids,
    therapists: { ads: clip(fd.get("ads"), 60) ?? cur.therapists.ads, paar: clip(fd.get("paar"), 60) ?? cur.therapists.paar },
    userPartner: me ? { ...cur.userPartner, [session.userId]: me } : cur.userPartner,
    diaryShared: share ? [...new Set([...cur.diaryShared, session.userId])] : cur.diaryShared.filter((u) => u !== session.userId),
  });
  return done("Gespeichert.");
}

// ---- Paar --------------------------------------------------------------------------------------------

export async function addIntimAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const day = dayOr(fd.get("day"));
  if (day > todayIso()) return fail("Bitte kein Datum in der Zukunft.");
  const ini = fd.get("initiative");
  await addEntry(session, "intim", compact({
    day,
    time: time(fd.get("time")),
    initiative: ini === "a" || ini === "b" || ini === "beide" ? ini : undefined,
    closeness: rating(fd.get("closeness")),
    note: clip(fd.get("note"), 500),
  }));
  return done(`Eingetragen für ${day.split("-").reverse().join(".")}.`);
}

export async function addTalkAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  await addEntry(session, "gespraech", compact({
    day: dayOr(fd.get("day")),
    appreciationsA: clip(fd.get("appreciationsA"), 1000),
    appreciationsB: clip(fd.get("appreciationsB"), 1000),
    topic: clip(fd.get("topic"), 500),
    agreed: clip(fd.get("agreed"), 1000),
  }));
  return done("Paar-Gespräch gespeichert.");
}

// ---- Kinder ------------------------------------------------------------------------------------------

export async function addKidsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const person = partner(fd.get("person"));
  if (!person) return fail("Bitte wählen, wer mit den Kindern unterwegs war.");
  const from = time(fd.get("from"));
  const to = time(fd.get("to"));
  const hours = num(fd.get("hours"), 0, 72);
  if (!(from && to) && !hours) return fail("Bitte von–bis oder die Stunden angeben.");
  const settings = await privateSettings(session.tenantId);
  const kids = fd.getAll("kids").map(String).filter((k) => settings.kids.includes(k));
  const entry: KidsEntry = compact({ day: dayOr(fd.get("day")), person, from, to, hours: from && to ? undefined : hours, what: clip(fd.get("what"), 200), kids });
  await addEntry(session, "kinder", entry);
  return done(`Eingetragen: ${settings.partners[person]} am ${entry.day.split("-").reverse().join(".")}.`);
}

// ---- Aufgaben & Termine ------------------------------------------------------------------------------

export async function addTaskAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const title = clip(fd.get("title"), 300);
  if (!title) return fail("Bitte die Aufgabe beschreiben.");
  const src = fd.get("source");
  const forWhom = fd.get("forWhom");
  const repeat = fd.get("repeat");
  const due = fd.get("due");
  const task: TaskEntry = compact({
    title,
    source: src === "ads" || src === "paar" ? src : "sonst",
    forWhom: forWhom === "a" || forWhom === "b" ? forWhom : "beide",
    repeat: repeat === "taeglich" || repeat === "woechentlich" ? repeat : "einmal",
    due: isDay(due) ? (due as string) : undefined,
    notes: clip(fd.get("notes"), 2000),
    done: false,
    checks: [],
  });
  await addEntry(session, "aufgabe", task);
  return done("Aufgabe angelegt.");
}

/** Einmalige Aufgabe erledigt/offen; wiederkehrende: heute (bzw. diese Woche) abhaken oder zurücknehmen. */
export async function toggleTaskAction(fd: FormData) {
  const session = await requirePrivate();
  const id = uuid.parse(fd.get("id"));
  const [t] = (await loadEntries<TaskEntry>(session, ["aufgabe"])).filter((e) => e.id === id);
  if (!t) return;
  const today = todayIso();
  if (t.data.repeat === "einmal") {
    await updateEntry(session, id, "aufgabe", { done: !t.data.done, doneAt: t.data.done ? undefined : today });
  } else {
    const day = isDay(fd.get("day")) ? String(fd.get("day")) : today;
    const checks = new Set(t.data.checks ?? []);
    if (checks.has(day)) checks.delete(day);
    else checks.add(day);
    await updateEntry(session, id, "aufgabe", { checks: [...checks].sort().slice(-400) });
  }
  revalidatePath("/privat", "layout");
}

export async function saveTaskNoteAction(fd: FormData) {
  const session = await requirePrivate();
  const id = uuid.parse(fd.get("id"));
  await updateEntry(session, id, "aufgabe", { reflection: clip(fd.get("reflection"), 2000) ?? "", notes: clip(fd.get("notes"), 2000) ?? "" });
  revalidatePath("/privat", "layout");
}

export async function addAppointmentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const w = fd.get("with");
  if (!isDay(fd.get("day"))) return fail("Bitte ein Datum angeben.");
  await addEntry(session, "termin", compact({ day: String(fd.get("day")), time: time(fd.get("time")), with: w === "ads" || w === "paar" || w === "arzt" ? w : "sonst", notes: clip(fd.get("notes"), 4000) }));
  return done("Termin gespeichert.");
}

export async function saveAppointmentNotesAction(fd: FormData) {
  const session = await requirePrivate();
  await updateEntry(session, uuid.parse(fd.get("id")), "termin", { notes: clip(fd.get("notes"), 4000) ?? "" });
  revalidatePath("/privat", "layout");
}

// ---- Tagebuch ------------------------------------------------------------------------------------------

/** Ein Eintrag je Tag: gibt es den Tag schon, wird er überschrieben. */
export async function saveDiaryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const day = dayOr(fd.get("day"));
  if (day > todayIso()) return fail("Bitte kein Datum in der Zukunft.");
  const effects = fd.getAll("sideEffects").map(String).filter((s) => (SIDE_EFFECTS as readonly string[]).includes(s));
  const other = clip(fd.get("otherEffect"), 60);
  const entry: DiaryEntry = compact({
    day,
    med: clip(fd.get("med"), 60),
    doseMg: num(fd.get("doseMg"), 0, 1000),
    takenAt: time(fd.get("takenAt")),
    onset: time(fd.get("onset")),
    wearOff: time(fd.get("wearOff")),
    focus: rating(fd.get("focus")),
    mood: rating(fd.get("mood")),
    calm: rating(fd.get("calm")),
    energy: rating(fd.get("energy")),
    sleepQuality: rating(fd.get("sleepQuality")),
    appetite: rating(fd.get("appetite")),
    sleepHours: num(fd.get("sleepHours"), 0, 24),
    pulse: num(fd.get("pulse"), 30, 220),
    bpSys: num(fd.get("bpSys"), 60, 260),
    bpDia: num(fd.get("bpDia"), 30, 160),
    weightKg: num(fd.get("weightKg"), 20, 400),
    caffeine: num(fd.get("caffeine"), 0, 20),
    sideEffects: other ? [...effects, other] : effects,
    good: clip(fd.get("good"), 2000),
    hard: clip(fd.get("hard"), 2000),
    note: clip(fd.get("note"), 2000),
  });
  const mine = (await loadEntries<DiaryEntry>(session, ["tagebuch"])).find((e) => e.userId === session.userId && e.data.day === day);
  if (mine) await updateEntry(session, mine.id, "tagebuch", entry, true);
  else await addEntry(session, "tagebuch", entry);
  return done(`Tagebuch für ${day.split("-").reverse().join(".")} gespeichert.`);
}

export async function addObservationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const about = uuid.safeParse(fd.get("about"));
  const text = clip(fd.get("text"), 2000);
  if (!about.success || !text) return fail("Bitte die Beobachtung aufschreiben.");
  if (!(await privateMembers(session.tenantId)).some((m) => m.userId === about.data)) return fail("Diese Person hat keinen Privat-Zugang.");
  await addEntry(session, "beobachtung", { day: dayOr(fd.get("day")), aboutUserId: about.data, text });
  return done("Beobachtung gespeichert.");
}

// ---- Löschen (alle Arten) ----------------------------------------------------------------------------

const KINDS: PrivateKind[] = ["intim", "kinder", "aufgabe", "termin", "tagebuch", "beobachtung", "gespraech"];

export async function deleteEntryAction(fd: FormData) {
  const session = await requirePrivate();
  const kind = String(fd.get("kind")) as PrivateKind;
  if (!KINDS.includes(kind)) return;
  await deleteEntry(session, uuid.parse(fd.get("id")), kind);
  revalidatePath("/privat", "layout");
}
