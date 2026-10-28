import "server-only";
import { randomUUID } from "node:crypto";
import { todayIso } from "@/lib/dates";
import type { Session } from "@/lib/auth/session";
import { addDays, clip, daysBetween, defaultStatus, durationOf, isDay, isTime, linkIssues, num, rating, statusOf, statusProblem, type AppointmentEntry, type EntryStatus, type KidsEntry, type PartnerKey, type SleepEntry } from "./logic";
import { eventRefFrom, isoWeekday, parseOccurrence, periodProblem, ritualOccurrences, slotKey, touchRhythm, type PeriodEntry, type RitualEntry, type RitualSlot, type TouchEntry, type TouchKind } from "./kalender";
import { changesTiming, REPEAT_LABEL, repeatDays, seriesDeleteIds, seriesScope, seriesTargets, type SeriesScope } from "./serie";
import { addEntry, deleteEntry, loadEntries, loadEntry, myPartner, privateMembers, privateSettings, updateEntry, type PrivateKind } from "./service";

// Speichern der Kalender-Einträge (Termine, Familienzeiten, Nähe, Streicheln/Massage, Periode, Abendritual).
// Die Aufrufer (Server Actions) holen die Sitzung über requirePrivate(); hier nur Prüfen und Schreiben.

export type SaveResult = { ok: boolean; message: string; id?: string; day?: string };
const fail = (message: string): SaveResult => ({ ok: false, message });

export const partnerOf = (v: unknown): PartnerKey | undefined => (v === "a" || v === "b" ? v : undefined);
const otherOf = (p: PartnerKey): PartnerKey => (p === "a" ? "b" : "a");
const time = (v: unknown) => (isTime(v) ? (v as string).padStart(5, "0") : undefined);
const dmy = (d: string) => d.split("-").reverse().join(".");
const hoursText = (h: number) => `${String(h).replace(".", ",")} Std.`;
/** Leere Felder weglassen, damit die Einträge klein bleiben. */
export const compact = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))) as T;
export const parseStatus = (v: unknown): EntryStatus | undefined => (v === "geplant" || v === "stattgefunden" || v === "ausgefallen" ? v : undefined);
/** Status aus dem Formular, sonst der bisherige, sonst nach Datum (Zukunft = geplant). */
const statusFrom = (fd: FormData, day: string, today: string, current?: unknown) => parseStatus(fd.get("status")) ?? parseStatus(current) ?? defaultStatus(day, today);
/** Ausdrücklich in den verbundenen Kalender – nur angehakt, nie automatisch. */
const externFrom = (fd: FormData) => (fd.get("extern") === "on" ? true : undefined);
const fromEventOf = (fd: FormData, cur?: unknown) => eventRefFrom(fd.get("fromEvent")) ?? eventRefFrom(cur);

// ---- Kinderzeit, Ausschlafen, Auszeit, Paarzeit ---------------------------------------------------------

export type TimeKind = "kinder" | "ausschlafen" | "auszeit" | "paarzeit";
export const TIME_KINDS: TimeKind[] = ["kinder", "ausschlafen", "auszeit", "paarzeit"];
const MAX_HOURS: Record<TimeKind, number> = { kinder: 16, ausschlafen: 12, auszeit: 16, paarzeit: 24 };
const WHO_MISSING: Record<Exclude<TimeKind, "paarzeit">, string> = { kinder: "Bitte wählen, wer mit den Kindern unterwegs war.", ausschlafen: "Bitte wählen, wer ausgeschlafen hat.", auszeit: "Bitte wählen, wer Auszeit hatte." };

/**
 * Anlegen oder (mit `id`) ändern. Kinderzeit ↔ Auszeit als ein Vorgang („wer übernimmt die Kinder?“) – nur
 * wenn ausdrücklich gewählt, nie automatisch. Datum, Zeit und Status gelten dann für beide Einträge; jede
 * Person zählt nur in ihrer eigenen Auswertung (Auszeit bzw. Kinderzeit), nie doppelt.
 *
 * Wiederholen (neu): wöchentlich oder alle 2 Wochen bis zu einem Tag – je Termin ein eigener Eintrag mit
 * gemeinsamer Serie. Ändern einer Serie: „nur dieser“ (wird zur Ausnahme), „dieser und alle folgenden“ oder
 * „alle“ – Erledigtes und einzeln geänderte Einträge bleiben dabei, wie sie sind.
 */
