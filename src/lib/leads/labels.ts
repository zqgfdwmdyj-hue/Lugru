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
  follow_up: "Follow-up",
  preisliste: "Preisliste erhalten",
  abgeschlossen: "abgeschlossen",
  kein_interesse: "kein Interesse / GH ist nix",
  ausgeschlossen: "ausgeschlossen",
};

/** Kurzname je Fundstelle (Filter und Kennzeichnung in der Liste). */
export const FINDING_LABEL: Record<string, string> = {
  lucid: "Register",
  amazon: "Amazon",
  ebay: "eBay",
  gpsr: "GPSR",
  web: "Websuche",
  messe: "Messe",
};
/** Name je Suchlauf. */
export const SEARCH_SOURCE_LABEL: Record<string, string> = {
  lucid: "Verpackungsregister",
  amazon: "Amazon-Verkäufer",
  ebay: "eBay-Verkäufer + GPSR",
  gpsr: "GPSR",
  web: "KI-Websuche",
  messe: "Messe-Ausstellerliste",
};
