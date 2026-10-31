// Stammdaten prüfen: gleiche Firma oder Marke in verschiedenen Schreibweisen, auffällige Kürzel.
// Nur Hinweise zum Prüfen – nichts wird automatisch zusammengeführt oder geändert. Reine Logik.

const LEGAL = /\b(gmbh\s*&\s*co\.?\s*kg|gmbh|mbh|ug|ag|kg|ohg|gbr|e\.?\s?k\.?|ltd\.?|limited|inc\.?|llc|corp\.?|co\.?|s\.?r\.?o\.?|sp\.?\s*z\s*o\.?\s*o\.?|b\.?v\.?|s\.?a\.?s?\.?|s\.?l\.?|s\.?p\.?a\.?|oy|ab|as|aps)\b/gi;

/** Vergleichsschlüssel: klein, ohne Rechtsform, Umlaute ausgeschrieben, ohne Satzzeichen und Leerzeichen. */
export function nameKey(v: string): string {
  return v
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(LEGAL, " ")
    .replace(/[^a-z0-9]+/g, "");
}

export type SpellingGroup = { key: string; names: { name: string; n: number }[] };

/** Gruppen mit mehreren Schreibweisen desselben Namens (häufigste zuerst). */
export function spellingGroups(values: (string | null | undefined)[]): SpellingGroup[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const v = (raw ?? "").trim().replace(/\s+/g, " ");
    const k = v ? nameKey(v) : "";
    if (k.length < 2) continue;
    const m = byKey.get(k) ?? new Map<string, number>();
    m.set(v, (m.get(v) ?? 0) + 1);
    byKey.set(k, m);
  }
  return [...byKey]
    .filter(([, m]) => m.size > 1)
    .map(([key, m]) => ({ key, names: [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "de")) }))
    .sort((a, b) => b.names.reduce((s, x) => s + x.n, 0) - a.names.reduce((s, x) => s + x.n, 0));
}

const PLACEHOLDER = /^(n\/?a|na|none|null|keine|kein|ohne|unbekannt|unknown|unbranded|generic|no\s*brand|ohne\s*marke|markenlos|diverse|div\.?|sonstige|-+|\?+|x+|\.+)$/i;

/** Auffällige Marken-/Namensangaben: Platzhalter, ein Zeichen, nur Ziffern. */
export function suspiciousName(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (PLACEHOLDER.test(t)) return "Platzhalter statt Name";
  if (t.replace(/[^\p{L}\p{N}]/gu, "").length <= 1) return "nur ein Zeichen";
  if (/^\d+$/.test(t)) return "nur Ziffern";
  return null;
}
