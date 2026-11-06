import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { loadEntries, updateEntry } from "@/lib/private/service";
import { inhaberPrivatSitzung } from "@/lib/private/termin-mail-service";
import { getSettings } from "@/lib/settings";
import { gesehenMerken, kontaktLesen, kontaktSetzen, type NachrichtEintrag, type VerlaufEintrag } from "./persoenlich";
import { betreffKern, persoenlichEinstufen } from "./persoenlich-logic";

// B32.5 Postausgang mitlesen: Mails aus dem Gesendet-Ordner (bzw. über das System gesendet) dem Verlauf zuordnen.
// Antwort auf eine eingegangene Mail → „beantwortet (extern, am …)“, Aufgabe erledigt, Entwurf verworfen. Neu
// angeschrieben → „ausgehend“ mit Nachfassen. Persönliches nur im Privatbereich, nie hier.

const klein = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const E = schema.emails;
const A = schema.mailAusgang;

export type AusgangMail = {
  messageKey: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  text: string;
  receivedAt: Date;
  antwortAuf?: string[];
  /** Empfänger (An) – der erste fremde ist die Gegenseite. */
  empfaenger?: { adresse: string; name: string | null }[];
};

/** Eingegangene Geschäftsmail, auf die diese gesendete Mail antwortet (In-Reply-To/References, sonst Betreff + Empfänger, 30 Tage). */
async function geschaeftlichFinden(tenantId: string, an: string, m: AusgangMail) {
  const refs = (m.antwortAuf ?? []).filter(Boolean);
  if (refs.length) {
    const [r] = await db.select({ id: E.id }).from(E).where(and(eq(E.tenantId, tenantId), inArray(E.messageKey, refs))).orderBy(desc(E.receivedAt)).limit(1);
    if (r) return r.id;
  }
  const kern = betreffKern(m.subject);
  if (!kern || !an) return null;
  const seit = new Date(m.receivedAt.getTime() - 30 * 86_400_000);
  const kandidaten = await db
    .select({ id: E.id, subject: E.subject })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), sql`lower(${E.fromAddress}) = ${an}`, gte(E.receivedAt, seit), lte(E.receivedAt, m.receivedAt)))
    .orderBy(desc(E.receivedAt))
    .limit(20);
  return kandidaten.find((k) => betreffKern(k.subject ?? "") === kern)?.id ?? null;
}

/** Eigene frühere ausgehende Mail im selben Verlauf (Nachfass-Mail aus dem Mailprogramm). */
async function ausgangFinden(tenantId: string, an: string, m: { antwortAuf?: string[]; subject: string; receivedAt: Date }) {
  const refs = (m.antwortAuf ?? []).filter(Boolean);
  if (refs.length) {
    const [r] = await db.select().from(A).where(and(eq(A.tenantId, tenantId), inArray(A.messageKey, refs))).orderBy(desc(A.gesendetAm)).limit(1);
    if (r) return r;
  }
  const kern = betreffKern(m.subject);
  if (!kern || !an) return null;
  const seit = new Date(m.receivedAt.getTime() - 30 * 86_400_000);
  const liste = await db.select().from(A).where(and(eq(A.tenantId, tenantId), eq(A.an, an), gte(A.gesendetAm, seit))).orderBy(desc(A.gesendetAm)).limit(20);
  return liste.find((x) => betreffKern(x.betreff) === kern) ?? null;
}

/** Bezüge (Bestellnummer, ASIN, Fall-ID) einer gesendeten Mail – für Notizen am Auftrag/Fall. */
async function bezuegeAus(text: string, betreff: string): Promise<Record<string, string>> {
  const { classifyMail } = await import("./classify");
  return classifyMail({ from: "", subject: betreff, body: text }, new Date()).references ?? {};
}

