// Delegieren – reine Logik: Personen (intern = Konto im System, extern = nur Name: Prep Center, Steuerberater …),
// Regeln „Aufgabentyp → Person“ (Vorschlag beim ersten Mal, danach automatisch) und die Wochenübersicht je Person.

import { anleitungPasst, type AufgabeLite } from "@/lib/knowledge/anleitung";

export type PersonKey = `user:${string}` | `extern:${string}`;
export type Person = { key: PersonKey; name: string; art: "intern" | "extern" };
export type Regel = { typ: string; person: PersonKey; bestaetigt: boolean };

export const STANDARD_EXTERN = ["Prep Center", "Steuerberater"];

/** Vorlagen für Regeln (Aufgabentypen wie bei den Anleitungen: kategorie:, schluessel:, titel:). */
export const REGEL_VORLAGEN: { typ: string; text: string }[] = [
  { typ: "schluessel:claims", text: "Erstattungsansprüche (Amazon)" },
  { typ: "schluessel:belege-fehlen", text: "Belege anfordern (Buchhaltung)" },
  { typ: "schluessel:invoices-review", text: "Rechnungen prüfen" },
  { typ: "schluessel:lead-followup", text: "Lieferanten nachfassen" },
  { typ: "titel:nachfassen", text: "Alles mit „nachfassen“ im Titel" },
  { typ: "schluessel:removal-receipts", text: "Remissionen prüfen" },
  { typ: "schluessel:returns", text: "Retouren erstatten/prüfen" },
  { typ: "kategorie:support", text: "Kategorie Support" },
];

export const personKey = (p: { userId?: string | null; extern?: string | null }): PersonKey | null => (p.userId ? `user:${p.userId}` : p.extern ? `extern:${p.extern}` : null);
export function personAus(key: string): { userId: string } | { extern: string } | null {
  if (key.startsWith("user:") && /^[0-9a-f-]{36}$/i.test(key.slice(5))) return { userId: key.slice(5) };
  if (key.startsWith("extern:") && key.slice(7).trim()) return { extern: key.slice(7).trim().slice(0, 60) };
  return null;
}

/** Erste passende Regel (Reihenfolge = Vorrang). */
export function regelFuer(t: AufgabeLite, regeln: Regel[]): Regel | null {
  return regeln.find((r) => anleitungPasst(t, [r.typ])) ?? null;
}

export type AufgabeZ = AufgabeLite & { id: string; status: "open" | "done"; dueDate: string | null; completedAt: Date | null; createdAt: Date; assigneeId: string | null; zustaendigExtern: string | null };

/**
 * Für offene Aufgaben ohne Zuständigen: bestätigte Regel → zuweisen; unbestätigte → Vorschlag (Ludwig bestätigt
 * beim ersten Mal je Typ). Ausnahmen (bewusst „selbst machen“) bleiben unangetastet.
 */
export function zuweisungsPlan(aufgaben: AufgabeZ[], regeln: Regel[], ausnahmen: Set<string>): { zuweisen: { id: string; person: PersonKey; typ: string }[]; vorschlaege: { id: string; person: PersonKey; typ: string }[] } {
  const zuweisen: { id: string; person: PersonKey; typ: string }[] = [];
  const vorschlaege: { id: string; person: PersonKey; typ: string }[] = [];
  for (const a of aufgaben) {
    if (a.status !== "open" || a.assigneeId || a.zustaendigExtern || ausnahmen.has(a.id)) continue;
    const r = regelFuer(a, regeln);
    if (!r) continue;
    (r.bestaetigt ? zuweisen : vorschlaege).push({ id: a.id, person: r.person, typ: r.typ });
  }
  return { zuweisen, vorschlaege };
}

export type WochenZeile = { person: PersonKey; offen: number; ueberfaellig: number; erledigtWoche: number; neuWoche: number; aelteste: string | null };

/** Wochenübersicht je Person: abgegeben (offen), überfällig, diese Woche erledigt und neu zugewiesen. */
export function wochenUebersicht(aufgaben: AufgabeZ[], heute: string): WochenZeile[] {
  const vor7 = Date.parse(`${heute}T00:00:00Z`) - 7 * 86_400_000;
  const je = new Map<PersonKey, WochenZeile>();
  for (const a of aufgaben) {
    const p = personKey({ userId: a.assigneeId, extern: a.zustaendigExtern });
    if (!p) continue;
    const z = je.get(p) ?? { person: p, offen: 0, ueberfaellig: 0, erledigtWoche: 0, neuWoche: 0, aelteste: null };
    if (a.status === "open") {
      z.offen++;
      if (a.dueDate && a.dueDate < heute) z.ueberfaellig++;
      if (a.dueDate && (!z.aelteste || a.dueDate < z.aelteste)) z.aelteste = a.dueDate;
    } else if (a.completedAt && a.completedAt.getTime() >= vor7) z.erledigtWoche++;
    if (a.createdAt.getTime() >= vor7) z.neuWoche++;
    je.set(p, z);
  }
  return [...je.values()].sort((x, y) => y.ueberfaellig - x.ueberfaellig || y.offen - x.offen);
}
