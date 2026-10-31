import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Session } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { antwortText, einordnen, kiAuftrag, kiLesen, type Einordnung, type SchnellArt } from "./logic";

// Schnellerfassung (Modul 11): Diktat → Einordnung (Regeln, bei „unklar“ KI) → direkt anlegen oder Eingangsliste.
// Die Person handelt immer mit ihren eigenen Rechten; Privates nur mit vollem Privat-Zugang. Nichts wird gelöscht.

const S = schema.schnellEingaenge;

async function personen(tenantId: string) {
  const rows = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.readOnly, false)));
  const va = await import("@/lib/va/service").then((m) => m.vaNutzerId(tenantId)).catch(() => null);
  return rows.map((r) => ({ id: r.id, name: r.name ?? r.email, va: r.id === va }));
}

const privatVoll = (s: Session) => s.privateAccess && s.privateScope === "voll";

/** Anlegen nach Einordnung. Liefert die ID des Angelegten oder einen Fehlertext. */
async function anlegen(session: Session, e: Einordnung, text: string): Promise<{ id: string; zustaendig: string | null; telefonHinweis?: string } | { fehler: string }> {
  const t = session.tenantId;
  const kann = (bereich: Parameters<typeof import("@/lib/auth/areas").canAccess>[1]) => import("@/lib/auth/areas").then((m) => m.canAccess({ role: session.role, areas: session.areas, readOnly: session.readOnly, privateAccess: session.privateAccess }, bereich));
  if (e.art === "aufgabe" || e.art === "termin") {
    const titel = e.art === "termin" && e.uhrzeit ? `${e.uhrzeit} ${e.titel}` : e.titel;
    // Anruf-Aufgabe: Nummer aus dem Diktat übernehmen; fehlt sie, in der Antwort nachfragen (mit Vorschlag).
    const { anrufName, istAnruf, telefonAus, telefonRueckfrage } = await import("@/lib/mobil/logic");
    const anruf = istAnruf(titel);
    const telefon = anruf ? telefonAus(text) : null;
    const [row] = await db
      .insert(schema.tasks)
      .values({ tenantId: t, title: titel.slice(0, 280), notes: `Per Sprache erfasst: „${text.slice(0, 400)}“`, dueDate: e.tag, priority: "normal", category: "eigene", createdBy: session.userId, assigneeId: e.zustaendigId, telefon })
      .returning({ id: schema.tasks.id });
    let telefonHinweis: string | undefined;
    if (anruf && !telefon) {
      const mails = await kann("posteingang");
      const v = await import("@/lib/mobil/telefon").then((m) => m.telefonVorschlag(t, anrufName(titel), { mails })).catch(() => null);
      if (v?.art !== "lieferant") telefonHinweis = telefonRueckfrage(anrufName(titel), v);
    }
    let zustaendig: string | null = null;
    if (e.zustaendigId) {
      // Zuweisung wie im Seller-System (VA bekommt den Discord-Thread auf Englisch).
      await import("@/lib/va/service").then((m) => m.beiZuweisung(t, row.id, e.zustaendigId!)).catch(() => null);
      const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, e.zustaendigId));
      zustaendig = u ? (u.name ?? u.email) : null;
    }
    return { id: row.id, zustaendig, telefonHinweis };
  }
  if (e.art === "notiz") {
    if (!(await kann("wissen"))) return { fehler: "Kein Zugriff auf das Wissen." };
    const K = schema.knowledgeEntries;
    const [row] = await db.insert(K).values({ tenantId: t, kind: "article", category: "Notiz", title: e.titel.slice(0, 120) || "Notiz", body: text.slice(0, 4000), tags: ["sprache"], origin: "notiz", updatedBy: session.userId }).returning({ id: K.id });
    return { id: row.id, zustaendig: null };
  }
  if (e.art === "einkauf") {
    if (!(await kann("dealeingang"))) return { fehler: "Kein Zugriff auf den Deal-Eingang." };
    const { eingangAnlegen } = await import("@/lib/deal-eingang/service");
    const r = await eingangAnlegen(t, session.userId, { weg: "kurzbefehl", text, quelle: "Sprache" });
    // Prüfen im Hintergrund (Ergebnis als Mitteilung bzw. im Deal-Eingang).
    if (r.neu) void import("@/lib/deal-eingang/service").then((m) => m.eingangPruefen(t, r.id)).catch(() => null);
    return { id: r.id, zustaendig: null };
  }
  if (e.art === "privat_aufgabe") {
    if (!privatVoll(session)) return { fehler: "Kein Privat-Zugang." };
    const { privatEintragAnlegen } = await import("@/lib/private/anlegen");
    const r = await privatEintragAnlegen(session, { art: "aufgabe", tag: e.tag ?? undefined, text: e.titel });
    return r.ok && r.id ? { id: r.id, zustaendig: null } : { fehler: r.message };
  }
  if (e.art === "privat_termin") {
    if (!privatVoll(session) || !e.tag) return { fehler: "Kein Privat-Zugang oder kein Tag." };
    const { saveAppointment } = await import("@/lib/private/save");
    const fd = new FormData();
    fd.set("day", e.tag);
    if (e.uhrzeit) fd.set("time", e.uhrzeit);
    fd.set("with", /arzt|zahnarzt/i.test(text) ? "arzt" : /schule|kita|kind/i.test(text) ? "familie" : "privat");
    fd.set("title", e.titel.slice(0, 120));
    fd.set("status", "geplant");
    const r = await saveAppointment(session, fd);
    return r.ok && r.id ? { id: r.id, zustaendig: null } : { fehler: r.message };
  }
  return { fehler: "Bitte zuordnen." };
}

