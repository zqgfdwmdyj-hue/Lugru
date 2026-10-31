import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { addEntry, loadEntries, privateSettings, updateEntry } from "./service";
import type { AppointmentEntry, PartnerKey } from "./logic";
import { abfahrt, konfliktMit, passtZu, terminAusMail, terminTitel, type TerminMail } from "./termin-mail";

// Termin-Mails (Modul 6) → Privatkalender des Inhabers. Diese Mails landen nie im geschäftlichen Posteingang;
// Meldungen gehen nur per Push an den Inhaber (nie in den gemeinsamen Discord-Kanal).

type MailTermin = AppointmentEntry & { quelle?: "mail"; mailKeys?: string[]; erinnertAm?: string };

/**
 * Sitzung des Inhabers für den Privatbereich (Hintergrund, ohne Anmeldung): nur ein Inhaber mit vollem
 * Privat-Zugang, der ändern darf. Ohne so einen Zugang → null (dann wird nichts übernommen).
 */
export async function inhaberPrivatSitzung(tenantId: string): Promise<Session | null> {
  const M = schema.memberships;
  const [row] = await db
    .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, tenantName: schema.tenants.name })
    .from(M)
    .innerJoin(schema.users, eq(schema.users.id, M.userId))
    .innerJoin(schema.tenants, eq(schema.tenants.id, M.tenantId))
    .where(and(eq(M.tenantId, tenantId), eq(M.role, "owner"), eq(M.privateAccess, true), eq(M.privateScope, "voll"), eq(M.readOnly, false)))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    tenantId,
    role: "owner",
    areas: null,
    brandIds: null,
    readOnly: false,
    privateAccess: true,
    privateScope: "voll",
    privatePin: false,
    privateUnlockedUntil: null,
    sessionId: "system:termin-mail",
    email: row.email,
    name: row.name,
    tenantName: row.tenantName,
  };
}

const mailKey = (messageKey: string) => createHash("sha256").update(messageKey).digest("hex").slice(0, 20);
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Person aus der Mail → Partner (Name aus den Privat-Einstellungen) oder Kind (im Titel). */
function personZuordnen(name: string | null, s: { partners: { a: string; b: string }; kids: string[] }): { person: PartnerKey | "beide"; kind: string | null } {
  if (!name) return { person: "beide", kind: null };
  const n = name.toLowerCase();
  for (const k of ["a", "b"] as const) if (s.partners[k] && s.partners[k].toLowerCase().split(/\s+/)[0] === n) return { person: k, kind: null };
  const kind = s.kids.find((k) => k.toLowerCase().split(/\s+/)[0] === n) ?? null;
  return { person: "beide", kind };
}

