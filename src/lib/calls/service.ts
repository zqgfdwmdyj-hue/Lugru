import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { addDaysIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { driveToken } from "@/lib/integrations/clients/drive";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import { bereinigeTranskript, callTitelUndDatum, callWissenText, datumAusText, ERKENNTNIS_TEXT, googleDocId, googleDocLinks, inhaltKennung, istEigeneAufgabe, kiAuftrag, kiWissenAuftrag, trefferImText, leseArchivExport, leseKiPunkte, leseKiWissen, leseKiZusammenfassung, linksMitKontext, zitatPosition, type CallArt, type PunktArt } from "./logic";
import { textAusCallDateien } from "./dateien";

// Call-Archiv: Import (Text, Google-Doc-Link, Dateien/ZIP, wöchentlich aus einem Discord-Kanal), KI-Auswertung,
// Vorschläge → Aufgaben nach Bestätigung, offene Punkte für den nächsten Call.

const C = schema.calls;
const P = schema.callPunkte;
const DOCS = () => (process.env.GOOGLE_DOCS_BASE_URL || "https://docs.google.com").replace(/\/$/, "");
const DISCORD = () => (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");

/** Text eines Google Docs: mit Dienstkonto (Drive-Anbindung) oder – bei „Jeder mit dem Link“ – öffentlich. */
export async function holeGoogleDoc(tenantId: string, docId: string): Promise<string> {
  const drive = await getIntegration(tenantId, "google_drive");
  if (drive?.serviceAccountJson) {
    try {
      const token = await driveToken(drive.serviceAccountJson);
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(docId)}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      if (r.ok) return await r.text();
    } catch {
      // weiter mit dem öffentlichen Link
    }
  }
  const r = await fetch(`${DOCS()}/document/d/${encodeURIComponent(docId)}/export?format=txt`, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const typ = r.headers.get("content-type") ?? "";
  if (!r.ok || !typ.startsWith("text/plain")) throw new Error("Das Google Doc ist nicht lesbar – in Google Docs „Freigeben → Jeder mit dem Link: Betrachter“ einstellen (oder die Drive-Anbindung mit Dienstkonto nutzen).");
  return await r.text();
}

async function ki(tenantId: string) {
  const ai = await getIntegration(tenantId, "anthropic");
  return ai?.apiKey ? { apiKey: ai.apiKey, model: modelFor(ai, "creative") } : null;
}

/** Gibt es diesen Call schon (gleiche Quelle oder gleicher Inhalt aus einer anderen Quelle)? */
async function vorhandenerCall(tenantId: string, ref: string | null, kennung: string | null): Promise<{ id: string; titel: string; datum: string } | null> {
  const felder = { id: C.id, titel: C.titel, datum: C.datum };
  if (ref) {
    const [a] = await db.select(felder).from(C).where(and(eq(C.tenantId, tenantId), eq(C.quelleRef, ref)));
    if (a) return a;
  }
  if (kennung) {
    const [b] = await db.select(felder).from(C).where(and(eq(C.tenantId, tenantId), eq(C.inhaltKennung, kennung)));
    if (b) return b;
  }
  return null;
}

/** Call anlegen (Doppel über Quelle und Inhalt verhindern) und gleich auswerten – bei „auswerten: false“ später im Hintergrund. */
export async function callImportieren(
  tenantId: string,
  e: { titel: string; datum: string; text?: string; link?: string; quelle: "text" | "google_doc" | "discord" | "datei"; quelleRef?: string | null; art?: CallArt; auswerten?: boolean },
): Promise<{ id: string; neu: boolean; punkte: number; fehler: string | null }> {
  let text = e.text ?? "";
  let ref = e.quelleRef ?? null;
  if (e.link) {
    const docId = googleDocId(e.link);
    if (!docId) throw new Error("Kein Google-Docs-Link erkannt (…docs.google.com/document/d/…).");
    ref = ref ?? `gdoc:${docId}`;
    const alt = await vorhandenerCall(tenantId, ref, null);
    if (alt) return { id: alt.id, neu: false, punkte: 0, fehler: null };
    text = await holeGoogleDoc(tenantId, docId);
  }
  const transkript = bereinigeTranskript(text);
  if (transkript.length < 20) throw new Error("Das Transkript ist leer oder zu kurz.");
  const kennung = inhaltKennung(transkript);
  const doppelt = await vorhandenerCall(tenantId, ref, kennung);
  if (doppelt) return { id: doppelt.id, neu: false, punkte: 0, fehler: null };
  const [row] = await db
    .insert(C)
    .values({ tenantId, titel: e.titel.slice(0, 200), datum: e.datum, art: e.art ?? "consultant", quelle: e.quelle, quelleRef: ref, inhaltKennung: kennung, quelleUrl: e.link && googleDocId(e.link) ? `https://docs.google.com/document/d/${googleDocId(e.link)}/edit` : null, transkript })
    .onConflictDoNothing()
    .returning({ id: C.id });
  if (!row) {
    const alt = await vorhandenerCall(tenantId, ref, kennung);
    return { id: alt!.id, neu: false, punkte: 0, fehler: null };
  }
  if (e.auswerten === false) return { id: row.id, neu: true, punkte: 0, fehler: null };
  const r = await callAuswerten(tenantId, row.id);
  return { id: row.id, neu: true, ...r };
}

/**
 * Mehrere Calls auf einmal (z. B. alle Wochen-Calls der Deal-Gruppe): Dateien (Word, PDF, Text, Untertitel, ZIP)
 * und/oder eingefügte Google-Docs-Links bzw. kopierte Discord-Nachrichten. Legt nur an – die KI wertet danach
 * nacheinander im Hintergrund aus (offeneCallsAuswerten). Doppelte (gleiches Doc oder gleicher Inhalt) überspringt er.
 */
export async function callsSammelImport(
  tenantId: string,
  e: { art: CallArt; bezeichnung: string | null; linkText: string; dateien: { name: string; daten: Uint8Array }[]; heute: string },
): Promise<{ neu: number; vorhanden: string[]; fehler: string[]; ohneDatum: number }> {
  let neu = 0;
  let ohneDatum = 0;
  const vorhanden: string[] = [];
  const fehler: string[] = [];
  const dmy = (iso: string) => iso.split("-").reverse().join(".");
  const anlegen = async (quelle: { name: string; ref: string; text: string; url: string | null; titelHinweis: string | null; datumHinweis: string | null; geaendert: string | null; quelle: "datei" | "google_doc" }) => {
    const transkript = bereinigeTranskript(quelle.text);
    if (transkript.length < 20) {
      fehler.push(`${quelle.name}: leer oder zu kurz`);
      return;
    }
    const kennung = inhaltKennung(transkript);
    const ref = quelle.ref.startsWith("datei:") && kennung ? `datei:${kennung}` : quelle.ref;
    const alt = await vorhandenerCall(tenantId, ref, kennung);
    if (alt) {
      vorhanden.push(`${quelle.name} (= „${alt.titel}“ vom ${dmy(alt.datum)})`);
      return;
    }
    const t = callTitelUndDatum({ name: quelle.quelle === "datei" ? quelle.name : null, titelHinweis: quelle.titelHinweis, datumHinweis: quelle.datumHinweis, text: transkript, bezeichnung: e.bezeichnung, art: e.art, ersatzDatum: e.heute, geaendert: quelle.geaendert });
    const [row] = await db
      .insert(C)
      .values({ tenantId, titel: t.titel, datum: t.datum, art: e.art, quelle: quelle.quelle, quelleRef: ref, inhaltKennung: kennung, quelleUrl: quelle.url, transkript, auswertung: "offen" })
      .onConflictDoNothing()
      .returning({ id: C.id });
    if (!row) {
      vorhanden.push(quelle.name);
      return;
    }
    neu++;
    if (t.datumGeraten) ohneDatum++;
  };

  for (const l of linksMitKontext(e.linkText)) {
    const ref = `gdoc:${l.docId}`;
    const name = `Google Doc ${l.docId.slice(0, 8)}…`;
    const alt = await vorhandenerCall(tenantId, ref, null);
    if (alt) {
      vorhanden.push(`${name} (= „${alt.titel}“ vom ${dmy(alt.datum)})`);
      continue;
    }
    try {
      const text = await holeGoogleDoc(tenantId, l.docId);
      await anlegen({ name, ref, text, url: `https://docs.google.com/document/d/${l.docId}/edit`, titelHinweis: l.titel, datumHinweis: l.datum, geaendert: null, quelle: "google_doc" });
    } catch (err) {
      fehler.push(`${name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
  }

  const gelesen = await textAusCallDateien(e.dateien);
  fehler.push(...gelesen.fehler);
  for (const d of gelesen.dateien) {
    await anlegen({ name: d.name, ref: `datei:${d.name}`, text: d.text, url: null, titelHinweis: null, datumHinweis: null, geaendert: d.geaendert, quelle: "datei" });
  }
  return { neu, vorhanden, fehler, ohneDatum };
}

const LAEUFT = ((globalThis as { __callAuswertung?: Map<string, Promise<number>> }).__callAuswertung ??= new Map());

/**
 * Im Hintergrund: offene Calls auswerten, danach das Wissen aus Calls ziehen, bei denen es noch aussteht (auch
 * ältere Calls) – älteste zuerst, damit Spätere als „Ergänzung“ erkannt werden. Höchstens „max“ KI-Aufrufe je
 * Lauf; läuft je Firma nur einmal gleichzeitig.
 */
export function offeneCallsAuswerten(tenantId: string, max = 60): Promise<number> {
  const laufend = LAEUFT.get(tenantId);
  if (laufend) return laufend;
  const lauf = (async () => {
    const erledigt = new Set<string>();
    while (erledigt.size < max) {
      const [c] = await db.select({ id: C.id }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.auswertung, "offen"))).orderBy(C.datum).limit(1);
      if (!c || erledigt.has(c.id)) break;
      erledigt.add(c.id);
      await callAuswerten(tenantId, c.id);
    }
    if (!(await ki(tenantId))) return erledigt.size;
    const wissen = new Set<string>();
    while (erledigt.size + wissen.size < max) {
      const [c] = await db
        .select({ id: C.id })
        .from(C)
        .where(and(eq(C.tenantId, tenantId), isNull(C.wissenAm), ne(C.auswertung, "offen")))
        .orderBy(C.datum, C.createdAt)
        .limit(1);
      if (!c || wissen.has(c.id)) break;
      wissen.add(c.id);
      await wissenAusCall(tenantId, c.id);
    }
    return erledigt.size + wissen.size;
  })().finally(() => LAEUFT.delete(tenantId));
  LAEUFT.set(tenantId, lauf);
  return lauf;
}

const K = schema.knowledgeEntries;

/**
 * Wissen aus einem Call ins Wissen ziehen (ungeprüft, Herkunft „call“, mit Quelle und Zitat). Bei erneutem Lauf
 * werden nur die Einträge dieses Calls ersetzt, die noch niemand geprüft oder bearbeitet hat.
 */
export async function wissenAusCall(tenantId: string, callId: string): Promise<{ eintraege: number; fehler: string | null }> {
  const [c] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, callId)));
  if (!c) return { eintraege: 0, fehler: "Call nicht gefunden" };
  const k = await ki(tenantId);
  if (!k) return { eintraege: 0, fehler: "Keine KI-Anbindung (Anbindungen → Claude)" };
  if (c.transkript.replace(/\s+/g, "").length < 200) {
    await db.update(C).set({ wissenAm: new Date(), wissenFehler: "Transkript zu kurz" }).where(eq(C.id, callId));
    return { eintraege: 0, fehler: "Transkript zu kurz" };
  }
  try {
    const bekannt = await db
      .select({ title: K.title })
      .from(K)
      .where(and(eq(K.tenantId, tenantId), eq(K.origin, "call"), andererCall(callId)))
      .orderBy(desc(K.updatedAt))
      .limit(200);
    const antwort = await askClaude(k.apiKey, kiWissenAuftrag(c, KNOWLEDGE_CATEGORIES, bekannt.map((b) => b.title)), { model: k.model, task: "simple", maxTokens: 6000, timeoutMs: 180_000 });
    const wissen = leseKiWissen(antwort.text, KNOWLEDGE_CATEGORIES, c.art);
    const behalten = await db
      .select({ title: K.title })
      .from(K)
      .where(and(eq(K.tenantId, tenantId), eq(K.callId, callId), eq(K.origin, "call"), geprueftOderBearbeitet()));
    const vorhandeneTitel = new Set(behalten.map((b) => b.title.toLowerCase()));
    await db.delete(K).where(and(eq(K.tenantId, tenantId), eq(K.callId, callId), eq(K.origin, "call"), isNull(K.verifiedAt), isNull(K.updatedBy)));
    const neu = wissen.filter((w) => !vorhandeneTitel.has(w.titel.toLowerCase()));
    const marke = c.art === "gruppe" ? "Deal-Gruppe" : "Consultant-Call";
    if (neu.length)
      await db.insert(K).values(
        neu.map((w) => ({
          tenantId,
          kind: "article" as const,
          category: w.kategorie,
          title: w.titel,
          body: callWissenText(w, c),
          tags: [...new Set([...w.stichworte, marke, ERKENNTNIS_TEXT[w.art], ...(w.einschaetzung === "unsicher" ? ["unsicher"] : [])])].slice(0, 10),
          origin: "call" as const,
          insider: true,
          callId,
          callZitat: w.zitat,
          callStelle: w.zitat ? zitatPosition(c.transkript, w.zitat) : null,
          quelleDatum: c.datum,
          quelleWer: w.wer,
          erkenntnis: w.art,
        })),
      );
    await db.update(C).set({ wissenAm: new Date(), wissenFehler: null }).where(eq(C.id, callId));
    return { eintraege: neu.length, fehler: null };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await db.update(C).set({ wissenAm: new Date(), wissenFehler: msg }).where(eq(C.id, callId));
    return { eintraege: 0, fehler: msg };
  }
}

/** Einträge anderer Calls (oder ohne Call) – als „schon bekannt“ für die KI. */
const andererCall = (callId: string) => sql`(${K.callId} is null or ${K.callId} <> ${callId})`;
/** Geprüft oder von Hand bearbeitet – bleibt bei „Wissen neu ziehen“ stehen. */
const geprueftOderBearbeitet = () => sql`(${K.verifiedAt} is not null or ${K.updatedBy} is not null)`;

/**
 * Volltextsuche über alle Calls (Transkript und Zusammenfassung): zuerst Calls mit allen Suchwörtern, dann die
 * mit den meisten; je Call bis zu drei Ausschnitte.
 */
export async function callsDurchsuchen(tenantId: string, suche: string, o: { art?: CallArt; limit?: number } = {}) {
  const rows = await db
    .select({ id: C.id, titel: C.titel, datum: C.datum, art: C.art, transkript: C.transkript, zusammenfassung: C.zusammenfassung })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), o.art ? eq(C.art, o.art) : undefined))
    .orderBy(desc(C.datum))
    .limit(1000);
  const gesucht = new Set(suche.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2)).size;
  return rows
    .map((c) => {
      const z = c.zusammenfassung;
      const zText = z ? [z.ueberblick, ...z.themen.map((t) => `${t.name}: ${t.punkte.join(" ")}`)].join(" ") : "";
      const r = trefferImText(`${c.titel}\n${zText}\n${c.transkript}`, suche);
      return { id: c.id, titel: c.titel, datum: c.datum, art: c.art, ...r };
    })
    .filter((c) => c.treffer > 0)
    .sort((a, b) => b.woerter - a.woerter || b.treffer - a.treffer || b.datum.localeCompare(a.datum))
    .slice(0, o.limit ?? 5)
    .map((c) => ({ ...c, alleWoerter: c.woerter >= gesucht }));
}

/** Wissenseinträge eines Calls (für die Call-Seite). */
export async function wissenZumCall(tenantId: string, callId: string) {
  return db
    .select({ id: K.id, title: K.title, category: K.category, verifiedAt: K.verifiedAt, tags: K.tags, erkenntnis: K.erkenntnis, quelleWer: K.quelleWer, callStelle: K.callStelle })
    .from(K)
    .where(and(eq(K.tenantId, tenantId), eq(K.callId, callId), eq(K.origin, "call")))
    .orderBy(K.title);
}

/** Wie viel Wissen aus Calls es gibt und wie viele Calls noch ausstehen (für die Calls-Seite). */
export async function wissenStand(tenantId: string): Promise<{ eintraege: number; ausstehend: number }> {
  const [[e], [a]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.origin, "call"))),
    db.select({ n: sql<number>`count(*)::int` }).from(C).where(and(eq(C.tenantId, tenantId), isNull(C.wissenAm))),
  ]);
  return { eintraege: e.n, ausstehend: a.n };
}

/** „Wissen neu ziehen“ für einen Call: wieder als ausstehend markieren – der Hintergrund holt es nach. */
export async function wissenNeuAnstossen(tenantId: string, callId: string) {
  await db.update(C).set({ wissenAm: null, wissenFehler: null }).where(and(eq(C.tenantId, tenantId), eq(C.id, callId)));
}

/** Titel, Datum und Art von Hand korrigieren (z. B. wenn im Dateinamen kein Datum stand). */
export async function callBearbeiten(tenantId: string, id: string, e: { titel: string; datum: string; art: CallArt }) {
  await db.update(C).set({ titel: e.titel.slice(0, 200), datum: e.datum, art: e.art }).where(and(eq(C.tenantId, tenantId), eq(C.id, id)));
  // Das Call-Datum steht auch an den Erkenntnissen (Haltbarkeit) – mitziehen.
  await db.update(K).set({ quelleDatum: e.datum }).where(and(eq(K.tenantId, tenantId), eq(K.callId, id)));
}

/** KI zieht Vereinbarungen, Aufgaben, Entscheidungen und offene Fragen. Ersetzt nur unbearbeitete Vorschläge. */
export async function callAuswerten(tenantId: string, callId: string): Promise<{ punkte: number; fehler: string | null }> {
  const [c] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, callId)));
  if (!c) return { punkte: 0, fehler: "Call nicht gefunden" };
  const k = await ki(tenantId);
  if (!k) {
    await db.update(C).set({ auswertung: "ohne_ki", auswertungFehler: "Keine KI-Anbindung (Anbindungen → Claude)" }).where(eq(C.id, callId));
    return { punkte: 0, fehler: "Keine KI-Anbindung – Punkte bitte von Hand erfassen." };
  }
  try {
    const antwort = await askClaude(k.apiKey, kiAuftrag(c.titel, c.datum, c.transkript, c.art), { model: k.model, task: "simple", maxTokens: 4000, timeoutMs: 120_000 });
    const punkte = leseKiPunkte(antwort.text);
    const zusammenfassung = leseKiZusammenfassung(antwort.text);
    await db.delete(P).where(and(eq(P.tenantId, tenantId), eq(P.callId, callId), eq(P.status, "vorschlag")));
    if (punkte.length)
      await db.insert(P).values(punkte.map((p) => ({ tenantId, callId, art: p.art, text: p.text, verantwortlich: p.verantwortlich, frist: p.frist, zitat: p.zitat, position: zitatPosition(c.transkript, p.zitat) })));
    await db.update(C).set({ auswertung: "fertig", auswertungFehler: null, ...(zusammenfassung ? { zusammenfassung } : {}) }).where(eq(C.id, callId));
    return { punkte: punkte.length, fehler: null };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await db.update(C).set({ auswertung: "fehler", auswertungFehler: msg }).where(eq(C.id, callId));
    return { punkte: 0, fehler: msg };
  }
}

/**
 * Einmaliger Umzug aus dem bisherigen Call-Archiv (claude.ai-Seite): Export-Datei (JSON) mit Zusammenfassung und
 * Transkript. To-dos, Entscheidungen und offene Fragen werden Vorschläge (Aufgaben erst nach Bestätigung). Calls,
 * die es schon gibt (gleiches Google-Doc oder gleiche Archiv-ID), werden übersprungen.
 */
export async function archivImportieren(tenantId: string, roh: unknown): Promise<{ neu: number; vorhanden: number; fehler: string | null }> {
  const { calls: liste, fehler } = leseArchivExport(roh);
  if (fehler) return { neu: 0, vorhanden: 0, fehler };
  let neu = 0;
  let vorhanden = 0;
  for (const a of liste) {
    const docId = a.quelleUrl ? googleDocId(a.quelleUrl) : null;
    const ref = docId ? `gdoc:${docId}` : `archiv:${a.externeId}`;
    const transkript = bereinigeTranskript(a.transkript);
    const kennung = inhaltKennung(transkript);
    if (await vorhandenerCall(tenantId, ref, kennung)) {
      vorhanden++;
      continue;
    }
    const [row] = await db
      .insert(C)
      .values({ tenantId, titel: a.titel, datum: a.datum, quelle: "archiv", quelleRef: ref, inhaltKennung: kennung, quelleUrl: a.quelleUrl, transkript: transkript || "(Im Export war kein Transkript enthalten.)", zusammenfassung: a.zusammenfassung, auswertung: "fertig" })
      .onConflictDoNothing()
      .returning({ id: C.id });
    if (!row) {
      vorhanden++;
      continue;
    }
    if (a.punkte.length) await db.insert(P).values(a.punkte.map((p) => ({ tenantId, callId: row.id, art: p.art, text: p.text, verantwortlich: p.verantwortlich, frist: p.frist })));
    neu++;
  }
  return { neu, vorhanden, fehler: null };
}

/** Punkt von Hand ergänzen (z. B. ohne KI). */
export async function punktAnlegen(tenantId: string, callId: string, p: { art: PunktArt; text: string; verantwortlich: string | null; frist: string | null }) {
  const [c] = await db.select({ id: C.id }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, callId)));
  if (!c) return false;
  await db.insert(P).values({ tenantId, callId, ...p });
  return true;
}

/** Vorschlag bestätigen: eigene Aufgaben werden Aufgaben (Kategorie Amazon/SAS) mit Link zur Call-Stelle. */
export async function punkteUebernehmen(tenantId: string, userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db
    .select({ p: P, titel: C.titel, datum: C.datum })
    .from(P)
    .innerJoin(C, eq(C.id, P.callId))
    .where(and(eq(P.tenantId, tenantId), inArray(P.id, ids), eq(P.status, "vorschlag")));
  let n = 0;
  for (const { p, titel, datum } of rows) {
    let taskId: string | null = null;
    if (istEigeneAufgabe(p)) {
      const [t] = await db
        .insert(schema.tasks)
        .values({
          tenantId,
          title: p.text.slice(0, 300),
          notes: [`Aus dem Call „${titel}“ vom ${datum.split("-").reverse().join(".")}.`, p.verantwortlich ? `Verantwortlich: ${p.verantwortlich}.` : null, p.zitat ? `Im Call: „${p.zitat}“` : null].filter(Boolean).join("\n"),
          category: "amazon",
          dueDate: p.frist,
          link: `/calls/${p.callId}#p-${p.id}`,
          createdBy: userId,
        })
        .returning({ id: schema.tasks.id });
      taskId = t.id;
    }
    await db.update(P).set({ status: "uebernommen", taskId, geaendertAm: new Date() }).where(eq(P.id, p.id));
    n++;
  }
  return n;
}

export async function punktStatus(tenantId: string, id: string, status: "verworfen" | "geklaert" | "vorschlag") {
  await db.update(P).set({ status, geaendertAm: new Date() }).where(and(eq(P.tenantId, tenantId), eq(P.id, id)));
}

export async function callsListe(tenantId: string, o: { von?: string; bis?: string; art?: CallArt } = {}) {
  const calls = await db
    .select({ id: C.id, titel: C.titel, datum: C.datum, art: C.art, quelle: C.quelle, auswertung: C.auswertung, auswertungFehler: C.auswertungFehler, zusammenfassung: C.zusammenfassung })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), o.von ? gte(C.datum, o.von) : undefined, o.bis ? lte(C.datum, o.bis) : undefined, o.art ? eq(C.art, o.art) : undefined))
    .orderBy(desc(C.datum), desc(C.createdAt))
    .limit(200);
  const punkte = calls.length ? await db.select({ callId: P.callId, art: P.art, status: P.status }).from(P).where(and(eq(P.tenantId, tenantId), inArray(P.callId, calls.map((c) => c.id)))) : [];
  return calls.map((c) => {
    const p = punkte.filter((x) => x.callId === c.id);
    return { ...c, vorschlaege: p.filter((x) => x.status === "vorschlag").length, aufgaben: p.filter((x) => x.art === "aufgabe" && x.status !== "verworfen").length, fragenOffen: p.filter((x) => x.art === "frage" && (x.status === "vorschlag" || x.status === "uebernommen")).length };
  });
}

