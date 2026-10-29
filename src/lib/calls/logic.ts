// Call-Archiv – reine Logik: Google-Doc-Links erkennen, Transkript bereinigen, KI-Auftrag bauen und die Antwort
// prüfen (Vereinbarungen, Aufgaben, Entscheidungen, offene Fragen), Fundstelle im Transkript finden.

export const PUNKT_TEXT = { vereinbarung: "Vereinbarung", aufgabe: "Aufgabe", entscheidung: "Entscheidung", frage: "Offene Frage" } as const;
export type PunktArt = keyof typeof PUNKT_TEXT;
export type Punkt = { art: PunktArt; text: string; verantwortlich: string | null; frist: string | null; zitat: string | null };

/** Google-Docs-ID aus einem Link (…/document/d/<ID>/…). */
export function googleDocId(s: string): string | null {
  return /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/.exec(s)?.[1] ?? null;
}

/** Alle Google-Doc-Links in einem Text (z. B. Discord-Nachricht). */
export function googleDocLinks(text: string): string[] {
  return [...new Set([...text.matchAll(/https?:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/[A-Za-z0-9_-]{20,}[^\s)>]*/g)].map((m) => googleDocId(m[0])!).filter(Boolean))];
}

/** Datum aus Titel/Text (TT.MM.JJJJ oder JJJJ-MM-TT), sonst Ersatz. */
export function datumAusText(text: string, ersatz: string): string {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = /\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/.exec(text);
  if (de) return `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  return ersatz;
}

/** Transkript für die KI: Leerzeilen zusammenfassen, auf Länge kürzen. */
export function bereinigeTranskript(t: string, max = 120_000): string {
  return t.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

export function kiAuftrag(titel: string, datum: string, transkript: string): string {
  return [
    "Du liest das Transkript eines Calls mit dem Amazon-Consultant (SAS-Programm) eines Online-Händlers (Ludwig, LuGru GmbH).",
    "Ziehe heraus: Vereinbarungen, Aufgaben (mit Verantwortlichem und Frist, falls genannt), Entscheidungen und offene Fragen.",
    'Antworte NUR mit JSON: {"punkte":[{"art":"vereinbarung|aufgabe|entscheidung|frage","text":"kurz, deutsch, eindeutig","verantwortlich":"ich|consultant|Name|null","frist":"JJJJ-MM-TT|null","zitat":"wörtlicher kurzer Ausschnitt (max. 120 Zeichen) aus dem Transkript"}]}',
    "Regeln: nichts erfinden; Frist nur, wenn im Call genannt (relative Angaben wie „bis Freitag“ vom Call-Datum aus rechnen); höchstens 40 Punkte; Wiederholungen zusammenfassen.",
    `Call: ${titel} am ${datum}`,
    "Transkript:",
    transkript,
  ].join("\n");
}

/** KI-Antwort prüfen: nur gültige Arten, Texte gekürzt, Datum geprüft, Doppel entfernt. */
export function leseKiPunkte(antwort: string): Punkt[] {
  const json = /\{[\s\S]*\}/.exec(antwort)?.[0];
  if (!json) return [];
  let roh: unknown;
  try {
    roh = JSON.parse(json);
  } catch {
    return [];
  }
  const liste = (roh as { punkte?: unknown[] })?.punkte;
  if (!Array.isArray(liste)) return [];
  const out: Punkt[] = [];
  const gesehen = new Set<string>();
  for (const x of liste.slice(0, 60)) {
    const p = x as Record<string, unknown>;
    const art = String(p.art ?? "").toLowerCase() as PunktArt;
    if (!(art in PUNKT_TEXT)) continue;
    const text = String(p.text ?? "").trim().slice(0, 400);
    if (text.length < 3) continue;
    const key = `${art}|${text.toLowerCase()}`;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    const frist = typeof p.frist === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.frist) ? p.frist : null;
    const wer = typeof p.verantwortlich === "string" && p.verantwortlich.trim() && p.verantwortlich !== "null" ? p.verantwortlich.trim().slice(0, 60) : null;
    const zitat = typeof p.zitat === "string" && p.zitat.trim() ? p.zitat.trim().slice(0, 200) : null;
    out.push({ art, text, verantwortlich: wer, frist, zitat });
  }
  return out;
}

/** Stelle des Zitats im Transkript (unscharf: Leerzeichen und Groß/klein egal) – für den Sprung zur Call-Stelle. */
export function zitatPosition(transkript: string, zitat: string | null): number | null {
  if (!zitat) return null;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const t = norm(transkript);
  const z = norm(zitat).slice(0, 80);
  const i = t.indexOf(z);
  if (i >= 0) return i;
  const kurz = z.slice(0, 30);
  const j = kurz.length >= 12 ? t.indexOf(kurz) : -1;
  return j >= 0 ? j : null;
}

/** Ausschnitt rund um eine Stelle (für die Anzeige „Call-Stelle“). */
export function ausschnitt(transkript: string, pos: number | null, breite = 300): string | null {
  if (pos === null) return null;
  const t = transkript.replace(/\s+/g, " ");
  const von = Math.max(0, pos - breite / 2);
  return `${von > 0 ? "…" : ""}${t.slice(von, von + breite).trim()}${von + breite < t.length ? "…" : ""}`;
}

/** Wer ist „ich“? Aufgaben für den Consultant werden keine eigenen Aufgaben, sondern offene Punkte. */
export const istEigeneAufgabe = (p: { art: PunktArt; verantwortlich: string | null }) => p.art === "aufgabe" && !/consultant|amazon|berater/i.test(p.verantwortlich ?? "");
