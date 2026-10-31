import "server-only";
import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaudeWithWeb, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { namensKern, telefonAus, telefonAusSignatur } from "./logic";

// Telefonnummer für Anruf-Aufgaben vorschlagen (B17): Lieferanten-Profil → Kontakte (Hersteller-Register) → Signatur
// in Mails des Absenders → auf Knopfdruck Websuche. Ein Vorschlag wird nie von selbst gespeichert – erst nach
// Bestätigung (Knopf bzw. ausdrückliche Angabe an Claude).

export type TelefonVorschlag = { nummer: string; quelle: string; art: "lieferant" | "kontakt" | "mail" | "web" };

const like = (s: string) => `%${s.replace(/[%_\\]/g, "")}%`;

/** `mails: false` = ohne Mail-Signaturen (Personen ohne Posteingang-Zugriff). */
export async function telefonVorschlag(tenantId: string, name: string, o: { web?: boolean; mails?: boolean } = {}): Promise<TelefonVorschlag | null> {
  const n = name.trim();
  if (!n) return null;
  const kern = namensKern(n);
  const L = schema.lieferantenProfile;
  const S = schema.suppliers;
  const lief = await db.select({ name: S.name, code: S.code, telefon: L.telefon }).from(L).innerJoin(S, eq(S.id, L.supplierId)).where(and(eq(L.tenantId, tenantId), isNotNull(L.telefon)));
  const l = lief.find((x) => [x.name, x.code].some((v) => v && v.length >= 3 && (n.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(n.toLowerCase()))));
  if (l?.telefon) return { nummer: l.telefon, quelle: `Lieferanten-Profil ${l.name}`, art: "lieferant" };
  if (kern) {
    const LE = schema.supplierLeads;
    const [k] = await db.select({ name: LE.companyName, phone: LE.phone }).from(LE).where(and(eq(LE.tenantId, tenantId), isNotNull(LE.phone), ilike(LE.companyName, like(kern)))).limit(1);
    if (k?.phone) {
      const nr = telefonAus(k.phone) ?? k.phone;
      return { nummer: nr, quelle: `Kontakt ${k.name}`, art: "kontakt" };
    }
    const E = schema.emails;
    const mails = o.mails === false ? [] : await db
      .select({ from: E.fromAddress, fromName: E.fromName, body: E.bodyText, receivedAt: E.receivedAt })
      .from(E)
      .where(and(eq(E.tenantId, tenantId), or(ilike(E.fromName, like(kern)), ilike(E.fromAddress, like(kern.toLowerCase()))), sql`${E.bodyText} is not null`))
      .orderBy(desc(E.receivedAt))
      .limit(20);
    for (const m of mails) {
      const nr = telefonAusSignatur(m.body ?? "");
      if (nr) return { nummer: nr, quelle: `Signatur einer Mail von ${m.fromName || m.from || "Absender"} vom ${m.receivedAt.toISOString().slice(0, 10)}`, art: "mail" };
    }
  }
  if (!o.web) return null;
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) return null;
  const prompt = `Suche die offizielle Telefonnummer (Kundenservice/Hotline in Deutschland) von: ${n}.\nAntworte in genau einer Zeile: NUMMER | QUELLE-URL. Wenn du keine verlässliche Nummer findest: KEINE.`;
  const r = await askClaudeWithWeb(ai.apiKey, prompt, { model: modelFor(ai, "simple"), maxSearches: 3, maxTokens: 300, timeoutMs: 60_000 });
  if (/^\s*KEINE\b/i.test(r.text)) return null;
  const nr = telefonAus(r.text);
  if (!nr) return null;
  const url = /https?:\/\/\S+/.exec(r.text)?.[0] ?? r.sources[0] ?? null;
  return { nummer: nr, quelle: `Websuche${url ? ` (${url.replace(/[).,]+$/, "")})` : ""} – bitte prüfen`, art: "web" };
}

export type AnrufHinweis = { vorschlag: TelefonVorschlag | null };

/**
 * Für die Aufgabenliste: offene Anruf-Aufgaben ohne Nummer (weder in der Aufgabe noch in der Notiz) mit Vorschlag aus
 * Kontakten/Mails. Nummern aus dem Lieferanten-Profil gelten als bekannt (wie bei „Anrufe in der Fahrzeit“).
 */
export async function anrufHinweise(tenantId: string, tasks: { id: string; title: string; notes: string | null; status?: string; telefon?: string | null }[], o: { mails?: boolean } = {}): Promise<Map<string, AnrufHinweis>> {
  const { anrufName, istAnruf } = await import("./logic");
  const out = new Map<string, AnrufHinweis>();
  const offen = tasks.filter((t) => t.status !== "done" && istAnruf(t.title) && !t.telefon && !telefonAus(t.notes ?? "")).slice(0, 10);
  for (const t of offen) {
    const v = await telefonVorschlag(tenantId, anrufName(t.title), { mails: o.mails }).catch(() => null);
    if (v?.art === "lieferant") continue;
    out.set(t.id, { vorschlag: v });
  }
  return out;
}