export async function callDetail(tenantId: string, id: string) {
  const [c] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.id, id)));
  if (!c) return null;
  const punkte = await db
    .select({ p: P, taskStatus: schema.tasks.status, taskTitel: schema.tasks.title })
    .from(P)
    .leftJoin(schema.tasks, eq(schema.tasks.id, P.taskId))
    .where(and(eq(P.tenantId, tenantId), eq(P.callId, id)))
    .orderBy(P.position, P.createdAt);
  return { call: c, punkte: punkte.map((x) => ({ ...x.p, aufgabeStatus: x.taskStatus, aufgabeTitel: x.taskTitel })) };
}

/** Vor dem nächsten Call: offene Aufgaben aus Calls, offene Fragen, Punkte beim Consultant, Kennzahlen. */
export async function offenePunkte(tenantId: string, heute: string) {
  const T = schema.tasks;
  const rows = await db
    .select({ p: P, callTitel: C.titel, callDatum: C.datum, callArt: C.art, taskStatus: T.status, taskFaellig: T.dueDate })
    .from(P)
    .innerJoin(C, eq(C.id, P.callId))
    .leftJoin(T, eq(T.id, P.taskId))
    .where(and(eq(P.tenantId, tenantId), inArray(P.status, ["uebernommen", "vorschlag"])))
    .orderBy(desc(C.datum));
  const aufgabenOffen = rows.filter((r) => r.p.art === "aufgabe" && r.p.status === "uebernommen" && r.p.taskId && r.taskStatus === "open");
  const aufgabenErledigt = await db
    .select({ id: P.id })
    .from(P)
    .innerJoin(T, eq(T.id, P.taskId))
    .where(and(eq(P.tenantId, tenantId), isNotNull(P.taskId), eq(T.status, "done"), gte(T.completedAt, new Date(`${addDaysIso(heute, -45)}T00:00:00Z`))));
  const consultant = rows.filter((r) => r.p.art === "aufgabe" && r.callArt === "consultant" && !istEigeneAufgabe(r.p));
  const fragen = rows.filter((r) => r.p.art === "frage");
  const vorschlaege = rows.filter((r) => r.p.status === "vorschlag").length;
  // Kennzahlen wie im „Business-Plan-Update“: Umsatz/Gewinn Monat bis heute und letzter Monat (sellerboard).
  const { sellerboardRange } = await import("@/lib/sellerboard/sales");
  const monatAnfang = `${heute.slice(0, 7)}-01`;
  const vorEnde = addDaysIso(monatAnfang, -1);
  const vorAnfang = `${vorEnde.slice(0, 7)}-01`;
  const [laufend, vormonat] = await Promise.all([sellerboardRange(tenantId, monatAnfang, heute).catch(() => null), sellerboardRange(tenantId, vorAnfang, vorEnde).catch(() => null)]);
  return { aufgabenOffen, erledigtSeitLetztem: aufgabenErledigt.length, consultant, fragen, vorschlaege, kpis: { laufend, vormonat } };
}

