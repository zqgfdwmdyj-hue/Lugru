import { jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import { tenantId } from "./core";

/**
 * Stand der zuletzt heruntergeladenen EK-Liste für AccountOne (SKU → EK netto). Daran wird erkannt,
 * welche EKs seitdem neu sind oder sich geändert haben – unabhängig davon, wer Chargen sonst anfasst.
 */
export const cogExports = pgTable("cog_exports", {
  tenantId: tenantId().primaryKey(),
  exportedAt: timestamp("exported_at", { withTimezone: true }).notNull(),
  costs: jsonb("costs").$type<Record<string, number>>().notNull(),
});