export async function saveTimeEntry(session: Session, kind: TimeKind, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  const editId = String(fd.get("id") ?? "") || null;
  const day = isDay(fd.get("day")) ? String(fd.get("day")) : today;
  const all = await loadEntries<Record<string, unknown>>(session, [kind]);
  const cur = editId ? all.find((e) => e.id === editId) : undefined;
  if (editId && !cur) return fail("Eintrag nicht gefunden.");
  const status = statusFrom(fd, day, today, cur?.data.status);
  const problem = statusProblem(day, status, today);
  if (problem) return fail(problem);
  // Kinderzeit auch „beide zusammen“ (zählt nicht als „allein mit den Kindern“).
  const person = kind === "paarzeit" ? undefined : kind === "kinder" && fd.get("person") === "beide" ? ("beide" as const) : partnerOf(fd.get("person"));
  if (kind !== "paarzeit" && !person) return fail(WHO_MISSING[kind]);
  const from = time(fd.get("from"));
  const to = time(fd.get("to"));
  const hoursIn = num(fd.get("hours"), 0, 72);
  const dur = durationOf({ day, from, to, hours: hoursIn }, MAX_HOURS[kind]);
  if ("error" in dur) return fail(dur.error);
  const settings = await privateSettings(session.tenantId);
  const extern = externFrom(fd);
  const hours = from && to ? undefined : dur.hours;
  // „Wer übernimmt in dieser Zeit die Kinder?“ (Auszeit) bzw. „Hatte … währenddessen Auszeit?“ (Kinderzeit)
  const kidsBy = String(fd.get("kidsBy") ?? "");
  // „beide zusammen“ (Kinderzeit) hat keine andere Person, die Auszeit haben könnte – dann keine Verknüpfung.
  const wantsLink = person !== "beide" && ((kind === "auszeit" && (kidsBy === "partner" || fd.get("linkKinder") === "on")) || (kind === "kinder" && fd.get("linkAuszeit") === "on"));
  const asked = fd.get("linkQuestion") === "1";
  // Gilt bei Serien für alle betroffenen Einträge …
  const shared: Record<string, unknown> =
    kind === "paarzeit"
      ? { what: clip(fd.get("what"), 200), sitter: clip(fd.get("sitter"), 60) }
      : kind === "kinder"
        ? { person, what: clip(fd.get("what"), 200), kids: fd.getAll("kids").map(String).filter((k) => settings.kids.includes(k)) }
        : { person, note: clip(fd.get("note"), kind === "auszeit" ? 200 : 300), kidsBy: kind === "auszeit" && kidsBy === "andere" ? clip(fd.get("kidsByName"), 60) ?? "jemand anderes" : undefined };
  // … das hier nur für den geöffneten Eintrag (Kosten, Bewertung, Notiz eines Dates).
  const own: Record<string, unknown> = kind === "paarzeit" ? { costEur: num(fd.get("costEur"), 0, 10000), rating: rating(fd.get("rating")), note: clip(fd.get("note"), 500) } : {};
  const OWN_KEYS = Object.keys(own);
  const build = (d: string, st: EntryStatus, extra: Record<string, unknown>): Record<string, unknown> => compact({ day: d, from, to, hours, status: st, extern, ...shared, ...extra });
  const other = person && person !== "beide" ? otherOf(person) : undefined;
  const linkKind: TimeKind | null = kind === "kinder" ? "auszeit" : kind === "auszeit" ? "kinder" : null;
  const what = `${dmy(day)}, ${hoursText(dur.hours)}${dur.overnight ? ", über Mitternacht" : ""}${dur.clockShift ? `, inkl. Zeitumstellung ${dur.clockShift > 0 ? "+" : "−"}${String(Math.abs(dur.clockShift)).replace(".", ",")} Std` : ""}${status !== "stattgefunden" ? ` (${status})` : ""}`;
  const linkedRows = linkKind ? await loadEntries<Record<string, unknown>>(session, [linkKind]) : [];
  const linkedEntry = (d: string, st: EntryStatus, linkId: string, rep: Record<string, unknown>) => compact({ day: d, person: other, from, to, hours, status: st, linkId, ...rep });

  /** Einen Eintrag ändern – samt verknüpfter Kinderzeit/Auszeit. Gibt einen Hinweis zur Verknüpfung zurück. */
  async function editOne(e: { id: string; data: Record<string, unknown> }, data: Record<string, unknown>): Promise<string> {
    const d = String(data.day);
    const st = data.status as EntryStatus;
    const rep = { repeatId: e.data.repeatId, repeatEvery: e.data.repeatEvery };
    let linkId = typeof e.data.linkId === "string" ? e.data.linkId : undefined;
    let note = "";
    if (linkKind && linkId && ((asked && !wantsLink) || person === "beide")) {
      // Verknüpfung ausdrücklich gelöst: beide Einträge bleiben, nur nicht mehr verbunden (nichts wird gelöscht).
      for (const x of linkedRows.filter((x) => x.data.linkId === linkId)) {
        const { linkId: _drop, ...rest } = x.data;
        await updateEntry(session, x.id, linkKind, rest, true);
      }
      linkId = undefined;
      note = ` – Verknüpfung gelöst, der ${linkKind === "kinder" ? "Kinderzeit" : "Auszeit"}-Eintrag bleibt bestehen (bei Bedarf dort löschen)`;
    }
    if (linkKind && !linkId && wantsLink && other) {
      linkId = randomUUID();
      await addEntry(session, linkKind, linkedEntry(d, st, linkId, rep));
      note = ` – zugleich ${linkKind === "auszeit" ? "Auszeit" : "Kinderzeit"} für ${settings.partners[other]} eingetragen`;
    } else if (linkKind && linkId) {
      // Der verknüpfte Eintrag gehört immer der jeweils anderen Person (Auszeit A ↔ Kinder bei B) – auch nach
      // einem Personenwechsel. Früher blieb die Person dort stehen: „Auszeit Alexandra · Kinder bei Alexandra“.
      let n = 0;
      for (const x of linkedRows.filter((x) => x.data.linkId === linkId)) {
        await updateEntry(session, x.id, linkKind, { day: d, from, to, hours, status: st, ...(other ? { person: other } : {}), editedAt: new Date().toISOString() });
        n++;
      }
      if (n) note = " – verknüpfter Eintrag angepasst";
    }
    await updateEntry(session, e.id, kind, { ...data, ...(linkId ? { linkId } : {}), editedAt: new Date().toISOString() }, true);
    return note;
  }

  if (cur) {
    const scope = seriesScope(fd.get("umfang"));
    const { targets, kept } = seriesTargets(all as unknown as SeriesRow[], cur as unknown as SeriesRow, scope);
    const delta = daysBetween(String(cur.data.day), day);
    let note = "";
    for (const t of targets) {
      const isCur = t.id === cur.id;
      const rep = { repeatId: t.data.repeatId, repeatEvery: t.data.repeatEvery };
      const data = isCur
        ? build(day, status, { ...own, fromEvent: fromEventOf(fd, cur.data.fromEvent), ...rep })
        : build(addDays(t.data.day, delta), parseStatus(t.data.status) ?? "geplant", { ...pick(t.data, OWN_KEYS), fromEvent: (t.data as Record<string, unknown>).fromEvent, ...rep });
      // Nur diesen einen Termin anders gelegt → Ausnahme; spätere Änderungen der Serie lassen ihn dann in Ruhe.
      if (isCur && scope === "dieser" && cur.data.repeatId && (cur.data.exception === true || changesTiming(cur.data, data))) data.exception = true;
      const n = await editOne(t, data);
      if (isCur) note = n;
    }
    return { ok: true, message: `Geändert: ${what}${note}${seriesNote(scope, targets.length, kept)}.`, id: cur.id, day };
  }

  const rep = repeatDays(day, fd.get("wiederholung"), fd.get("bis"));
  if ("error" in rep) return fail(rep.error);
  const series = rep.days.length > 1 ? { repeatId: randomUUID(), repeatEvery: rep.every } : {};
  let firstId = "";
  let linked = false;
  for (const d of rep.days) {
    const st = d === day ? status : defaultStatus(d, today);
    const linkId = linkKind && wantsLink && other ? randomUUID() : undefined;
    const id = await addEntry(session, kind, build(d, st, { ...(d === day ? { ...own, fromEvent: fromEventOf(fd) } : {}), ...series, linkId }));
    firstId ||= id;
    if (linkKind && linkId) {
      await addEntry(session, linkKind, linkedEntry(d, st, linkId, series));
      linked = true;
    }
  }
  const label = kind === "paarzeit" ? "Paarzeit" : person === "beide" ? "Kinderzeit zusammen" : `${settings.partners[person!]}`;
  const linkText = linked && other ? ` – zugleich ${linkKind === "auszeit" ? "Auszeit" : "Kinderzeit"} für ${settings.partners[other]} (zählt dort, nicht doppelt)` : "";
  return { ok: true, message: `Eingetragen: ${label} am ${what}${linkText}${repeatNote(rep)}.`, id: firstId, day };
}