// ---- Discord-Kanal (wöchentlich)

type DiscordMsg = { id: string; content?: string; timestamp?: string; embeds?: { url?: string; title?: string; description?: string }[] };

/**
 * Google-Doc-Links aus dem Call-Kanal importieren. Wöchentlich reichen die letzten 50 Nachrichten; „nachholen“ liest
 * bis zu 2.000 ältere (seitenweise je 100). Legt nur an – die KI wertet danach im Hintergrund aus.
 */
export async function discordCallsImport(tenantId: string, heute: string, o: { nachrichten?: number } = {}): Promise<{ neu: number; fehler: string[]; gelesen: number }> {
  const cfg = await getIntegration(tenantId, "discord_calls");
  if (!cfg?.botToken || !cfg.kanalId) return { neu: 0, fehler: [], gelesen: 0 };
  const art: CallArt = cfg.art === "consultant" ? "consultant" : "gruppe";
  const ziel = Math.min(Math.max(o.nachrichten ?? 50, 1), 2000);
  const msgs: DiscordMsg[] = [];
  let vor: string | null = null;
  while (msgs.length < ziel) {
    const limit = Math.min(100, ziel - msgs.length);
    const r = await fetch(`${DISCORD()}/channels/${encodeURIComponent(cfg.kanalId)}/messages?limit=${limit}${vor ? `&before=${vor}` : ""}`, { headers: { Authorization: `Bot ${cfg.botToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`Discord: Kanal nicht lesbar (${r.status}) – Bot-Token, Kanal-ID und Leserechte des Bots prüfen.`);
    const seite = (await r.json()) as DiscordMsg[];
    msgs.push(...seite);
    if (seite.length < limit) break;
    vor = seite[seite.length - 1].id;
  }
  let neu = 0;
  const fehler: string[] = [];
  for (const m of [...msgs].reverse()) {
    const text = [m.content ?? "", ...(m.embeds ?? []).flatMap((e) => [e.url ?? "", e.title ?? "", e.description ?? ""])].join("\n");
    for (const docId of googleDocLinks(text)) {
      const ersteZeile = (m.content ?? "").split("\n")[0].replace(/https?:\/\/\S+/g, "").trim();
      const datum = datumAusText(`${ersteZeile} ${m.content ?? ""}`, m.timestamp ? m.timestamp.slice(0, 10) : heute);
      try {
        const res = await callImportieren(tenantId, { titel: ersteZeile || `${art === "gruppe" ? "Wochen-Call Deal-Gruppe" : "Consultant-Call"} ${datum.split("-").reverse().join(".")}`, datum, link: `https://docs.google.com/document/d/${docId}/edit`, quelle: "discord", quelleRef: `gdoc:${docId}`, art, auswerten: false });
        if (res.neu) neu++;
      } catch (e) {
        fehler.push(`${docId.slice(0, 8)}…: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
  }
  return { neu, fehler, gelesen: msgs.length };
}
