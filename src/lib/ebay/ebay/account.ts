import type { Db } from '../db/db';
import type { Settings } from '../types';
import { getUserAccessToken } from './auth';
import { apiBase, MARKETPLACE } from './config';
import { ebayFetch } from './http';

export type PolicyType = 'fulfillment' | 'payment' | 'return';

export interface PolicyOption {
  id: string;
  name: string;
}

const LIST_KEYS: Record<PolicyType, { listKey: string; idKey: string }> = {
  fulfillment: { listKey: 'fulfillmentPolicies', idKey: 'fulfillmentPolicyId' },
  payment: { listKey: 'paymentPolicies', idKey: 'paymentPolicyId' },
  return: { listKey: 'returnPolicies', idKey: 'returnPolicyId' },
};

/** Einmaliges Opt-in des Verkäuferkontos in Business Policies (Verkaufsprofile). */
export async function optInToBusinessPolicies(db: Db, settings: Settings): Promise<void> {
  const token = await getUserAccessToken(db, settings);
  await ebayFetch(`${apiBase(settings.env)}/sell/account/v1/program/opt_in`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ programType: 'SELLING_POLICY_MANAGEMENT' }),
  });
}

export async function getPolicies(db: Db, settings: Settings, type: PolicyType): Promise<PolicyOption[]> {
  const token = await getUserAccessToken(db, settings);
  const url = `${apiBase(settings.env)}/sell/account/v1/${type}_policy?marketplace_id=${MARKETPLACE}`;
  const json = (await ebayFetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })) as Record<string, unknown> | null;

  const { listKey, idKey } = LIST_KEYS[type];
  const list = (json?.[listKey] as Record<string, unknown>[] | undefined) ?? [];
  return list.map((p) => ({ id: String(p[idKey] ?? ''), name: String(p.name ?? '') })).filter((p) => p.id !== '');
}

/** Versandprofil mit dem, was die Auswahl im Angebot braucht, um es zu erkennen. */
export interface ShippingPolicyOption extends PolicyOption {
  /** Versandkosten der ersten Inlands-Versandart für den Käufer; fehlt bei berechnetem Versand. */
  cost?: number;
  freeShipping?: boolean;
  /** eBay-Code der ersten Inlands-Versandart, z.B. `DE_DHLPaket`. */
  service?: string;
  /** Bearbeitungszeit in Tagen. */
  handlingDays?: number;
}

/**
 * Liest aus einem Versandprofil die erste Inlands-Versandart heraus. eBay
 * sortiert die Versandarten über `sortOrder` — die erste ist die, die im
 * Angebot oben steht.
 */
export function summarizeFulfillmentPolicy(p: Record<string, unknown>): ShippingPolicyOption {
  const out: ShippingPolicyOption = { id: String(p.fulfillmentPolicyId ?? ''), name: String(p.name ?? '') };
  const handling = (p.handlingTime as { value?: number } | undefined)?.value;
  if (typeof handling === 'number') out.handlingDays = handling;

  const options = (p.shippingOptions as Record<string, unknown>[] | undefined) ?? [];
  const domestic = options.find((o) => o.optionType === 'DOMESTIC') ?? options[0];
  const services = [...((domestic?.shippingServices as Record<string, unknown>[] | undefined) ?? [])].sort(
    (a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)
  );
  const first = services[0];
  if (!first) return out;
  if (typeof first.shippingServiceCode === 'string') out.service = first.shippingServiceCode;
  if (first.freeShipping === true) {
    out.freeShipping = true;
    out.cost = 0;
    return out;
  }
  const value = Number((first.shippingCost as { value?: string } | undefined)?.value);
  if (Number.isFinite(value)) out.cost = value;
  return out;
}

/** Versandprofile des Kontos — für die Auswahl direkt am Angebot. */
export async function getShippingPolicies(db: Db, settings: Settings): Promise<ShippingPolicyOption[]> {
  const token = await getUserAccessToken(db, settings);
  const url = `${apiBase(settings.env)}/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`;
  const json = (await ebayFetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })) as Record<string, unknown> | null;
  const list = (json?.fulfillmentPolicies as Record<string, unknown>[] | undefined) ?? [];
  return list.map(summarizeFulfillmentPolicy).filter((p) => p.id !== '');
}