type SeriesRow = { id: string; data: { day: string; status?: string; exception?: boolean; repeatId?: string; repeatEvery?: number } };
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const repeatNote = (rep: { days: string[]; every?: number }) => (rep.days.length > 1 ? ` – ${rep.days.length} Termine, ${REPEAT_LABEL[rep.every ?? 7]} bis ${dmy(rep.days[rep.days.length - 1])}` : "");
const seriesNote = (scope: SeriesScope, n: number, kept: number) =>
  scope === "dieser" ? "" : ` – ${n} ${n === 1 ? "Eintrag" : "Einträge"} der Serie geändert${kept ? `, ${kept} ${kept === 1 ? "bleibt" : "bleiben"} unverändert (schon erledigt oder einzeln geändert)` : ""}`;

// ---- Termine --------------------------------------------------------------------------------------------

const WITH = ["ads", "paar", "arzt", "familie", "privat", "sonst"] as const;

export async function saveAppointment(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  if (!isDay(fd.get("day"))) return fail("Bitte ein Datum angeben.");
  const day = String(fd.get("day"));
  const editId = String(fd.get("id") ?? "") || null;
  const all = await loadEntries<AppointmentEntry>(session, ["termin"]);
  const cur = editId ? all.find((e) => e.id === editId) : undefined;
  if (editId && !cur) return fail("Eintrag nicht gefunden.");
  const status = statusFrom(fd, day, today, cur?.data.status);
  const problem = statusProblem(day, status, today);
  if (problem) return fail(problem);
  const from = time(fd.get("time"));
  const to = time(fd.get("to"));
  if (to && !from) return fail("Bitte auch die Anfangszeit angeben.");
  if (from && to && to <= from) return fail("Das Ende liegt vor dem Beginn – bitte prüfen.");
  const w = String(fd.get("with") ?? "");
  const p = fd.get("person");
  // Gilt bei Serien für alle betroffenen Termine; Notizen gehören zum einzelnen Termin.
  const shared = {
    time: from,
    to,
    with: (WITH as readonly string[]).includes(w) ? (w as AppointmentEntry["with"]) : "privat",
    title: clip(fd.get("title"), 120),
    person: partnerOf(p) ?? ("beide" as const),
    extern: externFrom(fd),
  };
  if (!shared.title && (shared.with === "privat" || shared.with === "familie")) return fail("Bitte einen Titel angeben.");
  const notes = clip(fd.get("notes"), 4000);
  if (cur) {
    const scope = seriesScope(fd.get("umfang"));
    const { targets, kept } = seriesTargets(all as unknown as SeriesRow[], cur as unknown as SeriesRow, scope);
    const delta = daysBetween(cur.data.day, day);
    for (const t of targets) {
      const isCur = t.id === cur.id;
      const next: AppointmentEntry = isCur
        ? { ...cur.data, ...shared, day, status, notes, fromEvent: fromEventOf(fd, cur.data.fromEvent), exception: undefined }
        : { ...(t.data as unknown as AppointmentEntry), ...shared, day: addDays(t.data.day, delta) };
      if (isCur && scope === "dieser" && cur.data.repeatId && (cur.data.exception === true || changesTiming(cur.data, next))) next.exception = true;
      await updateEntry(session, t.id, "termin", compact(next), true);
    }
    return { ok: true, message: `Termin am ${dmy(day)} geändert${seriesNote(scope, targets.length, kept)}.`, id: cur.id, day };
  }
  const rep = repeatDays(day, fd.get("wiederholung"), fd.get("bis"));
  if ("error" in rep) return fail(rep.error);
  const series = rep.days.length > 1 ? { repeatId: randomUUID(), repeatEvery: rep.every } : {};
  let firstId = "";
  for (const d of rep.days) {
    const entry: AppointmentEntry = { day: d, ...shared, status: d === day ? status : defaultStatus(d, today), ...(d === day ? { notes, fromEvent: fromEventOf(fd) } : {}), ...series };
    const id = await addEntry(session, "termin", compact(entry));
    firstId ||= id;
  }
  return { ok: true, message: `Termin am ${dmy(day)} gespeichert${repeatNote(rep)}.`, id: firstId, day };
}

