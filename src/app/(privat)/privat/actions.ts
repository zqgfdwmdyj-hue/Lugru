"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { CARE_SUGGESTIONS, SIDE_EFFECTS, changePlan, clip, isDay, intakesAt, isTime, medStock, nextCareDate, num, partnerHolders, parseTimes, planFor, rating, type CareOwner, type CareTask, type DateIdea, type DiaryEntry, type MoodEntry, type PartnerKey, type Routine, type TaskEntry } from "@/lib/private/logic";
import { saveTimeEntry as saveTime, TIME_KINDS, type TimeKind } from "@/lib/private/save";
import { exportTargetProblem } from "@/lib/private/export-sync";
import { addEntry, deleteAllPrivate, deleteEntry, loadEntries, lockPrivate, myMedPlan, myPartner, nowTime, privateMembers, privateSettings, requirePrivate, savePrivateSettings, setPin, unlockPrivate, updateEntry, type PrivateKind } from "@/lib/private/service";

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
  // Rahmen (Navigation) neu aufbauen – im gesperrten Zustand war er leer.
  revalidatePath("/privat", "layout");
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

/** Was von „Privat“ auf der geschäftlichen Startseite erscheint – je Person, auch mit Umfang „familie“. */
export async function saveStartHintAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const v = String(fd.get("startHint") ?? "");
  if (v !== "aus" && v !== "link" && v !== "hinweise") return fail("Bitte eine Auswahl treffen.");
  const cur = await privateSettings(session.tenantId);
  await savePrivateSettings(session, { startHint: { ...cur.startHint, [session.userId]: v } });
  revalidatePath("/");
  return done(v === "aus" ? "Startseite zeigt nichts von Privat." : v === "link" ? "Startseite zeigt nur den Link „Privat“." : "Startseite zeigt Hinweise aus Privat.");
}

export async function saveSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate({ full: true });
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
  if (me && me !== cur.userPartner[session.userId]) {
    const holder = partnerHolders(cur.userPartner, await privateMembers(session.tenantId), session.userId)[me];
    if (holder) return fail(`„${me === "a" ? a : b}“ ist schon dem Konto „${holder}“ zugeordnet. Eine Person gehört genau zu einem Konto – Konten werden nicht zusammengeführt.`);
  }
  const share = fd.get("shareDiary") === "on";
  const wake = time(fd.get("wakeTime"));
  await savePrivateSettings(session, {
    partners: { a, b },
    kids,
    therapists: { ads: clip(fd.get("ads"), 60) ?? cur.therapists.ads, paar: clip(fd.get("paar"), 60) ?? cur.therapists.paar },
    userPartner: me ? { ...cur.userPartner, [session.userId]: me } : cur.userPartner,
    diaryShared: share ? [...new Set([...cur.diaryShared, session.userId])] : cur.diaryShared.filter((u) => u !== session.userId),
    wakeTime: wake ?? cur.wakeTime,
    dateReminderDays: Math.max(0, Math.min(365, Math.round(Number(fd.get("dateReminderDays") ?? cur.dateReminderDays)) || 0)),
  });
  return done("Gespeichert.");
}

/** Ausdrücklicher Export einzelner Einträge in einen eigenen Kalender (neutral, Standard aus). */
export async function saveExternSyncAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate({ full: true });
  const enabled = fd.get("enabled") === "on";
  const calendar = clip(fd.get("calendar"), 60) ?? "Privat";
  if (enabled) {
    const problem = await exportTargetProblem(session.tenantId, calendar);
    if (problem) return fail(problem);
  }
  await savePrivateSettings(session, { externSync: { enabled, calendar } });
  return done(enabled ? `Export an: nur einzeln angehakte Einträge, neutral als „Privater Termin“ im eigenen Kalender „${calendar}“ – beim nächsten Abgleich.` : "Export aus – früher übertragene „Private Termine“ werden beim nächsten Abgleich wieder entfernt.");
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

// ---- Zeit-Einträge: Paarzeit, Kinderzeit, Ausschlafen, Auszeit ---------------------------------------

/** Anlegen oder (mit `id`) ändern – Prüfung und Verknüpfung in src/lib/private/save.ts. */
async function saveTimeEntry(kind: TimeKind, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const r = await saveTime(session, kind, fd);
  return r.ok ? done(r.message) : fail(r.message);
}