export type ErfassenErgebnis = { angelegt: boolean; art: SchnellArt; antwort: string; id: string };

/**
 * Diktat erfassen: einordnen (Regeln, sonst KI), sicher Eingeordnetes anlegen, alles andere in die Eingangsliste.
 * Jedes Diktat steht danach in der Liste (angelegt oder offen) – verschlüsselt, nur für die Person sichtbar.
 */
export async function erfassen(session: Session, textIn: string, o: { tokenId?: string | null; heute?: string } = {}): Promise<ErfassenErgebnis> {
  const text = textIn.replace(/\s+/g, " ").trim().slice(0, 1000);
  const heute = o.heute ?? todayIso();
  const privat = privatVoll(session);
  let e = einordnen(text, heute, { personen: await personen(session.tenantId), privat });
  if (e.art === "unklar" && text.length >= 3) {
    const { getIntegration } = await import("@/lib/integrations/store");
    const ai = await getIntegration(session.tenantId, "anthropic");
    if (ai?.apiKey) {
      const { askClaude, modelFor } = await import("@/lib/ai/claude");
      const r = await askClaude(ai.apiKey, kiAuftrag(text, heute, privat), { model: modelFor(ai, "simple"), task: "simple", maxTokens: 300, timeoutMs: 20_000 }).catch(() => null);
      e = (r && kiLesen(r.text, e, privat)) ?? e;
    }
  }
  const einordnung = { art: e.art, titel: e.titel, tag: e.tag, uhrzeit: e.uhrzeit, zustaendigId: e.zustaendigId, privatArt: e.privatArt, ean: e.ean, preis: e.preis, grund: e.grund };
  if (e.sicher && !session.readOnly) {
    const r = await anlegen(session, e, text);
    if ("id" in r) {
      const antwort = `${antwortText(e, true, r.zustaendig)}${r.telefonHinweis ? ` ${r.telefonHinweis}` : ""}`;
      const [row] = await db.insert(S).values({ tenantId: session.tenantId, userId: session.userId, tokenId: o.tokenId ?? null, daten: { text, einordnung, ergebnis: antwort }, status: "angelegt", art: e.art, zielId: r.id, erledigtAt: new Date() }).returning({ id: S.id });
      return { angelegt: true, art: e.art, antwort, id: row.id };
    }
    e = { ...e, sicher: false, grund: r.fehler };
  }
  const [row] = await db.insert(S).values({ tenantId: session.tenantId, userId: session.userId, tokenId: o.tokenId ?? null, daten: { text, einordnung: { ...einordnung, grund: e.grund } }, status: "offen", art: e.art }).returning({ id: S.id });
  return { angelegt: false, art: e.art, antwort: antwortText(e, false), id: row.id };
}

