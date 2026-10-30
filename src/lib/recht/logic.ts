// Rechtsfälle (B14): reine Logik – Aktenzeichen und Fristen erkennen, wer am Zug ist, Stillstand, Morgenbericht
// (privat nur als Anzahl), Entwurf „beim Anwalt nachfragen“. Keine Rechts- oder Steuerberatung, nur Ordnung.

import { datumsangaben } from "@/lib/private/termin-mail";

/** Aktenzeichen aus Betreff/Text: „Az. 123/26“, „Aktenzeichen: 45 O 123/26“, „Unser Zeichen: KAN-2026-0012“. */
export function aktenzeichenAus(text: string): string | null {
  const m = /(?:\bAz\.?|Aktenzeichen|Unser Zeichen|Ihr Zeichen|Gz\.?|Geschäftszeichen)\s*[:.]?\s*([A-Z0-9][A-Za-z0-9 ./-]{1,30}?\d)(?=[\s,;)]|$)/i.exec(text);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/** Für den Vergleich: nur Buchstaben/Ziffern, klein. */
export const azNorm = (az: string) => az.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Passt ein Text zu einem Fall (Aktenzeichen im Text, oder Gegenstand/Titel-Stichwort)? */
export function passtZuFall(text: string, fall: { aktenzeichen: string | null }): boolean {
  if (!fall.aktenzeichen) return false;
  const az = azNorm(fall.aktenzeichen);
  return az.length >= 4 && azNorm(text).includes(az);
}

const FRIST_WORT = /(stellung|unterlagen|frist|einreichen|übersenden|senden|zahlen|zahlung|rückmeldung|antwort|erklärung|widerspruch|einspruch|vorlegen|nachreichen|entscheidung|unterschrift|unterschreiben)/i;

/** Fristen im Text: „bis 14.11. Stellung nehmen“, „Unterlagen bis zum 20.11.2026“ – Datum + kurzer Satz. */
export function fristenAus(text: string, heute: string): { tag: string; text: string }[] {
  const out: { tag: string; text: string }[] = [];
  // Sätze trennen – aber nicht an Datumspunkten („bis 14.11. zu“).
  for (const satz of text.split(/(?<=[!?\n])\s+|(?<=[a-zäöüß)]\.)\s+(?=[A-ZÄÖÜ])/)) {
    if (!/\bbis\b|frist|spätestens/i.test(satz) || !FRIST_WORT.test(satz)) continue;
    for (const d of datumsangaben(satz, heute)) {
      if (d.iso >= heute && !out.some((o) => o.tag === d.iso)) out.push({ tag: d.iso, text: satz.replace(/\s+/g, " ").trim().slice(0, 240) });
    }
  }
  return out.sort((a, b) => a.tag.localeCompare(b.tag));
}

export type AmZug = "anwalt" | "wir" | "gegenseite" | "gericht" | "unklar";
export const AM_ZUG_TEXT: Record<AmZug, string> = { anwalt: "Anwalt", wir: "wir", gegenseite: "Gegenseite", gericht: "Gericht", unklar: "unklar" };

/** Wer ist am Zug? „Bitte senden Sie …“/„benötigen Ihre Entscheidung“ → wir; Gericht/Verhandlung → Gericht. */
export function amZugAus(text: string): AmZug {
  if (/\bbitte\b[^!?\n]{0,60}?\b(senden|übersenden|schicken|einreichen|nachreichen|unterschreiben|mitteilen|zukommen lassen|bestätigen|entscheiden)\b/i.test(text)) return "wir";
  if (/\b(bitte (senden|übersenden|schicken|reichen|teilen|geben)|benötige[n]? (noch )?(ihre|die|folgende)|ihre (rückmeldung|entscheidung|freigabe|zustimmung|unterlagen)|wir benötigen|bitte um (rückmeldung|ihre)|unterschreiben sie)\b/i.test(text)) return "wir";
  if (/\b(gericht|verhandlung|termin zur mündlichen|urteil|beschluss)\b/i.test(text)) return "gericht";
  if (/\b(gegenseite|gegnerisch|gegner hat|abmahner)\b/i.test(text)) return "gegenseite";
  if (text.trim()) return "anwalt";
  return "unklar";
}

/** Privater Fall? Projekt-gid oder -Name in der Liste „privat“, oder „privat“ im Projekt-/Abschnittsnamen. */
export function istPrivat(p: { projektGid: string; projektName: string; abschnitt: string | null }, privatProjekte: string[]): boolean {
  const liste = privatProjekte.map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (liste.includes(p.projektGid.toLowerCase()) || liste.includes(p.projektName.trim().toLowerCase())) return true;
  return /\bprivat\b/i.test(p.projektName) || /\bprivat\b/i.test(p.abschnitt ?? "");
}

