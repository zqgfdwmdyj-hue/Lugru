/**
 * Zerlegt die frei eingegebene Einkaufsquelle in Rohtext, optionalen Link und
 * Händlernamen. Der Händler kommt aus der Domain, damit verschiedene
 * Produkt-URLs desselben Shops in der Auswertung zusammenfallen.
 *
 * Bewusst nicht gespeichert, sondern beim Lesen berechnet: so lassen sich die
 * Regeln verbessern, ohne die Datenbank anzufassen.
 */
export interface ParsedSource {
  /** Die Eingabe, wie sie getippt wurde (getrimmt). */
  text: string;
  /** Absolute URL, falls im Text ein Link steckt. */
  url?: string;
  /** Anzeige- und Gruppierungsname. */
  merchant: string;
}

/** Ein Label braucht mindestens zwei Zeichen und mindestens einen Buchstaben — sonst hielten wir „12.Mai" für eine Domain. */
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z][a-z0-9-]*)';
const WITH_PROTOCOL = /https?:\/\/\S+/i;
const BARE_DOMAIN = new RegExp(`${LABEL}(?:\\.${LABEL})*\\.[a-z]{2,}(?:\\/\\S*)?`, 'i');

/** TLDs, bei denen der Händlername eine Ebene weiter links steht. */
const SECOND_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'co.za',
]);

function merchantFromHost(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.');
  const lastTwo = labels.slice(-2).join('.');
  const index = SECOND_LEVEL_TLDS.has(lastTwo) ? labels.length - 3 : labels.length - 2;
  const name = labels[Math.max(0, index)] ?? host;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function parseSource(raw: string): ParsedSource | null {
  const text = raw.trim();
  if (text === '') return null;

  const match = WITH_PROTOCOL.exec(text) ?? BARE_DOMAIN.exec(text);
  if (!match) return { text, merchant: text };

  const found = match[0];
  const url = /^https?:\/\//i.test(found) ? found : `https://${found}`;
  try {
    return { text, url, merchant: merchantFromHost(new URL(url).hostname) };
  } catch {
    return { text, merchant: text };
  }
}
