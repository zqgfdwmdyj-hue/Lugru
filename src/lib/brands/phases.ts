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

/** Content-Status (idea, filmed, edited, scheduled, published) → Phase; eine Idee mit Datum ist schon geplant. */
export function contentPhase(status: string, plannedFor: string | null): Phase {
  if (status === "filmed" || status === "edited") return "umsetzung";
  if (status === "scheduled" || status === "published") return "veroeffentlichung";
  return plannedFor ? "planung" : "ideen";
}

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