/** Status aus Asana: erledigt → abgeschlossen, sonst Abschnitt (z. B. „In Bearbeitung“) oder „offen“. */
export const statusAus = (completed: boolean, abschnitt: string | null) => (completed ? "abgeschlossen" : abschnitt?.trim().slice(0, 60) || "offen");

const TAG = 86_400_000;
export const plusTage = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * TAG).toISOString().slice(0, 10);

/** Stillstand: keine Bewegung seit `tage` Tagen (nur offene Fälle). */
export function stillstand(f: { letzteBewegung: Date | null; abgeschlossen: Date | null; createdAt: Date }, jetzt: Date, tage: number): boolean {
  if (f.abgeschlossen || !tage) return false;
  return jetzt.getTime() - (f.letzteBewegung ?? f.createdAt).getTime() >= tage * TAG;
}

/** Morgenbericht: geschäftliche Fristen mit Titel, private nur als Anzahl. */
export function morgenZeile(fristen: { bereich: "geschaeft" | "privat"; titel: string; tag: string }[]): string | null {
  if (!fristen.length) return null;
  const g = fristen.filter((f) => f.bereich === "geschaeft").sort((a, b) => a.tag.localeCompare(b.tag));
  const p = fristen.filter((f) => f.bereich === "privat").length;
  const teile = [...g.slice(0, 3).map((f) => `„${f.titel.slice(0, 50)}“ ${f.tag.slice(8, 10)}.${f.tag.slice(5, 7)}.`), ...(g.length > 3 ? [`+${g.length - 3} weitere`] : []), ...(p ? [`${p} private Rechtsfrist${p === 1 ? "" : "en"}`] : [])];
  return `Rechtsfristen in 7 Tagen: ${teile.join(", ")}`;
}

/** Entwurf „beim Anwalt nachfragen“ (nie automatisch gesendet). */
export function nachfrageEntwurf(f: { titel: string; aktenzeichen: string | null }, tage: number): { betreff: string; text: string } {
  return {
    betreff: `Sachstand ${f.aktenzeichen ? `Az. ${f.aktenzeichen}` : f.titel}`.slice(0, 160),
    text: `Guten Tag,\n\nin der Sache „${f.titel}“${f.aktenzeichen ? ` (Az. ${f.aktenzeichen})` : ""} habe ich seit ${tage} Tagen nichts gehört. Gibt es einen neuen Stand oder brauchen Sie etwas von mir?\n\nViele Grüße`,
  };
}

/** Domain einer Adresse (für „Mails vom Anwalt“). */
export const domainVon = (adresse: string) => adresse.trim().toLowerCase().split("@")[1]?.replace(/>$/, "") ?? "";
export const istAnwalt = (adresse: string, domains: string[]) => {
  const d = domainVon(adresse);
  return Boolean(d) && domains.some((x) => {
    const y = x.trim().toLowerCase().replace(/^@/, "");
    return y && (d === y || d.endsWith(`.${y}`));
  });
};

/** Mail von Gericht, Behörde oder Gegenseite (Abmahnung, Mahnbescheid …)? → Hinweis „an Anwalt weitergeben?“. */
export function behoerdenMail(m: { from: string; subject: string; body: string }): boolean {
  const kopf = `${m.from}\n${m.subject}`;
  if (/\b(amtsgericht|landgericht|oberlandesgericht|arbeitsgericht|sozialgericht|verwaltungsgericht|staatsanwaltschaft|polizei|gerichtsvollzieher|mahngericht|bundesnetzagentur|ordnungsamt|gewerbeaufsicht|verbraucherzentrale|wettbewerbszentrale|bundeskartellamt|zollamt|hauptzollamt)\b/i.test(kopf)) return true;
  return /\b(abmahnung|mahnbescheid|vollstreckungsbescheid|klageschrift|klageerhebung|einstweilige verfügung|unterlassungserklärung|strafbewehrt|anhörung|bußgeld|ordnungswidrigkeit|zustellung|ladung)\b/i.test(`${m.subject}\n${m.body.slice(0, 3000)}`);
}

/** Wenn der Anwalt Unterlagen braucht: passende Stellen im Seller-System vorschlagen (nur Links, nichts wird verschickt). */
export function unterlagenVorschlag(text: string): { name: string; link: string }[] {
  const out: { name: string; link: string }[] = [];
  if (/rechnung|beleg|lieferschein|einkauf|nachweis/i.test(text)) out.push({ name: "Rechnungen / Belege", link: "/rechnungen" });
  if (/marke|echtheit|lieferkette|authentizität|markenrecht|bezugsquelle/i.test(text)) out.push({ name: "Echtheits-Ordner (Marken-Belege)", link: "/echtheit" });
  if (/amazon|asin|listing|konto|account|seller central/i.test(text)) out.push({ name: "Amazon-Fall-Zentrale", link: "/amazon-faelle" });
  if (/vertrag|vereinbarung|agb/i.test(text)) out.push({ name: "Wissen / Dokumente", link: "/wissen" });
  return out;
}
