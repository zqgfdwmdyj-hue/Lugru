import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Medienablage für Fotos und Videos (Retouren-Station): Dateien liegen verschlüsselt (AES-256-GCM, Schlüssel aus
// APP_SECRET) im Ordner MEDIA_DIR – nicht in der Datenbank, damit die tägliche Sicherung klein bleibt. Versand-
// etiketten enthalten Namen und Adressen: deshalb nie unverschlüsselt auf die Platte und nie öffentlich erreichbar.
//
// Format je Datei: „SM1“ + IV (12 Byte) + Prüfwert (16 Byte) + verschlüsselte Daten.

const MAGIC = Buffer.from("SM1");

export function medienOrdner(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "medien"));
}

function schluessel(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("APP_SECRET fehlt oder ist kürzer als 32 Zeichen.");
  return createHash("sha256").update(`medien:${secret}`).digest();
}

/** Pfad innerhalb der Ablage – nur Mandant/Monat/UUID, nie etwas aus Eingaben. */
function voll(key: string): string {
  if (!/^[0-9a-f-]{36}\/\d{4}-\d{2}\/[0-9a-f-]{36}(\.(\d{1,4}|k))?$/.test(key)) throw new Error("Ungültiger Ablage-Schlüssel.");
  return path.join(/*turbopackIgnore: true*/ medienOrdner(), key);
}

export function neuerSchluessel(tenantId: string, jetzt = new Date()): string {
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error("Ungültige Mandanten-ID.");
  return `${tenantId}/${jetzt.toISOString().slice(0, 7)}/${randomUUID()}`;
}

export function verschluesseln(daten: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", schluessel(), iv);
  const enc = Buffer.concat([c.update(daten), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), enc]);
}

export function entschluesseln(buf: Buffer): Buffer {
  if (buf.length < 31 || !buf.subarray(0, 3).equals(MAGIC)) throw new Error("Unbekanntes Format in der Medienablage.");
  const d = createDecipheriv("aes-256-gcm", schluessel(), buf.subarray(3, 15));
  d.setAuthTag(buf.subarray(15, 31));
  return Buffer.concat([d.update(buf.subarray(31)), d.final()]);
}

export async function speichern(key: string, daten: Uint8Array): Promise<void> {
  const p = voll(key);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(p), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ p, verschluesseln(daten), { mode: 0o600 });
}

export async function lesen(key: string): Promise<Buffer> {
  return entschluesseln(await readFile(/*turbopackIgnore: true*/ voll(key)));
}

export async function vorhanden(key: string): Promise<boolean> {
  return stat(/*turbopackIgnore: true*/ voll(key)).then(() => true, () => false);
}

export async function loeschen(key: string): Promise<void> {
  await rm(/*turbopackIgnore: true*/ voll(key), { force: true });
}

/** Teil n (1, 2, …) eines Videos. */
export const teilSchluessel = (key: string, n: number) => `${key}.${n}`;
/** Verkleinerte Fassung eines Fotos (lange Kante ~1600 px) für die KI. */
export const kleinSchluessel = (key: string) => `${key}.k`;