// ---- Nähe -------------------------------------------------------------------------------------------------

export async function saveNaehe(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  const day = isDay(fd.get("day")) ? String(fd.get("day")) : today;
  if (day > today) return fail("Nähe bitte erst eintragen, wenn sie stattgefunden hat.");
  const ini = fd.get("initiative");
  const data = compact({ day, time: time(fd.get("time")), initiative: ini === "a" || ini === "b" || ini === "beide" ? ini : undefined, closeness: rating(fd.get("closeness")), note: clip(fd.get("note"), 500) });
  const editId = String(fd.get("id") ?? "") || null;
  if (editId) {
    if (!(await updateEntry(session, editId, "intim", data, true))) return fail("Eintrag nicht gefunden.");
    return { ok: true, message: `Geändert: ${dmy(day)}.`, id: editId, day };
  }
  const id = await addEntry(session, "intim", data);
  return { ok: true, message: `Eingetragen für ${dmy(day)}.`, id, day };
}

// ---- Streicheln & Massage -------------------------------------------------------------------------------

const touchLabel = (k: TouchKind) => (k === "massage" ? "Massage" : "Streicheln");

/**
 * Neu: Streicheln und/oder Massage am selben Tag – je ein eigener Eintrag, damit beides getrennt bestätigt
 * werden kann. Ändern (mit `id`): genau dieser Eintrag; bei einem Vorkommen aus dem Abendritual heißt ein
 * anderer Tag „verschoben“ (das Vorkommen bleibt zugeordnet, die Serie ändert sich nicht).
 */