/** Eingangsliste der Person (offen zuerst, dann die letzten Erledigten). */
export async function eingangsliste(session: Session, limit = 50) {
  const rows = await db.select().from(S).where(and(eq(S.tenantId, session.tenantId), eq(S.userId, session.userId))).orderBy(desc(S.createdAt)).limit(limit);
  return [...rows.filter((r) => r.status === "offen"), ...rows.filter((r) => r.status !== "offen")];
}

/** Eintrag aus der Eingangsliste bestätigen – als gewählte Art (mit Tag/Uhrzeit aus dem Formular). */
export async function bestaetigen(session: Session, id: string, wahl: { art: SchnellArt; titel?: string; tag?: string | null; uhrzeit?: string | null }): Promise<{ ok: boolean; message: string }> {
  const [r] = await db.select().from(S).where(and(eq(S.tenantId, session.tenantId), eq(S.userId, session.userId), eq(S.id, id), eq(S.status, "offen")));
  if (!r) return { ok: false, message: "Eintrag nicht gefunden oder schon erledigt." };
  if (wahl.art === "unklar" || wahl.art === "privat_zeit") return { ok: false, message: wahl.art === "privat_zeit" ? "Privat-Zeiten bitte im Privatbereich eintragen (Eintragen → Paarzeit/Kinderzeit …)." : "Bitte eine Art wählen." };
  const alt = r.daten.einordnung;
  const e: Einordnung = {
    art: wahl.art,
    titel: (wahl.titel?.trim() || alt.titel).slice(0, 200),
    tag: wahl.tag && /^\d{4}-\d{2}-\d{2}$/.test(wahl.tag) ? wahl.tag : alt.tag,
    uhrzeit: wahl.uhrzeit && /^([01]\d|2[0-3]):[0-5]\d$/.test(wahl.uhrzeit) ? wahl.uhrzeit : alt.uhrzeit,
    zustaendigId: alt.zustaendigId,
    privatArt: null,
    ean: alt.ean,
    preis: alt.preis,
    sicher: true,
    grund: "bestätigt",
  };
  const a = await anlegen(session, e, r.daten.text);
  if ("fehler" in a) return { ok: false, message: a.fehler };
  const antwort = antwortText(e, true, a.zustaendig);
  await db.update(S).set({ status: "angelegt", art: e.art, zielId: a.id, erledigtAt: new Date(), daten: { ...r.daten, einordnung: { ...alt, art: e.art, titel: e.titel, tag: e.tag, uhrzeit: e.uhrzeit }, ergebnis: antwort } }).where(eq(S.id, r.id));
  return { ok: true, message: antwort };
}

export async function verwerfen(session: Session, id: string) {
  await db.update(S).set({ status: "verworfen", erledigtAt: new Date() }).where(and(eq(S.tenantId, session.tenantId), eq(S.userId, session.userId), eq(S.id, id), eq(S.status, "offen")));
}

/** Offene Einträge der Person (Zahl) – für Startseite/Navigation. */
export async function offeneAnzahl(session: Session): Promise<number> {
  const rows = await db.select({ id: S.id }).from(S).where(and(eq(S.tenantId, session.tenantId), eq(S.userId, session.userId), eq(S.status, "offen"))).limit(100);
  return rows.length;
}
