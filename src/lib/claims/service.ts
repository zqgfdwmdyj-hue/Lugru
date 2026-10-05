import "server-only";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { getSettings, type ResolvedSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { loadReturnClaims } from "@/lib/returns/service";
import { detectClaims, type ClaimData } from "./rules";

export async function loadClaimData(tenantId: string): Promise<ClaimData> {
  const t = tenantId;
  const L = schema.amazonLedgerEvents;
  const RS = schema.amazonRemovalShipments;
  const [adjustments, receipts, reimbursements, returnClaims, removals, lots, inbound, removalShipments, removalShipmentMarks] = await Promise.all([
    db
      .select({ rowHash: L.rowHash, date: L.eventDate, sku: L.sku, fnsku: L.fnsku, asin: L.asin, quantity: L.quantity, reason: L.reason, fulfillmentCenter: L.fulfillmentCenter, referenceId: L.referenceId })
      .from(L)
      .where(and(eq(L.tenantId, t), sql`lower(${L.eventType}) like 'adjust%'`)),
    db
      .select({ referenceId: L.referenceId, fnsku: L.fnsku, sku: L.sku, quantity: L.quantity, date: L.eventDate })
      .from(L)
      .where(and(eq(L.tenantId, t), sql`lower(${L.eventType}) like 'receipt%'`, isNotNull(L.referenceId))),
    db.select().from(schema.amazonReimbursements).where(eq(schema.amazonReimbursements.tenantId, t)),
    loadReturnClaims(t),
    db.select().from(schema.amazonRemovalOrders).where(eq(schema.amazonRemovalOrders.tenantId, t)),
    db
      .select({ sku: schema.lots.sku, cost: schema.lots.unitCostNet, asin: schema.products.asin })
      .from(schema.lots)
      .innerJoin(schema.products, eq(schema.products.id, schema.lots.productId))
      .where(eq(schema.lots.tenantId, t)),
    db
      .select({ id: schema.inboundShipments.id, name: schema.inboundShipments.name, amazonShipmentId: schema.inboundShipments.amazonShipmentId, shippedAt: schema.inboundShipments.shippedAt, sku: schema.inboundItems.sku, fnsku: schema.inboundItems.fnsku, asin: schema.inboundItems.asin, scanned: schema.inboundItems.scannedQuantity })
      .from(schema.inboundShipments)
      .innerJoin(schema.inboundItems, eq(schema.inboundItems.shipmentId, schema.inboundShipments.id))
      .where(and(eq(schema.inboundShipments.tenantId, t), isNotNull(schema.inboundShipments.amazonShipmentId), inArray(schema.inboundShipments.status, ["transmitted", "shipped", "receiving", "closed"]))),
    db
      .select({ orderId: RS.orderId, requestDate: RS.requestDate, shipmentDate: RS.shipmentDate, sku: RS.sku, fnsku: RS.fnsku, quantity: RS.shippedQuantity, carrier: RS.carrier, trackingNumber: RS.trackingNumber, lastEvent: RS.lastEvent, lastEventAt: RS.lastEventAt })
      .from(RS)
      .where(and(eq(RS.tenantId, t), isNotNull(RS.trackingNumber))),
    db
      .select({ orderId: schema.amazonRemovalShipmentMarks.orderId, trackingNumber: schema.amazonRemovalShipmentMarks.trackingNumber, status: schema.amazonRemovalShipmentMarks.status })
      .from(schema.amazonRemovalShipmentMarks)
      .where(eq(schema.amazonRemovalShipmentMarks.tenantId, t)),
  ]);

  const costBySku = new Map<string, number>();
  const asinBySku = new Map<string, string>();
  const byAsin = new Map<string, number[]>();
  for (const l of lots) {
    asinBySku.set(l.sku, l.asin);
    if (l.cost === null) continue;
    const c = Number(l.cost);
    costBySku.set(l.sku, c);
    byAsin.set(l.asin, [...(byAsin.get(l.asin) ?? []), c]);
  }
  const costByAsin = new Map([...byAsin].map(([a, cs]) => [a, Math.round((cs.reduce((x, y) => x + y, 0) / cs.length) * 100) / 100]));

  const shipments = new Map<string, ClaimData["inbound"][number]>();
  for (const r of inbound) {
    const s = shipments.get(r.id) ?? { id: r.id, name: r.name, amazonShipmentId: r.amazonShipmentId!, shippedAt: r.shippedAt ? r.shippedAt.toISOString().slice(0, 10) : null, items: [] };
    s.items.push({ sku: r.sku, fnsku: r.fnsku, asin: r.asin, scanned: r.scanned });
    shipments.set(r.id, s);
  }

  return {
    adjustments,
    receipts: receipts.map((r) => ({ ...r, referenceId: r.referenceId! })),
    reimbursements: reimbursements.map((r) => ({
      reimbursementId: r.reimbursementId,
      date: r.approvalDate,
      reason: r.reason,
      sku: r.sku,
      fnsku: r.fnsku,
      orderId: r.orderId,
      caseId: r.caseId,
      amountPerUnit: r.amountPerUnit,
      amountTotal: r.amountTotal,
      quantityCash: r.quantityCash,
      quantityTotal: r.quantityTotal,
    })),
    returnClaims,
    removals: removals.map((r) => ({
      orderId: r.orderId,
      orderType: r.orderType,
      orderStatus: r.orderStatus,
      requestDate: r.requestDate,
      lastUpdated: r.lastUpdated,
      sku: r.sku,
      fnsku: r.fnsku,
      requestedQuantity: r.requestedQuantity,
      cancelledQuantity: r.cancelledQuantity,
      disposedQuantity: r.disposedQuantity,
      shippedQuantity: r.shippedQuantity,
      inProcessQuantity: r.inProcessQuantity,
      receivedQuantity: r.receivedQuantity,
    })),
    removalShipments,
    removalShipmentMarks,
    inbound: [...shipments.values()],
    costBySku,
    costByAsin,
    asinBySku,
  };
}

/**
 * Gleicht die erkannten Ansprüche mit der Datenbank ab:
 * neue anlegen, offene aktualisieren, erledigte (Amazon hat erstattet) schließen,
 * eingereichte über die Fall-ID mit Erstattungen verknüpfen.
 */
export async function syncClaims(tenantId: string) {
  const settings = await getSettings(tenantId);
  const data = await loadClaimData(tenantId);
  const candidates = detectClaims(data, settings.claims, todayIso());
  const C = schema.claims;

  const lotIds = new Map<string, string>();
  const skus = [...new Set(candidates.map((c) => c.sku).filter((s): s is string => !!s))];
  if (skus.length) {
    for (const l of await db.select({ id: schema.lots.id, sku: schema.lots.sku }).from(schema.lots).where(and(eq(schema.lots.tenantId, tenantId), inArray(schema.lots.sku, skus)))) {
      lotIds.set(l.sku, l.id);
    }
  }

  let created = 0;
  await db.transaction(async (tx) => {
    for (const c of candidates) {
      const priority = Math.round((c.expectedAmount ?? 0) * 100);
      const res = await tx
        .insert(C)
        .values({
          tenantId,
          type: c.type,
          detectionKey: c.key,
          title: c.title,
          sku: c.sku,
          fnsku: c.fnsku,
          asin: c.asin,
          lotId: c.sku ? (lotIds.get(c.sku) ?? null) : null,
          quantity: c.quantity,
          unitCost: c.unitCost,
          expectedAmount: c.expectedAmount,
          reference: c.reference,
          eventDate: c.eventDate,
          deadline: c.deadline,
          priority,
          evidence: c.evidence,
        })
        .onConflictDoUpdate({
          target: [C.tenantId, C.detectionKey],
          set: {
            title: sql`case when ${C.status} in ('detected','queued') then excluded.title else ${C.title} end`,
            quantity: sql`case when ${C.status} in ('detected','queued') then excluded.quantity else ${C.quantity} end`,
            unitCost: sql`excluded.unit_cost`,
            expectedAmount: sql`case when ${C.status} in ('detected','queued') then excluded.expected_amount else ${C.expectedAmount} end`,
            evidence: sql`excluded.evidence`,
            deadline: sql`excluded.deadline`,
            priority: sql`excluded.priority`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: C.id, inserted: sql<boolean>`(xmax = 0)` });
      if (res[0]?.inserted) {
        created++;
        await tx.insert(schema.claimEvents).values({ tenantId, claimId: res[0].id, action: "erkannt", note: c.title });
      }
    }

    // Nicht mehr erkannte, noch nicht eingereichte Ansprüche: Amazon hat erstattet, die Ware
    // ist wieder da – oder die Fristen wurden geändert. Nie angefasste Ansprüche verschwinden
    // einfach; vorgemerkte werden als erledigt markiert, damit die Historie bleibt.
    const keys = candidates.map((c) => c.key);
    const stale = await tx
      .select({ id: C.id, status: C.status })
      .from(C)
      .where(
        and(
          eq(C.tenantId, tenantId),
          inArray(C.status, ["detected", "queued"]),
          isNotNull(C.detectionKey),
          keys.length ? sql`${C.detectionKey} not in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})` : sql`true`,
        ),
      );
    for (const s of stale) {
      if (s.status === "detected") {
        await tx.delete(C).where(eq(C.id, s.id));
        continue;
      }
      await tx.update(C).set({ status: "reimbursed", resolvedAt: new Date(), updatedAt: new Date(), notes: sql`coalesce(${C.notes} || E'\\n', '') || 'Automatisch erledigt: laut aktuellen Reports nicht mehr offen (erstattet, wiedergefunden oder zurückgekommen).'` }).where(eq(C.id, s.id));
      await tx.insert(schema.claimEvents).values({ tenantId, claimId: s.id, action: "automatisch erledigt", note: "Nicht mehr offen laut aktuellen Reports" });
    }

    // Eingereichte Ansprüche mit Erstattungen derselben Fall-ID verknüpfen.
    await tx.execute(sql`
      with paid as (
        select case_id, sum(amount_total) as amount from amazon_reimbursements
         where tenant_id = ${tenantId} and case_id is not null group by case_id
      )
      update claims c set reimbursed_amount = p.amount,
             status = case when p.amount >= coalesce(c.expected_amount, 0) * 0.95 then 'reimbursed' else 'partial' end,
             resolved_at = coalesce(c.resolved_at, now()), updated_at = now()
        from paid p
       where c.tenant_id = ${tenantId} and c.amazon_case_id = p.case_id
         and c.status in ('submitted', 'partial')`);
  });

  await refreshClaimTasks(tenantId, settings);
  return { candidates: candidates.length, created };
}

async function refreshClaimTasks(tenantId: string, settings: ResolvedSettings) {
  const C = schema.claims;
  const [open] = await db
    .select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${C.expectedAmount}), 0)::float` })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), inArray(C.status, ["detected", "queued"])));
  if (open.n > 0) {
    await upsertSystemTask(db, tenantId, "claims-open", {
      title: `${open.n} Ansprüche offen – ${open.sum.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}`,
      notes: `Heute noch bis zu ${settings.claims.dailyLimit} Fälle einreichen.`,
      category: "geld",
      link: "/ansprueche",
    });
  } else {
    await resolveSystemTask(db, tenantId, "claims-open");
  }

  const today = todayIso();
  const [urgent] = await db
    .select({ n: sql<number>`count(*)::int`, first: sql<string | null>`min(${C.deadline})::text` })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), inArray(C.status, ["detected", "queued"]), sql`${C.deadline} between ${today}::date and (${today}::date + 7)`));
  if (urgent.n > 0) {
    await upsertSystemTask(db, tenantId, "claims-deadline", {
      title: `${urgent.n} Ansprüche laufen in den nächsten 7 Tagen ab`,
      category: "geld",
      priority: "critical",
      link: "/ansprueche?ansicht=fristen",
      dueDate: urgent.first,
    });
  } else {
    await resolveSystemTask(db, tenantId, "claims-deadline");
  }

  // Eingereicht und seit einer Woche keine Antwort: bei Amazon nachfragen.
  const [stale] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(C)
    .where(
      and(
        eq(C.tenantId, tenantId),
        eq(C.status, "submitted"),
        sql`${C.submittedAt} < now() - interval '7 days'`,
        // Eine eigene Notiz (z. B. „nachgefragt“) setzt die Woche neu.
        sql`not exists (select 1 from claim_events e where e.claim_id = ${C.id} and e.user_id is not null and e.created_at > now() - interval '7 days')`,
      ),
    );
  if (stale.n > 0) {
    await upsertSystemTask(db, tenantId, "claims-followup", {
      title: `${stale.n} eingereichte Fälle seit über 7 Tagen ohne Antwort – nachfragen`,
      category: "geld",
      link: "/ansprueche?ansicht=eingereicht",
    });
  } else {
    await resolveSystemTask(db, tenantId, "claims-followup");
  }

  const [expired] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), inArray(C.status, ["detected", "queued"]), sql`${C.deadline} < ${today}::date`));
  if (expired.n > 0) {
    await upsertSystemTask(db, tenantId, "claims-expired", {
      title: `${expired.n} Ansprüche über der hinterlegten Frist – trotzdem versuchen oder verwerfen`,
      notes: "Die Fristen in den Einstellungen sind Platzhalter – bitte mit den aktuellen Amazon-Richtlinien abgleichen.",
      category: "geld",
      priority: "low",
      link: "/ansprueche?ansicht=fristen",
    });
  } else {
    await resolveSystemTask(db, tenantId, "claims-expired");
  }
}

/** Beginn des aktuellen Limit-Fensters (letzter Reset um resetHour deutscher Zeit). */
export function limitWindowStart(resetHour: number, now = new Date()): Date {
  const berlin = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  const offsetMs = berlin.getTime() - now.getTime();
  const start = new Date(berlin);
  start.setHours(resetHour, 0, 0, 0);
  if (berlin < start) start.setDate(start.getDate() - 1);
  return new Date(start.getTime() - offsetMs);
}

export async function submittedInWindow(tenantId: string, resetHour: number) {
  const since = limitWindowStart(resetHour);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.claims)
    .where(and(eq(schema.claims.tenantId, tenantId), gte(schema.claims.submittedAt, since)));
  const next = new Date(since.getTime() + 86400_000);
  return { used: row.n, since, next };
}
