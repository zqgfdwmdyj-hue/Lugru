import type { EventRow } from "@/lib/event-view";

/** Offene Punkte vor einem Export (Collage, Social Media, Aushang) – kurz und zählbar. */
export function exportWarnings(rows: EventRow[]): string[] {
  const n = (f: (r: EventRow) => boolean) => rows.filter(f).length;
  const out: string[] = [];
  const conflicts = n((r) => r.state.conflict);
  const noPrice = n((r) => r.item.price === null);
  const unconfirmed = n((r) => r.item.price !== null && !r.item.priceConfirmed);
  const unnamed = n((r) => r.unnamed);
  const oldVisible = n((r) => !r.state.conflict && r.state.plan === "ersetzen");
  const unread = n((r) => r.item.inCollage && r.state.unread);
  const units = n((r) => r.issues.some((i) => i.key === "einheit"));
  const internal = n((r) => r.issues.some((i) => i.key === "intern"));
  if (conflicts) out.push(`${conflicts} ungelöste(r) Preiswiderspruch/-widersprüche (ausgegeben wird der eingetragene Preis)`);
  if (noPrice) out.push(`${noPrice} ohne Preis`);
  if (unconfirmed) out.push(`${unconfirmed} Preis(e) unbestätigt`);
  if (unnamed) out.push(`${unnamed} ohne Namen`);
  if (oldVisible) out.push(`${oldVisible} Foto(s) zeigen einen alten, abweichenden Preis – bitte Foto ohne Preis hochladen`);
  if (unread) out.push(`${unread} Foto(s) noch nicht auf eingebrannte Preise geprüft (Gefahr doppelter Preise)`);
  if (units) out.push(`${units} Abgabeeinheit(en) offen`);
  if (internal) out.push(`${internal} Name(n)/Variante(n) mit internen KI-Hinweisen (werden in der Ausgabe weggelassen)`);
  return out;
}
