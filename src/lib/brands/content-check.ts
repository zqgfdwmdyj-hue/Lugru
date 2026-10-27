// Content-Plan: Jahreszahl und Anlass vor der Freigabe prüfen (z. B. „#halloween2025“ in einem Beitrag für
// 2026, Halloween-Video nach dem 31.10.). Nur Hinweise und ein Vorschlag – geändert wird erst auf Klick.

import { OCCASIONS } from "./occasions";

export type ContentText = { hook: string; script: string | null; caption: string | null; hashtags: string | null; shots: string[] };
export type ContentIssue = { kind: "jahr" | "anlass"; text: string; fromYear?: string; toYear?: string };

const OCCASION_WORDS: Record<string, RegExp> = {
  valentinstag: /valentin/i,
  ostern: /\boster|easter/i,
  muttertag: /muttertag|mother'?s\s*day/i,
  vatertag: /vatertag|father'?s\s*day/i,
  einschulung: /einschul|schulanfang|schult[üu]te/i,
  oktoberfest: /oktoberfest|wiesn/i,
  halloween: /halloween/i,
  "singles-day": /singles\s*day/i,
  thanksgiving: /thanksgiving/i,
  "black-friday": /black\s*friday|cyber\s*(week|monday)/i,
  nikolaus: /nikolaus/i,
  weihnachten: /weihnacht|christmas|xmas/i,
  silvester: /silvester|new\s*year'?s?\s*eve|neujahr/i,
};

const allText = (p: ContentText) => [p.hook, p.script, p.caption, p.hashtags, ...p.shots].filter(Boolean).join("\n");
const dmy = (iso: string) => iso.split("-").reverse().join(".");

/** Hinweise zu Jahreszahlen (veraltet bzw. falsches Jahr) und zum Anlass (am geplanten Tag schon vorbei). */
export function contentIssues(p: ContentText, plannedFor: string | null, today: string): ContentIssue[] {
  const text = allText(p);
  const day = plannedFor ?? today;
  const target = Number(day.slice(0, 4));
  const out: ContentIssue[] = [];
  const years = [...new Set([...text.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map((m) => Number(m[1])))];
  for (const y of years) {
    if (y === target || y < target - 3 || y > target + 1) continue;
    out.push({ kind: "jahr", text: `Jahreszahl ${y} im Beitrag – ${plannedFor ? `geplant für ${dmy(plannedFor)}` : `heute ist ${target}`}.`, fromYear: String(y), toYear: String(target) });
  }
  if (plannedFor) {
    for (const o of OCCASIONS) {
      const re = OCCASION_WORDS[o.key];
      if (!re || !re.test(text)) continue;
      const date = o.date(target);
      const after = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      if (plannedFor > after) out.push({ kind: "anlass", text: `${o.name} (${dmy(date)}) ist am geplanten Tag (${dmy(plannedFor)}) schon vorbei.` });
    }
  }
  return out;
}

/** Veraltete Jahreszahlen ersetzen (nur die gemeldeten, nur als ganze Zahl). */
export function fixYears(p: ContentText, issues: ContentIssue[]): ContentText {
  const pairs = issues.filter((i) => i.kind === "jahr" && i.fromYear && i.toYear).map((i) => [i.fromYear!, i.toYear!] as const);
  const swap = (s: string) => pairs.reduce((acc, [from, to]) => acc.replace(new RegExp(`(?<!\\d)${from}(?!\\d)`, "g"), to), s);
  return { hook: swap(p.hook), script: p.script === null ? null : swap(p.script), caption: p.caption === null ? null : swap(p.caption), hashtags: p.hashtags === null ? null : swap(p.hashtags), shots: p.shots.map(swap) };
}
