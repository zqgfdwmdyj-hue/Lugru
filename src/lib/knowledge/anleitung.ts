// Anleitungen (SOPs) im Wissen – reine Logik: Felder lesen, als Text darstellen, zu Aufgaben passend finden,
// Prüf-Erinnerung nach 6 Monaten.

export type AnleitungFelder = { zweck: string; wann: string; wer: string; schritte: string[]; zugaenge: string[]; fehler: string[]; aufgabenTypen: string[] };

const zeilen = (s: unknown, max = 40) =>
  String(s ?? "")
    .split(/\r?\n/)
    .map((z) => z.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, max)
    .map((z) => z.slice(0, 500));

/** Felder aus einem Formular (Schritte, Zugänge, Fehler, Aufgabentypen je Zeile). */
export function leseAnleitung(get: (k: string) => unknown): AnleitungFelder {
  return {
    zweck: String(get("a_zweck") ?? "").trim().slice(0, 1000),
    wann: String(get("a_wann") ?? "").trim().slice(0, 500),
    wer: String(get("a_wer") ?? "").trim().slice(0, 200),
    schritte: zeilen(get("a_schritte"), 60),
    zugaenge: zeilen(get("a_zugaenge")),
    fehler: zeilen(get("a_fehler")),
    aufgabenTypen: normTypen(zeilen(get("a_typen"), 20)),
  };
}

/** „amazon“ → „kategorie:amazon“; bekannte Präfixe bleiben; Rest wird Titel-Stichwort. */
export function normTypen(typen: string[]): string[] {
  const KAT = ["amazon", "ebay", "versand", "einkauf", "geld", "support", "eigene", "marken", "system"];
  return [
    ...new Set(
      typen
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
          const m = /^(kategorie|schluessel|schlüssel|titel)\s*:\s*(.+)$/i.exec(t);
          if (m) return `${m[1].toLowerCase().replace("ü", "ue")}:${m[2].trim().toLowerCase()}`;
          return KAT.includes(t.toLowerCase()) ? `kategorie:${t.toLowerCase()}` : `titel:${t.toLowerCase()}`;
        }),
    ),
  ];
}

/** Anleitung als lesbarer Text (für Anzeige, Suche und Claude). */
export function anleitungText(a: AnleitungFelder): string {
  const teile: string[] = [];
  if (a.zweck) teile.push(`Zweck: ${a.zweck}`);
  if (a.wann) teile.push(`Wann: ${a.wann}`);
  if (a.wer) teile.push(`Wer: ${a.wer}`);
  if (a.schritte.length) teile.push(["Schritte:", ...a.schritte.map((s, i) => `${i + 1}. ${s}`)].join("\n"));
  if (a.zugaenge.length) teile.push(["Benötigte Zugänge:", ...a.zugaenge.map((s) => `- ${s}`)].join("\n"));
  if (a.fehler.length) teile.push(["Häufige Fehler:", ...a.fehler.map((s) => `- ${s}`)].join("\n"));
  return teile.join("\n\n");
}

export type AufgabeLite = { title: string; category: string; systemKey: string | null };

/** Passt die Anleitung zu dieser Aufgabe? (Kategorie, Anfang des Systemschlüssels oder Stichwort im Titel) */
export function anleitungPasst(t: AufgabeLite, typen: string[]): boolean {
  const titel = t.title.toLowerCase();
  const key = (t.systemKey ?? "").toLowerCase();
  return typen.some((x) => {
    const [art, ...rest] = x.split(":");
    const wert = rest.join(":").trim().toLowerCase();
    if (!wert) return false;
    if (art === "kategorie") return t.category === wert;
    if (art === "schluessel") return key.startsWith(wert);
    if (art === "titel") return titel.includes(wert);
    return false;
  });
}

export function anleitungenFuer(t: AufgabeLite, anleitungen: { id: string; anleitung: AnleitungFelder | null }[]): string[] {
  return anleitungen.filter((a) => a.anleitung && anleitungPasst(t, a.anleitung.aufgabenTypen)).map((a) => a.id);
}

const TAG = 86_400_000;
/** Prüfen fällig: nie geprüft oder zuletzt vor mehr als 6 Monaten (183 Tage). */
export function pruefungFaellig(verifiedAt: Date | null, jetzt: Date = new Date()): boolean {
  return !verifiedAt || jetzt.getTime() - verifiedAt.getTime() > 183 * TAG;
}
