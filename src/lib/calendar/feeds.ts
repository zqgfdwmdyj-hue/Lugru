// Kalender per Link: Liste aus dem Einstellungsfeld lesen („Name | https://…“ oder nur die Adresse).

export type CalendarFeed = { name: string | null; url: string; color: string };

/** Farben für Link-Kalender (in der Reihenfolge der Liste). */
const COLORS = ["#F59E0B", "#8B5CF6", "#10B981", "#EC4899", "#3B82F6", "#EF4444", "#14B8A6", "#A16207"];

export function parseFeedList(text: string): CalendarFeed[] {
  const out: CalendarFeed[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:(.*?)\s*[|=]\s*)?((?:https?|webcals?):\/\/\S+)$/i.exec(line);
    if (!m) continue;
    const url = m[2].replace(/^webcals?:\/\//i, "https://");
    out.push({ name: m[1]?.trim() || null, url, color: COLORS[out.length % COLORS.length] });
  }
  return out;
}
