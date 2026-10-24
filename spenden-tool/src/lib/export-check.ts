import type { EventRow } from "@/lib/event-view";

/** Offene Punkte vor einem Export (Collage, Social Media, Aushang) – kurz und zählbar. */
export function exportWarnings(rows: EventRow[]): string[] {
  const n = (f: (r: EventRow) => boolean) => rows.filter(f).length;
  const out: string[] = [];
  const conflicts = n((r) => r.state.conflict);
  const noPrice = n((r) => r.item.price === null);
  const unconfirmed = n((r) => r.item.price !== null && !r.item.priceConfirmed);
  const unnamed = n((r) => r.unnamed);
  const oldVisible = n((r) => !r.state.conflict && r.state.oldVisible);
  if (conflicts) out.push(`${conflicts} ungelöste(r) Preiswiderspruch/-widersprüche (ausgegeben wird der eingetragene Preis)`);
  if (noPrice) out.push(`${noPrice} ohne Preis`);
  if (unconfirmed) out.push(`${unconfirmed} Preis(e) unbestätigt`);
  if (unnamed) out.push(`${unnamed} ohne Namen`);
  if (oldVisible) out.push(`${oldVisible} Foto(s) zeigen noch einen alten Preis`);
  return out;
}
