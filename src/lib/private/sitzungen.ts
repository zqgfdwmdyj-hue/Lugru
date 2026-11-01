import "server-only";
import { and, eq, gte, ilike, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import type { AppointmentEntry } from "./logic";
import { istPaartherapie, letzteSitzung, naechsteSitzung, type SitzungsTermin } from "./rueckblick-logic";
import { loadEntries } from "./service";

// B22.1: Paartherapie-Sitzungen für Therapie-Bogen, Wochenrückblick und Reflexion – aus dem Privatkalender
// (Art „Paartherapie“ oder passender Titel) und aus den abgeglichenen Kalendern (nur der Titel zählt, z. B.
// „Paartherapie“, „Paarberatung“). Es wird nur das Datum verwendet, nichts angezeigt oder weitergegeben.

const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function paarSitzungen(session: Session, heute: string): Promise<{ letzte: string | null; naechste: string | null; termine: SitzungsTermin[] }> {
  if (!session.privateAccess || session.privateScope !== "voll") return { letzte: null, naechste: null, termine: [] };
  const E = schema.calendarEvents;
  const [privat, kalender] = await Promise.all([
    loadEntries<AppointmentEntry>(session, ["termin"]),
    db
      .select({ day: E.day, title: E.title })
      .from(E)
      .where(and(eq(E.tenantId, session.tenantId), gte(E.day, plus(heute, -400)), lte(E.day, plus(heute, 200)), or(ilike(E.title, "%paar%"), ilike(E.title, "%couple%"), ilike(E.title, "%eheberatung%")))),
  ]);
  const termine: SitzungsTermin[] = [
    ...privat.map((t) => ({ day: t.data.day, with: t.data.with, title: t.data.title, status: t.data.status })),
    ...kalender.filter((k) => istPaartherapie({ with: "sonst", title: k.title })).map((k) => ({ day: k.day, with: "sonst" as const, title: k.title })),
  ];
  return { letzte: letzteSitzung(termine, heute), naechste: naechsteSitzung(termine, heute), termine };
}
