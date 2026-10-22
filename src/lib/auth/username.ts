// Anmeldename: ein Benutzername (z. B. „lager1“) oder eine E-Mail-Adresse. Gespeichert in
// users.email, immer klein geschrieben – Groß/Klein spielt beim Anmelden keine Rolle.

export const LOGIN_MIN = 3;
export const LOGIN_MAX = 60;
/** Mindestlänge für Passwörter, die der Inhaber für Mitarbeiter vergibt. */
export const STAFF_PASSWORD_MIN = 8;

export function normalizeLogin(raw: unknown): string {
  return String(raw ?? "").normalize("NFC").trim().toLowerCase();
}

export const isEmailLogin = (login: string) => login.includes("@");

/** Fehlertext für einen neuen Anmeldenamen, sonst null. */
export function loginNameError(login: string): string | null {
  if (login.length < LOGIN_MIN) return `Benutzername: mindestens ${LOGIN_MIN} Zeichen.`;
  if (login.length > LOGIN_MAX) return `Benutzername: höchstens ${LOGIN_MAX} Zeichen.`;
  if (!/^[\p{L}\p{N}._@+-]+$/u.test(login)) return "Benutzername: nur Buchstaben, Ziffern und . _ - (keine Leerzeichen).";
  if (isEmailLogin(login) && !/^[^@]+@[^@]+\.[^@.]+$/.test(login)) return "E-Mail-Adresse ist unvollständig – oder einfach einen Benutzernamen ohne @ nehmen.";
  return null;
}

/** Fehlertext für ein vergebenes Passwort, sonst null. */
export function passwordError(pw: string, min = STAFF_PASSWORD_MIN): string | null {
  if (pw.length < min) return `Passwort: mindestens ${min} Zeichen.`;
  if (pw.length > 200) return "Passwort: höchstens 200 Zeichen.";
  return null;
}