export async function saveTouches(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  const day = isDay(fd.get("day")) ? String(fd.get("day")) : today;
  const editId = String(fd.get("id") ?? "") || null;
  const minutes = num(fd.get("minutes"), 1, 600);
  const note = clip(fd.get("note"), 300);
  if (editId) {
    const cur = (await loadEntries<TouchEntry>(session, ["zuwendung"])).find((e) => e.id === editId);
    if (!cur) return fail("Eintrag nicht gefunden.");
    const status = statusFrom(fd, day, today, cur.data.status);
    const problem = statusProblem(day, status, today);
    if (problem) return fail(problem);
    const giver = partnerOf(fd.get("giver")) ?? cur.data.giver;
    const kind: TouchKind = fd.get("kind") === "massage" ? "massage" : fd.get("kind") === "streicheln" ? "streicheln" : cur.data.kind;
    const next: TouchEntry = compact({ ...cur.data, day, kind, giver, receiver: otherOf(giver), time: time(fd.get("time")), minutes, note, status, skipped: undefined });
    await updateEntry(session, cur.id, "zuwendung", next, true);
    return { ok: true, message: `${touchLabel(kind)} am ${dmy(day)} geändert (${status}).`, id: cur.id, day };
  }
  const status = statusFrom(fd, day, today);
  const problem = statusProblem(day, status, today);
  if (problem) return fail(problem);
  const wanted: { kind: TouchKind; giver: PartnerKey }[] = [];
  for (const kind of ["streicheln", "massage"] as const) {
    if (fd.get(`do-${kind}`) !== "on") continue;
    const giver = partnerOf(fd.get(`${kind}-giver`));
    if (!giver) return fail(`Bitte bei ${touchLabel(kind)} wählen, wer gibt.`);
    wanted.push({ kind, giver });
  }
  if (!wanted.length) return fail("Bitte Streicheln, Massage oder beides auswählen.");
  const ids: string[] = [];
  for (const w of wanted) ids.push(await addEntry(session, "zuwendung", compact({ day, kind: w.kind, giver: w.giver, receiver: otherOf(w.giver), time: time(fd.get(`${w.kind}-time`)) ?? time(fd.get("time")), minutes, note, status })));
  return { ok: true, message: `${wanted.map((w) => touchLabel(w.kind)).join(" und ")} am ${dmy(day)} eingetragen (${status}).`, id: ids[0], day };
}

// ---- Periode ----------------------------------------------------------------------------------------------

/** Beginn (Pflicht), Ende (später nachtragen), Notiz, Freigabe für andere Konten – auch rückwirkend. */
export async function savePeriod(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  if (!isDay(fd.get("start"))) return fail("Bitte den ersten Tag angeben.");
  const start = String(fd.get("start"));
  const end = isDay(fd.get("end")) ? String(fd.get("end")) : undefined;
  const settings = await privateSettings(session.tenantId);
  const person = partnerOf(fd.get("person")) ?? myPartner(settings, session);
  if (!person) return fail("Bitte wählen, wessen Periode es ist.");
  const members = await privateMembers(session.tenantId);
  const shareWith = fd.getAll("shareWith").map(String).filter((u) => u !== session.userId && members.some((m) => m.userId === u));
  const editId = String(fd.get("id") ?? "") || null;
  const all = await loadEntries<PeriodEntry>(session, ["periode"]);
  const cur = editId ? all.find((e) => e.id === editId && e.userId === session.userId) : undefined;
  if (editId && !cur) return fail("Eintrag nicht gefunden (nur wer die Periode eingetragen hat, kann sie ändern).");
  const problem = periodProblem({ start, end, person }, all.map((e) => ({ id: e.id, ...e.data })), today, editId ?? undefined);
  if (problem) return fail(problem);
  const data: PeriodEntry = compact({ start, end, person, note: clip(fd.get("note"), 300), shareWith });
  if (cur) {
    await updateEntry(session, cur.id, "periode", data, true);
    return { ok: true, message: `Periode ${dmy(start)}${end ? `–${dmy(end)}` : " (läuft)"} geändert.`, id: cur.id, day: start };
  }
  const id = await addEntry(session, "periode", data);
  return { ok: true, message: `Periode ab ${dmy(start)}${end ? ` bis ${dmy(end)}` : " eingetragen – das Ende später hier nachtragen"}.`, id, day: start };
}

