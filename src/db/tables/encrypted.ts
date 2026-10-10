import { customType } from "drizzle-orm/pg-core";
import { INVOICE_PII_PATHS, isSealedPii, openBytes, openJsonPaths, openPii, sealBytes, sealJsonPaths, sealPii } from "@/lib/pii";

// Spaltentypen, die beim Schreiben verschlüsseln und beim Lesen entschlüsseln (siehe src/lib/pii.ts).
// Die Anwendung sieht Klartext; in der Datenbank (und in Sicherungen) steht nur Chiffretext.
// Achtung: In SQL kann über diese Spalten nicht gesucht oder verglichen werden.

/** Text, verschlüsselt. */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (v) => sealPii(v),
  fromDriver: (v) => openPii(v),
});

/** jsonb kommt vom Treiber normalerweise schon geparst; zur Sicherheit auch als Text annehmen. */
function parsed(v: unknown): unknown {
  if (typeof v !== "string" || isSealedPii(v)) return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** JSON-Objekt, als Ganzes verschlüsselt (gespeichert als jsonb-Zeichenkette „pii:v1.…“). */
export const encryptedJson = <T>(name: string) =>
  customType<{ data: T; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver: (v) => JSON.stringify(sealPii(JSON.stringify(v))),
    fromDriver: (v) => {
      const p = parsed(v);
      return (isSealedPii(p) ? JSON.parse(openPii(p)) : p) as T;
    },
  })(name);

/** Rechnungsinhalt: Käuferdaten verschlüsselt, Beträge/Datum/Nummer/`b2b` bleiben für Abfragen lesbar. */
export const invoiceJson = <T>(name: string) =>
  customType<{ data: T; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver: (v) => JSON.stringify(sealJsonPaths(v as Record<string, unknown>, INVOICE_PII_PATHS)),
    fromDriver: (v) => openJsonPaths<T>(parsed(v)),
  })(name);

/** Dateiinhalt (bytea), verschlüsselt. */
export const encryptedBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (v) => sealBytes(v),
  fromDriver: (v) => openBytes(v),
});
