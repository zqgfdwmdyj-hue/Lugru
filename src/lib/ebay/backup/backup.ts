import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Datensicherung. Im bisherigen Tool eine Kopie der SQLite-Datei; hier sichert der
 * Container „backup" (siehe docker-compose.yml) täglich die ganze Datenbank mit pg_dump –
 * alle Bereiche, nicht nur eBay. Die App liest nur den Ordner und stößt eine Sicherung an.
 *
 * Absprache über Dateien im Sicherungsordner:
 *   .keep    Anzahl der aufzubewahrenden Sicherungen (von hier geschrieben)
 *   .jetzt   „Jetzt sichern" angefordert (von hier geschrieben, vom Container gelöscht)
 *   .letzte  Unix-Zeit der letzten erfolgreichen Sicherung (vom Container)
 *   .status  „ok" oder Fehlermeldung des letzten Laufs (vom Container)
 */

export interface BackupSettings {
  keep?: number;
}

export interface BackupStatus {
  at: string;
  file?: string;
  error?: string;
  requested?: boolean;
}

export interface BackupFile {
  name: string;
  size: number;
  at: string;
}

export const DEFAULT_KEEP = 30;

export function backupDir(): string | null {
  return process.env.BACKUP_DIR || null;
}

const read = (dir: string, name: string) => {
  try {
    return readFileSync(join(dir, name), "utf8").trim();
  } catch {
    return null;
  }
};

export function getBackupSettings(dir: string | null): BackupSettings {
  const keep = dir ? Number(read(dir, ".keep")) : NaN;
  return Number.isInteger(keep) && keep > 0 ? { keep } : {};
}

export function saveBackupSettings(dir: string | null, body: Record<string, unknown>): BackupSettings {
  if (!dir) throw new Error("Die Sicherung läuft nur in der Server-Installation (Docker).");
  const keep = body.keep === "" || body.keep == null ? undefined : Number(body.keep);
  if (keep !== undefined && !(Number.isInteger(keep) && keep >= 1 && keep <= 365)) {
    throw new Error("Die Anzahl der Sicherungen muss zwischen 1 und 365 liegen.");
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".keep"), String(keep ?? DEFAULT_KEEP));
  return { keep };
}

export function listBackups(dir: string | null): BackupFile[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".dump"))
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function getBackupStatus(dir: string | null): BackupStatus | null {
  if (!dir) return null;
  const last = Number(read(dir, ".letzte"));
  const status = read(dir, ".status");
  const requested = existsSync(join(dir, ".jetzt"));
  if (!last && !status && !requested) return null;
  const newest = listBackups(dir)[0];
  return {
    at: last ? new Date(last * 1000).toISOString() : new Date().toISOString(),
    file: newest ? join(dir, newest.name) : undefined,
    error: status && status !== "ok" ? `Sicherung fehlgeschlagen: ${status}` : undefined,
    requested,
  };
}

/** Fordert beim Sicherungs-Container eine Sicherung an; er prüft jede Minute. */
export function runBackup(dir: string | null): BackupStatus {
  if (!dir) throw new Error("Die Sicherung läuft nur in der Server-Installation (Docker).");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".jetzt"), new Date().toISOString());
  return { at: new Date().toISOString(), requested: true };
}
