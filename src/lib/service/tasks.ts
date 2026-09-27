import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";

/** Fälle mit Frist in den nächsten 2 Tagen und offene Retouren als To-dos. */
export async function refreshServiceTasks(tenantId: string) {
  const C = schema.cases;
  const [urgent] = await db
    .select({ n: sql<number>`count(*)::int`, first: sql<string | null>`min(${C.deadline})::text` })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), inArray(C.status, ["open", "waiting"]), lte(C.deadline, addDaysIso(todayIso(), 2))));
  if (urgent.n > 0) await upsertSystemTask(db, tenantId, "cases-deadline", { title: `${urgent.n} Fälle mit Frist bis übermorgen`, category: "support", priority: "critical", link: "/faelle", dueDate: urgent.first });
  else await resolveSystemTask(db, tenantId, "cases-deadline");

  const R = schema.customerReturns;
  const [received] = await db.select({ n: sql<number>`count(*)::int` }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.status, "received")));
  if (received.n > 0) await upsertSystemTask(db, tenantId, "returns-refund", { title: `${received.n} eingegangene Retouren erstatten`, category: "support", link: "/retouren" });
  else await resolveSystemTask(db, tenantId, "returns-refund");
}
