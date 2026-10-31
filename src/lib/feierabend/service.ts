import "server-only";
import { and, eq, gte, isNull, lt, lte, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { linkAllowed } from "@/lib/auth/areas";
import { privateCalendar } from "@/lib/private/calendar-data";
import type { TouchEntry } from "@/lib/private/kalender";
import type { DateIdea, MoodEntry, ObservationEntry, TalkEntry, TaskEntry, ThanksEntry } from "@/lib/private/logic";
import { vergleichVorwoche, wochePrivat } from "@/lib/private/rueckblick-logic";
import { loadEntries, myPartner, privateSettings } from "@/lib/private/service";
import { plusTage, wochentag } from "@/lib/tagesplan/logic";
import { tagesplan } from "@/lib/tagesplan/service";
import { berlinMidnight, bindingTask } from "@/lib/today/service";

// Feierabend-Check: heute erledigt, was noch offen ist (rutscht auf morgen), morgen Termine + Top-3 und
// Sperrzeiten. Sonntags (oder auf Wunsch) Wochenrückblick Geschäft + Privat (Familienzeit, Paarzeit).

const T = schema.tasks;

const meineAufgabe = (session: Session) => (session.role === "owner" ? or(eq(T.assigneeId, session.userId), and(isNull(T.assigneeId), isNull(T.zustaendigExtern)))! : eq(T.assigneeId, session.userId));
const sichtbar = (session: Session) => (x: { link: string | null; createdBy: string | null; assigneeId: string | null }) =>
  !(session.role === "staff" && session.areas !== null) || (x.link ? linkAllowed(session, x.link) : x.createdBy === session.userId || x.assigneeId === session.userId);

const dauerMin = (von?: string, bis?: string) => {
  if (!von || !bis) return 0;
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return Math.max(0, m(bis) - m(von));
};

export async function feierabend(session: Session, o: { heute: string; mitPrivat?: boolean; rueckblick?: boolean }) {
  const t = session.tenantId;
  const morgen = plusTage(o.heute, 1);
  const vis = sichtbar(session);
  const erledigt = (
    await db
      .select({ id: T.id, title: T.title, link: T.link, createdBy: T.createdBy, assigneeId: T.assigneeId, completedAt: T.completedAt })
      .from(T)
      .where(and(eq(T.tenantId, t), eq(T.status, "done"), gte(T.completedAt, berlinMidnight(o.heute)), lt(T.completedAt, berlinMidnight(morgen)), meineAufgabe(session)))
  ).filter(vis);
  const offen = (
    await db
      .select({ id: T.id, title: T.title, link: T.link, createdBy: T.createdBy, assigneeId: T.assigneeId, dueDate: T.dueDate, priority: T.priority })
      .from(T)
      .where(and(eq(T.tenantId, t), eq(T.status, "open"), lte(T.dueDate, o.heute), meineAufgabe(session), bindingTask))
  ).filter(vis);
  const plan = await tagesplan(session, { start: morgen, tage: 1, mitPrivat: o.mitPrivat, heute: o.heute });
  const m = plan.tage[0];
  const out = {
    heute: o.heute,
    morgen,
    erledigt: erledigt.map((x) => ({ id: x.id, titel: x.title, link: x.link })),
    offen: offen.map((x) => ({ id: x.id, titel: x.title, link: x.link, frist: x.dueDate, wichtig: x.priority === "critical" })),
    morgenArbeitszeit: m.arbeitszeit,
    morgenTermine: m.sperren.filter((s) => (s.art === "termin" || s.art === "privat") && !s.ganztags).sort((a, b) => a.von.localeCompare(b.von)),
    morgenSperren: m.sperren.filter((s) => s.ganztags || s.art === "frei" || s.art === "reserviert"),
    morgenTop3: m.geplant.slice(0, 3),
    morgenKonflikte: m.konflikte,
    morgenAmpel: m.ampel,
    privatDetails: plan.privatDetails,
    rueckblick: o.rueckblick || wochentag(o.heute) === 7 ? await wochenrueckblick(session, o.heute, !!o.mitPrivat) : null,
    // VA über Discord (nur Inhaber): „VA heute: 6 erledigt, 2 Rückfragen, 3 automatisch beantwortet“.
    va: session.role === "owner" ? await (await import("@/lib/va/service")).vaHeute(t, o.heute).catch(() => null) : null,
  };
  return out;
}

/** Offene Aufgaben mit Frist bis heute auf morgen schieben (wichtige bleiben – sie brauchen eine Entscheidung). */
export async function offeneAufMorgen(session: Session, heute: string): Promise<{ verschoben: number; wichtigGeblieben: number }> {
  const morgen = plusTage(heute, 1);
  const offen = (
    await db
      .select({ id: T.id, link: T.link, createdBy: T.createdBy, assigneeId: T.assigneeId, priority: T.priority })
      .from(T)
      .where(and(eq(T.tenantId, session.tenantId), eq(T.status, "open"), lte(T.dueDate, heute), meineAufgabe(session), bindingTask))
  ).filter(sichtbar(session));
  const schieben = offen.filter((x) => x.priority !== "critical");
  for (const x of schieben) await db.update(T).set({ dueDate: morgen }).where(and(eq(T.tenantId, session.tenantId), eq(T.id, x.id)));
  return { verschoben: schieben.length, wichtigGeblieben: offen.length - schieben.length };
}

/**
 * Wochenrückblick (letzte 7 Tage): erledigt je Person; privat nur mit Freigabe und vollem Umfang – Familienzeit,
 * Paarzeit, eigene Beobachtungen (Therapie-Bogen), Zuwendung, Gespräche, Danke, eigene Stimmung, Dateideen,
 * private Aufgaben und Vergleich zur Vorwoche.
 */
export async function wochenrueckblick(session: Session, heute: string, mitPrivat: boolean) {
  const t = session.tenantId;
  const von = plusTage(heute, -6);
  const rows = await db
    .select({ assigneeId: T.assigneeId, extern: T.zustaendigExtern })
    .from(T)
    .where(and(eq(T.tenantId, t), eq(T.status, "done"), gte(T.completedAt, berlinMidnight(von)), lt(T.completedAt, berlinMidnight(plusTage(heute, 1))), ne(T.category, "marken")));
  const namen = new Map(
    (await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.tenantId, t))).map((u) => [u.id, u.name || u.email]),
  );
  const je = new Map<string, number>();
  for (const r of rows) {
    const wer = r.assigneeId ? (namen.get(r.assigneeId) ?? "andere Person") : r.extern ? `${r.extern} (extern)` : session.role === "owner" ? (namen.get(session.userId) ?? "ich") : "ohne Zuständigen";
    je.set(wer, (je.get(wer) ?? 0) + 1);
  }
  const geschaeft = { zeitraum: { von, bis: heute }, erledigtJePerson: [...je.entries()].map(([person, anzahl]) => ({ person, anzahl })).sort((a, b) => b.anzahl - a.anzahl), erledigtGesamt: rows.length };
  if (!mitPrivat || !session.privateAccess || session.privateScope !== "voll") return { geschaeft, privat: null };
  const [pc, ps] = await Promise.all([privateCalendar(session, von, heute, heute), privateSettings(t)]);
  const ich = myPartner(ps, session);
  const stattgefunden = pc.items.filter((x) => x.day <= heute && x.status !== "ausgefallen" && (!ich || !x.people.length || x.people.includes(ich)));
  // Familienzeit = Kinderzeit und Auszeiten des Partners, in denen die Kinder bei mir waren.
  const beiMir = ich ? `Kinder bei ${ps.partners[ich]}` : "Kinder bei";
  const kinder = stattgefunden.filter((x) => x.kind === "kinder" || (x.kind === "auszeit" && x.title.includes(beiMir)));
  const paar = stattgefunden.filter((x) => x.kind === "paarzeit");
  // B16: übrige Privat-Einträge der Woche – Beobachtungen nur die eigenen, Stimmung nur die eigene Person.
  const [beob, zuwendung, gespraeche, danke, stimmung, ideen, aufgaben] = await Promise.all([
    loadEntries<ObservationEntry>(session, ["beobachtung"]),
    loadEntries<TouchEntry>(session, ["zuwendung"]),
    loadEntries<TalkEntry>(session, ["gespraech"]),
    loadEntries<ThanksEntry>(session, ["danke"]),
    loadEntries<MoodEntry>(session, ["stimmung"]),
    loadEntries<DateIdea>(session, ["dateidee"]),
    loadEntries<TaskEntry>(session, ["aufgabe"]),
  ]);
  const daten = {
    beobachtungen: beob.filter((e) => e.userId === session.userId).map((e) => e.data),
    zuwendung: zuwendung.map((e) => e.data),
    gespraeche: gespraeche.map((e) => e.data),
    danke: danke.map((e) => e.data),
    stimmung: stimmung.map((e) => e.data),
    dateideen: ideen.map((e) => ({ data: e.data, createdAt: e.createdAt })),
    aufgaben: aufgaben.map((e) => e.data),
  };
  const woche = wochePrivat(daten, { von, bis: heute, ich, namen: ps.partners });
  const vorwoche = wochePrivat(daten, { von: plusTage(von, -7), bis: plusTage(von, -1), ich, namen: ps.partners });
  return {
    geschaeft,
    privat: {
      familienzeitStunden: Math.round((kinder.reduce((n, x) => n + dauerMin(x.from, x.to), 0) / 60) * 10) / 10,
      familienzeitOhneUhrzeit: kinder.filter((x) => !x.from || !x.to).length,
      paarzeit: paar.length > 0,
      paarzeitAnzahl: paar.length,
      beobachtungen: woche.beobachtungen,
      zuwendung: woche.zuwendung,
      zuwendungAusgefallen: woche.zuwendungAusgefallen,
      gespraeche: woche.gespraeche,
      danke: woche.danke,
      stimmung: woche.stimmung,
      dateideen: woche.dateideen,
      aufgaben: woche.aufgaben,
      vergleichVorwoche: vergleichVorwoche(woche, vorwoche),
      therapieBogen: "/privat/therapie-bogen",
    },
  };
}
