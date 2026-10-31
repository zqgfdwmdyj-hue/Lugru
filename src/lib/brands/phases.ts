// Marken & Content in vier Phasen: Ideen → Planung → Umsetzung → Veröffentlichung. Überfälliges sichtbar,
// eigene Projekte vor KI-Vorschlägen. Reine Logik.

export type Phase = "ideen" | "planung" | "umsetzung" | "veroeffentlichung";
export const PHASES: Phase[] = ["ideen", "planung", "umsetzung", "veroeffentlichung"];
export const PHASE_LABEL: Record<Phase, string> = { ideen: "Ideen", planung: "Planung", umsetzung: "Umsetzung", veroeffentlichung: "Veröffentlichung" };

/** Ideen-Status (idea, review, planned, in_progress, live) → Phase. */
export function ideaPhase(status: string): Phase {
  if (status === "planned") return "planung";
  if (status === "in_progress") return "umsetzung";
  if (status === "live") return "veroeffentlichung";
  return "ideen";
}

/**
 * Content-Status (idea, filmed, edited, scheduled, published) → Phase. Eine eigene Idee mit Datum ist
 * geplant; ein KI-Vorschlag bleibt eine Idee, bis ihn jemand annimmt – das vorgeschlagene Datum zählt nicht.
 */
export function contentPhase(status: string, plannedFor: string | null, source?: string): Phase {
  if (status === "filmed" || status === "edited") return "umsetzung";
  if (status === "scheduled" || status === "published") return "veroeffentlichung";
  if (source === "ai") return "ideen";
  return plannedFor ? "planung" : "ideen";
}

/** Noch nicht angenommen: Projekt-Idee in „Idee“/„prüfen“ bzw. KI-Beitrag im Status „Idee“. Nie überfällig. */
export const ideaUnaccepted = (status: string) => status === "idea" || status === "review";
export const postUnaccepted = (status: string, source: string) => source === "ai" && status === "idea";

/**
 * Art eines Datums: „termin“ = verbindlicher Veröffentlichungs-/Launch-Termin, „wunsch“ = Wunschdatum
 * (unverbindlich). Beiträge: erst mit Status „Fester Termin“ (scheduled) verbindlich. Projekt-Ideen: ab „Geplant“.
 */
export type DateKind = "termin" | "wunsch";
export const contentDateKind = (status: string): DateKind => (status === "scheduled" || status === "published" ? "termin" : "wunsch");
export const ideaDateKind = (status: string): DateKind => (status === "planned" || status === "in_progress" || status === "live" ? "termin" : "wunsch");

/** Überfällig: Termin vorbei und noch nicht veröffentlicht/live. */
export function isOverdue(date: string | null, done: boolean, today: string): boolean {
  return Boolean(date) && !done && date! < today;
}

/** Sortierung innerhalb einer Phase: überfällig zuerst, eigene vor KI, dann nach Termin. */
export function phaseOrder<T extends { source: string; date: string | null; done: boolean }>(list: T[], today: string): T[] {
  return [...list].sort(
    (a, b) =>
      Number(isOverdue(b.date, b.done, today)) - Number(isOverdue(a.date, a.done, today)) ||
      Number(a.source === "ai") - Number(b.source === "ai") ||
      (a.date ?? "9999").localeCompare(b.date ?? "9999"),
  );
}
