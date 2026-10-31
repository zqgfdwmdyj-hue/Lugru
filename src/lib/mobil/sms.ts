import "server-only";
import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { smsAntwort, smsErlaubt, smsText } from "./logic";

// Wichtige Meldungen per SMS (B13) und Antworten darauf. Nur an Ludwigs Nummer (Einstellungen), nie Kunden- oder
// Privatdaten im Text, Ruhe- und Familienzeiten beachten (außer rote Konto-Themen), Tageslimit. Antworten lösen nur
// Aufgaben oder Entwürfe aus – „KAUFEN 20“ erzeugt einen Einkaufsentwurf, nie eine Bestellung.

const S = schema.smsMeldungen;
const T = schema.tasks;
const nur = (n: string) => n.replace(/[^\d+]/g, "").replace(/^00/, "+");

const berlin = (d = new Date()) => {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const [tag, uhr] = f.split(" ");
  return { tag, uhr };
};

/** Ist jetzt eine private Sperrzeit (Familienzeit) im Tagesplan des Inhabers? */
async function inSperrzeit(tenantId: string, tag: string, uhr: string): Promise<boolean> {
  const { inhaberPrivatSitzung } = await import("@/lib/private/termin-mail-service");
  const s = await inhaberPrivatSitzung(tenantId);
  if (!s) return false;
  const { tagesplan } = await import("@/lib/tagesplan/service");
  const p = await tagesplan(s, { start: tag, tage: 1, heute: tag }).catch(() => null);
  return Boolean(p?.tage[0]?.sperren.some((x) => (x.art === "privat" || x.art === "frei") && x.von <= uhr && uhr < x.bis));
}

export type SmsArt = (typeof S.$inferInsert)["art"];

/**
 * Wichtige Meldung als SMS – einmal je `schluessel`. Gibt den Status zurück (gesendet / unterdrückt mit Grund /
 * aus, wenn SMS nicht eingerichtet ist). `rot`: Konto-Themen dürfen auch in Ruhe- und Familienzeiten raus.
 */
export async function smsMelden(tenantId: string, m: { art: SmsArt; kern: string; schluessel: string; bezug?: string | null; rot?: boolean; codes?: string[] }): Promise<"gesendet" | "unterdrueckt" | "fehler" | "doppelt" | "aus"> {
  const cfg = (await getSettings(tenantId)).mobil.sms;
  const tw = await getIntegration(tenantId, "twilio");
  if (!cfg.an || !cfg.nummer.trim() || !tw?.accountSid) return "aus";
  const [schon] = await db.select({ id: S.id }).from(S).where(and(eq(S.tenantId, tenantId), eq(S.schluessel, m.schluessel)));
  if (schon) return "doppelt";
  const { tag, uhr } = berlin();
  const [{ heute }] = await db.select({ heute: count() }).from(S).where(and(eq(S.tenantId, tenantId), eq(S.status, "gesendet"), gte(S.createdAt, new Date(`${tag}T00:00:00+01:00`))));
  const [{ n }] = await db.select({ n: count() }).from(S).where(eq(S.tenantId, tenantId));
  const ref = `F${n + 1}`;
  const text = smsText(m.kern, ref, m.codes);
  const erlaubt = smsErlaubt({ uhrzeit: uhr, ruheVon: cfg.ruheVon, ruheBis: cfg.ruheBis, inSperrzeit: m.rot ? false : await inSperrzeit(tenantId, tag, uhr), rot: Boolean(m.rot), heuteGesendet: heute, limit: cfg.limit });
  if (!erlaubt.ok) {
    await db.insert(S).values({ tenantId, ref, art: m.art, text, bezug: m.bezug ?? null, schluessel: m.schluessel, status: "unterdrueckt", grund: erlaubt.grund }).onConflictDoNothing();
    return "unterdrueckt";
  }
  const { smsSenden } = await import("@/lib/integrations/clients/sms");
  try {
    await smsSenden(tw, nur(cfg.nummer), text);
    await db.insert(S).values({ tenantId, ref, art: m.art, text, bezug: m.bezug ?? null, schluessel: m.schluessel, status: "gesendet" }).onConflictDoNothing();
    return "gesendet";
  } catch (e) {
    await db.insert(S).values({ tenantId, ref, art: m.art, text, bezug: m.bezug ?? null, schluessel: m.schluessel, status: "fehler", grund: (e instanceof Error ? e.message : String(e)).slice(0, 200) }).onConflictDoNothing();
    return "fehler";
  }
}

/** Welcher Mandant gehört zu dieser Absendernummer (nur die eingetragene Nummer)? */
export async function mandantFuerNummer(von: string): Promise<string | null> {
  const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  for (const t of tenants) {
    const n = (await getSettings(t.id)).mobil.sms.nummer;
    if (n && nur(n) === nur(von)) return t.id;
  }
  return null;
}

async function aufgabeAus(tenantId: string, titel: string, notiz: string, faellig: string | null) {
  const [r] = await db.insert(T).values({ tenantId, title: titel.slice(0, 280), notes: notiz.slice(0, 2000), dueDate: faellig, priority: "normal", category: "eigene" }).returning({ id: T.id });
  return r.id;
}

/**
 * Antwort auf eine SMS auswerten: VA → Aufgabe an die VA (englisch, Discord); SPÄTER → auf morgen; OK → gelesen;
 * KAUFEN n → Einkaufsentwurf (nie Bestellung); Unklares → Aufgabe an Ludwig mit Originaltext.
 */
