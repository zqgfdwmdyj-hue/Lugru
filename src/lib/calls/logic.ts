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
    "Schreibe eine deutsche Zusammenfassung (Überblick, Teilnehmer, Themen mit Kernaussagen) und ziehe heraus: Vereinbarungen, Aufgaben (mit Verantwortlichem und Frist, falls genannt), Entscheidungen und offene Fragen.",
    'Antworte NUR mit JSON: {"ueberblick":"3–5 Sätze","teilnehmer":["Name"],"themen":[{"name":"Thema","punkte":["Kernaussage"]}],"punkte":[{"art":"vereinbarung|aufgabe|entscheidung|frage","text":"kurz, deutsch, eindeutig","verantwortlich":"ich|consultant|Name|null","frist":"JJJJ-MM-TT|null","zitat":"wörtlicher kurzer Ausschnitt (max. 120 Zeichen) aus dem Transkript"}]}',
    "Regeln: nichts erfinden; Frist nur, wenn im Call genannt (relative Angaben wie „bis Freitag“ vom Call-Datum aus rechnen); höchstens 40 Punkte; Wiederholungen zusammenfassen.",
    `Call: ${titel} am ${datum}`,
    "Transkript:",
    transkript,
  ].join("\n");
}

/** Zusammenfassung aus der KI-Antwort (Überblick, Teilnehmer, Themen). */
export function leseKiZusammenfassung(antwort: string): { ueberblick: string; teilnehmer: string[]; themen: { name: string; punkte: string[] }[] } | null {
  const json = /\{[\s\S]*\}/.exec(antwort)?.[0];
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    return normZusammenfassung(o.ueberblick ?? o.overview, o.teilnehmer ?? o.participants, o.themen ?? o.topics);
  } catch {
    return null;
  }
}

const liste = (v: unknown) => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function normZusammenfassung(ueberblick: unknown, teilnehmer: unknown, themen: unknown) {
  const z = {
    ueberblick: str(ueberblick, 3000),
    teilnehmer: liste(teilnehmer).map((x) => str(x, 80)).filter(Boolean).slice(0, 30),
    themen: liste(themen)
      .map((t) => {
        const o = (t ?? {}) as Record<string, unknown>;
        return { name: str(o.name, 120), punkte: liste(o.punkte ?? o.points).map((x) => str(x, 400)).filter(Boolean).slice(0, 20) };
      })
      .filter((t) => t.name)
      .slice(0, 30),
  };
  return z.ueberblick || z.themen.length || z.teilnehmer.length ? z : null;
}

/** Datum aus freier Angabe („2026-10-23“, „23.10.2026“, „23.10.“ mit Jahr des Calls) – sonst null. */
export function fristAus(v: unknown, callDatum: string): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const de = /\b(\d{1,2})\.(\d{1,2})\.(20\d{2})?/.exec(s);
  if (de) return `${de[3] ?? callDatum.slice(0, 4)}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
  return null;
}

export type ArchivCall = { externeId: string; datum: string; titel: string; quelleUrl: string | null; transkript: string; zusammenfassung: ReturnType<typeof normZusammenfassung>; punkte: Punkt[] };

/**
 * Export aus dem bisherigen Call-Archiv (claude.ai-Seite) lesen: ein Call, eine Liste oder {calls, chunks}.
 * Felder: id, date, title, sourceUrl, summary {overview, topics, decisions, todos{task, owner, due}, open_questions,
 * participants}; Transkript als transcript/text oder in chunks ({callId, n, text}).
 */
export function leseArchivExport(roh: unknown): { calls: ArchivCall[]; fehler: string | null } {
  const o = (roh ?? {}) as Record<string, unknown>;
  const chunks = liste(o.chunks).map((c) => (c ?? {}) as Record<string, unknown>);
  const rohCalls = Array.isArray(roh) ? roh : Array.isArray(o.calls) ? (o.calls as unknown[]) : o.date || o.datum ? [roh] : [];
  const calls: ArchivCall[] = [];
  for (const x of rohCalls) {
    const c = (x ?? {}) as Record<string, unknown>;
    const datum = str(c.date ?? c.datum, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) continue;
    const id = str(c.id ?? c.externeId, 80) || `ohne-id-${datum}`;
    const eigene = liste(c.chunks).length ? liste(c.chunks) : chunks.filter((k) => k.callId === c.id);
    const teile = eigene.map((k, i) => (typeof k === "string" ? { n: i, text: k } : { n: Number((k as Record<string, unknown>).n ?? i), text: typeof (k as Record<string, unknown>).text === "string" ? ((k as Record<string, unknown>).text as string).slice(0, 200_000) : "" }));
    const transkript = str(c.transcript ?? c.transkript ?? c.text, 400_000) || teile.sort((a, b) => a.n - b.n).map((t) => t.text).join("");
    const s = (c.summary ?? c.zusammenfassung ?? {}) as Record<string, unknown>;
    const punkte: Punkt[] = [
      ...liste(s.todos).map((t) => {
        const a = typeof t === "string" ? { task: t } : ((t ?? {}) as Record<string, unknown>);
        return { art: "aufgabe" as const, text: str(a.task ?? a.text, 400), verantwortlich: str(a.owner ?? a.verantwortlich, 60) || null, frist: fristAus(a.due ?? a.frist, datum), zitat: null };
      }),
      ...liste(s.decisions).map((d) => ({ art: "entscheidung" as const, text: str(d, 400), verantwortlich: null, frist: null, zitat: null })),
      ...liste(s.open_questions).map((q) => ({ art: "frage" as const, text: str(q, 400), verantwortlich: null, frist: null, zitat: null })),
    ].filter((p) => p.text.length >= 3);
    calls.push({
      externeId: id,
      datum,
      titel: str(c.title ?? c.titel, 200) || str(s.title, 200) || `Consultant-Call ${datum.split("-").reverse().join(".")}`,
      quelleUrl: /^https:\/\/docs\.google\.com\//.test(str(c.sourceUrl ?? c.quelleUrl, 500)) ? str(c.sourceUrl ?? c.quelleUrl, 500) : null,
      transkript,
      zusammenfassung: normZusammenfassung(s.overview ?? s.ueberblick, s.participants ?? s.teilnehmer, s.topics ?? s.themen),
      punkte,
    });
  }
  return { calls, fehler: calls.length ? null : "Keine Calls in der Datei erkannt (erwartet: date im Format JJJJ-MM-TT, dazu title, summary, Transkript)." };
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
