import { sql } from "drizzle-orm";
import { date, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, tenantId, updatedAt } from "./core";

/**
 * Eingelagerte Paletten (Palettenstellplätze für Kunden). Ab `inAt` läuft die Lagerzeit,
 * mit `outAt` ist die Palette ausgelagert. Eine Nummer ist nur einmal gleichzeitig eingelagert
 * und kann nach dem Auslagern wieder benutzt werden.
 */
export const pallets = pgTable(
  "pallets",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    customer: text("customer"),
    note: text("note"),
    inAt: date("in_at").notNull(),
    outAt: date("out_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("pallets_open_code_uq").on(t.tenantId, t.code).where(sql`${t.outAt} is null`),
    index("pallets_in_idx").on(t.tenantId, t.inAt),
  ],
);
