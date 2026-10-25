import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";

// Doppeltipp / erneutes Absenden: Das Formular schickt einen Einmal-Schlüssel mit. Gleicher Schlüssel = dieselbe
// Eingabe → es wird nur einmal gebucht, die zweite Anfrage bekommt das Ergebnis der ersten.

const FS = schema.formSubmissions;
const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Schlüssel aus dem Formular (Feld `submitKey`); ungültig/fehlend → null (dann ohne Schutz, wie bisher). */
export function submitKeyOf(fd: FormData): string | null {
  const k = String(fd.get("submitKey") ?? "");
  return KEY_RE.test(k) ? k : null;
}

/**
 * Führt `run` je Schlüssel genau einmal aus. Ein Fehlschlag (`ok: false` oder Ausnahme) gibt den Schlüssel
 * wieder frei, damit die korrigierte Eingabe neu abgeschickt werden kann.
 */
export async function onceOnly<T extends { ok: boolean }>(tenantId: string, key: string | null, run: () => Promise<T>, busy: T): Promise<T> {
  if (!key) return run();
  const mine = await db.insert(FS).values({ tenantId, key }).onConflictDoNothing().returning({ id: FS.id });
  if (!mine.length) {
    // Schon abgeschickt: auf das Ergebnis der ersten Anfrage warten (läuft evtl. noch).
    for (let i = 0; i < 40; i++) {
      const [row] = await db.select({ result: FS.result }).from(FS).where(and(eq(FS.tenantId, tenantId), eq(FS.key, key)));
      if (!row) return run(); // erste Anfrage ist fehlgeschlagen → diese darf es neu versuchen
      if (row.result) return row.result as T;
      await sleep(250);
    }
    return busy;
  }
  const where = and(eq(FS.tenantId, tenantId), eq(FS.key, key));
  try {
    const res = await run();
    if (res.ok) await db.update(FS).set({ result: res }).where(where);
    else await db.delete(FS).where(where);
    // Aufräumen: alte Schlüssel weg (klein halten).
    if (Math.random() < 0.05) await db.delete(FS).where(and(eq(FS.tenantId, tenantId), lt(FS.createdAt, new Date(Date.now() - 2 * 86_400_000))));
    return res;
  } catch (e) {
    await db.delete(FS).where(where);
    throw e;
  }
}
