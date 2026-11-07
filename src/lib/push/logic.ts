// Push aufs Handy (Bauauftrag Push-Handy, Teil A) – reine Logik (tests/push-logic.test.ts): welche Meldungsarten es
// gibt, was an ist, Ruhezeiten (Standard 22–6 Uhr nur „kritisch“) und was mit einer Meldung passiert.

export const MELDE_ARTEN = [
  { key: "deal", titel: "Deal grün/gelb", text: "Deal-Eingang und Lugru: grüne und gelbe Deals – mit „In den Warenkorb“, wenn ein Shop bekannt ist.", standard: true },
  { key: "amazon_kritisch", titel: "Amazon kritisch", text: "Sperrung, Listing deaktiviert, Zahlung abgelehnt, Kontozustand kritisch – kommt auch in der Ruhezeit.", standard: true, kritisch: true },
  { key: "frist_heute", titel: "Frist heute", text: "Morgens: was heute fällig ist (Fristen, wichtige Aufgaben).", standard: true },
  { key: "paletten_heute", titel: "Paletten-Sendung heute", text: "Morgens: Speditions-Sendungen mit Termin heute.", standard: true },
  { key: "morgenbericht", titel: "Morgenbericht liegt vor", text: "Morgens ein Überblick mit Link – dabei auch, was über Nacht zurückgehalten wurde.", standard: true },
  { key: "va_rueckfrage", titel: "VA-Rückfrage", text: "Die VA hat eine Frage zu einer Aufgabe (❓ oder Frage im Thread).", standard: true },
  { key: "aufgabe_wichtig", titel: "Neue wichtige Aufgabe", text: "Aufgaben mit Priorität „wichtig“ (Apple Watch: „Erledigt“ schließt sie).", standard: true },
  { key: "persoenlich", titel: "Persönliche Mail", text: "Persönliche Mails (Privatbereich) mit fertigem Antwortentwurf – nur an den Inhaber, nie in Discord-Kanäle.", standard: true },
  { key: "bqool", titel: "BQool-Freigabe", text: "Täglicher BQool-Upload wartet auf Freigabe (Änderungen je Land, Regelwechsel, Warnungen) und Abweichungen der Nachkontrolle.", standard: true },
  { key: "mail_entwurf", titel: "Antwort vorbereitet", text: "Käuferfrage oder Lieferanten-Antwort mit fertigem Antwortentwurf im Posteingang.", standard: true },
  { key: "sonstiges", titel: "Sonstiges", text: "Übrige Hinweise (Tesla, Calls, Frühwarnungen, Termine …).", standard: true },
] as const;

export type MeldeArt = (typeof MELDE_ARTEN)[number]["key"] | "test";
export const istMeldeArt = (v: unknown): v is MeldeArt => v === "test" || MELDE_ARTEN.some((a) => a.key === v);

/** Einstellungen je Person (in den Mandanten-Einstellungen unter benachrichtigungen.personen[userId]). */
export type MeldePrefs = { aus?: string[]; ruheVon?: string; ruheBis?: string };
export const RUHE_STANDARD = { von: "22:00", bis: "06:00" } as const;
export const RUHE_ZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Ist die Art an? (Test-Pushs immer.) */
export const artAn = (art: MeldeArt, p: MeldePrefs | null | undefined) => art === "test" || !(p?.aus ?? []).includes(art);

/** Uhrzeit „HH:MM“ in Berlin. */
export const uhrBerlin = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** Liegt die Uhrzeit in der Ruhezeit? Auch über Mitternacht (22:00–06:00). von = bis → keine Ruhezeit. */
export function inRuhezeit(uhr: string, von: string = RUHE_STANDARD.von, bis: string = RUHE_STANDARD.bis): boolean {
  if (von === bis) return false;
  return von < bis ? uhr >= von && uhr < bis : uhr >= von || uhr < bis;
}

export type Zustellung = "senden" | "zurueckhalten" | "ausgeschaltet";

/**
 * Was passiert mit einer Meldung für diese Person jetzt? Art aus → nur ins Protokoll; Ruhezeit und nicht kritisch →
 * zurückhalten (kommt morgens mit dem Morgenbericht); sonst senden. Test-Pushs kommen immer sofort.
 */
export function zustellung(art: MeldeArt, kritisch: boolean, p: MeldePrefs | null | undefined, jetzt: Date): Zustellung {
  if (!artAn(art, p)) return "ausgeschaltet";
  if (art === "test" || kritisch || MELDE_ARTEN.some((a) => a.key === art && "kritisch" in a && a.kritisch)) return "senden";
  return inRuhezeit(uhrBerlin(jetzt), p?.ruheVon ?? RUHE_STANDARD.von, p?.ruheBis ?? RUHE_STANDARD.bis) ? "zurueckhalten" : "senden";
}

/** Nach 3 Fehlversuchen in Folge gilt ein Abo als abgelaufen. */
export const ABO_MAX_FEHLER = 3;

/** Protokoll-Text je Zustand. */
export const ZUSTAND_TEXT: Record<string, string> = {
  gesendet: "an das Handy gesendet",
  fehlgeschlagen: "Push fehlgeschlagen",
  kein_geraet: "kein Gerät mit Push",
  zurueckgehalten: "Ruhezeit – kommt morgens",
  ausgeschaltet: "Art ausgeschaltet",
  ausgeliefert: "morgens nachgereicht",
  erledigt: "erledigt – Karte geschlossen",
};

/** Morgenbericht-Text: kurz, das Wichtigste vorne. */
export function morgenText(o: { ueberNacht: number; fristen: number; wichtig: number; paletten: number; persoenlich?: number; /** B31.4: „BQool-Upload gestern: …“ bzw. „wartet auf Freigabe“ (nur Inhaber). */ bqool?: string | null }): string {
  const teile = [
    o.bqool || null,
    o.persoenlich ? `${o.persoenlich} persönliche Nachricht${o.persoenlich === 1 ? " wartet" : "en warten"}` : null,
    o.fristen ? `${o.fristen} Frist${o.fristen === 1 ? "" : "en"} heute` : null,
    o.wichtig ? `${o.wichtig} wichtige Aufgabe${o.wichtig === 1 ? "" : "n"}` : null,
    o.paletten ? `${o.paletten} Paletten-Sendung${o.paletten === 1 ? "" : "en"} heute` : null,
    o.ueberNacht ? `${o.ueberNacht} Meldung${o.ueberNacht === 1 ? "" : "en"} über Nacht` : null,
  ].filter(Boolean);
  return teile.length ? `${teile.join(" · ")}.` : "Nichts Dringendes – guten Start!";
}
