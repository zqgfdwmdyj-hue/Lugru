import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Personenbezogene Daten der Empfänger (Name, Anschrift, Telefon, E-Mail) werden verschlüsselt
// gespeichert: AES-256-GCM, je Wert ein zufälliger 96-Bit-IV, Integritätsschutz über das Auth-Tag.
// Der Schlüssel wird per HKDF-SHA256 aus APP_SECRET abgeleitet (Server-Umgebung, nicht in der
// Datenbank) und ist ein anderer als der für Zugangsdaten. Altbestand im Klartext wird beim Lesen
// erkannt und beim Update (scripts/migrate.ts) verschlüsselt.
//
// Kein "server-only": wird auch vom Migrationsskript und vom Datenbankschema genutzt.

const PREFIX = "pii:v1.";
const FILE_MAGIC = Buffer.from("PIIENC1\0");

let cache: { secret: string; key: Buffer } | null = null;

function piiKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("APP_SECRET fehlt oder ist kürzer als 32 Zeichen.");
  if (cache?.secret !== secret) cache = { secret, key: Buffer.from(hkdfSync("sha256", secret, "seller-system", "pii-at-rest:v1", 32)) };
  return cache.key;
}

function encrypt(plain: Buffer): { iv: Buffer; tag: Buffer; data: Buffer } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", piiKey(), iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return { iv, tag: c.getAuthTag(), data };
}

function decrypt(iv: Buffer, tag: Buffer, data: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", piiKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]);
}

export const isSealedPii = (v: unknown): v is string => typeof v === "string" && v.startsWith(PREFIX);

/** Text verschlüsseln → „pii:v1.<iv>.<tag>.<daten>“ (base64url). */
export function sealPii(plain: string): string {
  if (isSealedPii(plain)) return plain;
  const { iv, tag, data } = encrypt(Buffer.from(plain, "utf8"));
  return PREFIX + [iv, tag, data].map((b) => b.toString("base64url")).join(".");
}

/** Entschlüsseln; Altbestand im Klartext kommt unverändert zurück. */
export function openPii(value: string): string {
  if (!isSealedPii(value)) return value;
  const [iv, tag, data] = value.slice(PREFIX.length).split(".").map((p) => Buffer.from(p, "base64url"));
  return decrypt(iv, tag, data).toString("utf8");
}

export const isSealedBytes = (b: Buffer) => b.length >= FILE_MAGIC.length && b.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);

/** Dateien (Versandetiketten, Importdateien, Belege): Kennung + IV + Tag + Daten. */
export function sealBytes(plain: Buffer): Buffer {
  if (isSealedBytes(plain)) return plain;
  const { iv, tag, data } = encrypt(plain);
  return Buffer.concat([FILE_MAGIC, iv, tag, data]);
}

export function openBytes(stored: Buffer): Buffer {
  if (!isSealedBytes(stored)) return stored;
  const o = FILE_MAGIC.length;
  return decrypt(stored.subarray(o, o + 12), stored.subarray(o + 12, o + 28), stored.subarray(o + 28));
}

/**
 * JSON mit einzelnen verschlüsselten Feldern (z. B. Rechnungen): die genannten Pfade wandern
 * verschlüsselt nach `pii`, alles andere bleibt lesbar (Beträge, Datum, Nummer – für Abfragen).
 */
export function sealJsonPaths<T extends Record<string, unknown>>(obj: T, paths: string[][]): Record<string, unknown> {
  if (!obj || typeof obj !== "object" || typeof (obj as { pii?: unknown }).pii === "string") return obj;
  const out: Record<string, unknown> = structuredClone(obj);
  const taken: Record<string, unknown> = {};
  for (const path of paths) {
    let parent: Record<string, unknown> | undefined = out;
    for (const k of path.slice(0, -1)) parent = parent?.[k] && typeof parent[k] === "object" ? (parent[k] as Record<string, unknown>) : undefined;
    const last = path[path.length - 1];
    if (parent && last in parent) {
      taken[path.join(".")] = parent[last];
      delete parent[last];
    }
  }
  if (!Object.keys(taken).length) return out;
  return { ...out, pii: sealPii(JSON.stringify(taken)) };
}

export function openJsonPaths<T>(stored: unknown): T {
  if (!stored || typeof stored !== "object" || typeof (stored as { pii?: unknown }).pii !== "string") return stored as T;
  const { pii, ...rest } = stored as Record<string, unknown> & { pii: string };
  const out: Record<string, unknown> = structuredClone(rest);
  for (const [dotted, value] of Object.entries(JSON.parse(openPii(pii)) as Record<string, unknown>)) {
    const path = dotted.split(".");
    let parent = out;
    for (const k of path.slice(0, -1)) parent = (parent[k] ??= {}) as Record<string, unknown>;
    parent[path[path.length - 1]] = value;
  }
  return out as T;
}

/** Felder einer Rechnung, die den Käufer/Empfänger betreffen. */
export const INVOICE_PII_PATHS = [["buyer"], ["buyerEmail"], ["buyerUsername"], ["b2b", "buyerAddress"], ["b2b", "buyerEmail"], ["b2b", "buyerVatId"]];