/** Laufende Periode beenden (letzter Tag: heute oder angegeben). */
export async function endPeriod(session: Session, id: string, endIn: unknown): Promise<SaveResult> {
  const today = todayIso();
  const all = await loadEntries<PeriodEntry>(session, ["periode"]);
  const cur = all.find((e) => e.id === id && e.userId === session.userId);
  if (!cur) return fail("Eintrag nicht gefunden.");
  const end = isDay(endIn) ? String(endIn) : today;
  const problem = periodProblem({ ...cur.data, end }, all.map((e) => ({ id: e.id, ...e.data })), today, id);
  if (problem) return fail(problem);
  await updateEntry(session, id, "periode", { end });
  return { ok: true, message: `Periode bis ${dmy(end)} eingetragen.`, id, day: cur.data.start };
}

// ---- Abendritual ------------------------------------------------------------------------------------------

/**
 * Wochenvorlage speichern. Bestätigte, verschobene oder ausgelassene Vorkommen sind eigene Einträge und
 * bleiben unverändert. Ändert sich der Ablauf ab einem späteren Tag, endet die alte Vorlage am Vortag und
 * eine neue beginnt – frühere Wochen bleiben, wie sie waren.
 */
export async function saveRitual(session: Session, fd: FormData): Promise<SaveResult> {
  const today = todayIso();
  const strokeGiver = partnerOf(fd.get("streicheln-giver")) ?? "a";
  const massageGiver = partnerOf(fd.get("massage-giver")) ?? "b";
  const strokeTime = time(fd.get("streicheln-time"));
  const massageTime = time(fd.get("massage-time"));
  const mode = fd.get("modus") === "abfolge" ? ("abfolge" as const) : ("woche" as const);
  const slot = (wd: number, kind: TouchKind): RitualSlot => kind === "streicheln" ? compact({ weekday: wd, kind, giver: strokeGiver, receiver: otherOf(strokeGiver), time: strokeTime }) : compact({ weekday: wd, kind, giver: massageGiver, receiver: otherOf(massageGiver), time: massageTime });
  const slots: RitualSlot[] = [];
  for (let wd = 1; wd <= 7; wd++) {
    if (mode === "abfolge") {
      // Abfolge: an jedem gewählten Abend beide Plätze – welcher dran ist, ergibt die Reihenfolge.
      if (fd.get(`a-${wd}`) === "on") slots.push(slot(wd, "streicheln"), slot(wd, "massage"));
      continue;
    }
    if (fd.get(`s-${wd}-streicheln`) === "on") slots.push(slot(wd, "streicheln"));
    if (fd.get(`s-${wd}-massage`) === "on") slots.push(slot(wd, "massage"));
  }
  if (!slots.length) return fail(mode === "abfolge" ? "Bitte mindestens einen Abend für die Abfolge ankreuzen." : "Bitte mindestens einen Tag ankreuzen.");
  const strokesPerMassage = Math.round(num(fd.get("strokesPerMassage"), 1, 14) ?? 2);
  const title = clip(fd.get("title"), 60) ?? "Unser Abendritual";
  const validFrom = isDay(fd.get("from")) ? String(fd.get("from")) : today;
  const until = isDay(fd.get("until")) ? String(fd.get("until")) : undefined;
  if (until && until < validFrom) return fail("„Endet am“ liegt vor dem Beginn.");
  // Abfolge setzt beim tatsächlichen Stand an (bestätigte Streicheleinheiten seit der letzten Massage).
  const offset = mode === "abfolge" ? Math.min(strokesPerMassage, touchRhythm((await loadEntries<TouchEntry>(session, ["zuwendung"])).map((t) => t.data), { slots, strokesPerMassage }).count) : undefined;
  const next: RitualEntry = compact({ title, slots, from: validFrom, until, strokesPerMassage, active: true, mode: mode === "abfolge" ? mode : undefined, offset: offset || undefined });
  const editId = String(fd.get("id") ?? "") || null;
  const plan = mode === "abfolge" ? ` Abfolge: ${strokesPerMassage}× Streicheln, dann Massage${offset ? ` – startet beim aktuellen Stand (${offset}/${strokesPerMassage})` : ""}.` : "";
  if (editId) {
    const cur = (await loadEntries<RitualEntry>(session, ["ritual"])).find((e) => e.id === editId);
    if (!cur) return fail("Vorlage nicht gefunden.");
    const sameFlow = JSON.stringify(cur.data.slots) === JSON.stringify(slots) && (cur.data.mode ?? "woche") === mode && (mode === "woche" || cur.data.strokesPerMassage === strokesPerMassage);
    if (cur.data.from < validFrom && !sameFlow) {
      await updateEntry(session, cur.id, "ritual", { until: addDays(validFrom, -1) });
      const id = await addEntry(session, "ritual", next);
      return { ok: true, message: `Neuer Ablauf gilt ab ${dmy(validFrom)} – frühere Wochen bleiben unverändert, bestätigte Einträge auch.${plan}`, id, day: validFrom };
    }
    // Gleicher Ablauf: Reihenfolge und Startstand der Abfolge bleiben, wie sie waren.
    await updateEntry(session, cur.id, "ritual", { ...next, from: cur.data.from < validFrom ? cur.data.from : validFrom, ...(sameFlow ? { offset: cur.data.offset } : {}) }, true);
    return { ok: true, message: `Vorlage gespeichert – bestätigte, verschobene oder ausgelassene Termine bleiben, wie sie sind.${plan}`, id: cur.id, day: validFrom };
  }
  const id = await addEntry(session, "ritual", next);
  return { ok: true, message: `„${title}“ angelegt – ab ${dmy(validFrom)} im Kalender (geplant, zählt erst nach Bestätigung).${plan}`, id, day: validFrom };
}

