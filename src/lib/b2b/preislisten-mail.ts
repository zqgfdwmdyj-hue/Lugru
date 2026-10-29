import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { FeedMapping } from "@/db/schema";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { isGenericMailDomain } from "@/lib/leads/logic";
import { domainOf } from "@/lib/mail/servers";
import { autoMapping } from "@/lib/suppliers/prices";
import { importTable } from "@/lib/suppliers/feed-service";
import { readTable, type Table } from "@/lib/tabular";
import { upsertSystemTask } from "@/lib/tasks/system";
import { kiSpaltenPrompt, leseKiSpalten } from "./preislisten-logik";

// Antworten von Lieferanten mit Preisliste im Anhang (CSV/Excel): Absender einem Lieferanten zuordnen (Profil-
// E-Mail oder gleiche Firmen-Domain), Spalten erkennen (Regeln, sonst KI), in eine eigene „per Mail“-Preisliste
// des Lieferanten übernehmen. Danach läuft der Keepa-Abgleich wie bei jeder Preisliste; Aufgabe mit Link.

export type MailTabelle = { name: string; data: Uint8Array };

const LP = schema.lieferantenProfile;
const S = schema.suppliers;
const F = schema.supplierFeeds;

/** Lieferant zum Absender: Profil-E-Mail genau, sonst gleiche Domain (nicht bei Freemailern). */
export async function lieferantZuAbsender(tenantId: string, absender: string): Promise<{ supplierId: string; name: string } | null> {
  const a = absender.trim().toLowerCase();
  if (!a.includes("@")) return null;
  const dom = domainOf(a);
  const profile = await db.select({ supplierId: LP.supplierId, email: LP.email, name: S.name, code: S.code }).from(LP).innerJoin(S, eq(S.id, LP.supplierId)).where(and(eq(LP.tenantId, tenantId), sql`${LP.email} is not null`));
  const genau = profile.find((p) => p.email?.toLowerCase() === a);
  const gleich = genau ?? (isGenericMailDomain(dom) ? undefined : profile.find((p) => p.email && domainOf(p.email.toLowerCase()) === dom));
  return gleich ? { supplierId: gleich.supplierId, name: gleich.name ?? gleich.code } : null;
}

/** KI ordnet die Spalten zu (nur wenn die Regeln Artikelnummer/EAN oder Preis nicht finden). */
export async function kiSpalten(tenantId: string, t: Table): Promise<FeedMapping | null> {
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) return null;
  const r = await askClaude(ai.apiKey, kiSpaltenPrompt(t.headers, t.rows.slice(0, 5)), { model: modelFor(ai, "simple"), task: "simple", maxTokens: 600, timeoutMs: 60_000 }).catch(() => null);
  return r ? leseKiSpalten(r.text, t.headers) : null;
}

/** Zuordnung: gespeicherte → Regeln → KI für fehlende Felder. */
export async function spaltenZuordnen(tenantId: string, t: Table, gespeichert: FeedMapping = {}): Promise<{ mapping: FeedMapping; ki: boolean }> {
  const regeln = autoMapping(t.headers, gespeichert);
  // Artikelnummer nur ersatzweise aus der EAN – zählt nicht als erkannt.
  const skuErsatz = regeln.supplierSku !== undefined && regeln.supplierSku === regeln.ean && !gespeichert.supplierSku;
  if (!skuErsatz && regeln.supplierSku && regeln.price && regeln.title && (regeln.ean || regeln.asin)) return { mapping: regeln, ki: false };
  const ki = await kiSpalten(tenantId, t);
  if (!ki) return { mapping: regeln, ki: false };
  // Regeln behalten, KI füllt nur Lücken (auch eine echte Artikelnummer statt der EAN-Ersatzlösung).
  const out: FeedMapping = { ...ki, ...Object.fromEntries(Object.entries(regeln).filter(([k, v]) => v && !(k === "supplierSku" && skuErsatz && ki.supplierSku && ki.supplierSku !== regeln.ean))) };
  if (!out.supplierSku && out.ean) out.supplierSku = out.ean;
  return { mapping: out, ki: true };
}

export async function preislisteAusMail(tenantId: string, m: { messageKey: string; fromAddress: string; subject: string; tabellen: MailTabelle[] }): Promise<{ feedId: string; meldung: string } | null> {
  if (!m.tabellen.length) return null;
  const l = await lieferantZuAbsender(tenantId, m.fromAddress);
  if (!l) return null;
  const name = `${l.name} – Preisliste per Mail`;
  let [feed] = await db.select().from(F).where(and(eq(F.tenantId, tenantId), eq(F.supplierId, l.supplierId), eq(F.name, name)));
  if (!feed) [feed] = await db.insert(F).values({ tenantId, name, supplierId: l.supplierId }).returning();
  const key = `preisliste-mail:${createHash("sha1").update(m.messageKey).digest("hex").slice(0, 16)}`;
  // Größte Tabelle zuerst (Preislisten sind meist der größte Anhang).
  for (const anhang of [...m.tabellen].sort((a, b) => b.data.byteLength - a.data.byteLength)) {
    let t: Table;
    try {
      t = readTable(anhang.data);
    } catch {
      continue;
    }
    if (t.rows.length < 1 || t.headers.length < 2) continue;
    const z = await spaltenZuordnen(tenantId, t, feed.mapping);
    const r = await importTable(tenantId, feed, t, { mapping: z.mapping, full: true });
    await upsertSystemTask(db, tenantId, key, {
      title: r.ok ? `Neue Preisliste von ${l.name} übernommen` : `Preisliste von ${l.name}: Spalten zuordnen`,
      notes: `${anhang.name} · ${m.subject}`.slice(0, 480) + (r.ok ? ` · ${r.message}${z.ki ? " (Spalten per KI erkannt – bitte kurz prüfen)" : ""}` : ""),
      category: "einkauf",
      link: r.ok ? `/b2b/preislisten/${feed.id}` : `/lieferanten/${feed.id}`,
    });
    if (r.ok) return { feedId: feed.id, meldung: r.message };
  }
  return { feedId: feed.id, meldung: "Kein lesbarer Tabellen-Anhang." };
}
