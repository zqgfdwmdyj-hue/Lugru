import { getTableName, sql, type Column, type SQL } from "drizzle-orm";

/**
 * Spalte immer mit Tabellennamen („orders“.„id“). Nötig in Unterabfragen in Select-Feldern: Ohne Join schreibt
 * drizzle dort nur "id" – in `(select … from order_items i where i.order_id = "id")` meint Postgres dann
 * order_items.id statt orders.id, und die Unterabfrage findet nichts.
 */
export function qcol(c: Column): SQL {
  return sql`${sql.identifier(getTableName(c.table))}.${sql.identifier(c.name)}`;
}
