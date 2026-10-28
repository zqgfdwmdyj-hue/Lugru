// Quelle und Datenstand an Werkzeug-Ergebnisse hängen – reine Logik (ohne Datenbank), auch in Tests nutzbar.

export type Datenstand = { quelle: string; stand: string; abgerufen: string; letzter_fehler?: string };

/** Bei JSON als Feld „datenstand“, sonst als letzte Zeile. */
export function withStand(text: string, stand: Datenstand | null): string {
  if (!stand) return text;
  try {
    const o = JSON.parse(text) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) return JSON.stringify({ ...o, datenstand: stand });
  } catch {
    /* kein JSON */
  }
  return `${text}\n\nDatenstand: ${stand.quelle} – ${stand.stand}`;
}
