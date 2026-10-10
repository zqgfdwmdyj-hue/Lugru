"use server";

import { redirect } from "next/navigation";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { pullFeed, refreshMarket, refreshPackData } from "@/lib/suppliers/feed-service";
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

/** Stückzahl/Inhalt der Amazon-Angebote bei Keepa nachladen (für Treffer mit unplausiblem ROI). */
export async function packRefreshAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const ids = String(fd.get("ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const back = String(fd.get("back") ?? "");
  const r = await refreshPackData(session.tenantId, ids);
  const msg = r.note ?? `Keepa: ${r.asked} Amazon-Angebote abgefragt, bei ${r.found} Stückzahl bzw. Inhalt gefunden – neu gerechnet.${r.tokensLeft !== null ? ` · ${r.tokensLeft} Tokens übrig` : ""}`;
  const qs = new URLSearchParams(back.startsWith("?") ? back.slice(1) : "");
  qs.delete("meldung");
  qs.set("meldung", msg);
  redirect(`/lieferanten/chancen?${qs}`);
}
