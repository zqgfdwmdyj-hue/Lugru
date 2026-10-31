import "server-only";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { fahrtVorschlag, verspaetung, verspaetungsText } from "./logic";
import { orteLaden } from "./service";

// Fahrtenbuch (B13) und Verspätungs-Entwürfe. Nur Vorschläge – Ludwig bestätigt je Fahrt; ob Fahrtenbuch oder
// Pauschale steuerlich besser ist, klärt der Steuerberater (keine Steuerberatung im System).

const F = schema.fahrten;

async function teslaCfg(tenantId: string) {
  const t = await getIntegration(tenantId, "tesla");
  if (!t?.accessToken) return null;
  return { ...t, vin: t.vin || (await getSettings(tenantId)).mobil.tesla.vin };
}

/** Neue Fahrten vom Auto holen und mit Vorschlag (geschäftlich/privat, Zweck aus dem Termin) speichern. */
export async function fahrtenAbrufen(tenantId: string): Promise<number> {
  const c = await teslaCfg(tenantId);
  if (!c) return 0;
  const [letzte] = await db.select({ beginn: F.beginn }).from(F).where(eq(F.tenantId, tenantId)).orderBy(desc(F.beginn)).limit(1);
  const { teslaFahrten } = await import("@/lib/integrations/clients/tesla");
  const liste = await teslaFahrten(c, letzte?.beginn ?? new Date(Date.now() - 14 * 86_400_000));
  if (!liste.length) return 0;
  const orte = await orteLaden(tenantId);
  const E = schema.calendarEvents;
  let n = 0;
  for (const f of liste) {
    const beginn = new Date(f.beginn);
    const [termin] = await db.select({ titel: E.title }).from(E).where(and(eq(E.tenantId, tenantId), gte(E.startsAt, beginn), lte(E.startsAt, new Date(beginn.getTime() + 3 * 3_600_000)))).orderBy(asc(E.startsAt)).limit(1);
    const v = fahrtVorschlag({ start: f.start ?? "", ziel: f.ziel, beginn: f.beginn, km: f.km }, orte, termin ?? null);
    const r = await db
      .insert(F)
      .values({ tenantId, quelleId: f.id, beginn, ende: f.ende ? new Date(f.ende) : null, start: f.start, ziel: f.ziel, km: Math.round(f.km * 10) / 10, vorschlag: v.art, zweck: v.zweck })
      .onConflictDoNothing()
      .returning({ id: F.id });
    n += r.length;
  }
  return n;
}

export async function fahrtenListe(tenantId: string, von: Date, bis: Date) {
  return db.select().from(F).where(and(eq(F.tenantId, tenantId), gte(F.beginn, von), lte(F.beginn, bis))).orderBy(asc(F.beginn));
}

export async function fahrtBestaetigen(tenantId: string, id: string, art: "geschaeftlich" | "privat", zweck: string | null) {
  await db.update(F).set({ art, zweck: art === "geschaeftlich" ? (zweck?.trim().slice(0, 200) || null) : null, bestaetigtAt: new Date() }).where(and(eq(F.tenantId, tenantId), eq(F.id, id)));
}

/** Alle Vorschläge einer Woche auf einmal übernehmen (ein Klick). */
export async function wocheBestaetigen(tenantId: string, von: Date, bis: Date): Promise<number> {
  const r = await db
    .update(F)
    .set({ art: sql`${F.vorschlag}`, bestaetigtAt: new Date() })
    .where(and(eq(F.tenantId, tenantId), gte(F.beginn, von), lte(F.beginn, bis), isNull(F.bestaetigtAt)))
    .returning({ id: F.id });
  return r.length;
}

/** CSV fürs Fahrtenbuch: private Fahrten ohne Ziel-Details. */
export function fahrtenCsv(rows: (typeof F.$inferSelect)[]): string {
  const q = (s: string | null | undefined) => `"${(s ?? "").replace(/"/g, '""')}"`;
  const z = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  const kopf = "Beginn;Ende;Start;Ziel;km;Art;Zweck;bestätigt";
  return [kopf, ...rows.map((r) => {
    const privat = (r.art ?? r.vorschlag) === "privat";
    return [q(z(r.beginn)), q(r.ende ? z(r.ende) : ""), q(privat ? "privat" : r.start), q(privat ? "privat" : r.ziel), String(r.km).replace(".", ","), q(r.art ?? `Vorschlag: ${r.vorschlag}`), q(privat ? "" : r.zweck), q(r.bestaetigtAt ? z(r.bestaetigtAt) : "")].join(";");
  })].join("\r\n");
}

/**
 * Verspätung: Navi-Ankunft des Autos liegt mehr als die Toleranz nach dem nächsten Termin mit Ort → Aufgabe mit
 * Nachrichten-Entwurf + Push „Senden?“. Nie automatisch senden; je Termin höchstens ein Entwurf.
 */
export async function verspaetungPruefen(tenantId: string, jetzt = new Date()): Promise<string | null> {
  const c = await teslaCfg(tenantId);
  if (!c) return null;
  const E = schema.calendarEvents;
  const [termin] = await db
    .select({ uid: E.uid, title: E.title, startsAt: E.startsAt, location: E.location })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), eq(E.allDay, false), gte(E.startsAt, jetzt), lte(E.startsAt, new Date(jetzt.getTime() + 2 * 3_600_000)), sql`${E.location} is not null and ${E.location} <> ''`))
    .orderBy(asc(E.startsAt))
    .limit(1);
  if (!termin) return null;
  const { teslaStatus } = await import("@/lib/integrations/clients/tesla");
  const st = await teslaStatus(c).catch(() => null);
  if (!st?.minutenBisAnkunft) return null;
  const min = verspaetung(new Date(jetzt.getTime() + st.minutenBisAnkunft * 60_000), termin.startsAt, (await getSettings(tenantId)).mobil.verspaetungToleranz);
  if (!min) return null;
  const T = schema.tasks;
  const key = `verspaetung:${termin.uid}:${termin.startsAt.toISOString().slice(0, 16)}`;
  const text = verspaetungsText(min);
  const [neu] = await db
    .insert(T)
    .values({ tenantId, systemKey: key, title: `Verspätung ~${min} Min.: ${termin.title}`.slice(0, 200), notes: `Entwurf (nicht gesendet):\n${text}\n\nBitte selbst senden, wenn passend.`, dueDate: jetzt.toISOString().slice(0, 10), priority: "critical", category: "eigene" })
    .onConflictDoNothing()
    .returning({ id: T.id });
  if (!neu) return null;
  const { melden } = await import("@/lib/push/service");
  const owner = (await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner")))).map((r) => r.id);
  await melden(tenantId, owner, { titel: `Verspätung ~${min} Min. – Senden?`, text: `${termin.title}: Entwurf liegt bereit (nicht gesendet).`, link: "/" }, { ohneDiscord: true }).catch(() => null);
  return neu.id;
}
