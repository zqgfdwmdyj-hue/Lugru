// Mehrere Paletten auf einmal einlagern: Wohin kommt welche? Vorher klar entschieden – alle auf einen Platz,
// auf freie Plätze verteilen oder ohne Platz. Reine Logik (auch im Browser für die Vorschau).

export type Placement = "alle" | "verteilen" | "ohne";

/**
 * Stellplatz je Palette. `plan` = Plätze in Reihenfolge, `occupied` = schon belegte Plätze.
 * Verteilen: ab dem gewählten Platz die nächsten freien im Plan (danach von vorn); reicht es nicht, bleiben
 * die übrigen ohne Platz – das steht in `short`.
 */
export function placeAll(count: number, location: string | null, placement: Placement | null, plan: string[], occupied: string[]): { locations: (string | null)[]; short: number } {
  if (count <= 1) return { locations: [location], short: 0 };
  if (!location || placement === "ohne") return { locations: Array(count).fill(null), short: 0 };
  if (placement !== "verteilen") return { locations: Array(count).fill(location), short: 0 };
  const busy = new Set(occupied);
  const start = Math.max(0, plan.indexOf(location));
  const ordered = plan.length ? [...plan.slice(start), ...plan.slice(0, start)] : [location];
  const freeOnes = ordered.filter((p) => !busy.has(p));
  if (!freeOnes.includes(location) && !plan.includes(location)) freeOnes.unshift(location);
  const picked = freeOnes.slice(0, count);
  return { locations: [...picked, ...Array(count - picked.length).fill(null)], short: count - picked.length };
}
