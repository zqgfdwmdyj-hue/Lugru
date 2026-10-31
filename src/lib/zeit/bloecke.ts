// Zeitblöcke – reine Logik: freie Zeiten (Sperrzeit) und reservierte Kapazität je Tag, Verschieben geschäftlicher
// Aufgaben aus freien Tagen, Rückblick „freie Zeiten eingehalten?“.

export type Block = {
  id: string;
  art: "frei" | "reserviert";
  titel: string;
  userId: string | null;
  wochentage: number[];
  ganztags: boolean;
  vonZeit: string | null;
  bisZeit: string | null;
  gueltigVon: string | null;
  gueltigBis: string | null;
  stunden: number | null;
  link: string | null;
  aktiv: boolean;
};

/** ISO-Wochentag 1 = Montag … 7 = Sonntag. */
export function wochentag(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
export const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const WOCHENTAG_TEXT = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Blöcke, die an diesem Tag gelten. */
export function bloeckeAm(bloecke: Block[], tag: string, art?: Block["art"]): Block[] {
  const wt = wochentag(tag);
  return bloecke.filter((b) => b.aktiv && (!art || b.art === art) && b.wochentage.includes(wt) && (!b.gueltigVon || tag >= b.gueltigVon) && (!b.gueltigBis || tag <= b.gueltigBis));
}

/** Ganzer Tag frei (für diese Person bzw. für alle)? */
export function freierTag(bloecke: Block[], tag: string, userId: string | null = null): boolean {
  return bloeckeAm(bloecke, tag, "frei").some((b) => b.ganztags && (b.userId === null || userId === null || b.userId === userId));
}

/** Nächster Tag ab `tag` (einschließlich), der kein freier Tag ist – höchstens 14 Tage weiter. */
export function naechsterArbeitstag(bloecke: Block[], tag: string, userId: string | null = null): string {
  let d = tag;
  for (let i = 0; i < 14 && freierTag(bloecke, d, userId); i++) d = plusTage(d, 1);
  return d;
}

export type AufgabeZeit = { id: string; dueDate: string | null; priority: string; category: string; assigneeId: string | null; status: string };

/**
 * Geschäftliche Aufgaben, deren Fälligkeit auf einen freien Tag fällt, auf den nächsten Arbeitstag schieben.
 * Ausnahme: Frist heute + wichtig → Rückfrage (nicht automatisch verschieben). Aufgaben anderer zuständiger
 * Personen bleiben, wenn der freie Block nur für eine bestimmte Person gilt.
 */
export function verschiebePlan(aufgaben: AufgabeZeit[], bloecke: Block[], heute: string): { verschieben: { id: string; von: string; nach: string }[]; rueckfragen: string[] } {
  const verschieben: { id: string; von: string; nach: string }[] = [];
  const rueckfragen: string[] = [];
  for (const a of aufgaben) {
    if (a.status !== "open" || !a.dueDate || a.dueDate < heute) continue;
    const frei = bloeckeAm(bloecke, a.dueDate, "frei").filter((b) => b.ganztags && (b.userId === null || a.assigneeId === null || a.assigneeId === b.userId));
    if (!frei.length) continue;
    if (a.dueDate === heute && a.priority === "critical") {
      rueckfragen.push(a.id);
      continue;
    }
    const nach = naechsterArbeitstag(frei, plusTage(a.dueDate, 1));
    if (nach !== a.dueDate) verschieben.push({ id: a.id, von: a.dueDate, nach });
  }
  return { verschieben, rueckfragen };
}

/** Reservierte Stunden an einem Tag (Summe), mit den Blöcken. */
export function reserviertAm(bloecke: Block[], tag: string): { stunden: number; bloecke: Block[] } {
  const r = bloeckeAm(bloecke, tag, "reserviert");
  return { stunden: r.reduce((n, b) => n + (b.stunden ?? 0), 0), bloecke: r };
}

/** Berlin-Uhrzeit „HH:MM“ eines Zeitpunkts. */
const berlinZeit = (d: Date) => d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false });
const berlinTag = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

/**
 * Rückblick: Wurden die freien Zeiten der Woche (7 Tage vor `bis`) eingehalten? Gezählt werden erledigte
 * geschäftliche Aufgaben im freien Block (ganzer Tag bzw. ab/bis Uhrzeit).
 */
export function rueckblick(bloecke: Block[], erledigt: { completedAt: Date; category: string }[], bis: string): { tag: string; titel: string; eingehalten: boolean; erledigt: number }[] {
  const out: { tag: string; titel: string; eingehalten: boolean; erledigt: number }[] = [];
  for (let i = 7; i >= 1; i--) {
    const tag = plusTage(bis, -i);
    for (const b of bloeckeAm(bloecke, tag, "frei")) {
      const n = erledigt.filter((e) => {
        if (berlinTag(e.completedAt) !== tag) return false;
        if (b.ganztags) return true;
        const z = berlinZeit(e.completedAt);
        return (!b.vonZeit || z >= b.vonZeit) && (!b.bisZeit || z < b.bisZeit);
      }).length;
      out.push({ tag, titel: b.titel, eingehalten: n === 0, erledigt: n });
    }
  }
  return out;
}

/** Standard laut Plan: ein freier Abend (Mi ab 18 Uhr) und ein freier Wochenendtag (So). */
export function standardFreiZeiten(): Omit<Block, "id" | "userId">[] {
  return [
    { art: "frei", titel: "Freier Abend", wochentage: [3], ganztags: false, vonZeit: "18:00", bisZeit: null, gueltigVon: null, gueltigBis: null, stunden: null, link: null, aktiv: true },
    { art: "frei", titel: "Freier Wochenendtag", wochentage: [7], ganztags: true, vonZeit: null, bisZeit: null, gueltigVon: null, gueltigBis: null, stunden: null, link: null, aktiv: true },
  ];
}

/** Retourenwelle: ab 15.12. werktags Kapazität für die Retouren-Prüfung, bis Ende Januar; Meilenstein Anfang Januar. */
export function retourenwelle(heute: string): { reserviertAb: string; reserviertBis: string; meilenstein: string } {
  const jahr = Number(heute.slice(0, 4)) - (heute.slice(5) < "02-01" ? 1 : 0);
  const ab = `${jahr}-12-15`;
  // erster Montag im Januar (frühestens 2.)
  let m = `${jahr + 1}-01-02`;
  while (wochentag(m) !== 1) m = plusTage(m, 1);
  return { reserviertAb: ab, reserviertBis: `${jahr + 1}-01-31`, meilenstein: m };
}