/** Notiz am Auftrag bzw. Fall (geschäftliche Antwort mit Bestellnummer/Fall-ID). */
async function notizenSetzen(tenantId: string, refs: Record<string, string>, zeile: string) {
  const order = refs.amazonOrder ?? refs.ebayOrder;
  if (order) {
    const O = schema.orders;
    const [o] = await db.select({ id: O.id, notes: O.notes }).from(O).where(and(eq(O.tenantId, tenantId), eq(O.externalId, order))).limit(1);
    if (o) await db.update(O).set({ notes: o.notes ? `${o.notes}\n${zeile}` : zeile }).where(and(eq(O.tenantId, tenantId), eq(O.id, o.id)));
  }
  if (refs.caseId) {
    const claims = await db.select({ id: schema.claims.id }).from(schema.claims).where(and(eq(schema.claims.tenantId, tenantId), eq(schema.claims.amazonCaseId, refs.caseId)));
    for (const c of claims) await db.insert(schema.claimEvents).values({ tenantId, claimId: c.id, action: "Antwort gesendet", note: clip(zeile, 200) });
  }
}

/** Eingegangene Mail als beantwortet markieren: Aufgabe erledigt, offene Entwürfe verworfen, Push-Karten weg. */
export async function alsBeantwortet(tenantId: string, emailId: string, o: { am: Date; von: string }) {
  await db.update(E).set({ beantwortetAm: o.am, beantwortetVon: clip(o.von, 300) }).where(and(eq(E.tenantId, tenantId), eq(E.id, emailId)));
  const T = schema.tasks;
  await db.update(T).set({ status: "done", completedAt: new Date() }).where(and(eq(T.tenantId, tenantId), eq(T.systemKey, `mail:${emailId}`), eq(T.status, "open")));
  const [m] = await db.select({ taskId: E.taskId }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, emailId)));
  if (m?.taskId) await db.update(T).set({ status: "done", completedAt: new Date() }).where(and(eq(T.tenantId, tenantId), eq(T.id, m.taskId), eq(T.status, "open")));
  // Nicht gesendete Entwürfe zu dieser Mail sind überholt (wie „Verwerfen“).
  await db.delete(schema.emailDrafts).where(and(eq(schema.emailDrafts.tenantId, tenantId), eq(schema.emailDrafts.emailId, emailId), isNull(schema.emailDrafts.sentAt)));
  await db
    .update(schema.meldungen)
    .set({ zustand: "erledigt" })
    .where(and(eq(schema.meldungen.tenantId, tenantId), eq(schema.meldungen.link, `/posteingang/${emailId}`), ne(schema.meldungen.zustand, "erledigt")));
}

/** Über das System gesendet (Entwurf im Posteingang): Postausgang + „beantwortet“, damit der Gesendet-Ordner nichts doppelt zählt. */
export async function antwortGesendet(tenantId: string, emailId: string, o: { messageKey: string; mailboxId: string | null; von: string; vonName: string | null; an: string; betreff: string; text: string }) {
  const [m] = await db.select({ messageKey: E.messageKey, references: E.references }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, emailId)));
  await db
    .insert(A)
    .values({ tenantId, mailboxId: o.mailboxId, messageKey: o.messageKey, an: klein(o.an), betreff: clip(o.betreff, 500), gesendetAm: new Date(), snippet: clip(o.text.replace(/\s+/g, " "), 300), bodyText: clip(o.text, 20_000), absender: o.von, absenderName: o.vonName, antwortAuf: m?.messageKey ? [m.messageKey] : [], emailId, referenzen: m?.references ?? {} })
    .onConflictDoNothing();
  await gesehenMerken(tenantId, o.messageKey, "ausgang");
  await alsBeantwortet(tenantId, emailId, { am: new Date(), von: `${o.von}${o.vonName ? ` (${o.vonName})` : ""} · über das Seller-System` });
}

/**
 * Gesendete Mail (eigene Absenderadresse) zuordnen. Ergebnis: „beantwortet“ (Antwort auf eine Geschäftsmail),
 * „privat“ (persönlicher Verlauf im Privatbereich), „ausgehend“ (neu angeschrieben, geschäftlich), „bekannt“.
 */