export type OccurrenceOp = "stattgefunden" | "ausgefallen" | "auslassen" | "verschieben";

/** Ein Vorkommen der Serie bestätigen, als ausgefallen markieren, auslassen oder verschieben – nur dieses eine. */
export async function handleOccurrence(session: Session, key: string, op: OccurrenceOp, fd?: FormData): Promise<SaveResult> {
  const today = todayIso();
  const occ = parseOccurrence(key);
  if (!occ) return fail("Termin nicht gefunden.");
  const ritual = (await loadEntries<RitualEntry>(session, ["ritual"])).find((r) => r.id === occ.seriesId);
  if (!ritual) return fail("Die Vorlage gibt es nicht mehr.");
  const valid = ritualOccurrences(ritual.id, ritual.data, occ.day, occ.day, new Set()).find((o) => o.key === key);
  if (!valid || isoWeekday(occ.day) !== valid.slot.weekday || slotKey(valid.slot) !== occ.slot) return fail("Dieser Termin gehört nicht (mehr) zur Vorlage.");
  const slot = valid.slot;
  let day = occ.day;
  let status: EntryStatus = op === "stattgefunden" ? "stattgefunden" : op === "verschieben" ? "geplant" : "ausgefallen";
  let at = slot.time;
  if (op === "verschieben") {
    if (!fd || !isDay(fd.get("day"))) return fail("Bitte den neuen Tag angeben.");
    day = String(fd.get("day"));
    at = time(fd.get("time")) ?? slot.time;
    status = parseStatus(fd.get("status")) ?? defaultStatus(day, today);
  }
  const problem = statusProblem(day, status, today);
  if (problem) return fail(problem);
  const existing = (await loadEntries<TouchEntry>(session, ["zuwendung"])).find((e) => e.data.occurrence === key);
  const data: TouchEntry = compact({ day, kind: slot.kind, giver: slot.giver, receiver: slot.receiver, time: at, status, seriesId: ritual.id, occurrence: key, skipped: op === "auslassen" ? true : undefined, note: existing?.data.note });
  const id = existing ? (await updateEntry(session, existing.id, "zuwendung", data, true), existing.id) : await addEntry(session, "zuwendung", data);
  const text = op === "stattgefunden" ? "bestätigt" : op === "ausgefallen" ? "als ausgefallen markiert" : op === "auslassen" ? "ausgelassen" : `verschoben auf ${dmy(day)}`;
  return { ok: true, message: `${touchLabel(slot.kind)} am ${dmy(occ.day)} ${text} – die Serie bleibt unverändert.`, id, day };
}