/** Paarzeit: zu zweit unterwegs, Kinder bei Babysitterin & Co. */
export async function addDateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return saveTimeEntry("paarzeit", fd);
}

export async function addKidsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return saveTimeEntry("kinder", fd);
}

export async function addSleepAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return saveTimeEntry("ausschlafen", fd);
}

/** Schnell eintragen: Art wählen → Person → Zeit → speichern (alles Weitere optional). */
export async function quickAddAction(prev: FormState, fd: FormData): Promise<FormState> {
  const type = String(fd.get("type") ?? "");
  if (type === "intim") return addIntimAction(prev, fd);
  if ((TIME_KINDS as string[]).includes(type)) return saveTimeEntry(type as TimeKind, fd);
  return fail("Bitte wählen, was du eintragen möchtest.");
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
  const intakesIn = fd.has("intakes") ? parseTimes(fd.get("intakes")) : undefined;
  if (intakesIn === null) return fail("Einnahmen bitte als Uhrzeiten angeben, z. B. „08:00, 13:30“.");
  const noEffects = fd.get("noSideEffects") === "on";
  if (noEffects && (effects.length || other)) return fail("Bitte entweder „keine Nebenwirkungen“ anhaken oder Nebenwirkungen auswählen – nicht beides.");
  const entry: DiaryEntry = compact({
    day,
    med: clip(fd.get("med"), 60),
    doseMg: num(fd.get("doseMg"), 0, 1000),
    takenAt: fd.has("intakes") ? intakesIn?.[0] : time(fd.get("takenAt")),
    notTaken: fd.has("notTaken") ? Math.max(0, Math.min(10, Math.round(Number(fd.get("notTaken")) || 0))) || undefined : undefined,
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
    noSideEffects: noEffects || undefined,
    good: clip(fd.get("good"), 2000),
    hard: clip(fd.get("hard"), 2000),
    note: clip(fd.get("note"), 2000),
  });
  const mine = (await loadEntries<DiaryEntry>(session, ["tagebuch"])).find((e) => e.userId === session.userId && e.data.day === day);
  if (intakesIn !== undefined) {
    // Einnahmen aus dem Feld (auch nachgetragen oder korrigiert).
    if (intakesIn.length) entry.intakes = intakesIn;
  } else {
    // Ältere Formulare: per „Jetzt genommen“ erfasste Einnahmen behalten; geänderte erste Uhrzeit übernehmen.
    const intakes = [...(mine?.data.intakes ?? [])];
    if (intakes.length && entry.takenAt && !intakes.includes(entry.takenAt)) {
      intakes[0] = entry.takenAt;
      intakes.sort();
    }
    if (intakes.length) entry.intakes = intakes;
  }
  // Stück je Einnahme: was damals galt – eine spätere Planänderung ändert den Tag nicht.
  if (entry.intakes?.length) {
    const { plan } = await myMedPlan(session);
    entry.pieces = mine?.data.pieces ?? planFor(plan, day).piecesPerIntake;
  }
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

const KINDS: PrivateKind[] = ["intim", "paarzeit", "kinder", "ausschlafen", "auszeit", "routine", "danke", "stimmung", "zustaendig", "dateidee", "aufgabe", "termin", "tagebuch", "beobachtung", "gespraech", "periode", "zuwendung", "ritual"];

export async function deleteEntryAction(fd: FormData) {
  const session = await requirePrivate();
  const kind = String(fd.get("kind")) as PrivateKind;
  if (!KINDS.includes(kind)) return;
  const id = uuid.parse(fd.get("id"));
  // Ein verknüpfter Vorgang (Kinderzeit + Auszeit) wird als Ganzes gelöscht.
  if (kind === "kinder" || kind === "auszeit") {
    const linkId = (await loadEntries<{ linkId?: string }>(session, [kind])).find((e) => e.id === id)?.data.linkId;
    if (linkId) {
      const pk = kind === "kinder" ? "auszeit" : "kinder";
      for (const e of (await loadEntries<{ linkId?: string }>(session, [pk])).filter((x) => x.data.linkId === linkId)) await deleteEntry(session, e.id, pk);
    }
  }
  await deleteEntry(session, id, kind);
  revalidatePath("/privat", "layout");
  // Von der Detailseite aus: zurück in den Kalender (der Eintrag ist ja weg).
  const back = String(fd.get("back") ?? "");
  if (back.startsWith("/privat")) redirect(back);
}

// ---- Medikament: Plan, Vorrat, Einnahme per Tipp -------------------------------------------------------

export async function saveMedPlanAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const med = clip(fd.get("med"), 60);
  if (!med) return fail("Bitte das Medikament eintragen.");
  const { id, plan } = await myMedPlan(session);
  const next = changePlan(
    plan,
    {
      med,
      doseMg: num(fd.get("doseMg"), 0, 1000),
      piecesPerIntake: num(fd.get("piecesPerIntake"), 0.25, 20) ?? 1,
      intakesPerDay: num(fd.get("intakesPerDay"), 1, 10) ?? 1,
      warnDays: num(fd.get("warnDays"), 0, 60) ?? 10,
    },
    todayIso(),
    Boolean(id),
  );
  if (id) await updateEntry(session, id, "medplan", compact(next), true);
  else await addEntry(session, "medplan", compact(next));
  return done(next.validFrom === todayIso() && (next.history?.length ?? 0) > (plan.history?.length ?? 0) ? "Plan geändert – gilt ab heute, frühere Tage bleiben unverändert." : "Medikament gespeichert.");
}