export async function ausgangErfassen(tenantId: string, mailboxId: string | null, m: AusgangMail, eigene: Set<string>): Promise<"beantwortet" | "privat" | "ausgehend" | "bekannt"> {
  const [schon] = await db.select({ id: A.id }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.messageKey, m.messageKey)));
  if (schon) return "bekannt";
  const gegen = (m.empfaenger ?? []).find((e) => e.adresse && !eigene.has(klein(e.adresse)));
  const an = klein(gegen?.adresse);
  const von = `${klein(m.fromAddress)}${m.fromName ? ` (${m.fromName})` : ""}`;
  const am = m.receivedAt;
  if (!an) return "bekannt"; // an sich selbst – nichts zuzuordnen

  // 1) Persönlicher Verlauf (Privatbereich): Antwort an eine Person, deren Mail dort liegt.
  const session = await inhaberPrivatSitzung(tenantId);
  if (session) {
    const liste = await loadEntries<NachrichtEintrag>(session, ["nachricht"]);
    if (liste.some((e) => e.data.verlauf?.some((v) => v.key === m.messageKey))) return "bekannt";
    const refs = new Set(m.antwortAuf ?? []);
    const kern = betreffKern(m.subject);
    const treffer =
      liste.find((e) => e.data.verlauf?.some((v) => refs.has(v.key))) ??
      liste.filter((e) => e.data.von === an && kern && betreffKern(e.data.betreff) === kern).sort((a, b) => b.data.zuletztAm.localeCompare(a.data.zuletztAm))[0];
    if (treffer) {
      const aus: VerlaufEintrag = { richtung: "aus", key: m.messageKey, am: am.toISOString(), text: clip(m.text, 20_000), von, betreff: clip(m.subject, 300), extern: true };
      const verlauf = [...treffer.data.verlauf, aus].sort((a, b) => a.am.localeCompare(b.am)).slice(-40);
      const offen = treffer.data.status === "offen" || treffer.data.status === "unsicher";
      await updateEntry(session, treffer.id, "nachricht", {
        verlauf,
        zuletztAm: am.toISOString() > treffer.data.zuletztAm ? am.toISOString() : treffer.data.zuletztAm,
        ...(offen || treffer.data.status === "ausgehend" ? { status: offen ? "beantwortet_extern" : treffer.data.status, entwurf: offen ? "" : treffer.data.entwurf, beantwortetAm: am.toISOString(), beantwortetVon: von, spaeterBis: null } : {}),
      });
      const ids = (treffer.data as { meldungIds?: string[] }).meldungIds ?? [];
      if (ids.length) await db.update(schema.meldungen).set({ zustand: "erledigt" }).where(and(eq(schema.meldungen.tenantId, tenantId), inArray(schema.meldungen.id, ids)));
      await gesehenMerken(tenantId, m.messageKey, "privat_gesendet");
      return "privat";
    }
  }

  // 2) Antwort auf eine eingegangene Geschäftsmail.
  const emailId = await geschaeftlichFinden(tenantId, an, m);
  const refs = await bezuegeAus(m.text, m.subject);
  if (emailId) {
    const [orig] = await db.select({ references: E.references }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, emailId)));
    const alle = { ...(orig?.references ?? {}), ...refs };
    await db
      .insert(A)
      .values({ tenantId, mailboxId, messageKey: m.messageKey, an, anName: gegen?.name ?? null, betreff: clip(m.subject, 500), gesendetAm: am, snippet: clip(m.text.replace(/\s+/g, " "), 300), bodyText: clip(m.text, 20_000), absender: klein(m.fromAddress), absenderName: m.fromName, antwortAuf: m.antwortAuf ?? [], emailId, referenzen: alle })
      .onConflictDoNothing();
    await alsBeantwortet(tenantId, emailId, { am, von: `${von} · extern` });
    await notizenSetzen(tenantId, alle, `${todayIso(am).split("-").reverse().join(".")} Antwort gesendet (${von}): ${clip(m.subject, 120)}`);
    await gesehenMerken(tenantId, m.messageKey, "ausgang");
    return "beantwortet";
  }

  // 3) Nachfass-Mail im selben Verlauf wie eine frühere ausgehende Mail → dort anhängen (gleicher Vorgang).
  const frueher = await ausgangFinden(tenantId, an, m);

  // 4) Neu angeschrieben: persönlich (Privatbereich) oder geschäftlich „ausgehend“.
  const kontakt = await kontaktLesen(tenantId, an);
  let bezug = kontakt?.bezug ?? null;
  if (!bezug) {
    const lieferant = await import("@/lib/b2b/preislisten-mail").then((x) => x.lieferantZuAbsender(tenantId, an)).catch(() => null);
    const kunden = await db.select({ email: schema.b2bKunden.email }).from(schema.b2bKunden).where(eq(schema.b2bKunden.tenantId, tenantId));
    const istKunde = kunden.some((k) => klein(k.email) === an);
    if (istKunde) bezug = "b2b_kunde";
    else if (lieferant) bezug = "lieferant";
    else if (!frueher && kontakt?.art !== "geschaeftlich" && session) {
      const e = persoenlichEinstufen({ adresse: an, name: gegen?.name ?? null, betreff: m.subject, text: m.text, inhaber: null });
      if (e.stufe === "persoenlich" || kontakt?.art === "persoenlich") bezug = "persoenlich";
    }
  }
  if (kontakt?.art === "persoenlich") bezug = "persoenlich";
  if (bezug === "persoenlich" && session) {
    const { addEntry } = await import("@/lib/private/service");
    const aus: VerlaufEintrag = { richtung: "aus", key: m.messageKey, am: am.toISOString(), text: clip(m.text, 20_000), von, betreff: clip(m.subject, 300), extern: true };
    const eintrag: NachrichtEintrag = { status: "ausgehend", von: an, name: gegen?.name ?? null, betreff: clip(m.subject, 300), postfachId: mailboxId, postfach: klein(m.fromAddress), verlauf: [aus], zusammenfassung: "", entwurf: "", entwurfQuelle: "", anrede: kontakt?.anrede ?? "sie", termin: null, terminId: null, terminGeaendert: null, beantwortetAm: null, beantwortetVon: von, nachfassenAm: null, zuletztAm: am.toISOString() };
    await addEntry(session, "nachricht", eintrag as unknown as Record<string, unknown>);
    await kontaktSetzen(tenantId, an, { name: gegen?.name ?? undefined, bezug: "persoenlich", ...(kontakt?.art ? {} : { art: "persoenlich" }) });
    await gesehenMerken(tenantId, m.messageKey, "privat_gesendet");
    return "privat";
  }
  const kontaktId = await kontaktSetzen(tenantId, an, { ...(gegen?.name ? { name: gegen.name } : {}), bezug: bezug ?? "sonst" });
  await db
    .insert(A)
    .values({ tenantId, mailboxId, kontaktId, messageKey: m.messageKey, an, anName: gegen?.name ?? null, betreff: clip(m.subject, 500), gesendetAm: am, snippet: clip(m.text.replace(/\s+/g, " "), 300), bodyText: clip(m.text, 20_000), absender: klein(m.fromAddress), absenderName: m.fromName, antwortAuf: m.antwortAuf ?? [], referenzen: refs, ...(frueher?.nachfassenAm && !frueher.antwortEmailId ? { nachfassenAm: frueher.nachfassenAm } : {}) })
    .onConflictDoNothing();
  // Nachfass-Mail aus dem Mailprogramm: die frühere Erinnerung ist damit erledigt (neue Frist gilt für die neue Mail).
  if (frueher && !frueher.antwortEmailId) {
    await db.update(A).set({ nachfassenAm: null }).where(eq(A.id, frueher.id));
    if (frueher.nachfassTaskId) await db.update(schema.tasks).set({ status: "done", completedAt: new Date() }).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.id, frueher.nachfassTaskId), eq(schema.tasks.status, "open")));
  }
  await notizenSetzen(tenantId, refs, `${todayIso(am).split("-").reverse().join(".")} Mail gesendet an ${an}: ${clip(m.subject, 120)}`);
  await gesehenMerken(tenantId, m.messageKey, "ausgang");
  return "ausgehend";
}

