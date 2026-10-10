"use server";

import { redirect } from "next/navigation";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { pullFeed, refreshMarket } from "@/lib/suppliers/feed-service";
import { titleLookupScanned } from "@/lib/suppliers/scan-service";

/** Keepa-Abgleich im Hintergrund anstoßen (im Rahmen der Tokens). */
export async function keepaRunAction() {
  const session = await requireArea("lieferanten");
  const r = await refreshMarket(session.tenantId);
  redirect(`/lieferanten/chancen?${new URLSearchParams({ meldung: r.note ?? `${r.checked} EANs bei Keepa geprüft, ${r.found} auf amazon.de gefunden${r.waiting ? `, ${r.waiting} warten auf den nächsten Lauf` : ""}${r.tokensLeft !== null ? ` · ${r.tokensLeft} Tokens übrig` : ""}.` })}`);
}

/** Alle Feeds mit Link sofort abrufen. */
export async function pullAllAction() {
  const session = await requireArea("lieferanten");
  const F = schema.supplierFeeds;
  const feeds = await db.select({ id: F.id, name: F.name }).from(F).where(and(eq(F.tenantId, session.tenantId), isNotNull(F.sourceUrl)));
  const msgs: string[] = [];
  for (const f of feeds) {
    try {
      msgs.push(`${f.name}: ${await pullFeed(session.tenantId, f.id)}`);
    } catch (e) {
      msgs.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  void refreshMarket(session.tenantId).catch(() => undefined);
  redirect(`/lieferanten/chancen?${new URLSearchParams({ meldung: msgs.length ? msgs.join(" · ") : "Kein Feed mit Link – auf der Feed-Seite unter „Automatischer Abruf“ eintragen." })}`);
}

/** Von Hand gezogene Artikel, die noch nicht geprüft sind, jetzt einmal bei Keepa nachschlagen. */
export async function keepaScannedAction() {
  const session = await requireArea("lieferanten");
  const t = session.tenantId;
  const O = schema.supplierOffers;
  const back = (msg: string) => redirect(`/lieferanten/chancen?${new URLSearchParams({ quelle: "manuell", meldung: msg })}`);
  const open = await db
    .select({ feedId: O.feedId, ean: O.ean, scannedAt: O.scannedAt })
    .from(O)
    .where(and(eq(O.tenantId, t), eq(O.origin, "scan"), eq(O.active, true), isNull(O.market)));
  if (!open.length) return back("Alle von Hand gezogenen Artikel sind schon geprüft.");
  const eans = [...new Set(open.map((o) => o.ean).filter((e): e is string => Boolean(e)))];
  const r = eans.length ? await refreshMarket(t, { eans }) : { found: 0, checked: 0, tokensLeft: null as number | null };
  let byTitle = 0;
  for (const feedId of [...new Set(open.filter((o) => !o.ean).map((o) => o.feedId))]) {
    byTitle += (await titleLookupScanned(t, feedId, new Date(0))).found;
  }
  back(`${r.checked} EANs geprüft (${r.found} gefunden)${byTitle ? `, ${byTitle} per Titel gefunden – bitte gegenprüfen` : ""}.${r.tokensLeft !== null ? ` ${r.tokensLeft} Tokens übrig.` : ""}`);
}
