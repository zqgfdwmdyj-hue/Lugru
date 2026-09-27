// Erkennung von Ansprüchen gegenüber Amazon – reine Logik ohne Datenbank, damit sie
// sich mit Beispieldaten testen lässt. Grundidee: Jede Einheit muss irgendwo sauber
// landen. Was nicht aufgeht, wird ein Anspruch.

import type { ClaimType } from "@/db/schema";
import { addDaysIso } from "@/lib/dates";
import type { ReturnClaim } from "@/lib/returns/reconcile";

export type LedgerAdjustment = {
  rowHash: string;
  date: string;
  sku: string | null;
  fnsku: string | null;
  asin: string | null;
  quantity: number;
  reason: string | null;
  fulfillmentCenter: string | null;
  referenceId: string | null;
};

export type Reimbursement = {
  reimbursementId: string;
  date: string;
  reason: string | null;
  sku: string | null;
  fnsku: string | null;
  orderId: string | null;
  caseId: string | null;
  amountPerUnit: number | null;
  amountTotal: number | null;
  quantityCash: number;
  quantityTotal: number;
};

export type RemovalOrder = {
  orderId: string;
  orderType: string | null;
  orderStatus: string | null;
  requestDate: string;
  lastUpdated: string | null;
  sku: string;
  fnsku: string | null;
  requestedQuantity: number;
  cancelledQuantity: number;
  disposedQuantity: number;
  shippedQuantity: number;
  inProcessQuantity: number;
  receivedQuantity: number | null;
};
export type InboundShipment = {
  id: string;
  name: string;
  amazonShipmentId: string;
  shippedAt: string | null;
  items: { sku: string; fnsku: string | null; asin: string | null; scanned: number }[];
};

export type ClaimData = {
  adjustments: LedgerAdjustment[];
  receipts: { referenceId: string; fnsku: string | null; sku: string | null; quantity: number; date: string }[];
  reimbursements: Reimbursement[];
  /** Aus dem Retouren-Abgleich (Erstattung ↔ Rücksendung ↔ Zahlung von Amazon). */
  returnClaims: ReturnClaim[];
  removals: RemovalOrder[];
  inbound: InboundShipment[];
  costBySku: Map<string, number>;
  costByAsin: Map<string, number>;
  asinBySku: Map<string, string>;
};

export type ClaimSettings = {
  windowDays: Record<ClaimType, number>;
  minAmount: number;
};

export type ClaimCandidate = {
  key: string;
  type: ClaimType;
  title: string;
  sku: string | null;
  fnsku: string | null;
  asin: string | null;
  quantity: number;
  unitCost: number | null;
  expectedAmount: number | null;
  reference: string | null;
  eventDate: string;
  deadline: string;
  evidence: { label: string; value: string; source?: string }[];
};

/** Wartezeit, in der Amazon häufig selbst erstattet oder Ware wiederfindet. */
export const GRACE_DAYS = { warehouse: 30, returns: 45, removal: 30, inbound: 30 };

const LOST_CODES = new Set(["M"]);
const FOUND_CODES = new Set(["F"]);
const DAMAGE_CODES = new Set(["E", "6", "7"]);
const DISPOSE_CODES = new Set(["D"]);

const isLost = (r: string | null) => !!r && (LOST_CODES.has(r.trim().toUpperCase()) || /misplaced|lost/i.test(r));
const isFound = (r: string | null) => !!r && (FOUND_CODES.has(r.trim().toUpperCase()) || /\bfound\b/i.test(r));
const isAmazonDamage = (r: string | null) =>
  !!r && (DAMAGE_CODES.has(r.trim().toUpperCase()) || /(warehouse|amazon|fulfil?ment center).*damag|damag.*(warehouse|amazon)/i.test(r));
const isDisposal = (r: string | null) => !!r && (DISPOSE_CODES.has(r.trim().toUpperCase()) || /dispos/i.test(r));

const round2 = (n: number) => Math.round(n * 100) / 100;

function unitCost(d: ClaimData, sku: string | null, asin: string | null): number | null {
  if (sku && d.costBySku.has(sku)) return d.costBySku.get(sku)!;
  const a = asin ?? (sku ? d.asinBySku.get(sku) : undefined);
  if (a && d.costByAsin.has(a)) return d.costByAsin.get(a)!;
  return null;
}

