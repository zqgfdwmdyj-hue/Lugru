// Lange Aufgabennotizen: standardmäßig nur Wirkung (Betrag) und der erste Satz als nächster Schritt –
// der vollständige Text zum Aufklappen. Reine Logik, damit testbar.

const MONEY = /(?:ca\.\s*)?[-−]?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s?€(?:\s*(?:im Monat|pro Monat|im Jahr|pro Jahr))?/;
/** Satzende nur nach einem Wort mit mindestens drei Zeichen – „z. B.“ und „ca.“ trennen nicht. */
const SENTENCE = /(?<=[\p{L}\p{N})“"]{3}[.!?])\s+(?=[\p{Lu}•„\d])/u;

export type NoteSummary = {
  /** Erster Satz bzw. erste Zeile (gekürzt) – der nächste Schritt. */
  short: string;
  /** Betrag/Wirkung, falls im Text und nicht schon im ersten Satz. */
  effect: string | null;
  /** Lang genug, um eingeklappt zu werden. */
  long: boolean;
};

const clip = (s: string, max: number) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:–-]+$/, "")} …`;
};

export function noteSummary(notes: string | null | undefined, max = 110): NoteSummary | null {
  const text = (notes ?? "").trim();
  if (!text) return null;
  const lines = text.split(/\n/).filter((l) => l.trim());
  const long = text.length > 140 || lines.length > 2;
  const parts = lines.flatMap((l) => l.trim().split(SENTENCE)).map((s) => s.trim()).filter(Boolean);
  // Ein Betragssatz („Wirkung zusammen ca. 1.200 € im Monat.“) ist die Wirkung, nicht der Schritt. Beträge aus
  // anderen Sätzen werden nicht als Wirkung herausgezogen – sie könnten etwas anderes bedeuten.
  const onlyEffect = (p: string) => MONEY.test(p) && /^(?:Wirkung|Ersparnis|Effekt|Betrag|Summe|Gesamt|Kapital|Umsatz)\b/i.test(p);
  const effectLine = parts.find(onlyEffect);
  const step = parts.find((p) => !onlyEffect(p)) ?? parts[0] ?? text;
  const short = clip(step, max);
  const effect = effectLine ? (effectLine.match(MONEY)?.[0].replace(/\s+/g, " ") ?? null) : null;
  return { short, effect, long };
}