/** Vorrat: „jetzt im Haus“ setzen oder eine neue Packung dazurechnen. */
export async function stockAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const n = num(fd.get("count"), 0, 10000);
  if (n === undefined) return fail("Bitte die Stückzahl angeben.");
  const { id, plan } = await myMedPlan(session);
  if (!id || !plan.med) return fail("Bitte zuerst das Medikament speichern.");
  const diary = (await loadEntries<DiaryEntry>(session, ["tagebuch"])).filter((e) => e.userId === session.userId).map((e) => e.data);
  const current = medStock(plan, diary)?.remaining ?? 0;
  const count = fd.get("mode") === "add" ? current + n : n;
  const asOf = `${todayIso()}T${nowTime()}`;
  await updateEntry(session, id, "medplan", { stock: { count, asOf, atAsOf: intakesAt(diary, asOf) } });
  return done(`Vorrat: ${String(count).replace(".", ",")} Stück.`);
}

/** „Jetzt genommen“: Uhrzeit ins heutige Tagebuch, Medikament und Dosis aus dem Plan. */
export async function takeNowAction() {
  const session = await requirePrivate();
  const today = todayIso();
  const at = nowTime();
  const { plan } = await myMedPlan(session);
  const mine = (await loadEntries<DiaryEntry>(session, ["tagebuch"])).find((e) => e.userId === session.userId && e.data.day === today);
  const intakes = [...(mine?.data.intakes ?? (mine?.data.takenAt ? [mine.data.takenAt] : []))];
  // Doppelt getippt? Innerhalb von 10 Minuten nicht nochmal zählen.
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  if (intakes.some((t) => Math.abs(toMin(t) - toMin(at)) < 10)) return;
  intakes.push(at);
  intakes.sort();
  const patch = { intakes, takenAt: intakes[0], pieces: mine?.data.pieces ?? plan.piecesPerIntake, ...(plan.med && !mine?.data.med ? { med: plan.med } : {}), ...(plan.doseMg !== undefined && mine?.data.doseMg === undefined ? { doseMg: plan.doseMg } : {}) };
  if (mine) await updateEntry(session, mine.id, "tagebuch", patch);
  else await addEntry(session, "tagebuch", { day: today, ...patch });
  revalidatePath("/privat", "layout");
  revalidatePath("/");
}

/** Letzte Einnahme von heute zurücknehmen (versehentlich getippt). */
export async function undoIntakeAction() {
  const session = await requirePrivate();
  const mine = (await loadEntries<DiaryEntry>(session, ["tagebuch"])).find((e) => e.userId === session.userId && e.data.day === todayIso());
  if (!mine) return;
  const intakes = [...(mine.data.intakes ?? (mine.data.takenAt ? [mine.data.takenAt] : []))];
  intakes.pop();
  await updateEntry(session, mine.id, "tagebuch", { intakes, takenAt: intakes[0] });
  revalidatePath("/privat", "layout");
}

