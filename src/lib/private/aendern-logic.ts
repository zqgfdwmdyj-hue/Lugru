// Privat-Eintrag ändern (für Claude: privat_eintrag_aendern) – reine Logik. Welche Angabe bei welcher Art in
// welches Feld geht; nur die Arten, die Claude auch anlegen darf. Sichtbarkeit und Verfasser prüft der Service.

import { beobachtungTeile, beobachtungText } from "./rueckblick-logic";
import { isDay, rating } from "./logic";

export const AENDERBARE_ARTEN = ["intim", "zuwendung", "tagebuch", "beobachtung", "gespraech", "danke", "stimmung", "dateidee", "aufgabe"] as const;
export type AenderbareArt = (typeof AENDERBARE_ARTEN)[number];

export type Aenderung = {
  tag?: string;
  text?: string;
  situation?: string;
  problematik?: string;
  veraenderung?: string;
  vereinbart?: string;
  wert?: number;
  erledigt?: boolean;
};

/** Wohin „text“ je Art geht. */
const TEXT_FELD: Record<AenderbareArt, string> = { intim: "note", zuwendung: "note", tagebuch: "note", beobachtung: "text", gespraech: "topic", danke: "text", stimmung: "note", dateidee: "text", aufgabe: "title" };
const TEXT_MAX: Record<AenderbareArt, number> = { intim: 500, zuwendung: 300, tagebuch: 2000, beobachtung: 2000, gespraech: 500, danke: 300, stimmung: 300, dateidee: 300, aufgabe: 300 };
/** Wohin „wert“ je Art geht (1–5 bzw. Minuten). */
const WERT_FELD: Partial<Record<AenderbareArt, { feld: string; art: "bewertung" | "minuten" }>> = {
  intim: { feld: "closeness", art: "bewertung" },
  tagebuch: { feld: "mood", art: "bewertung" },
  stimmung: { feld: "value", art: "bewertung" },
  zuwendung: { feld: "minutes", art: "minuten" },
};

export type PatchErgebnis = { ok: true; daten: Record<string, unknown>; felder: string[] } | { ok: false; meldung: string };

/**
 * Neue Daten eines Eintrags aus den alten und der Änderung. Leere Texte löschen optionale Felder (nicht den
 * Pflichttext). `felder` = geänderte Angaben (nur Namen, für Protokoll und Antwort – nie Inhalte).
 */
export function eintragPatch(art: AenderbareArt, alt: Record<string, unknown>, a: Aenderung, heute: string): PatchErgebnis {
  const d: Record<string, unknown> = { ...alt };
  const felder: string[] = [];
  const setze = (k: string, v: unknown) => {
    if (v === undefined || v === "") delete d[k];
    else d[k] = v;
  };

  if (a.tag !== undefined) {
    if (!isDay(a.tag)) return { ok: false, meldung: "tag als JJJJ-MM-TT angeben." };
    if (art === "dateidee") return { ok: false, meldung: "Date-Ideen haben keinen Tag." };
    if ((art === "tagebuch" || art === "beobachtung" || art === "stimmung") && a.tag > heute) return { ok: false, meldung: "Bitte kein Datum in der Zukunft." };
    setze(art === "aufgabe" ? "due" : "day", a.tag);
    felder.push("tag");
  }

  const dreiFelder = a.situation !== undefined || a.problematik !== undefined || a.veraenderung !== undefined;
  if (dreiFelder && art !== "beobachtung") return { ok: false, meldung: "situation/problematik/veraenderung gibt es nur bei Beobachtungen." };
  if (art === "beobachtung" && dreiFelder) {
    // Fehlende Felder aus dem bisherigen Stand (eigene Felder oder aus dem Text gelesen) übernehmen.
    const bisher = beobachtungTeile(alt as { text: string });
    const situation = (a.situation ?? bisher.situation).trim().slice(0, 1000);
    if (!situation) return { ok: false, meldung: "Die Situation darf nicht leer sein." };
    const problematik = (a.problematik ?? bisher.problematik ?? "").trim().slice(0, 1000);
    const veraenderung = (a.veraenderung ?? bisher.veraenderung ?? "").trim().slice(0, 1000);
    setze("situation", situation);
    setze("problematik", problematik);
    setze("veraenderung", veraenderung);
    d.text = beobachtungText(situation, problematik, veraenderung);
    for (const k of ["situation", "problematik", "veraenderung"] as const) if (a[k] !== undefined) felder.push(k);
    if (a.text !== undefined) return { ok: false, meldung: "Entweder text oder die drei Felder angeben, nicht beides." };
  } else if (a.text !== undefined) {
    const t = a.text.trim().slice(0, TEXT_MAX[art]);
    const pflicht = art === "beobachtung" || art === "danke" || art === "dateidee" || art === "aufgabe";
    if (pflicht && !t) return { ok: false, meldung: "Der Text darf hier nicht leer sein – zum Entfernen privat_eintrag_loeschen." };
    setze(TEXT_FELD[art], t);
    // Neuer Freitext ersetzt bei Beobachtungen auch die drei Felder (sonst widersprächen sie dem Text).
    if (art === "beobachtung") for (const k of ["situation", "problematik", "veraenderung"]) delete d[k];
    felder.push("text");
  }

  if (a.vereinbart !== undefined) {
    if (art !== "gespraech") return { ok: false, meldung: "vereinbart gibt es nur beim Paar-Gespräch." };
    setze("agreed", a.vereinbart.trim().slice(0, 500));
    felder.push("vereinbart");
  }

  if (a.wert !== undefined) {
    const w = WERT_FELD[art];
    if (!w) return { ok: false, meldung: `Bei ${art} gibt es keinen Wert.` };
    if (w.art === "bewertung") {
      const r = rating(a.wert);
      if (!r) return { ok: false, meldung: "wert als 1 bis 5 angeben." };
      d[w.feld] = r;
    } else {
      if (!(a.wert >= 0 && a.wert <= 600)) return { ok: false, meldung: "Minuten 0 bis 600." };
      setze(w.feld, a.wert ? Math.round(a.wert) : undefined);
    }
    felder.push("wert");
  }

  if (a.erledigt !== undefined) {
    if (art === "dateidee") d.done = a.erledigt;
    else if (art === "aufgabe") {
      if (alt.repeat && alt.repeat !== "einmal") return { ok: false, meldung: "Wiederkehrende Aufgaben bitte im Privatbereich abhaken." };
      d.done = a.erledigt;
      setze("doneAt", a.erledigt ? heute : undefined);
    } else return { ok: false, meldung: "erledigt gibt es nur bei Aufgaben und Date-Ideen." };
    felder.push("erledigt");
  }

  if (!felder.length) return { ok: false, meldung: "Nichts zu ändern – bitte mindestens eine Angabe machen." };
  return { ok: true, daten: d, felder };
}