export async function smsAntwortVerarbeiten(tenantId: string, body: string): Promise<string> {
  const a = smsAntwort(body);
  const [m] = a.ref
    ? await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.ref, a.ref)))
    : await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.status, "gesendet"), gte(S.createdAt, new Date(Date.now() - 24 * 3_600_000)))).orderBy(desc(S.createdAt)).limit(1);
  const heute = todayIso();
  const morgen = addDaysIso(heute, 1);
  let ergebnis: string;
  const bezug = m?.bezug ?? null;
  const taskId = bezug?.startsWith("task:") ? bezug.slice(5) : null;
  const dealId = bezug?.startsWith("deal:") ? bezug.slice(5) : null;
  const kern = m ? m.text.replace(/\s*Antwort:.*$/, "") : body;
  if (!m || a.code === "unklar") {
    const id = await aufgabeAus(tenantId, `SMS-Antwort prüfen: ${body.slice(0, 80)}`, `Antwort per SMS (nicht eindeutig): „${body.slice(0, 500)}“${m ? `\nZu: ${kern}` : ""}`, heute);
    ergebnis = `Aufgabe für Ludwig angelegt (${id.slice(0, 8)})`;
  } else if (a.code === "VA") {
    const id = taskId ?? (await aufgabeAus(tenantId, kern.slice(0, 200), `Per SMS an die VA gegeben (${m.ref}).`, morgen));
    const { anVaGeben } = await import("@/lib/va/service");
    const r = await anVaGeben(tenantId, id, `Per SMS weitergegeben (${m.ref}).`).catch((e) => ({ ok: false as const, fehler: e instanceof Error ? e.message : String(e) }));
    ergebnis = r.ok ? "an die VA gegeben" : `Aufgabe angelegt, VA nicht erreichbar: ${"fehler" in r ? r.fehler : ""}`.slice(0, 200);
  } else if (a.code === "SPAETER") {
    if (taskId) await db.update(T).set({ dueDate: morgen }).where(and(eq(T.tenantId, tenantId), eq(T.id, taskId)));
    else await aufgabeAus(tenantId, kern.slice(0, 200), `Per SMS auf morgen gelegt (${m.ref}).`, morgen);
    ergebnis = "auf morgen gelegt";
  } else if (a.code === "OK") {
    ergebnis = "gelesen";
  } else if (a.code === "GEKAUFT") {
    // Ludwig hat selbst gekauft → Deal „gekauft“ (Menge, Preis), Bestellung „bestellt“; ohne Menge nur Aufgabe.
    if (dealId && a.menge) {
      const { alsGekauft } = await import("@/lib/deal-eingang/kauf");
      const r = await alsGekauft(tenantId, dealId, { menge: a.menge, preis: a.preis ?? null, weg: "sms", ref: `sms:${m?.ref ?? ""}` }).catch((e) => ({ fehler: e instanceof Error ? e.message : String(e) }));
      ergebnis = "fehler" in r ? `Nicht gespeichert: ${r.fehler}`.slice(0, 200) : `als gekauft gespeichert (${a.menge} Stück)`;
    } else {
      await aufgabeAus(tenantId, `Kauf eintragen: ${a.menge ?? "?"} Stück (per SMS)`, `${kern}\nAntwort: ${body}`, heute);
      ergebnis = "Aufgabe angelegt – Menge bzw. Deal unklar";
    }
  } else {
    // KAUFEN n: nur Entwurf
    if (dealId) {
      const { inBestellvorschlaege } = await import("@/lib/deal-eingang/ablauf");
      const owner = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"))).orderBy(asc(schema.memberships.userId)).limit(1);
      const r = await inBestellvorschlaege(tenantId, owner[0]?.userId ?? "", dealId, null).catch(() => null);
      ergebnis = r ? `Einkaufsentwurf angelegt${a.menge ? ` (Menge ${a.menge} bitte im Entwurf prüfen)` : ""} – nichts bestellt` : "Entwurf nicht möglich – Aufgabe angelegt";
      if (!r) await aufgabeAus(tenantId, `Einkauf prüfen: ${a.menge ?? "?"} Stück (per SMS)`, `${kern}\nAntwort: ${body}`, heute);
    } else {
      await aufgabeAus(tenantId, `Einkauf prüfen: ${a.menge ?? "?"} Stück (per SMS)`, `${kern}\nAntwort: ${body} – nur Entwurf, nichts bestellt.`, heute);
      ergebnis = "Einkaufs-Aufgabe angelegt – nichts bestellt";
    }
  }
  if (m) await db.update(S).set({ status: "beantwortet", antwort: body.slice(0, 500), ergebnis }).where(eq(S.id, m.id));
  return ergebnis;
}

/** Täglich: „Frist morgen“ – wichtige Aufgaben mit Frist morgen (ohne Inhalt, nur Anzahl und Bereiche). */
export async function fristMorgenSms(tenantId: string, heute = todayIso()): Promise<string> {
  const morgen = addDaysIso(heute, 1);
  const rows = await db.select({ category: T.category }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), eq(T.priority, "critical"), eq(T.dueDate, morgen), sql`coalesce(${T.zustaendigExtern}, '') = ''`));
  if (!rows.length) return "keine";
  const bereiche = [...new Set(rows.map((r) => r.category))].slice(0, 3).join(", ");
  return smsMelden(tenantId, { art: "frist", kern: `Morgen fällig: ${rows.length} wichtige ${rows.length === 1 ? "Frist" : "Fristen"} (${bereiche})`, schluessel: `frist:${morgen}`, codes: ["OK", "SPÄTER"] });
}
