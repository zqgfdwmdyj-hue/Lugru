import type { Db } from '../db/db';
import { getUserAccessToken } from '../ebay/auth';
import { ACCEPT_LANGUAGE, apiBase, MARKETPLACE } from '../ebay/config';
import { EbayHttpError, ebayFetch } from '../ebay/http';
import type { Settings } from '../types';
import type { Address, OrderForInvoice } from './types';

type Json = Record<string, unknown>;

function amount(v: unknown): number {
  const n = Number((v as { value?: unknown } | undefined)?.value);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

const COUNTRY_NAMES: Record<string, string> = { DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz' };

function toAddress(contact: Json | undefined, fallbackName: string): Address {
  const addr = (contact?.contactAddress as Json | undefined) ?? {};
  const lines = [str(addr.addressLine1), str(addr.addressLine2)].filter((l): l is string => Boolean(l));
  const cityLine = [str(addr.postalCode), str(addr.city)].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  const country = str(addr.countryCode);
  // Inlandsadressen ohne Land — so sieht ein deutscher Brief aus.
  if (country && country !== 'DE') lines.push(COUNTRY_NAMES[country] ?? country);
  return { name: str(contact?.fullName) ?? fallbackName, lines };
}

/** Eine Bestellung der Fulfillment API auf das Rechnungsformat bringen. */
export function mapOrder(o: Json): OrderForInvoice {
  const buyer = (o.buyer as Json | undefined) ?? {};
  const registration = buyer.buyerRegistrationAddress as Json | undefined;
  const shipTo = ((o.fulfillmentStartInstructions as Json[] | undefined)?.[0]?.shippingStep as Json | undefined)?.shipTo as Json | undefined;
  const username = str(buyer.username);
  // Rechnungsempfänger ist der Käufer mit seiner eBay-Adresse; fehlt sie, die Lieferadresse.
  const contact = registration?.contactAddress ? registration : shipTo;
  const pricing = (o.pricingSummary as Json | undefined) ?? {};
  const payments = ((o.paymentSummary as Json | undefined)?.payments as Json[] | undefined) ?? [];
  const cancelState = str((o.cancelStatus as Json | undefined)?.cancelState);

  return {
    orderId: String(o.orderId ?? ''),
    createdAt: String(o.creationDate ?? ''),
    paidAt: str(payments.find((p) => p.paymentDate)?.paymentDate),
    paid: o.orderPaymentStatus === 'PAID',
    cancelled: cancelState === 'CANCELED',
    buyerUsername: username,
    buyer: toAddress(contact, username ?? 'eBay-Käufer'),
    buyerEmail: str(registration?.email) ?? str(shipTo?.email),
    currency: str((pricing.total as Json | undefined)?.currency) ?? 'EUR',
    items: ((o.lineItems as Json[] | undefined) ?? []).map((li) => ({
      title: str(li.title) ?? 'Artikel',
      sku: str(li.sku),
      itemId: str(li.legacyItemId),
      quantity: Number(li.quantity ?? 1) || 1,
      totalGross: amount(li.lineItemCost),
    })),
    shippingGross: amount(pricing.deliveryCost),
    discountGross: Math.abs(amount(pricing.priceDiscount)),
  };
}

export const MISSING_ORDER_SCOPE =
  'Die eBay-Verbindung erlaubt noch kein Lesen von Bestellungen. Bitte unter Einstellungen → Verbindung einmal neu mit eBay verbinden.';

/** Bestellungen ab `since` (ISO) laden, seitenweise. */
export async function fetchOrders(db: Db, settings: Settings, since: string): Promise<OrderForInvoice[]> {
  const token = await getUserAccessToken(db, settings);
  const out: OrderForInvoice[] = [];
  const filter = encodeURIComponent(`creationdate:[${new Date(since).toISOString()}..]`);
  for (let offset = 0; ; offset += 200) {
    const url = `${apiBase(settings.env)}/sell/fulfillment/v1/order?filter=${filter}&limit=200&offset=${offset}`;
    let json: Json | null;
    try {
      json = (await ebayFetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Accept-Language': ACCEPT_LANGUAGE,
          'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
        },
      })) as Json | null;
    } catch (err) {
      if (err instanceof EbayHttpError && (err.status === 403 || err.status === 401)) throw new Error(MISSING_ORDER_SCOPE);
      throw err;
    }
    const orders = (json?.orders as Json[] | undefined) ?? [];
    out.push(...orders.map(mapOrder));
    const total = Number(json?.total ?? 0);
    if (orders.length === 0 || offset + orders.length >= total) break;
  }
  return out;
}
