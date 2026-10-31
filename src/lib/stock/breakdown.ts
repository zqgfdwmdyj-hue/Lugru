// Amazon-Bestand überall mit denselben Begriffen aufschlüsseln: Verkaufbar, Reserviert, Unterwegs,
// Nicht verkaufbar und Gesamtbestand. Reine Logik – Produktkopf, Bestandsreiter, Nachbestellung, Repricer.

export type FbaStockRow = {
  fulfillable: number;
  reserved: number;
  inboundWorking?: number;
  inboundShipped?: number;
  inboundReceiving?: number;
  unsellable?: number;
};

export type StockBreakdown = { verkaufbar: number; reserviert: number; unterwegs: number; nichtVerkaufbar: number; gesamt: number };

export const STOCK_TERMS: Record<keyof StockBreakdown, { label: string; hint: string }> = {
  verkaufbar: { label: "Verkaufbar", hint: "Liegt im Amazon-Lager und kann sofort verkauft werden." },
  reserviert: { label: "Reserviert", hint: "Bei Amazon, aber gebunden: offene Kundenbestellungen, Umlagerung zwischen Lagern oder Prüfung." },
  unterwegs: { label: "Unterwegs", hint: "Zu Amazon gesendet, noch nicht eingelagert (angelegt, unterwegs, in Annahme)." },
  nichtVerkaufbar: { label: "Nicht verkaufbar", hint: "Beschädigt, abgelaufen oder vom Kunden zurück und nicht wiederverkäuflich." },
  gesamt: { label: "Gesamtbestand", hint: "Summe aus verkaufbar, reserviert, unterwegs und nicht verkaufbar." },
};

export function fbaBreakdown(rows: FbaStockRow[]): StockBreakdown {
  const b = { verkaufbar: 0, reserviert: 0, unterwegs: 0, nichtVerkaufbar: 0, gesamt: 0 };
  for (const r of rows) {
    b.verkaufbar += r.fulfillable || 0;
    b.reserviert += r.reserved || 0;
    b.unterwegs += (r.inboundWorking || 0) + (r.inboundShipped || 0) + (r.inboundReceiving || 0);
    b.nichtVerkaufbar += r.unsellable || 0;
  }
  b.gesamt = b.verkaufbar + b.reserviert + b.unterwegs + b.nichtVerkaufbar;
  return b;
}

/** Kurztext „verkaufbar 1 · reserviert 2 · unterwegs 0 · nicht verkaufbar 0“ (nur Teile > 0, verkaufbar immer). */
export function breakdownText(b: StockBreakdown): string {
  const parts: string[] = [`verkaufbar ${b.verkaufbar}`];
  if (b.reserviert) parts.push(`reserviert ${b.reserviert}`);
  if (b.unterwegs) parts.push(`unterwegs ${b.unterwegs}`);
  if (b.nichtVerkaufbar) parts.push(`nicht verkaufbar ${b.nichtVerkaufbar}`);
  return parts.join(" · ");
}

/** sellerboard meldet z. B. 999 Tage Reichweite, wenn nichts verkauft wurde – das ist keine echte Reichweite. */
export const NO_SALES_REACH = 900;

export function reachText(days: number | null | undefined, opts: { short?: boolean } = {}): string {
  if (days === null || days === undefined) return "–";
  if (days >= NO_SALES_REACH) return opts.short ? "keine Verk." : "keine Verkäufe (Reichweite unbegrenzt)";
  if (days < 0) return opts.short ? "0 T." : "aufgebraucht";
  return opts.short ? `${days} T.` : `${days} Tage`;
}

export function isNoSalesReach(days: number | null | undefined): boolean {
  return days !== null && days !== undefined && days >= NO_SALES_REACH;
}
