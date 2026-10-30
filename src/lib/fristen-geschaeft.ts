import "server-only";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { canAccess } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { ustvaTermine } from "./fristen-geschaeft-logic";

// Geschäftliche Fristen, die das System selbst kennt: Ansprüche (Einreichfrist), Amazon-ToDos aus Systemmails,
// SAS-Programm (Deal-Frist, nächster Termin) und – nur wenn eingestellt – USt-Voranmeldung. Keine Steuerberatung:
// der Rhythmus kommt aus den Einstellungen (Steuerberater fragen), das System rechnet nur das Datum.

export type GeschaeftsFrist = { datum: string; art: "Anspruch" | "Amazon" | "SAS" | "Steuer"; titel: string; ueberfaellig: boolean; link: string };

export async function geschaeftsFristen(session: Session, heute: string, bis: string): Promise<GeschaeftsFrist[]> {
  const t = session.tenantId;
  const out: GeschaeftsFrist[] = [];
  if (canAccess(session, "amazon")) {
    const C = schema.claims;
    const claims = await db
      .select({ id: C.id, title: C.title, deadline: C.deadline, status: C.status })
      .from(C)
      .where(and(eq(C.tenantId, t), inArray(C.status, ["detected", "queued"]), isNotNull(C.deadline), lte(C.deadline, bis)))
      .limit(100);
    for (const c of claims) out.push({ datum: c.deadline!, art: "Anspruch", titel: `Anspruch einreichen: ${c.title}`, ueberfaellig: c.deadline! < heute, link: `/ansprueche?q=${encodeURIComponent(c.title.slice(0, 40))}` });
    const A = schema.amazonTodos;
    const todos = await db
      .select({ subject: A.subject, summary: A.summary, deadline: A.deadline })
      .from(A)
      .where(and(eq(A.tenantId, t), eq(A.status, "open"), isNotNull(A.deadline), lte(A.deadline, bis)))
      .limit(100);
    for (const a of todos) out.push({ datum: a.deadline!, art: "Amazon", titel: (a.summary || a.subject || "Amazon-ToDo").slice(0, 160), ueberfaellig: a.deadline! < heute, link: "/amazon-todos" });
    const [sas] = await db.select({ dealDeadline: schema.sasProgram.dealDeadline, nextMeeting: schema.sasProgram.nextMeeting }).from(schema.sasProgram).where(eq(schema.sasProgram.tenantId, t));
    if (sas?.dealDeadline && sas.dealDeadline >= heute && sas.dealDeadline <= bis) out.push({ datum: sas.dealDeadline, art: "SAS", titel: "SAS-Programm: Frist für die Deals", ueberfaellig: false, link: "/sas" });
    if (sas?.nextMeeting && sas.nextMeeting >= heute && sas.nextMeeting <= bis) out.push({ datum: sas.nextMeeting, art: "SAS", titel: "SAS-Programm: nächster Termin mit dem Consultant", ueberfaellig: false, link: "/sas" });
  }
  if (canAccess(session, "geld")) {
    const b = (await getSettings(t)).buchhaltung;
    if (b.ustva && b.ustva.rhythmus !== "aus")
      for (const x of ustvaTermine(heute, bis, b.ustva.rhythmus, b.ustva.dauerfrist))
        out.push({ datum: x.datum, art: "Steuer", titel: `USt-Voranmeldung ${x.zeitraum} (laut Einstellung ${b.ustva.rhythmus}${b.ustva.dauerfrist ? ", Dauerfristverlängerung" : ""})`, ueberfaellig: false, link: "/buchhaltung" });
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum));
}
