// sellerboard: Zeitraum (nicht mehr) vorbereitet – reine Logik (tests/b27-automatik.test.ts).

/**
 * B27.4: „NOT_WARMED“ bzw. „The warmed data for this period expired part-way through your pull … Call dashboard_period
 * again with the SAME arguments“ – dann dashboard_period mit denselben Argumenten erneut und dieselbe Seite wiederholen.
 */
export const isNotWarmed = (e: unknown) => /NOT_WARMED|not warmed|warmed data .{0,40}expired|call (ebay_)?dashboard_period again/i.test(e instanceof Error ? e.message : String(e));

/** Versuche je Seite, wenn der Zeitraum abgelaufen ist. */
export const WARM_VERSUCHE_JE_SEITE = 3;
