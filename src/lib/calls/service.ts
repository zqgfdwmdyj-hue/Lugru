import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { addDaysIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { driveToken } from "@/lib/integrations/clients/drive";
import { bereinigeTranskript, datumAusText, googleDocId, googleDocLinks, istEigeneAufgabe, kiAuftrag, leseArchivExport, leseKiPunkte, leseKiZusammenfassung, zitatPosition, type PunktArt } from "./logic";

// Call-Archiv: Import (Text, Google-Doc-Link, wöchentlich aus einem Discord-Kanal), KI-Auswertung, Vorschläge →
// Aufgaben nach Bestätigung, offene Punkte für den nächsten Call.

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

/** Call anlegen (Doppel über die Quelle verhindern) und gleich auswerten. */
export async function callImportieren(
  tenantId: string,
  e: { titel: string; datum: string; text?: string; link?: string; quelle: "text" | "google_doc" | "discord"; quelleRef?: string | null },
): Promise<{ id: string; neu: boolean; punkte: number; fehler: string | null }> {
  let text = e.text ?? "";
  let ref = e.quelleRef ?? null;
  if (e.link) {
    const docId = googleDocId(e.link);
    if (!docId) throw new Error("Kein Google-Docs-Link erkannt (…docs.google.com/document/d/…).");
    ref = ref ?? `gdoc:${docId}`;
    const [alt] = await db.select({ id: C.id }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.quelleRef, ref)));
    if (alt) return { id: alt.id, neu: false, punkte: 0, fehler: null };
    text = await holeGoogleDoc(tenantId, docId);
  }
  const transkript = bereinigeTranskript(text);
  if (transkript.length < 20) throw new Error("Das Transkript ist leer oder zu kurz.");
  const [row] = await db
    .insert(C)
    .values({ tenantId, titel: e.titel.slice(0, 200), datum: e.datum, quelle: e.quelle, quelleRef: ref, quelleUrl: e.link && googleDocId(e.link) ? `https://docs.google.com/document/d/${googleDocId(e.link)}/edit` : null, transkript })
    .onConflictDoNothing()
    .returning({ id: C.id });
  if (!row) {
    const [alt] = await db.select({ id: C.id }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.quelleRef, ref!)));
    return { id: alt.id, neu: false, punkte: 0, fehler: null };
  }
  const r = await callAuswerten(tenantId, row.id);
  return { id: row.id, neu: true, ...r };
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
    const antwort = await askClaude(k.apiKey, kiAuftrag(c.titel, c.datum, c.transkript), { model: k.model, task: "simple", maxTokens: 4000, timeoutMs: 120_000 });
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
    const [row] = await db
      .insert(C)
      .values({ tenantId, titel: a.titel, datum: a.datum, quelle: "archiv", quelleRef: ref, quelleUrl: a.quelleUrl, transkript: bereinigeTranskript(a.transkript) || "(Im Export war kein Transkript enthalten.)", zusammenfassung: a.zusammenfassung, auswertung: "fertig" })
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

export async function callsListe(tenantId: string, o: { von?: string; bis?: string } = {}) {
  const calls = await db
    .select({ id: C.id, titel: C.titel, datum: C.datum, quelle: C.quelle, auswertung: C.auswertung, auswertungFehler: C.auswertungFehler, zusammenfassung: C.zusammenfassung })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), o.von ? gte(C.datum, o.von) : undefined, o.bis ? lte(C.datum, o.bis) : undefined))
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
    .select({ p: P, callTitel: C.titel, callDatum: C.datum, taskStatus: T.status, taskFaellig: T.dueDate })
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
  const consultant = rows.filter((r) => r.p.art === "aufgabe" && !istEigeneAufgabe(r.p));
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

/** Neue Google-Doc-Links aus dem Call-Kanal importieren (höchstens die letzten 50 Nachrichten). */
export async function discordCallsImport(tenantId: string, heute: string): Promise<{ neu: number; fehler: string[] }> {
  const cfg = await getIntegration(tenantId, "discord_calls");
  if (!cfg?.botToken || !cfg.kanalId) return { neu: 0, fehler: [] };
  const r = await fetch(`${DISCORD()}/channels/${encodeURIComponent(cfg.kanalId)}/messages?limit=50`, { headers: { Authorization: `Bot ${cfg.botToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Discord: Kanal nicht lesbar (${r.status}) – Bot-Token, Kanal-ID und Leserechte des Bots prüfen.`);
  const msgs = (await r.json()) as DiscordMsg[];
  let neu = 0;
  const fehler: string[] = [];
  for (const m of [...msgs].reverse()) {
    const text = [m.content ?? "", ...(m.embeds ?? []).flatMap((e) => [e.url ?? "", e.title ?? "", e.description ?? ""])].join("\n");
    for (const docId of googleDocLinks(text)) {
      const ersteZeile = (m.content ?? "").split("\n")[0].replace(/https?:\/\/\S+/g, "").trim();
      const datum = datumAusText(`${ersteZeile} ${m.content ?? ""}`, m.timestamp ? m.timestamp.slice(0, 10) : heute);
      try {
        const res = await callImportieren(tenantId, { titel: ersteZeile || `Consultant-Call ${datum.split("-").reverse().join(".")}`, datum, link: `https://docs.google.com/document/d/${docId}/edit`, quelle: "discord", quelleRef: `gdoc:${docId}` });
        if (res.neu) neu++;
      } catch (e) {
        fehler.push(`${docId.slice(0, 8)}…: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
  }
  return { neu, fehler };
}
