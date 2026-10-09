// Board wie bei Trello: Spalten für die Großhändler-Pipeline und für eigene Aufgaben.
// Reine Logik (Spalten, Zuordnung, Nachfass-Text) – ohne Datenbank, damit testbar.

import type { LEAD_STATUSES } from "@/db/schema";

type LeadStatus = (typeof LEAD_STATUSES)[number];

export type LeadColumnKey = "kontakt" | "angeschrieben" | "antwort" | "follow_up" | "preisliste" | "abgeschlossen" | "nix";

/** Spalten der Großhändler-Pipeline und welcher Status beim Hineinziehen gesetzt wird. */
export const LEAD_COLUMNS: { key: LeadColumnKey; title: string; target: LeadStatus; hint: string }[] = [
  { key: "kontakt", title: "Zu kontaktieren", target: "geprueft", hint: "geprüfte Großhändler und Entwürfe" },
  { key: "angeschrieben", title: "Angeschrieben", target: "angeschrieben", hint: "wartet auf Antwort" },
  { key: "antwort", title: "Antwort erhalten", target: "antwort", hint: "Antwort im Posteingang" },
  { key: "follow_up", title: "Follow-up", target: "follow_up", hint: "nachfassen" },
  { key: "preisliste", title: "Preisliste erhalten", target: "preisliste", hint: "Liste als Feed hochladen" },
  { key: "abgeschlossen", title: "Abgeschlossen", target: "abgeschlossen", hint: "Lieferant" },
  { key: "nix", title: "GH ist nix", target: "kein_interesse", hint: "kein Interesse / passt nicht" },
];

/** In welcher Spalte steht ein Kontakt? null = nicht auf dem Board (noch ungeprüft, ausgeschlossen). */
export function leadColumn(l: { status: string; kind: string; onBoard: boolean }): LeadColumnKey | null {
  switch (l.status) {
    case "entwurf":
      return "kontakt";
    case "neu":
    case "geprueft":
      return l.onBoard || l.kind === "grosshandel" ? "kontakt" : null;
    case "angeschrieben":
      return "angeschrieben";
    case "antwort":
      return "antwort";
    case "follow_up":
      return "follow_up";
    case "preisliste":
      return "preisliste";
    case "abgeschlossen":
      return "abgeschlossen";
    case "kein_interesse":
      return "nix";
    default:
      return null;
  }
}

/** Nach so vielen Tagen ohne Antwort wandert ein Kontakt nach „Follow-up“. */
export const FOLLOW_UP_DAYS = 7;

export const daysSince = (d: Date | null | undefined, now = new Date()) => (d ? Math.floor((now.getTime() - d.getTime()) / 86_400_000) : null);

export function needsFollowUp(l: { status: string; mailedAt: Date | null; repliedAt: Date | null }, now = new Date()): boolean {
  const d = daysSince(l.mailedAt, now);
  return l.status === "angeschrieben" && !l.repliedAt && d !== null && d >= FOLLOW_UP_DAYS;
}

/** Kurze Nachfass-Mail ohne KI – Bezug auf die erste Anfrage, mit Zitat. */
/** Nachfass-Mail: kurze Erinnerung, dann die Signatur des Absender-Postfachs, darunter die erste Anfrage als Zitat. */
export function followUpMail(l: { mailSubject: string | null; mailBody: string | null; mailedAt: Date | null; mailLanguage: string | null }, signature?: string | null): { subject: string; body: string } {
  const en = l.mailLanguage === "en";
  const date = l.mailedAt ? l.mailedAt.toLocaleDateString(en ? "en-GB" : "de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const subject = `${/^(re|aw):/i.test(l.mailSubject ?? "") ? "" : en ? "Re: " : "AW: "}${l.mailSubject ?? (en ? "Our inquiry" : "Unsere Anfrage")}`;
  const intro = en
    ? `Hello,\n\nI wanted to briefly follow up on my inquiry from ${date} below. Could you send us your price list and trade conditions (incl. minimum order quantity)?\n\nIf you are not interested, a short reply is enough and we will not contact you again.`
    : `Guten Tag,\n\nich wollte kurz an meine Anfrage vom ${date} (unten) erinnern. Könnten Sie uns Ihre Preisliste und Händlerkonditionen (inkl. Mindestbestellmenge) senden?\n\nFalls kein Interesse besteht, genügt eine kurze Antwort – dann melden wir uns nicht erneut.`;
  const quoted = (l.mailBody ?? "").split("\n").map((x) => `> ${x}`).join("\n");
  return { subject, body: `${intro}${signature ? `\n\n${signature}` : ""}\n\n${quoted}` };
}

export type TaskColumnKey = "offen" | "in_arbeit" | "warten" | "erledigt";
export const TASK_COLUMNS: { key: TaskColumnKey; title: string }[] = [
  { key: "offen", title: "Offen" },
  { key: "in_arbeit", title: "In Arbeit" },
  { key: "warten", title: "Warten auf …" },
  { key: "erledigt", title: "Erledigt" },
];

export function taskColumn(t: { status: string; boardColumn: string | null }): TaskColumnKey {
  if (t.status === "done") return "erledigt";
  return t.boardColumn === "in_arbeit" || t.boardColumn === "warten" ? t.boardColumn : "offen";
}
