/** eBay nimmt höchstens 500.000 Zeichen Beschreibung an. */
export const MAX_DESCRIPTION_LENGTH = 500_000;

/**
 * Was eBay als „aktive Inhalte" ablehnt. Besser hier mit verständlicher
 * Meldung abweisen als erst beim Veröffentlichen mit einem eBay-Fehlercode.
 */
const FORBIDDEN: { pattern: RegExp; label: string }[] = [
  { pattern: /<script\b/i, label: '<script>' },
  { pattern: /<iframe\b/i, label: '<iframe>' },
  { pattern: /<(object|embed|applet)\b/i, label: '<object>/<embed>' },
  { pattern: /<form\b/i, label: '<form>' },
  { pattern: /<(meta|base)\b/i, label: '<meta>/<base>' },
  // Nur innerhalb eines Tags — „online=ja" im Fließtext ist harmlos.
  { pattern: /<[^>]*\son[a-z]+\s*=/i, label: 'Event-Attribute wie onclick=' },
  { pattern: /javascript\s*:/i, label: 'javascript:-Links' },
];

/**
 * Prüft eine selbst eingefügte HTML-Beschreibung. Gibt den bereinigten Text
 * zurück oder wirft mit einer Meldung, die sagt, was raus muss.
 */
export function parseDescriptionHtml(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Die Beschreibung muss Text sein.');
  const html = value.trim();
  if (html === '') throw new Error('Die Beschreibung darf nicht leer sein.');
  if (html.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Die Beschreibung ist zu lang (${html.length.toLocaleString('de-DE')} Zeichen, eBay erlaubt 500.000).`);
  }
  const found = FORBIDDEN.filter((f) => f.pattern.test(html)).map((f) => f.label);
  if (found.length > 0) {
    throw new Error(`eBay erlaubt keine aktiven Inhalte in der Beschreibung — bitte entfernen: ${found.join(', ')}.`);
  }
  return html;
}
