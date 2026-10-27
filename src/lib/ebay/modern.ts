import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordJob } from "@/lib/today/jobs";
import { ListingScopeError } from "./listing-api";

// Umstieg auf eBays neue Schnittstellen (Listing API/GraphQL, Media API) mit Rückfall: Zuerst der neue Weg;
// schlägt er fehl (fehlende Berechtigung, Ausfall, unerwartete Antwort), läuft derselbe Vorgang über die
// bisherige Trading API – nichts bleibt liegen. Was zuletzt passiert ist, steht unter eBay → eBay-Einstellungen
// → Verbindung („Neue eBay-Schnittstelle“). Notbremse: EBAY_TRADING_ONLY=1 nutzt nur noch den alten Weg.

export const MODERN_JOB = "eBay: neue Schnittstelle";
const SCOPE_PAUSE_MS = 30 * 60_000;
const OK_RECORD_MS = 10 * 60_000;
const g = globalThis as unknown as { __ebayModern?: { noScopeUntil: Map<string, number>; lastOk: Map<string, number> } };
const state = (g.__ebayModern ??= { noScopeUntil: new Map(), lastOk: new Map() });

export const tradingOnly = () => process.env.EBAY_TRADING_ONLY === "1";

/**
 * Neuer Weg mit Rückfall. `granted === false`: Die Verbindung hat die neue Berechtigung sicher nicht – dann
 * gleich der alte Weg (ohne Fehlermeldung). Fehlt die Berechtigung laut eBay, wird 30 Minuten lang nicht
 * erneut gefragt.
 */
export async function withModern<T>(tenantId: string, label: string, modern: () => Promise<T>, legacy: () => Promise<T>, granted: boolean | null = null): Promise<T> {
  const until = state.noScopeUntil.get(tenantId) ?? 0;
  if (tradingOnly() || granted === false || until > Date.now()) return legacy();
  try {
    const r = await modern();
    const last = state.lastOk.get(tenantId) ?? 0;
    if (Date.now() - last > OK_RECORD_MS) {
      state.lastOk.set(tenantId, Date.now());
      void recordJob(tenantId, MODERN_JOB, null);
    }
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof ListingScopeError) state.noScopeUntil.set(tenantId, Date.now() + SCOPE_PAUSE_MS);
    console.warn(`[eBay] ${label}: neue Schnittstelle fehlgeschlagen, nutze Trading API – ${msg}`);
    void recordJob(tenantId, MODERN_JOB, `${label}: ${msg} (bisherige Schnittstelle genutzt)`);
    return legacy();
  }
}

export type ModernStatus = { tradingOnly: boolean; lastOkAt: string | null; lastErrorAt: string | null; lastError: string | null };

/** Letzter Erfolg bzw. Rückfall der neuen Schnittstelle – für die Verbindungsseite. */
export async function modernStatus(tenantId: string): Promise<ModernStatus> {
  const J = schema.jobRuns;
  const [j] = await db.select().from(J).where(and(eq(J.tenantId, tenantId), eq(J.name, MODERN_JOB))).limit(1);
  return { tradingOnly: tradingOnly(), lastOkAt: j?.lastOkAt?.toISOString() ?? null, lastErrorAt: j?.lastErrorAt?.toISOString() ?? null, lastError: j?.lastError ?? null };
}
