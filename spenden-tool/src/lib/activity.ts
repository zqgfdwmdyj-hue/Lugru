import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth";

// Protokoll: wer hat wann was getan. Fehler beim Schreiben dürfen die eigentliche Aktion nie verhindern.

export async function logActivity(user: CurrentUser, action: string, ref: { eventId?: string | null; productId?: string | null } = {}) {
  try {
    await db.insert(schema.activity).values({ userId: user.id, userName: user.name, action: action.slice(0, 300), eventId: ref.eventId ?? null, productId: ref.productId ?? null });
  } catch (e) {
    console.error("Protokoll konnte nicht geschrieben werden", e);
  }
}

export async function recentActivity(opts: { eventId?: string; limit?: number } = {}) {
  return db
    .select()
    .from(schema.activity)
    .where(opts.eventId ? eq(schema.activity.eventId, opts.eventId) : undefined)
    .orderBy(desc(schema.activity.createdAt))
    .limit(opts.limit ?? 50);
}
