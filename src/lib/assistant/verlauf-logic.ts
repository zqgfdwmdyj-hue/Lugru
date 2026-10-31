// B19.5: Assistent-Verlauf ehrlich – warum es bei einem Eintrag kein „Rückgängig“ gibt, und Eingabe-Tokens samt
// Zwischenspeicher (mit Prompt-Caching zählt input_tokens nur den nicht zwischengespeicherten Rest).

export const RUECKGAENGIG_TAGE = 7;

export type VerlaufEintrag = { ok: boolean; zurueck: boolean; undoDaten: boolean; toolHatUndo: boolean; stufe: string | null; alterTage: number; darf: boolean; nurAnsehen: boolean };

/** null = „Rückgängig“ möglich, sonst der Grund in einem Satz. */
export function keinRueckgaengigGrund(e: VerlaufEintrag): string | null {
  if (!e.ok) return "nicht ausgeführt – nichts zurückzunehmen";
  if (e.zurueck) return "schon rückgängig gemacht";
  if (!e.toolHatUndo) return "für dieses Werkzeug gibt es kein Rückgängig – bitte von Hand zurücknehmen";
  if (!e.undoDaten) return "keine alten Werte gespeichert (Änderung vor dem Update) – bitte von Hand zurücknehmen";
  if ((e.stufe ?? "gruen") !== "gruen") return "Stufe gelb/rot – bewusst nur von Hand zurückzunehmen";
  if (e.alterTage > RUECKGAENGIG_TAGE) return `älter als ${RUECKGAENGIG_TAGE} Tage`;
  if (e.nurAnsehen) return "Konto nur zum Ansehen";
  if (!e.darf) return "nur die Person, die es geändert hat (bzw. der Inhaber)";
  return null;
}

/** Eingabe-Tokens einer Antwort: nicht zwischengespeichert + in den Zwischenspeicher geschrieben + daraus gelesen. */
export function eingabeTokens(u: { input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | null | undefined): number {
  if (!u) return 0;
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}
