// Anzeige-Texte für „Großhändler finden“.

export const KIND_LABEL: Record<string, [string, string]> = {
  grosshandel: ["Großhandel", "tag-ok"],
  haendler: ["Händler", "tag-info"],
  hersteller: ["Hersteller", "tag-info"],
  salon: ["Salon", "tag-neutral"],
  marktplatz: ["Marktplatz", "tag-neutral"],
  privat: ["Privatperson", "tag-neutral"],
  unklar: ["unklar", "tag-neutral"],
};
export const STATUS_LABEL: Record<string, string> = {
  neu: "neu",
  geprueft: "geprüft",
  entwurf: "Entwurf",
  angeschrieben: "angeschrieben",
  antwort: "Antwort!",
  kein_interesse: "kein Interesse",
  ausgeschlossen: "ausgeschlossen",
};
