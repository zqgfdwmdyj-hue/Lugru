// Familien-Aufgabenliste – reine Logik: Fälligkeit wiederkehrender Aufgaben, Gruppierung, Fairness-Übersicht.

export type Zustaendig = "a" | "b" | "beide";
export type Wiederholung = "einmal" | "woechentlich" | "monatlich" | "jaehrlich";
export const KATEGORIEN = { haushalt: "Haushalt", kinder: "Kinder", arzt: "Arzt", geld: "Geld", geschenke: "Geschenke", sonstiges: "Sonstiges" } as const;
export type Kategorie = keyof typeof KATEGORIEN;

export type FamilienAufgabe = {
  titel: string;
  zustaendig: Zustaendig;
  faellig: string | null;
  wiederholung: Wiederholung;
  kategorie: Kategorie;
  notiz?: string;
  /** Erledigt (einmalige: abgeschlossen; wiederkehrende: letzte Erledigungen). */
  erledigt: { am: string; von: "a" | "b" }[];
  abgeschlossen?: boolean;
  /** Herkunft (Brief, Termin-Mail, Vorsorge …) und der Vorschlag „zuständig“. */
  quelle?: string;
};

const plusMonate = (iso: string, n: number) => {
  const [j, m, t] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1 + n, 1));
  const letzter = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(t, letzter));
  return d.toISOString().slice(0, 10);
};
const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Nächste Fälligkeit nach dem Erledigen (wiederkehrend), mindestens nach heute. */
export function naechsteFaelligkeit(w: Wiederholung, faellig: string | null, heute: string): string | null {
  if (w === "einmal") return faellig;
  let d = faellig ?? heute;
  const schritt = (x: string) => (w === "woechentlich" ? plusTage(x, 7) : w === "monatlich" ? plusMonate(x, 1) : plusMonate(x, 12));
  do d = schritt(d);
  while (d <= heute);
  return d;
}

/** Abhaken: einmalig → abgeschlossen; wiederkehrend → Erledigung merken und nächste Fälligkeit setzen. */
export function abhaken(a: FamilienAufgabe, von: "a" | "b", heute: string): FamilienAufgabe {
  const erledigt = [...a.erledigt, { am: heute, von }].slice(-50);
  if (a.wiederholung === "einmal") return { ...a, erledigt, abgeschlossen: true };
  return { ...a, erledigt, faellig: naechsteFaelligkeit(a.wiederholung, a.faellig, heute) };
}

export type Gruppe = "ueberfaellig" | "woche" | "spaeter" | "ohne" | "erledigt";
export const GRUPPE_TEXT: Record<Gruppe, string> = { ueberfaellig: "Überfällig", woche: "Diese Woche", spaeter: "Später", ohne: "Ohne Datum", erledigt: "Erledigt" };

export function gruppeVon(a: FamilienAufgabe, heute: string): Gruppe {
  if (a.abgeschlossen) return "erledigt";
  if (!a.faellig) return "ohne";
  if (a.faellig < heute) return "ueberfaellig";
  if (a.faellig <= plusTage(heute, 7)) return "woche";
  return "spaeter";
}

/** Sichtbar für „meine“: mir zugeordnet oder beide. */
export const fuerMich = (a: FamilienAufgabe, ich: "a" | "b" | null) => !ich || a.zustaendig === "beide" || a.zustaendig === ich;

/** Fairness: wer hat in den letzten `tage` Tagen wie viele Aufgaben erledigt (je Kategorie). */
export function fairness(aufgaben: FamilienAufgabe[], heute: string, tage = 30): { a: number; b: number; jeKategorie: Record<string, { a: number; b: number }> } {
  const ab = plusTage(heute, -tage);
  const out = { a: 0, b: 0, jeKategorie: {} as Record<string, { a: number; b: number }> };
  for (const x of aufgaben)
    for (const e of x.erledigt) {
      if (e.am <= ab || e.am > heute) continue;
      out[e.von]++;
      const k = (out.jeKategorie[x.kategorie] ??= { a: 0, b: 0 });
      k[e.von]++;
    }
  return out;
}

/** Vorschlag „zuständig“ für Aufgaben aus Briefen/Mails/Vorsorge: Kategorie, die bisher meist jemand übernimmt. */
export function vorschlagZustaendig(aufgaben: FamilienAufgabe[], kategorie: Kategorie): Zustaendig {
  let a = 0;
  let b = 0;
  for (const x of aufgaben) if (x.kategorie === kategorie) for (const e of x.erledigt) e.von === "a" ? a++ : b++;
  if (a + b < 3) return "beide";
  return a >= b * 2 ? "a" : b >= a * 2 ? "b" : "beide";
}