/** Heute eine geplante Einnahme bewusst nicht genommen (oder das zurücknehmen) – anders als „nicht dokumentiert“. */
export async function skipIntakeAction(fd: FormData) {
  const session = await requirePrivate();
  const today = todayIso();
  const { plan } = await myMedPlan(session);
  const mine = (await loadEntries<DiaryEntry>(session, ["tagebuch"])).find((e) => e.userId === session.userId && e.data.day === today);
  const taken = (mine?.data.intakes ?? (mine?.data.takenAt ? [mine.data.takenAt] : [])).length;
  const cur = mine?.data.notTaken ?? 0;
  const next = fd.get("undo") ? Math.max(0, cur - 1) : Math.min(Math.max(1, plan.intakesPerDay - taken), cur + 1);
  if (mine) await updateEntry(session, mine.id, "tagebuch", { notTaken: next || undefined });
  else if (next) await addEntry(session, "tagebuch", { day: today, notTaken: next, ...(plan.med ? { med: plan.med } : {}), ...(plan.doseMg !== undefined ? { doseMg: plan.doseMg } : {}) });
  revalidatePath("/privat", "layout");
  revalidatePath("/");
}

// ---- Routinen ---------------------------------------------------------------------------------------

export async function addRoutineAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const title = clip(fd.get("title"), 80);
  const items = String(fd.get("items") ?? "").split(/\r?\n/).map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 20);
  if (!title || !items.length) return fail("Bitte Name und mindestens einen Schritt angeben (ein Schritt je Zeile).");
  await addEntry(session, "routine", { title, items, checks: {} });
  return done(`Routine „${title}“ angelegt.`);
}

export async function toggleRoutineItemAction(fd: FormData) {
  const session = await requirePrivate();
  const id = uuid.parse(fd.get("id"));
  const item = String(fd.get("item") ?? "");
  const day = isDay(fd.get("day")) ? String(fd.get("day")) : todayIso();
  const r = (await loadEntries<Routine>(session, ["routine"])).find((e) => e.id === id && e.userId === session.userId);
  if (!r || !r.data.items.includes(item)) return;
  const checks = { ...(r.data.checks ?? {}) };
  const set = new Set(checks[day] ?? []);
  if (set.has(item)) set.delete(item);
  else set.add(item);
  checks[day] = [...set];
  // nur die letzten ~400 Tage behalten
  const keep = Object.keys(checks).sort().slice(-400);
  await updateEntry(session, id, "routine", { checks: Object.fromEntries(keep.map((k) => [k, checks[k]])) });
  revalidatePath("/privat", "layout");
}

// ---- Wertschätzung & Paar-Stimmung ------------------------------------------------------------------

const WHO_AM_I = "Bitte zuerst festlegen, wer du bist (oben auf der Seite oder unter Privat → Einstellungen) – dann ist klar, von wem der Eintrag ist.";

/** Einmalige Zuordnung: dieses Konto ist Partner 1 oder Partner 2. */
export async function assignMeAction(fd: FormData) {
  const session = await requirePrivate();
  const me = partner(fd.get("me"));
  if (!me) return;
  const cur = await privateSettings(session.tenantId);
  // Schon an ein anderes Konto vergeben: nicht zusammenführen (Knopf ist dann ohnehin gesperrt).
  if (partnerHolders(cur.userPartner, await privateMembers(session.tenantId), session.userId)[me]) return;
  await savePrivateSettings(session, { userPartner: { ...cur.userPartner, [session.userId]: me } });
  revalidatePath("/privat", "layout");
}

export async function addThanksAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const text = clip(fd.get("text"), 300);
  if (!text) return fail("Was hast du geschätzt?");
  const s = await privateSettings(session.tenantId);
  const me = myPartner(s, session);
  if (!me) return fail(WHO_AM_I);
  await addEntry(session, "danke", { day: todayIso(), from: me, text });
  return done("Gespeichert 💛 – kommt beim nächsten Paar-Gespräch automatisch mit.");
}

