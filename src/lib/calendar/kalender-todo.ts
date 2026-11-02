// Familienkalender → To-do-Liste: Ein Termin „To do Ludwig: Sachen Tafel herrichten“ (auch „ToDo für Ludwig …“,
// „To-Do Ludwig – …“, „Aufgabe Ludwig: …“, „Ludwig: To do …“) wird zur Aufgabe dieser Person mit höchster Priorität.
// Reine Logik (tests/kalender-todo.test.ts).

export type TodoPerson = { userId: string; namen: string[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TODO = "(?:to[\\s-]?do|todo|aufgabe|erledigen)";
const TRENNER = "\\s*[:\\-–—,]?\\s*";

/** Vornamen (erstes Wort, mind. 2 Zeichen), ohne Dubletten. */
export const vornamen = (...namen: (string | null | undefined)[]): string[] => [...new Set(namen.map((n) => (n ?? "").trim().split(/\s+/)[0] ?? "").filter((n) => n.length >= 2))];

/** Ist der Titel ein To-do für eine dieser Personen („To do Tom: …“)? Solche Termine werden Aufgaben und blocken keine Zeit. */
export const istKalenderTodo = (titel: string, namen: string[]): boolean => namen.length > 0 && kalenderTodo(titel, [{ userId: "", namen }]) !== null;

/** To-do im Kalendertitel erkennen: für wen und was. Ohne Text danach gilt der ganze Titel. */
export function kalenderTodo(titel: string, personen: TodoPerson[]): { userId: string; text: string } | null {
  const t = (titel ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const p of personen) {
    for (const name of p.namen) {
      const n = esc(name);
      const vorn = new RegExp(`^${TODO}\\s*(?:f[üu]r|fuer|an|von)?\\s*${n}(?![\\p{L}\\p{N}])${TRENNER}(.*)$`, "iu").exec(t);
      const hinten = vorn ? null : new RegExp(`^${n}(?![\\p{L}\\p{N}])${TRENNER}${TODO}(?![\\p{L}])${TRENNER}(.*)$`, "iu").exec(t);
      const m = vorn ?? hinten;
      if (m) {
        const text = (m[1] ?? "").trim();
        return { userId: p.userId, text: (text || t).slice(0, 200) };
      }
    }
  }
  return null;
}