function reimbursedUnits(d: ClaimData, sku: string, match: (reason: string) => boolean) {
  return d.reimbursements
    .filter((r) => r.sku === sku && r.reason && match(r.reason.toLowerCase()))
    .reduce((n, r) => n + r.quantityTotal, 0);
}

export function detectClaims(d: ClaimData, s: ClaimSettings, today: string): ClaimCandidate[] {
  const out: ClaimCandidate[] = [];
  const push = (c: Omit<ClaimCandidate, "deadline">) => {
    const deadline = addDaysIso(c.eventDate, s.windowDays[c.type]);
    if (c.expectedAmount !== null && c.expectedAmount < s.minAmount) return;
    out.push({ ...c, deadline });
  };

  // --- Im Lager verloren / beschädigt -------------------------------------------------
  const bySku = new Map<string, LedgerAdjustment[]>();
  for (const a of d.adjustments) {
    if (!a.sku) continue;
    bySku.set(a.sku, [...(bySku.get(a.sku) ?? []), a]);
  }
  for (const [sku, events] of bySku) {
    const asin = events.find((e) => e.asin)?.asin ?? d.asinBySku.get(sku) ?? null;
    const fnsku = events.find((e) => e.fnsku)?.fnsku ?? null;
    const cost = unitCost(d, sku, asin);

    const lost = events.filter((e) => isLost(e.reason) && e.quantity < 0);
    const found = events.filter((e) => isFound(e.reason) && e.quantity > 0);
    const lostUnits = -lost.reduce((n, e) => n + e.quantity, 0);
    const foundUnits = found.reduce((n, e) => n + e.quantity, 0);
    const lostReimbursed = reimbursedUnits(d, sku, (r) => r.includes("lost_warehouse") || r === "lost warehouse");
    const openLost = lostUnits - foundUnits - lostReimbursed;
    const firstLost = lost.map((e) => e.date).sort()[0];
    if (openLost > 0 && firstLost && addDaysIso(firstLost, GRACE_DAYS.warehouse) <= today) {
      push({
        key: `lost:${sku}`,
        type: "lost_warehouse",
        title: `${openLost} × im Lager verloren – ${sku}`,
        sku,
        fnsku,
        asin,
        quantity: openLost,
        unitCost: cost,
        expectedAmount: cost === null ? null : round2(cost * openLost),
        reference: lost.map((e) => e.referenceId).filter(Boolean).slice(0, 5).join(", ") || null,
        eventDate: firstLost,
        evidence: [
          { label: "Als verloren gebucht", value: `${lostUnits} Einheiten (${lost.length} Ereignisse, erstes am ${firstLost})`, source: "Bestandsprotokoll" },
          { label: "Wiedergefunden", value: `${foundUnits} Einheiten`, source: "Bestandsprotokoll" },
          { label: "Bereits erstattet", value: `${lostReimbursed} Einheiten`, source: "Erstattungen" },
          ...lost.slice(0, 10).map((e) => ({ label: `Verlust ${e.date}`, value: `${e.quantity} · ${e.fulfillmentCenter ?? "?"} · Ref. ${e.referenceId ?? "–"}`, source: "Bestandsprotokoll" })),
        ],
      });
    }

    const damaged = events.filter((e) => isAmazonDamage(e.reason) && e.quantity < 0);
    const damagedUnits = -damaged.reduce((n, e) => n + e.quantity, 0);
    const damagedReimbursed = reimbursedUnits(d, sku, (r) => r.includes("damaged_warehouse") || r === "damaged warehouse");
    const openDamaged = damagedUnits - damagedReimbursed;
    const firstDamaged = damaged.map((e) => e.date).sort()[0];
    if (openDamaged > 0 && firstDamaged && addDaysIso(firstDamaged, GRACE_DAYS.warehouse) <= today) {
      push({
        key: `damaged:${sku}`,
        type: "damaged_warehouse",
        title: `${openDamaged} × im Lager beschädigt – ${sku}`,
        sku,
        fnsku,
        asin,
        quantity: openDamaged,
        unitCost: cost,
        expectedAmount: cost === null ? null : round2(cost * openDamaged),
        reference: damaged.map((e) => e.referenceId).filter(Boolean).slice(0, 5).join(", ") || null,
        eventDate: firstDamaged,
        evidence: [
          { label: "Durch Amazon beschädigt", value: `${damagedUnits} Einheiten (Codes ${[...new Set(damaged.map((e) => e.reason))].join(", ")})`, source: "Bestandsprotokoll" },
          { label: "Bereits erstattet", value: `${damagedReimbursed} Einheiten`, source: "Erstattungen" },
        ],
      });
    }

    // --- Entsorgt, ohne dass ein Entsorgungsauftrag vorliegt -------------------------
    const disposals = events.filter((e) => isDisposal(e.reason) && e.quantity < 0);
    for (const e of disposals) {
      const ordered = d.removals.some(
        (r) =>
          r.sku === sku &&
          /dispos|entsorg/i.test(r.orderType ?? "") &&
          r.requestDate <= addDaysIso(e.date, 3) &&
          addDaysIso(r.requestDate, 60) >= e.date,
      );
      if (ordered) continue;
      const qty = -e.quantity;
      push({
        key: `disposed:${e.rowHash}`,
        type: "disposed_without_order",
        title: `${qty} × entsorgt ohne Auftrag – ${sku}`,
        sku,
        fnsku: e.fnsku,
        asin,
        quantity: qty,
        unitCost: cost,
        expectedAmount: cost === null ? null : round2(cost * qty),
        reference: e.referenceId,
        eventDate: e.date,
        evidence: [
          { label: "Entsorgung gebucht", value: `${e.date} · ${qty} Einheiten · ${e.fulfillmentCenter ?? "?"}`, source: "Bestandsprotokoll" },
          { label: "Entsorgungsauftrag", value: "keiner gefunden", source: "Remissionsaufträge" },
        ],
      });
    }
  }

  // --- Unter EK erstattet --------------------------------------------------------------
  for (const r of d.reimbursements) {
    if (!r.sku || r.quantityCash <= 0 || r.amountPerUnit === null) continue;
    const cost = unitCost(d, r.sku, null);
    if (cost === null || r.amountPerUnit >= cost - 0.5) continue;
    const diff = round2((cost - r.amountPerUnit) * r.quantityCash);
    push({
      key: `below:${r.reimbursementId}:${r.sku}`,
      type: "reimbursed_below_cost",
      title: `Unter EK erstattet – ${r.sku} (${r.amountPerUnit.toFixed(2)} € statt ${cost.toFixed(2)} €)`,
      sku: r.sku,
      fnsku: r.fnsku,
      asin: d.asinBySku.get(r.sku) ?? null,
      quantity: r.quantityCash,
      unitCost: cost,
      expectedAmount: diff,
      reference: r.reimbursementId,
      eventDate: r.date,
      evidence: [
        { label: "Erstattung", value: `${r.reimbursementId} vom ${r.date}, Grund ${r.reason ?? "–"}`, source: "Erstattungen" },
        { label: "Erstattet je Einheit", value: `${r.amountPerUnit.toFixed(2)} €`, source: "Erstattungen" },
        { label: "EK je Einheit", value: `${cost.toFixed(2)} €`, source: "Charge / Rechnung" },
      ],
    });
  }

  // --- Retouren: erstattet, aber nicht zurück / beschädigt / falscher Artikel / zu viel erstattet
  for (const r of d.returnClaims) {
    const asin = r.sku ? (d.asinBySku.get(r.sku) ?? null) : null;
    const cost = r.moneyOnly ? null : unitCost(d, r.sku, asin);
    push({
      key: r.key,
      type: r.type,
      title: r.title,
      sku: r.sku,
      fnsku: null,
      asin,
      quantity: r.quantity,
      unitCost: cost,
      // Mit EK bewertet wie die übrigen Ansprüche; ohne EK (oder bei Geldbeträgen) der erstattete Betrag.
      expectedAmount: cost === null ? r.refundValue : round2(cost * r.quantity),
      reference: r.reference,
      eventDate: r.eventDate,
      evidence: r.evidence,
    });
  }

  // --- Remission unvollständig ----------------------------------------------------------
  for (const r of d.removals) {
    // Entsorgungsaufträge: es wird keine Ware zurückerwartet.
    if (/dispos|entsorg/i.test(r.orderType ?? "")) continue;
    const cost = unitCost(d, r.sku, null);
    const completed = /complete|abgeschlossen/i.test(r.orderStatus ?? "");
    const vanished = r.requestedQuantity - r.cancelledQuantity - r.shippedQuantity - r.disposedQuantity - r.inProcessQuantity;
    const short = r.receivedQuantity !== null ? r.shippedQuantity - r.receivedQuantity : 0;
    const eventDate = r.lastUpdated ?? r.requestDate;
    const qty = (completed && vanished > 0 ? vanished : 0) + (short > 0 ? short : 0);
    if (qty <= 0) continue;
    // Fehlende Ware laut Amazon-Zahlen erst nach Wartezeit; von dir bestätigte Fehlmenge sofort.
    if (short <= 0 && addDaysIso(eventDate, GRACE_DAYS.removal) > today) continue;
    push({
      key: `removal:${r.orderId}:${r.sku}`,
      type: "removal_incomplete",
      title: `Remission ${r.orderId}: ${qty} × fehlt – ${r.sku}`,
      sku: r.sku,
      fnsku: r.fnsku,
      asin: d.asinBySku.get(r.sku) ?? null,
      quantity: qty,
      unitCost: cost,
      expectedAmount: cost === null ? null : round2(cost * qty),
      reference: r.orderId,
      eventDate,
      evidence: [
        { label: "Angefordert / storniert", value: `${r.requestedQuantity} / ${r.cancelledQuantity}`, source: "Remissionsaufträge" },
        { label: "Versandt / entsorgt", value: `${r.shippedQuantity} / ${r.disposedQuantity}`, source: "Remissionsaufträge" },
        { label: "Bei dir angekommen", value: r.receivedQuantity === null ? "nicht bestätigt" : String(r.receivedQuantity), source: "Remissionen (eigene Bestätigung)" },
      ],
    });
  }

  // --- Fehlt beim Wareneingang ------------------------------------------------------------
  const receivedByShipment = new Map<string, number>();
  const lastReceipt = new Map<string, string>();
  for (const r of d.receipts) {
    const k = `${r.referenceId}|${r.fnsku ?? r.sku ?? ""}`;
    receivedByShipment.set(k, (receivedByShipment.get(k) ?? 0) + r.quantity);
    if (!lastReceipt.has(r.referenceId) || lastReceipt.get(r.referenceId)! < r.date) lastReceipt.set(r.referenceId, r.date);
  }
  for (const sh of d.inbound) {
    const ref = sh.amazonShipmentId;
    const last = lastReceipt.get(ref);
    const since = last ?? sh.shippedAt;
    if (!since || addDaysIso(since, GRACE_DAYS.inbound) > today) continue;
    for (const it of sh.items) {
      const received = (receivedByShipment.get(`${ref}|${it.fnsku ?? ""}`) ?? 0) + (it.fnsku ? 0 : (receivedByShipment.get(`${ref}|${it.sku}`) ?? 0));
      const reimb = d.reimbursements
        .filter((r) => (r.fnsku === it.fnsku || r.sku === it.sku) && /inbound/i.test(r.reason ?? ""))
        .reduce((n, r) => n + r.quantityTotal, 0);
      const missing = it.scanned - received - reimb;
      if (missing <= 0) continue;
      const cost = unitCost(d, it.sku, it.asin);
      push({
        key: `inbound:${sh.id}:${it.fnsku ?? it.sku}`,
        type: "inbound_shortage",
        title: `${missing} × fehlt beim Wareneingang – ${ref}`,
        sku: it.sku,
        fnsku: it.fnsku,
        asin: it.asin,
        quantity: missing,
        unitCost: cost,
        expectedAmount: cost === null ? null : round2(cost * missing),
        reference: ref,
        eventDate: since,
        evidence: [
          { label: "Gescannt und verschickt", value: `${it.scanned} Einheiten (Sendung „${sh.name}“)`, source: "Inbound-Scan" },
          { label: "Von Amazon eingebucht", value: `${received} Einheiten`, source: "Bestandsprotokoll (Receipts)" },
          { label: "Bereits erstattet", value: `${reimb}`, source: "Erstattungen" },
        ],
      });
    }
  }

  return out;
}
