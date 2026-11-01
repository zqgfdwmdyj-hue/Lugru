// B24: Anmeldung der Browser-Automatik (BQool, sellerboard, ArbitrageOne) – reine Logik, getestet in
// tests/automatik-login.test.ts: Captcha/Cloudflare erkennen, Cookie-Banner und Anmelde-Knöpfe am Text erkennen,
// Name und Aufbewahrung der Fehler-Bildschirmfotos.

/** Seitentitel einer Browser-Prüfung (Cloudflare „Just a moment…“, „Attention Required“ …). */
export const CAPTCHA_TITEL = /just a moment|attention required|nur einen moment|einen moment bitte|checking your browser|verify you are human|sicherheitsüberprüfung|are you a robot|bist du ein mensch/i;

/** DOM-Merkmale einer Browser-Prüfung (Turnstile, hCaptcha, reCAPTCHA, Cloudflare-Challenge). */
export const CAPTCHA_DOM = 'iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], .cf-turnstile, .h-captcha, .g-recaptcha, #challenge-form, #cf-challenge-running';

/** Cookie-Banner: Knopf zum Zustimmen. */
export const COOKIE_KNOPF = /^\s*(alle\s+)?(cookies\s+)?(akzeptieren|annehmen|zustimmen|erlauben|zulassen|accept(\s+all)?(\s+cookies)?|allow(\s+all)?(\s+cookies)?|agree|i\s+agree|einverstanden|ok(ay)?(,?\s*verstanden)?|got\s+it)\s*$/i;

/** Anmelde- bzw. Weiter-Knopf am Text. */
export const ANMELDE_KNOPF = /^\s*(log\s?in|login|anmelden|einloggen|sign\s?in|weiter|continue|next|submit|absenden)\s*$/i;

/** Wartezeit auf das Anmeldeformular (Bauauftrag: 60 s; in den Ablaufprüfungen kürzer). */
export const anmeldeWarten = () => Math.max(1000, Number(process.env.AUTOMATIK_WARTEN_MS || 60_000));

export const DEBUG_TAGE = 7;

/** Name eines Fehler-Bildschirmfotos: Zeit (UTC, sekundengenau) + Dienst, nur [a-z0-9-]. */
export function debugName(zeit: Date, dienst: string, zufall: string): string {
  const z = zeit.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const d = dienst
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${z}-${d || "automatik"}-${zufall.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}`;
}

export const DEBUG_NAME = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-z0-9-]{1,40}$/;

/** Adresse ohne Abfrageteil (keine Tokens in Meldungen und Aufgaben). */
export function seiteOhneQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0].slice(0, 200);
  }
}

/** Fehlermeldung mit Verweis auf das Bildschirmfoto. */
export function mitBildschirmfoto(grund: string, d: { pfad: string; titel: string; url: string } | null): string {
  if (!d) return grund;
  return `${grund} – Bildschirmfoto: ${d.pfad} (Seite „${d.titel || "ohne Titel"}“, ${d.url})`;
}

/** Ist ein Fehler-Bildschirmfoto älter als 7 Tage? */
export const debugAbgelaufen = (erstellt: Date, jetzt = new Date()) => jetzt.getTime() - erstellt.getTime() > DEBUG_TAGE * 86_400_000;