/**
 * Eingang einer Antwort auf eine eigene ausgehende Mail (In-Reply-To/References, sonst Absender + Betreff):
 * Nachfassen erledigt. Liefert die ausgehende Mail (für die Einstufung als wichtig) oder null.
 */
export async function antwortAufAusgang(tenantId: string, m: { fromAddress: string; subject: string; receivedAt: Date; antwortAuf?: string[] }) {
  const a = await ausgangFinden(tenantId, klein(m.fromAddress), m);
  if (!a || (a.an !== klein(m.fromAddress) && !(m.antwortAuf ?? []).includes(a.messageKey))) return null;
  return a;
}

/** Nach dem Speichern der Antwort-Mail: Verknüpfen und Nachfass-Aufgabe schließen. */
export async function antwortVerknuepfen(tenantId: string, ausgangId: string, emailId: string) {
  const [a] = await db.select().from(A).where(and(eq(A.tenantId, tenantId), eq(A.id, ausgangId)));
  if (!a) return;
  await db.update(A).set({ antwortEmailId: a.antwortEmailId ?? emailId, nachfassenAm: null }).where(eq(A.id, a.id));
  await db.update(E).set({ ausgangId: a.id }).where(and(eq(E.tenantId, tenantId), eq(E.id, emailId)));
  if (a.nachfassTaskId) await db.update(schema.tasks).set({ status: "done", completedAt: new Date() }).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.id, a.nachfassTaskId), eq(schema.tasks.status, "open")));
}

