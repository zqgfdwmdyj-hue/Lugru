"use server";

import { redirect } from "next/navigation";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { pullFeed, refreshMarket } from "@/lib/suppliers/feed-service";
import { manualBacklog, startManualCheck } from "@/lib/suppliers/manual-check";

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

/** Von Hand gezogene Artikel, die noch nicht geprüft sind, einmal bei Keepa nachschlagen – im Hintergrund. */
export async function keepaScannedAction() {
  const session = await requireArea("lieferanten");
  const backlog = await manualBacklog(session.tenantId);
  const msg = backlog.total
    ? (() => {
        startManualCheck(session.tenantId);
        return `Prüfung läuft im Hintergrund: ${backlog.total} Artikel (${backlog.withEan} mit EAN, ${backlog.withoutEan} per Titel) – Fortschritt siehe unten.`;
      })()
    : "Alle von Hand gezogenen Artikel sind schon geprüft.";
  redirect(`/lieferanten/chancen?${new URLSearchParams({ quelle: "manuell", meldung: msg })}`);
}
