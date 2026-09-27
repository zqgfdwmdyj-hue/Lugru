import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "@/db";

type SystemTask = {
  title: string;
  notes?: string | null;
  priority?: "critical" | "normal" | "low";
  category?: (typeof schema.TASK_CATEGORIES)[number];
  link?: string | null;
  dueDate?: string | null;
};

/**
 * Legt eine vom System erkannte Aufgabe an oder aktualisiert sie. Ändert sich der Titel
 * (z. B. neue Anzahl), wird eine bereits erledigte Aufgabe wieder geöffnet.
 */
export async function upsertSystemTask(
  conn: Db | Tx,
  tenantId: string,
  key: string,
  task: SystemTask,
) {
  await conn
    .insert(schema.tasks)
    .values({
      tenantId,
      systemKey: key,
      title: task.title,
      notes: task.notes ?? null,
      priority: task.priority ?? "normal",
      category: task.category ?? "system",
      link: task.link ?? null,
      dueDate: task.dueDate ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.tasks.tenantId, schema.tasks.systemKey],
      set: {
        notes: sql`excluded.notes`,
        priority: sql`excluded.priority`,
        link: sql`excluded.link`,
        dueDate: sql`excluded.due_date`,
        status: sql`case when ${schema.tasks.title} <> excluded.title then 'open' else ${schema.tasks.status} end`,
        completedAt: sql`case when ${schema.tasks.title} <> excluded.title then null else ${schema.tasks.completedAt} end`,
        title: sql`excluded.title`,
      },
    });
}

/** Das Problem ist behoben – die Aufgabe wird automatisch erledigt. */
export async function resolveSystemTask(conn: Db | Tx, tenantId: string, key: string) {
  await conn
    .update(schema.tasks)
    .set({ status: "done", completedAt: new Date() })
    .where(
      and(
        eq(schema.tasks.tenantId, tenantId),
        eq(schema.tasks.systemKey, key),
        eq(schema.tasks.status, "open"),
      ),
    );
}

/** Erinnert daran, den Arbitrage-One-Export hochzuladen, wenn länger keiner kam. */
export async function refreshImportReminder(tenantId: string, reminderDays: number) {
  const [last] = await db
    .select({ at: sql<Date | null>`max(${schema.importRuns.createdAt})` })
    .from(schema.importRuns)
    .where(eq(schema.importRuns.tenantId, tenantId));
  const lastAt = last?.at ? new Date(last.at) : null;
  const due = !lastAt || Date.now() - lastAt.getTime() > reminderDays * 86400_000;
  if (due) {
    await upsertSystemTask(db, tenantId, "import-reminder", {
      title: "Arbitrage-One-Export hochladen",
      notes: lastAt
        ? `Letzter Import am ${lastAt.toLocaleDateString("de-DE")}. Vorlage „Tool“ oder AccountOne COG exportieren und hochladen.`
        : "Noch kein Import. Vorlage „Tool“ oder AccountOne COG exportieren und hochladen.",
      category: "einkauf",
      link: "/einkauf",
      dueDate: new Date().toISOString().slice(0, 10),
    });
  } else {
    await resolveSystemTask(db, tenantId, "import-reminder");
  }
}
