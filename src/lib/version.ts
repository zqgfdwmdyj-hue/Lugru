import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Programmstand (Commit und Datum) – schreibt deploy/update.sh vor dem Bauen in die Datei VERSION. Zeigt in der
// Seitenleiste, ob ein Update wirklich läuft. Lokal ohne Datei: nichts.
let cached: string | null | undefined;

export function appVersion(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = readFileSync(join(process.cwd(), "VERSION"), "utf8").trim().slice(0, 60) || null;
  } catch {
    cached = null;
  }
  return cached;
}
