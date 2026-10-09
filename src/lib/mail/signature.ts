// Signaturen für ausgehende Mails (Einkaufsanfragen, Nachfassen) – reine Logik ohne Datenbank.

/** Endet der Text schon mit einer Grußformel (z. B. ältere Entwürfe mit eingebauter Signatur)? */
export function hasSignOff(body: string): boolean {
  const tail = body.slice(-700);
  return /(^|\n)\s*(mit freundlichen grüßen|freundliche grüße|beste grüße|viele grüße|herzliche grüße|kind regards|best regards|regards)\b/i.test(tail);
}

/** Eigene Signatur des Postfachs; bei englischen Mails die deutsche Grußformel übersetzen. */
export function signatureFor(signature: string | null | undefined, lang: "de" | "en"): string | null {
  const s = (signature ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return null;
  if (lang === "de") return s;
  return s.replace(/^(mit freundlichen grüßen|freundliche grüße|beste grüße|viele grüße)[ \t]*,?/i, "Kind regards");
}

/** Text + Signatur – nicht doppelt, wenn der Text schon eine Grußformel hat. */
export function withSignature(body: string, signature: string | null): string {
  const b = body.replace(/\s+$/, "");
  if (!signature || hasSignOff(b)) return b;
  return `${b}\n\n${signature}`;
}
