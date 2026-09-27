import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ClaimType, TenantSettings } from "@/db/schema";

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  inbound_shortage: "Fehlt beim Wareneingang",
  lost_warehouse: "Im Lager verloren",
  damaged_warehouse: "Im Lager beschädigt",
  reimbursed_below_cost: "Unter EK erstattet",
  return_not_received: "Retoure erstattet, nie angekommen",
  disposed_without_order: "Entsorgt ohne Auftrag",
  removal_incomplete: "Remission unvollständig",
  other: "Sonstiges",
};

/** Standardwerte. Fristen bitte mit den aktuellen Amazon-Richtlinien abgleichen. */
export const DEFAULT_SETTINGS = {
  vatRate: 0.19,
  importReminderDays: 7,
  claims: {
    dailyLimit: 15,
    resetHour: 14,
    minAmount: 1,
    windowDays: {
      inbound_shortage: 60,
      lost_warehouse: 60,
      damaged_warehouse: 60,
      reimbursed_below_cost: 60,
      return_not_received: 60,
      disposed_without_order: 60,
      removal_incomplete: 60,
      other: 60,
    } as Record<ClaimType, number>,
  },
  shipper: {} as NonNullable<TenantSettings["shipper"]>,
  dhl: {
    sandbox: true,
    billingNumberPaket: "",
    billingNumberKleinpaket: "",
    productKleinpaket: "V62KP",
    labelFormat: "910-300-700",
    kleinpaketMaxKg: 1,
  },
  pricing: { referralRate: 0.15, minProfit: 1, maxPriceFactor: 2, defaultFbaFee: 3.5 },
  aging: { unsellableWarnDays: 30, noSaleWarnDays: 180 },
  drive: { folderId: "" },
};

export type ResolvedSettings = typeof DEFAULT_SETTINGS;

export function resolveSettings(s: TenantSettings): ResolvedSettings {
  const d = DEFAULT_SETTINGS;
  return {
    vatRate: s.vatRate ?? d.vatRate,
    importReminderDays: s.importReminderDays ?? d.importReminderDays,
    claims: {
      dailyLimit: s.claims?.dailyLimit ?? d.claims.dailyLimit,
      resetHour: s.claims?.resetHour ?? d.claims.resetHour,
      minAmount: s.claims?.minAmount ?? d.claims.minAmount,
      windowDays: { ...d.claims.windowDays, ...(s.claims?.windowDays ?? {}) },
    },
    shipper: { ...d.shipper, ...(s.shipper ?? {}) },
    dhl: { ...d.dhl, ...(s.dhl ?? {}) },
    pricing: { ...d.pricing, ...(s.pricing ?? {}) },
    aging: { ...d.aging, ...(s.aging ?? {}) },
    drive: { ...d.drive, ...(s.drive ?? {}) },
  };
}

export async function getSettings(tenantId: string): Promise<ResolvedSettings> {
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return resolveSettings(t?.settings ?? {});
}
