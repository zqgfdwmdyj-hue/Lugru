import "server-only";
import { and, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";

/** Warnt vor unverkäuflichem Bestand und offenen Remissions-Eingängen. */
export async function refreshStockWarnings(tenantId: string) {
  const settings = await getSettings(tenantId);
  const I = schema.amazonInventory;
  const before = addDaysIso(todayIso(), -settings.aging.unsellableWarnDays);
  const [old] = await db
    .select({ n: sql<number>`count(*)::int`, units: sql<number>`coalesce(sum(${I.unsellable}), 0)::int` })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), gt(I.unsellable, 0), isNotNull(I.unsellableSince), lte(I.unsellableSince, before)));
  if (old.n > 0) {
    await upsertSystemTask(db, tenantId, "unsellable-aging", {
      title: `${old.units} unverkäufliche Einheiten (${old.n} SKUs) seit über ${settings.aging.unsellableWarnDays} Tagen – Remission beauftragen`,
      notes: "Je länger unverkäufliche Ware bei Amazon liegt, desto eher wird sie entsorgt oder eine Erstattung abgelehnt.",
      category: "amazon",
      link: "/remissionen",
    });
  } else {
    await resolveSystemTask(db, tenantId, "unsellable-aging");
  }

  const R = schema.amazonRemovalOrders;
  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(R)
    .where(and(eq(R.tenantId, tenantId), gt(R.shippedQuantity, 0), sql`${R.receivedQuantity} is null`, sql`lower(coalesce(${R.orderType}, '')) not like '%dispos%'`));
  if (pending.n > 0) {
    await upsertSystemTask(db, tenantId, "removal-receipts", {
      title: `${pending.n} Remissionen: Eingang bestätigen`,
      notes: "Beim Auspacken zählen und bestätigen – Fehlmengen werden automatisch zum Anspruch.",
      category: "amazon",
      link: "/remissionen",
    });
  } else {
    await resolveSystemTask(db, tenantId, "removal-receipts");
  }
}
