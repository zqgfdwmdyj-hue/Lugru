// Bestandsabgleich über alle Verkaufskanäle – reine Logik ohne Datenbank.
//
// Die Wawi ist führend: verfügbar = eigenes Lager − in offenen FBM-Aufträgen reserviert.
// Jeder Kanal (eBay, Amazon FBM, Temu …) bekommt diese Menge (ggf. gedeckelt). Verkauft ein
// Kanal, ist die Ware ab dem Bestellabruf reserviert und alle anderen Kanäle gehen herunter.

export type StockLevel = { sku: string; onHand: number; reserved: number };

export type SyncListing = {
  id: string;
  channel: string;
  sku: string;
  stockSku: string | null;
  status: string;
  stockSync: boolean;
  maxQuantity: number | null;
  pushedQuantity: number | null;
};

export type SyncDecision =
  | { listingId: string; action: "push"; target: number; stockSku: string }
  | { listingId: string; action: "none"; target: number; stockSku: string }
  | { listingId: string; action: "skip"; reason: string; stockSku: string };

/** Wawi-SKU eines Kanal-Angebots. */
export const stockSkuOf = (l: { sku: string; stockSku: string | null }) => l.stockSku?.trim() || l.sku;

export const availableOf = (lvl: StockLevel | undefined) => (lvl ? Math.max(0, lvl.onHand - lvl.reserved) : 0);

export function targetQuantity(l: Pick<SyncListing, "maxQuantity">, available: number): number {
  return l.maxQuantity !== null && l.maxQuantity >= 0 ? Math.min(available, l.maxQuantity) : available;
}

/**
 * Was je Angebot zu tun ist. Nicht angefasst werden: Entwürfe/beendete Angebote,
 * abgeschaltete und – zur Sicherheit – Angebote, deren SKU die Wawi gar nicht führt
 * (sonst würde ein fehlender Bestand als 0 an den Kanal gehen und das Angebot beenden).
 */
export function planSync(listings: SyncListing[], levels: Map<string, StockLevel>): SyncDecision[] {
  return listings.map((l) => {
    const stockSku = stockSkuOf(l);
    if (l.status !== "active") return { listingId: l.id, action: "skip", reason: "nicht aktiv", stockSku };
    if (!l.stockSync) return { listingId: l.id, action: "skip", reason: "Abgleich aus", stockSku };
    const lvl = levels.get(stockSku);
    if (!lvl) return { listingId: l.id, action: "skip", reason: "kein Wawi-Bestand", stockSku };
    const target = targetQuantity(l, availableOf(lvl));
    return target === l.pushedQuantity
      ? { listingId: l.id, action: "none", target, stockSku }
      : { listingId: l.id, action: "push", target, stockSku };
  });
}

/** Überverkauft: mehr in offenen Aufträgen als im Lager. */
export const oversold = (levels: Iterable<StockLevel>) => [...levels].filter((l) => l.reserved > l.onHand);