/** Je Person ein Wert am Tag – nochmal speichern ändert ihn. */
export async function saveMoodAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const value = rating(fd.get("value"));
  if (!value) return fail("Bitte 1 bis 5 wählen.");
  const s = await privateSettings(session.tenantId);
  const me = myPartner(s, session);
  if (!me) return fail(WHO_AM_I);
  const day = todayIso();
  const entry: MoodEntry = compact({ day, person: me, value, note: clip(fd.get("note"), 300) });
  const mine = (await loadEntries<MoodEntry>(session, ["stimmung"])).find((e) => e.userId === session.userId && e.data.day === day);
  if (mine) await updateEntry(session, mine.id, "stimmung", entry, true);
  else await addEntry(session, "stimmung", entry);
  return done(`Heute: ${value}/5 – danke!`);
}

// ---- Wer kümmert sich (Mental Load) -------------------------------------------------------------------

const careOwner = (v: unknown): CareOwner => (v === "a" || v === "b" || v === "beide" ? v : "offen");
const careRepeat = (v: unknown): CareTask["repeat"] => (v === "woechentlich" || v === "monatlich" || v === "jaehrlich" || v === "laufend" ? v : "einmal");

export async function addCareAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const title = clip(fd.get("title"), 120);
  if (!title) return fail("Bitte angeben, worum es geht.");
  const next = fd.get("next");
  await addEntry(session, "zustaendig", compact({ title, owner: careOwner(fd.get("owner")), repeat: careRepeat(fd.get("repeat")), next: isDay(next) ? String(next) : undefined, notes: clip(fd.get("notes"), 500), done: [] }));
  return done(`„${title}“ angelegt.`);
}

export async function addCareSuggestionsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const picked = fd.getAll("pick").map(String).filter((p) => (CARE_SUGGESTIONS as readonly string[]).includes(p));
  if (!picked.length) return fail("Bitte mindestens einen Vorschlag auswählen.");
  const existing = new Set((await loadEntries<CareTask>(session, ["zustaendig"])).map((e) => e.data.title));
  let n = 0;
  for (const title of picked) {
    if (existing.has(title)) continue;
    await addEntry(session, "zustaendig", { title, owner: "offen", repeat: "laufend", done: [] });
    n++;
  }
  return done(`${n} übernommen – jetzt festlegen, wer sich kümmert.`);
}

export async function careDoneAction(fd: FormData) {
  const session = await requirePrivate();
  const id = uuid.parse(fd.get("id"));
  const t = (await loadEntries<CareTask>(session, ["zustaendig"])).find((e) => e.id === id);
  if (!t) return;
  const s = await privateSettings(session.tenantId);
  const me = myPartner(s, session);
  if (!me) return;
  const day = todayIso();
  const doneList = [...(t.data.done ?? []), { day, by: me }].slice(-200);
  await updateEntry(session, id, "zustaendig", { done: doneList, next: nextCareDate(t.data, day) });
  revalidatePath("/privat", "layout");
}

export async function setCareOwnerAction(fd: FormData) {
  const session = await requirePrivate();
  await updateEntry(session, uuid.parse(fd.get("id")), "zustaendig", { owner: careOwner(fd.get("owner")) });
  revalidatePath("/privat", "layout");
}

// ---- Auszeit (Zeit nur für sich) -----------------------------------------------------------------------

export async function addTimeoutAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return saveTimeEntry("auszeit", fd);
}

// ---- Date-Ideen -------------------------------------------------------------------------------------

export async function addIdeaAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  const text = clip(fd.get("text"), 200);
  if (!text) return fail("Bitte eine Idee eintragen.");
  await addEntry(session, "dateidee", { text, done: false } satisfies DateIdea);
  return done("Idee gespeichert.");
}

export async function toggleIdeaAction(fd: FormData) {
  const session = await requirePrivate();
  const id = uuid.parse(fd.get("id"));
  const idea = (await loadEntries<DateIdea>(session, ["dateidee"])).find((e) => e.id === id);
  if (!idea) return;
  await updateEntry(session, id, "dateidee", { done: !idea.data.done });
  revalidatePath("/privat", "layout");
}

// ---- Löschen ------------------------------------------------------------------------------------------

export async function deleteAllAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requirePrivate();
  if (String(fd.get("confirm") ?? "").trim().toUpperCase() !== "LÖSCHEN") return fail("Zum Bestätigen bitte LÖSCHEN eintippen.");
  // Nur die eigenen: niemand soll das Tagebuch oder die Einträge der anderen wegwischen können.
  const n = await deleteAllPrivate(session);
  return done(`${n} Einträge gelöscht.`);
}
