import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { glossarErsetzen, schuetzen, spracheErkennen, uebersetzungsAuftrag, wiederherstellen, type Sprache } from "./sprache";

// Übersetzen für die VA (Deutsch ↔ Englisch) mit kleinem Modell, Glossar und Zwischenspeicher. Nummern, Beträge
// und Links werden vorher durch Platzhalter geschützt und danach unverändert wieder eingesetzt. Ohne KI-Schlüssel
// oder bei Fehlern: Original (ggf. mit Glossar-Ersatz) und `uebersetzt: false`.

export type Uebersetzung = { text: string; uebersetzt: boolean; von: Sprache | null };

const U = schema.uebersetzungen;

export async function uebersetzen(tenantId: string, text: string, nach: Sprache, o: { quelle?: Sprache | null } = {}): Promise<Uebersetzung> {
  const roh = text.trim();
  if (!roh) return { text, uebersetzt: false, von: null };
  const von = o.quelle ?? spracheErkennen(roh);
  if (von === nach) return { text, uebersetzt: false, von };
  const glossar = (await getSettings(tenantId)).va.glossar;
  const hash = createHash("sha256").update(`${nach}\n${JSON.stringify(glossar)}\n${roh}`).digest("hex").slice(0, 40);
  const [alt] = await db.select({ text: U.text }).from(U).where(and(eq(U.tenantId, tenantId), eq(U.hash, hash), eq(U.nach, nach)));
  if (alt) return { text: alt.text, uebersetzt: true, von };
  const ai = (await getIntegration(tenantId, "anthropic")) as { apiKey?: string; tier?: string; model?: string } | null;
  if (!ai?.apiKey) return { text: glossarErsetzen(roh, glossar, nach), uebersetzt: false, von };
  const { text: geschuetzt, teile } = schuetzen(roh);
  try {
    const r = await askClaude(ai.apiKey, uebersetzungsAuftrag(geschuetzt, nach, glossar), { model: modelFor(ai, "simple"), task: "simple", maxTokens: 2000, timeoutMs: 30_000 });
    const fertig = wiederherstellen(r.text.trim(), teile);
    if (!fertig) return { text: roh, uebersetzt: false, von };
    await db.insert(U).values({ tenantId, hash, nach, text: fertig }).onConflictDoNothing();
    return { text: fertig, uebersetzt: true, von };
  } catch (e) {
    console.error("[VA] Übersetzung:", e instanceof Error ? e.message : e);
    return { text: roh, uebersetzt: false, von };
  }
}

/** Sprache der VA: Sprache ihres Kontos, sonst Einstellung „Sprache der VA“ (Standard Englisch). */
export async function vaSprache(tenantId: string, vaUserId: string | null): Promise<Sprache> {
  if (vaUserId) {
    const [u] = await db.select({ sprache: schema.users.sprache }).from(schema.users).where(eq(schema.users.id, vaUserId));
    if (u?.sprache === "de" || u?.sprache === "en") return u.sprache;
  }
  return (await getSettings(tenantId)).va.sprache;
}
