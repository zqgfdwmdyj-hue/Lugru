import "server-only";
import { todayIso } from "@/lib/dates";
import type { Session } from "@/lib/auth/session";
import { AENDERBARE_ARTEN, eintragPatch, type AenderbareArt, type Aenderung } from "./aendern-logic";
import { canEdit, deleteEntry, loadEntries, loadEntry, restoreEntry, updateEntry, type PrivateKind } from "./service";

// Privat-Einträge ändern und löschen (für Claude: privat_eintrag_aendern / privat_eintrag_loeschen). Gleiche
// Regeln wie im Privatbereich: nur sichtbare Einträge, eigene Arten (Tagebuch, Beobachtung, Stimmung) nur der
// Verfasser, Umfang „nur Familie“ gar nicht. Rückgängig-Daten enthalten den alten Stand – sie liegen
// verschlüsselt im Protokoll und dürfen nur von derselben Person zurückgespielt werden.

export type RueckgaengigDaten =
  | { op: "aendern"; by: string; id: string; art: AenderbareArt; alt: Record<string, unknown> }
  | { op: "loeschen"; by: string; id: string; art: AenderbareArt; userId: string; daten: Record<string, unknown>; createdAt: string };

type Ergebnis = { ok: true; meldung: string; art: AenderbareArt; felder?: string[]; undo: RueckgaengigDaten } | { ok: false; meldung: string };

const ART_TEXT: Record<AenderbareArt, string> = { intim: "Nähe", zuwendung: "Zuwendung", tagebuch: "Tagebuch", beobachtung: "Beobachtung", gespraech: "Paar-Gespräch", danke: "Danke", stimmung: "Stimmung", dateidee: "Date-Idee", aufgabe: "Private Aufgabe" };
const istAenderbar = (k: string): k is AenderbareArt => (AENDERBARE_ARTEN as readonly string[]).includes(k);

async function eintragFuer(session: Session, id: string) {
  if (!session.privateAccess || session.privateScope !== "voll") return { fehler: "Dafür braucht es den vollen Privat-Zugang." } as const;
  const e = await loadEntry<Record<string, unknown>>(session, id);
  if (!e) return { fehler: "Eintrag nicht gefunden (oder nicht sichtbar)." } as const;
  if (!istAenderbar(e.kind)) return { fehler: "Diese Art lässt sich hier nicht ändern – Termine und Zeiten über privat_termin/privat_zeit, sonst im Privatbereich." } as const;
  if (!canEdit(session, e)) return { fehler: "Diesen Eintrag kann nur sein Verfasser ändern oder löschen." } as const;
  return { e: e as typeof e & { kind: AenderbareArt } } as const;
}

export async function privatEintragAendern(session: Session, id: string, a: Aenderung): Promise<Ergebnis> {
  const r = await eintragFuer(session, id);
  if ("fehler" in r) return { ok: false, meldung: r.fehler! };
  const { e } = r;
  const p = eintragPatch(e.kind, e.data, a, todayIso());
  if (!p.ok) return { ok: false, meldung: p.meldung };
  // Tagebuch und Stimmung: je Tag ein eigener Eintrag – nicht auf einen schon belegten Tag schieben.
  if ((e.kind === "tagebuch" || e.kind === "stimmung") && p.daten.day !== e.data.day) {
    const belegt = (await loadEntries<{ day?: string }>(session, [e.kind])).some((x) => x.id !== e.id && x.userId === session.userId && x.data.day === p.daten.day);
    if (belegt) return { ok: false, meldung: `Für diesen Tag gibt es schon einen ${ART_TEXT[e.kind]}-Eintrag – bitte den ändern.` };
  }
  if (!(await updateEntry(session, e.id, e.kind as PrivateKind, p.daten, true))) return { ok: false, meldung: "Nicht gespeichert – keine Berechtigung." };
  return { ok: true, meldung: `${ART_TEXT[e.kind]} geändert (${p.felder.join(", ")}).`, art: e.kind, felder: p.felder, undo: { op: "aendern", by: session.userId, id: e.id, art: e.kind, alt: e.data } };
}

export async function privatEintragLoeschen(session: Session, id: string): Promise<Ergebnis> {
  const r = await eintragFuer(session, id);
  if ("fehler" in r) return { ok: false, meldung: r.fehler! };
  const { e } = r;
  if (!(await deleteEntry(session, e.id, e.kind as PrivateKind))) return { ok: false, meldung: "Nicht gelöscht – keine Berechtigung." };
  return { ok: true, meldung: `${ART_TEXT[e.kind]} gelöscht.`, art: e.kind, undo: { op: "loeschen", by: session.userId, id: e.id, art: e.kind, userId: e.userId, daten: e.data, createdAt: e.createdAt.toISOString() } };
}

/** Rückgängig: alten Stand zurückschreiben bzw. gelöschten Eintrag wiederherstellen – nur dieselbe Person.
 * Wirft bei Ablehnung, damit das Protokoll die Änderung nicht als zurückgenommen markiert. */
export async function privatRueckgaengig(session: Session, d: unknown): Promise<string> {
  const u = d as RueckgaengigDaten | null;
  if (!u || typeof u !== "object" || !istAenderbar(u.art)) throw new Error("Keine gültigen Rückgängig-Daten.");
  if (u.by !== session.userId) throw new Error("Private Änderungen kann nur die Person zurücknehmen, die sie gemacht hat.");
  if (!session.privateAccess || session.privateScope !== "voll") throw new Error("Dafür braucht es den vollen Privat-Zugang.");
  if (u.op === "aendern") {
    if (!(await updateEntry(session, u.id, u.art, u.alt, true))) throw new Error("Eintrag nicht mehr vorhanden – nichts zurückgenommen.");
    return `${ART_TEXT[u.art]}: alter Stand wiederhergestellt.`;
  }
  if (!(await restoreEntry(session, { id: u.id, userId: u.userId, kind: u.art, data: u.daten, createdAt: u.createdAt }))) throw new Error("Eintrag gibt es schon wieder – nichts zurückgenommen.");
  return `${ART_TEXT[u.art]} wiederhergestellt.`;
}
