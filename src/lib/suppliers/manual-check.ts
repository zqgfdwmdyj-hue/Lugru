import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OfferMarket } from "@/db/schema";
import { keepaKey, keepaSearch } from "@/lib/integrations/clients/keepa";
import { KEEPA_MIN_TOKENS, refreshMarket } from "./feed-service";
import { searchTerm } from "./scan";

// Von Hand gezogene Artikel (Seller-Knopf) einmal bei Keepa prüfen – im Hintergrund, mit Stand
// zum Anzeigen. Mit EAN 1 Token je Code, ohne EAN Titelsuche (ca. 10 Tokens je Artikel). Werden
// die Tokens knapp, pausiert die Prüfung; der stündliche Takt macht mit dem Rest weiter.

const O = schema.supplierOffers;
/** Tokens, die für den regelmäßigen Abgleich der Listen übrig bleiben sollen. */
const RESERVE = KEEPA_MIN_TOKENS + 10;

export type ManualRun = {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  found: number;
  byTitle: number;
  tokensLeft: number | null;
  /** Kurz, was gerade passiert bzw. warum es angehalten hat. */
  note: string;
  paused: boolean;
};

const g = globalThis as typeof globalThis & { __manualCheck?: Map<string, ManualRun> };
const runs = (g.__manualCheck ??= new Map<string, ManualRun>());
export const manualCheckStatus = (tenantId: string) => runs.get(tenantId) ?? null;

/** Was noch ungeprüft ist – mit und ohne EAN (für die Token-Schätzung). */
export async function manualBacklog(tenantId: string) {
  const [r] = (
    await db.execute<{ total: number; with_ean: number }>(sql`
      select count(*)::int as total, count(*) filter (where ean is not null)::int as with_ean
        from supplier_offers where tenant_id = ${tenantId} and origin = 'scan' and active and market is null`)
  ).rows;
  return { total: r.total, withEan: r.with_ean, withoutEan: r.total - r.with_ean, tokensNeeded: r.with_ean + (r.total - r.with_ean) * 10 };
}

/** Prüfung anstoßen (läuft schon eine, bleibt es bei der). Kommt sofort zurück. */
export function startManualCheck(tenantId: string, opts: { titleLimit?: number } = {}): ManualRun {
  const cur = runs.get(tenantId);
  if (cur?.running) return cur;
  const run: ManualRun = { running: true, startedAt: new Date().toISOString(), finishedAt: null, total: 0, done: 0, found: 0, byTitle: 0, tokensLeft: null, note: "Starte …", paused: false };
  runs.set(tenantId, run);
  void runManualCheck(tenantId, run, opts)
    .catch((e) => {
      run.note = e instanceof Error ? e.message : String(e);
      run.paused = /Tokens/i.test(run.note);
    })
    .finally(() => {
      run.running = false;
      run.finishedAt = new Date().toISOString();
    });
  return run;
}

/** Abarbeiten: erst alle EANs (günstig), dann Titelsuche bis `titleLimit`. Auch vom Takt genutzt. */
export async function runManualCheck(tenantId: string, run: ManualRun = { running: true, startedAt: new Date().toISOString(), finishedAt: null, total: 0, done: 0, found: 0, byTitle: 0, tokensLeft: null, note: "", paused: false }, opts: { titleLimit?: number } = {}): Promise<ManualRun> {
  const key = await keepaKey(tenantId);
  if (!key) {
    run.note = "Kein Keepa-Schlüssel – unter Anbindungen → Keepa eintragen.";
    return run;
  }
  const rows = await db
    .select({ id: O.id, ean: O.ean, title: O.title })
    .from(O)
    .where(and(eq(O.tenantId, tenantId), eq(O.origin, "scan"), eq(O.active, true), isNull(O.market)));
  run.total = rows.length;
  if (!rows.length) {
    run.note = "Alles schon geprüft.";
    return run;
  }
  const low = () => run.tokensLeft !== null && run.tokensLeft < RESERVE;
  const pause = () => {
    run.paused = true;
    run.note = `Keepa-Tokens knapp (${run.tokensLeft}) – pausiert, geht stündlich automatisch weiter.`;
    return run;
  };

  // 1) Mit EAN: 100 Codes je Abfrage.
  const byEan = new Map<string, number>();
  for (const r of rows) if (r.ean) byEan.set(r.ean, (byEan.get(r.ean) ?? 0) + 1);
  const eans = [...byEan.keys()];
  for (let n = 0; n < eans.length; n += 100) {
    if (low()) return pause();
    const batch = eans.slice(n, n + 100);
    run.note = `Prüfe EANs bei Keepa (${Math.min(n + 100, eans.length)} von ${eans.length}) …`;
    const r = await refreshMarket(tenantId, { eans: batch });
    run.tokensLeft = r.tokensLeft;
    run.found += r.found;
    run.done += batch.reduce((s, e) => s + (byEan.get(e) ?? 0), 0);
  }

  // 2) Ohne EAN: Titelsuche, einzeln.
  const noEan = rows.filter((r) => !r.ean && r.title).slice(0, opts.titleLimit ?? 200);
  for (const [i, r] of noEan.entries()) {
    if (low()) return pause();
    run.note = `Suche ohne EAN per Titel (${i + 1} von ${noEan.length}) …`;
    const res = await keepaSearch(key, searchTerm(r.title!));
    run.tokensLeft = res.tokensLeft;
    const mp = res.products[0];
    const market: OfferMarket = mp
      ? { checkedAt: new Date().toISOString(), asin: mp.asin, title: mp.title, price: mp.price, fbaFee: mp.fbaFee, referralPct: mp.referralPct, monthlySold: mp.monthlySold, salesRank: mp.salesRank, items: mp.items ?? null, netG: mp.netG ?? null, byTitle: true }
      : { checkedAt: new Date().toISOString(), asin: null, price: null, fbaFee: null, referralPct: null, monthlySold: null, salesRank: null, byTitle: true };
    await db.update(O).set({ market }).where(and(eq(O.id, r.id), eq(O.tenantId, tenantId)));
    run.done++;
    if (mp) {
      run.found++;
      run.byTitle++;
    }
  }
  const left = run.total - run.done;
  run.note = left > 0 ? `Fertig für diesmal – ${left} ohne EAN folgen im nächsten Durchgang.` : "Fertig.";
  return run;
}

/** Takt (stündlich, nach dem Abgleich der Listen): Rest der einmaligen Prüfung, sparsam. */
export async function continueManualCheck(tenantId: string) {
  if (runs.get(tenantId)?.running) return { skipped: true };
  const backlog = await manualBacklog(tenantId);
  if (!backlog.total) return { skipped: true };
  const run = startManualCheck(tenantId, { titleLimit: 30 });
  // Im Takt auf das Ende warten, damit der nächste Schritt nicht parallel Tokens verbraucht.
  while (run.running) await new Promise((r) => setTimeout(r, 500));
  return { done: run.done, found: run.found, note: run.note };
}
