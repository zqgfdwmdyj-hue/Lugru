// Fehlermeldungen für die Oberfläche: Datenbankfehler („Failed query: insert into …“ mit der ganzen SQL-Anweisung)
// auf den eigentlichen Grund kürzen, sonst die Meldung selbst.

export function lesbarerFehler(e: unknown, max = 300): string {
  if (!(e instanceof Error)) return "Unbekannter Fehler.";
  if (/^Failed query:/i.test(e.message)) {
    const grund = e.cause instanceof Error ? e.cause.message : null;
    return `Speichern in der Datenbank fehlgeschlagen${grund ? `: ${grund}` : "."}`.slice(0, max);
  }
  return e.message.slice(0, max);
}
