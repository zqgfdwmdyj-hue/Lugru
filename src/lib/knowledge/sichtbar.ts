import { sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import { canAccess, type Access } from "@/lib/auth/areas";

/**
 * Wissen aus Calls (Insider-Wissen der Deal-Gruppe, Consultant) sehen nur, die auch die Calls sehen dürfen –
 * Inhaber und wer den Bereich Amazon hat. Für alle anderen Abfragen auf das Wissen als zusätzliche Bedingung.
 */
export function wissenSichtbar(a: Access): SQL | undefined {
  return canAccess(a, "amazon") ? undefined : sql`${schema.knowledgeEntries.origin} <> 'call'`;
}