function notizen(t: TerminMail, m: { subject: string; receivedAt: Date }, kind: string | null): string {
  return [
    `Aus Mail vom ${m.receivedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}: ${m.subject.slice(0, 160)}`,
    kind ? `Für: ${kind}` : "",
    t.adresse ? `Adresse: ${t.adresse}` : "",
    t.mitbringen ? `Mitbringen: ${t.mitbringen}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export type TerminErgebnis = { ergebnis: "neu" | "verschoben" | "abgesagt" | "bekannt" | "ohne_termin"; tag: string; konflikt: string | null };

/**
 * Termin-Mail übernehmen: null = keine (private) Termin-Mail oder kein Inhaber mit Privat-Zugang. Erkannte Termine
 * werden angelegt, verschoben oder als ausgefallen markiert – nie gelöscht. Dieselbe Mail wirkt nur einmal.
 */
export async function terminMailUebernehmen(tenantId: string, m: { messageKey: string; from: string; subject: string; body: string; receivedAt: Date }, heute: string): Promise<TerminErgebnis | null> {
  const t = terminAusMail(m, heute);
  if (!t) return null;
  const session = await inhaberPrivatSitzung(tenantId);
  if (!session) return null;
  const key = mailKey(m.messageKey);
  const s = await privateSettings(tenantId);
  const termine = await loadEntries<MailTermin>(session, ["termin"]);
  const bekannt = termine.find((e) => e.data.mailKeys?.includes(key));
  if (bekannt) return { ergebnis: "bekannt", tag: bekannt.data.day, konflikt: null };
  const keys = (e?: { data: MailTermin }) => [...(e?.data.mailKeys ?? []), key].slice(-10);
  const aktiv = (e: { data: MailTermin }) => e.data.status !== "ausgefallen";
  const { person, kind } = personZuordnen(t.person, s);
  const notiz = notizen(t, m, kind);
  const titel = terminTitel(t) + (kind ? ` (${kind})` : "");
  const konflikt = (tag: string, uhrzeit: string | null, ohne?: string) => konfliktMit(termine.filter((e) => e.id !== ohne && aktiv(e)).map((e) => ({ day: e.data.day, time: e.data.time, title: e.data.title })), tag, uhrzeit);

  if (t.art === "abgesagt") {
    const e = termine.find((x) => aktiv(x) && passtZu(x.data, t, t.tag));
    if (!e) return { ergebnis: "ohne_termin", tag: t.tag, konflikt: null };
    await updateEntry(session, e.id, "termin", { status: "ausgefallen", notes: `${e.data.notes ? `${e.data.notes}\n` : ""}Abgesagt laut Mail vom ${dmy(heute)}.`.slice(0, 4000), mailKeys: keys(e) });
    return { ergebnis: "abgesagt", tag: t.tag, konflikt: null };
  }
  if (t.art === "verschoben" && t.alterTag) {
    const e = termine.find((x) => aktiv(x) && passtZu(x.data, t, t.alterTag!));
    if (e) {
      await updateEntry(session, e.id, "termin", { day: t.tag, time: t.uhrzeit ?? e.data.time, status: "geplant", notes: `${e.data.notes ? `${e.data.notes}\n` : ""}Verschoben vom ${dmy(t.alterTag)} laut Mail.`.slice(0, 4000), mailKeys: keys(e) });
      return { ergebnis: "verschoben", tag: t.tag, konflikt: konflikt(t.tag, t.uhrzeit ?? e.data.time ?? null, e.id) };
    }
  }
  const da = termine.find((x) => aktiv(x) && passtZu(x.data, t, t.tag));
  if (da) {
    await updateEntry(session, da.id, "termin", { ...(t.uhrzeit && !da.data.time ? { time: t.uhrzeit } : {}), mailKeys: keys(da) });
    return { ergebnis: "bekannt", tag: t.tag, konflikt: null };
  }
  const neu: MailTermin = { day: t.tag, ...(t.uhrzeit ? { time: t.uhrzeit } : {}), with: t.mit, title: titel.slice(0, 120), person, notes: notiz.slice(0, 4000), status: "geplant", quelle: "mail", mailKeys: [key] };
  await addEntry(session, "termin", neu as unknown as Record<string, unknown>);
  return { ergebnis: "neu", tag: t.tag, konflikt: konflikt(t.tag, t.uhrzeit) };
}

/** Kurze Meldung an den Inhaber (nur Push, ohne Inhalt der Mail auf dem Sperrbildschirm). */
export async function terminMelden(tenantId: string, r: TerminErgebnis) {
  if (r.ergebnis === "bekannt" || r.ergebnis === "ohne_termin") return;
  const session = await inhaberPrivatSitzung(tenantId);
  if (!session) return;
  const { melden } = await import("@/lib/push/service");
  const was = r.ergebnis === "neu" ? "übernommen" : r.ergebnis === "verschoben" ? "verschoben" : "abgesagt";
  await melden(
    tenantId,
    [session.userId],
    { titel: `Privatkalender: Termin ${was}`, text: `Termin am ${dmy(r.tag)} aus einer Mail ${was}.${r.konflikt ? ` Achtung: Überschneidung mit „${r.konflikt}“ – bitte prüfen.` : ""}`, link: `/privat/kalender?ansicht=tag&tag=${r.tag}` },
    { ohneDiscord: true },
  ).catch(() => null);
}

/**
 * Vorabend-Erinnerung (Modul 6): ab der eingestellten Uhrzeit einmal je Termin – „Morgen 09:30 Arzttermin, Abfahrt
 * ca. 09:00“. Nur Termine mit Uhrzeit, die nicht ausgefallen sind. Liefert die Zahl der Erinnerungen.
 */
export async function vorabendErinnerung(tenantId: string, jetzt = new Date()): Promise<number> {
  const { getSettings } = await import("@/lib/settings");
  const cfg = (await getSettings(tenantId)).posteingang;
  const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(jetzt);
  const [heute, uhr] = berlin.split(" ");
  if (uhr < (cfg.vorabendUm || "18:00")) return 0;
  const session = await inhaberPrivatSitzung(tenantId);
  if (!session) return 0;
  const morgen = new Date(Date.parse(`${heute}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const termine = (await loadEntries<MailTermin>(session, ["termin"])).filter((e) => e.data.day === morgen && e.data.time && e.data.status !== "ausgefallen" && e.data.erinnertAm !== heute);
  if (!termine.length) return 0;
  const { melden } = await import("@/lib/push/service");
  for (const e of termine.sort((a, b) => (a.data.time ?? "").localeCompare(b.data.time ?? ""))) {
    const ab = abfahrt(e.data.time!, cfg.abfahrtVorher);
    await melden(tenantId, [session.userId], { titel: `Morgen ${e.data.time}: ${(e.data.title || "Termin").slice(0, 60)}`, text: `Abfahrt ca. ${ab}${e.data.to ? ` · bis ${e.data.to}` : ""}. In der Arbeitszeit als Sperrzeit eingeplant.`, link: `/privat/kalender?ansicht=tag&tag=${morgen}` }, { ohneDiscord: true }).catch(() => null);
    await updateEntry(session, e.id, "termin", { erinnertAm: heute });
  }
  return termine.length;
}

/** Für `posteingang` (nur Claude mit Privat-Freigabe): wie viele Termin-Mails in den letzten Tagen übernommen wurden. */
export async function terminMailsZuletzt(session: Session, tage = 7): Promise<{ anzahl: number; naechster: { tag: string; titel: string } | null }> {
  const seit = Date.now() - tage * 86_400_000;
  const liste = (await loadEntries<MailTermin>(session, ["termin"])).filter((e) => e.data.quelle === "mail" && e.updatedAt.getTime() >= seit);
  const kommend = liste.filter((e) => e.data.status !== "ausgefallen").sort((a, b) => a.data.day.localeCompare(b.data.day))[0];
  return { anzahl: liste.length, naechster: kommend ? { tag: kommend.data.day, titel: kommend.data.title ?? "Termin" } : null };
}
