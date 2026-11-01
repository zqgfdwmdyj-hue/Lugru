import "server-only";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fristKurz, kuerzenAuf } from "@/lib/mobil/watch-logic";
import { todayIso } from "@/lib/dates";

// Apple Watch: neue wichtige Aufgaben (Priorität „critical“) als Push an den Inhaber – mit Bezug auf die Aufgabe,
// damit „Erledigt“ an der Watch genau diese schließt. Höchstens 6 solcher Pushs je Stunde (keine Flut nach Abgleichen);
// nie in den Discord-Kanal.

const MAX_JE_STUNDE = 6;

export async function aufgabeMelden(tenantId: string, t: { id: string; title: string; dueDate?: string | null; link?: string | null }): Promise<boolean> {
  const M = schema.meldungen;
  const [{ n }] = await db
    .select({ n: sql<number>`count(distinct ${M.bezug}->>'id')::int` })
    .from(M)
    .where(and(eq(M.tenantId, tenantId), sql`${M.bezug}->>'art' = 'aufgabe'`, gte(M.createdAt, new Date(Date.now() - 3_600_000))));
  if (n >= MAX_JE_STUNDE) return false;
  const inhaber = (await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"), isNull(schema.memberships.deaktiviertAm)))).map((r) => r.userId);
  if (!inhaber.length) return false;
  const { melden } = await import("./service");
  const frist = t.dueDate ? fristKurz(t.dueDate, todayIso()) : null;
  await melden(
    tenantId,
    inhaber,
    {
      titel: kuerzenAuf(`❗ ${t.title}`, 60),
      text: `${frist ? `Frist ${frist}. ` : ""}${kuerzenAuf(t.title, 70)} – an der Watch „Erledigt“ sagen, wenn fertig.`,
      link: t.link ?? "/",
      bezug: { art: "aufgabe", id: t.id, titel: t.title },
    },
    { ohneDiscord: true },
  );
  return true;
}
