import "server-only";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, schema } from "@/db";
import { refreshTodoTask } from "./service";
import { mapLegacyTodo, normalizeMessageKey, type LegacyRow } from "./legacy";

/** Liest amazon_todos und amazon_mail_seen aus der app.db des Retouren-Tools. */
async function readLegacy(bytes: Uint8Array) {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "todos-"));
  const file = join(dir, "app.db");
  writeFileSync(file, bytes);
  try {
    const d = new DatabaseSync(file, { readOnly: true });
    const tables = new Set((d.prepare("select name from sqlite_master where type = 'table'").all() as LegacyRow[]).map((r) => String(r.name)));
    if (!tables.has("amazon_todos")) throw new Error("In der Datei gibt es keine Tabelle amazon_todos – ist das die app.db des Retouren-Tools?");
    const todos = d.prepare("select * from amazon_todos").all() as LegacyRow[];
    const seen = tables.has("amazon_mail_seen") ? (d.prepare("select * from amazon_mail_seen").all() as LegacyRow[]) : [];
    d.close();
    return { todos, seen };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export type ImportResult = { todos: number; skipped: number; seen: number; open: number };

/** Übernimmt Aufgaben mit Status und Notiz; schon vorhandene (gleiche Message-ID) bleiben unverändert. */
export async function importLegacyTodos(tenantId: string, bytes: Uint8Array): Promise<ImportResult> {
  const { todos, seen } = await readLegacy(bytes);
  const rows = todos.map(mapLegacyTodo).filter((r): r is NonNullable<typeof r> => r !== null);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await db
      .insert(schema.amazonTodos)
      .values(rows.slice(i, i + 200).map((r) => ({ tenantId, ...r, source: "import" as const })))
      .onConflictDoNothing()
      .returning({ id: schema.amazonTodos.id });
    inserted += res.length;
  }
  let seenCount = 0;
  const seenRows = seen.map((s) => ({ tenantId, messageKey: normalizeMessageKey(s.message_id), reason: String(s.grund ?? "aus dem Retouren-Tool") })).filter((s) => s.messageKey);
  for (let i = 0; i < seenRows.length; i += 500) {
    const res = await db.insert(schema.amazonMailSeen).values(seenRows.slice(i, i + 500)).onConflictDoNothing().returning({ k: schema.amazonMailSeen.messageKey });
    seenCount += res.length;
  }
  await refreshTodoTask(tenantId);
  return { todos: inserted, skipped: rows.length - inserted, seen: seenCount, open: rows.filter((r) => r.status === "open").length };
}
