import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Passwörter nie im Klartext speichern: scrypt mit zufälligem Salz. Format: scrypt$<salz>$<hash> (base64url).

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const LEN = 32;

export const MIN_PASSWORD = 8;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, LEN);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Anmeldename: klein, ohne Leerzeichen – „Anna Müller“ → „anna.müller“. */
export function normalizeLogin(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ".").replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 40);
}