/** „Nachfassen in n Tagen“ (null = aus). */
export async function nachfassenSetzen(tenantId: string, ausgangId: string, tage: number | null) {
  const am = tage === null ? null : addDaysIso(todayIso(), Math.max(1, Math.min(60, Math.round(tage))));
  const [r] = await db.update(A).set({ nachfassenAm: am }).where(and(eq(A.tenantId, tenantId), eq(A.id, ausgangId), isNull(A.antwortEmailId))).returning({ id: A.id });
  return Boolean(r);
}

/** Fällige Nachfass-Termine ohne Antwort → Aufgabe „Nachfassen“ (einmal je Mail). */
export async function nachfassenFaellig(tenantId: string): Promise<number> {
  const heute = todayIso();
  const faellig = await db
    .select()
    .from(A)
    .where(and(eq(A.tenantId, tenantId), isNull(A.antwortEmailId), isNull(A.nachfassTaskId), isNull(A.emailId), sql`${A.nachfassenAm} is not null and ${A.nachfassenAm} <= ${heute}`))
    .limit(50);
  for (const a of faellig) {
    const [t] = await db
      .insert(schema.tasks)
      .values({ tenantId, title: clip(`Nachfassen: ${a.betreff || "(ohne Betreff)"}`, 280), notes: clip(`Keine Antwort von ${a.anName ? `${a.anName} <${a.an}>` : a.an} seit ${a.gesendetAm.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}.`, 500), category: "support", dueDate: heute, link: `/posteingang/ausgehend#a-${a.id}`, systemKey: `nachfassen:${a.id}` })
      .returning({ id: schema.tasks.id });
    await db.update(A).set({ nachfassTaskId: t.id }).where(eq(A.id, a.id));
  }
  return faellig.length;
}

/** Ausgehende Geschäftsmails (ohne Eingang) – für die Liste „Ausgehend“. */
export async function ausgehendListe(tenantId: string, tage = 60) {
  const seit = new Date(Date.now() - tage * 86_400_000);
  return db
    .select({ id: A.id, an: A.an, anName: A.anName, betreff: A.betreff, gesendetAm: A.gesendetAm, snippet: A.snippet, absender: A.absender, absenderName: A.absenderName, nachfassenAm: A.nachfassenAm, antwortEmailId: A.antwortEmailId, nachfassTaskId: A.nachfassTaskId, referenzen: A.referenzen, bezug: schema.mailKontakte.bezug })
    .from(A)
    .leftJoin(schema.mailKontakte, eq(schema.mailKontakte.id, A.kontaktId))
    .where(and(eq(A.tenantId, tenantId), isNull(A.emailId), gte(A.gesendetAm, seit)))
    .orderBy(desc(A.gesendetAm))
    .limit(200);
}

/** Verlauf einer Geschäftsmail: Eingang, gesendete Antworten, Antworten darauf (chronologisch). */
export async function geschaeftsVerlauf(tenantId: string, emailId: string) {
  const antworten = await db.select().from(A).where(and(eq(A.tenantId, tenantId), eq(A.emailId, emailId))).orderBy(A.gesendetAm);
  const keys = antworten.map((a) => a.messageKey);
  const folge = keys.length ? await db.select({ id: E.id, fromAddress: E.fromAddress, fromName: E.fromName, subject: E.subject, receivedAt: E.receivedAt, bodyText: E.bodyText, antwortAuf: E.antwortAuf }).from(E).where(and(eq(E.tenantId, tenantId), sql`${E.antwortAuf} ?| array[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[]`)) : [];
  return { antworten, folge };
}

/** Standard für „Nachfassen in n Tagen“. */
export async function nachfassTage(tenantId: string) {
  return (await getSettings(tenantId)).posteingang.nachfassTage ?? 3;
}