// ---- Status (alle planbaren Arten) ------------------------------------------------------------------------

export const STATUS_KINDS: PrivateKind[] = ["termin", "kinder", "auszeit", "ausschlafen", "paarzeit", "zuwendung"];

/** Status eines Eintrags ändern; verknüpfte Kinderzeit/Auszeit bekommt denselben Status (ein Vorgang). */
export async function setStatus(session: Session, id: string, statusIn: unknown): Promise<SaveResult> {
  const status = parseStatus(statusIn);
  if (!status) return fail("Unbekannter Status.");
  const e = await loadEntry<{ day?: string; linkId?: string; status?: string }>(session, id);
  if (!e || !STATUS_KINDS.includes(e.kind) || !e.data.day) return fail("Eintrag nicht gefunden.");
  const problem = statusProblem(e.data.day, status, todayIso());
  if (problem) return fail(problem);
  if (statusOf(e.data) === status) return { ok: true, message: "Unverändert.", id, day: e.data.day };
  await updateEntry(session, id, e.kind, { status, ...(e.kind === "zuwendung" ? { skipped: undefined } : {}) });
  if ((e.kind === "kinder" || e.kind === "auszeit") && e.data.linkId) {
    const pk = e.kind === "kinder" ? "auszeit" : "kinder";
    for (const x of (await loadEntries<{ linkId?: string }>(session, [pk])).filter((x) => x.data.linkId === e.data.linkId)) await updateEntry(session, x.id, pk, { status });
  }
  return { ok: true, message: `Status: ${status}.`, id, day: e.data.day };
}

// ---- Verknüpfungen reparieren -----------------------------------------------------------------------

/** Widersprüche zwischen verknüpfter Auszeit und Kinderzeit (siehe linkIssues) – aus den aktuellen Daten. */
export async function currentLinkIssues(session: Session) {
  const [auszeit, kinder, settings] = await Promise.all([loadEntries<SleepEntry>(session, ["auszeit"]), loadEntries<KidsEntry>(session, ["kinder"]), privateSettings(session.tenantId)]);
  return linkIssues(auszeit, kinder, settings.partners);
}

/**
 * Einen Vorschlag anwenden – nur nach ausdrücklicher Wahl. Die Vorschläge werden aus den aktuellen Daten neu
 * berechnet (nicht aus dem Formular übernommen); hat sich inzwischen etwas geändert, passiert nichts.
 */
export async function repairLink(session: Session, key: unknown, fixIndex: unknown): Promise<SaveResult> {
  const issue = (await currentLinkIssues(session)).find((i) => i.key === key);
  const fix = issue?.fixes[Number(fixIndex)];
  if (!issue || !fix) return fail("Dieser Widerspruch ist schon behoben oder hat sich geändert – bitte die Liste neu laden.");
  for (const c of fix.changes) await updateEntry(session, c.id, c.kind, { ...c.data, editedAt: new Date().toISOString() }, true);
  return { ok: true, message: `Repariert: ${fix.label}.`, day: issue.day };
}

// ---- Löschen ----------------------------------------------------------------------------------------------

/**
 * Löschen – bei Serien nach ausdrücklicher Wahl nur diesen, diesen und alle folgenden oder die ganze Serie.
 * Ein verknüpfter Vorgang (Kinderzeit + Auszeit) wird als Ganzes gelöscht. Gibt die Anzahl zurück.
 */
export async function deleteEntries(session: Session, kind: PrivateKind, id: string, scopeIn: unknown): Promise<number> {
  const all = await loadEntries<Record<string, unknown>>(session, [kind]);
  const cur = all.find((e) => e.id === id);
  if (!cur) return (await deleteEntry(session, id, kind)) ? 1 : 0;
  const ids = new Set(seriesDeleteIds(all as unknown as SeriesRow[], cur as unknown as SeriesRow, seriesScope(scopeIn)));
  const linkKind: PrivateKind | null = kind === "kinder" ? "auszeit" : kind === "auszeit" ? "kinder" : null;
  const linked = linkKind ? await loadEntries<{ linkId?: string }>(session, [linkKind]) : [];
  let n = 0;
  for (const x of all.filter((e) => ids.has(e.id))) {
    const linkId = x.data.linkId;
    if (linkKind && linkId) for (const l of linked.filter((l) => l.data.linkId === linkId)) await deleteEntry(session, l.id, linkKind);
    if (await deleteEntry(session, x.id, kind)) n++;
  }
  return n;
}
