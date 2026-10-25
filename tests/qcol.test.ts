import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { qcol } from "@/db/qcol";

describe("Unterabfragen in Select-Feldern beziehen sich auf die äußere Tabelle", () => {
  const d = drizzle.mock({ schema });
  const O = schema.orders;
  it("ohne qcol schreibt drizzle nur \"id\" (würde order_items.id meinen)", () => {
    const q = d.select({ o: O.id, n: sql`(select count(*) from order_items i where i.order_id = ${O.id})` }).from(O).where(and(eq(O.tenantId, "T")));
    expect(q.toSQL().sql).toContain('i.order_id = "id"');
  });
  it("mit qcol: \"orders\".\"id\"", () => {
    const q = d.select({ o: O.id, n: sql`(select count(*) from order_items i where i.order_id = ${qcol(O.id)})` }).from(O).where(and(eq(O.tenantId, "T")));
    expect(q.toSQL().sql).toContain('i.order_id = "orders"."id"');
  });
});
