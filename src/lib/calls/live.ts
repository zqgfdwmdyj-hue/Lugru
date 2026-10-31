import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { recordJob } from "@/lib/today/jobs";
import { textAusCallDateien } from "./dateien";
import { callTitelAus, htmlText, nachrichtLink, sprecherAus, transkriptKandidat, type DiscordNachricht, type TranskriptLink } from "./live-logic";
import { bereinigeTranskript, CALL_ART_TEXT, datumAusText, googleDocId, inhaltKennung, type CallArt } from "./logic";
import { callAuswerten, callImportieren, holeGoogleDoc, wissenAusCall } from "./service";

// B21: Call-Transkripte aus dem Discord-Call-Kanal sofort verarbeiten – ausgelöst live über die Discord-Verbindung
// (MESSAGE_CREATE/MESSAGE_UPDATE), als Sicherheitsnetz täglich 06:00 für die letzten 7 Tage. Eine Kette: Datei holen →
// Call-Archiv → KI-Auswertung (Punkte, Wissen) → Push an die Inhaber. Fehler → Aufgabe mit Link zur Nachricht.

const C = schema.calls;
const DISCORD = () => (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");
export const LIVE_JOB = "Call-Archiv (Discord live)";
export const NETZ_JOB = "Call-Archiv (Discord, Sicherheitsnetz)";

/** Gerade in Arbeit (gleiche Nachricht nicht zweimal gleichzeitig). */
const LAEUFT = new Set<string>();

export type LiveErgebnis = { status: "kein_transkript" | "schon_da" | "neu" | "ersetzt" | "fehler"; callId?: string; wissen?: number; aufgaben?: number; fehler?: string[] };

async function inhaberIds(tenantId: string): Promise<string[]> {
  const rows = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"), eq(schema.memberships.readOnly, false)));
  return rows.map((r) => r.userId);
}

/** Text hinter einem Transkript-Link: Google Doc über die bestehende Anbindung, sonst öffentlich lesbare Seite. */
async function linkText(tenantId: string, l: TranskriptLink): Promise<string> {
  if (l.art === "google_doc") return holeGoogleDoc(tenantId, googleDocId(l.url)!);
  const r = await fetch(l.url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!r.ok) throw new Error(`Link nicht lesbar (${r.status})`);
  const t = htmlText(await r.text());
  if (t.length < 500) throw new Error("Link verlangt eine Anmeldung oder enthält kein Transkript – bitte das Transkript als Datei in den Kanal laden");
  return t;
}

/** Fehler → offene Aufgabe für die Inhaber (eine je Nachricht, nicht still verwerfen). */
async function fehlerAufgabe(tenantId: string, m: DiscordNachricht, kanalId: string, gruende: string[]) {
  const link = nachrichtLink(m.guild_id, kanalId, m.id);
  const T = schema.tasks;
  const key = `call-discord:${m.id}`;
  const notes = `Ein Call-Transkript aus dem Discord-Call-Kanal konnte nicht (vollständig) verarbeitet werden:\n${gruende.map((g) => `- ${g}`).join("\n")}\n\nNachricht in Discord: ${link}\nTipp: Transkript als .txt/.docx/.pdf (bis 25 MB) erneut hochladen oder unter Calls → „Call hinzufügen“ einfügen.`;
  const [alt] = await db.select({ id: T.id }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.systemKey, key))).limit(1);
  if (alt) await db.update(T).set({ notes, status: "open" }).where(eq(T.id, alt.id));
  else await db.insert(T).values({ tenantId, title: "Call-Transkript aus Discord nicht verarbeitet", notes, dueDate: todayIso(), priority: "normal", category: "amazon", systemKey: key, link: "/calls" }).onConflictDoNothing();
}

/**
 * Eine Discord-Nachricht aus dem Call-Kanal verarbeiten. `bearbeitet`: Nachricht wurde geändert (Anhang ersetzt) →
 * vorhandenen Call ersetzen statt doppelt anlegen. `auswerten: false` nur fürs Nachholen vieler Nachrichten (die KI
 * wertet dann im Hintergrund aus).
 */
export async function callNachrichtVerarbeiten(tenantId: string, m: DiscordNachricht, o: { bearbeitet?: boolean; auswerten?: boolean; quelle?: "live" | "netz" | "hand" } = {}): Promise<LiveErgebnis> {
  const cfg = await getIntegration(tenantId, "discord_calls");
  if (!cfg?.botToken || !cfg.kanalId) return { status: "kein_transkript" };
  const kanalId = String(cfg.kanalId);
  if (m.channel_id && m.channel_id !== kanalId) return { status: "kein_transkript" };
  const k = transkriptKandidat(m);
  if (!k) return { status: "kein_transkript" };
  const ref = `discord:${m.id}`;
  const sperre = `${tenantId}:${m.id}`;
  if (LAEUFT.has(sperre)) return { status: "schon_da" };
  LAEUFT.add(sperre);
  const t0 = Date.now();
  try {
    const [alt] = await db.select({ id: C.id, kennung: C.inhaltKennung }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.quelleRef, ref))).limit(1);
    if (alt && !o.bearbeitet) return { status: "schon_da", callId: alt.id };
    // Ältere Google-Doc-Importe (gleiches Dokument) nicht noch einmal anlegen.
    if (!alt && !o.bearbeitet && k.links.length && !k.anhaenge.length && !k.langerText) {
      const docs = k.links.filter((l) => l.art === "google_doc").map((l) => `gdoc:${googleDocId(l.url)}`);
      if (docs.length === k.links.length) {
        const [vorhanden] = await db.select({ id: C.id }).from(C).where(and(eq(C.tenantId, tenantId), sql`${C.quelleRef} in (${sql.join(docs.map((d) => sql`${d}`), sql`, `)})`)).limit(1);
        if (vorhanden) return { status: "schon_da", callId: vorhanden.id };
      }
    }

    // Nur ein Google-Doc-Link: wie bisher über die Doc-Kennung (Link bleibt am Call, gleiche Doc nie doppelt).
    if (!alt && !k.anhaenge.length && !k.zuGross.length && !k.langerText && k.links.length === 1 && k.links[0].art === "google_doc") {
      const art: CallArt = cfg.art === "consultant" ? "consultant" : "gruppe";
      const titelRoh = callTitelAus(m);
      const datum = datumAusText(`${titelRoh ?? ""} ${m.content ?? ""}`, m.timestamp ? m.timestamp.slice(0, 10) : todayIso());
      const r = await callImportieren(tenantId, { titel: titelRoh || `${CALL_ART_TEXT[art]} ${datum.split("-").reverse().join(".")}`, datum, link: k.links[0].url, quelle: "discord", art, auswerten: false });
      if (!r.neu) return { status: "schon_da", callId: r.id };
      return nachAuswerten(tenantId, r.id, "neu", [], o, t0);
    }
    const fehler: string[] = k.zuGross.map((a) => `${a.filename}: zu groß (über 25 MB)`);
    const teile: string[] = [];
    // Anhänge: herunterladen und lesen (mehrere Anhänge = ein Call, in der Reihenfolge der Nachricht).
    const dateien: { name: string; daten: Uint8Array }[] = [];
    for (const a of k.anhaenge) {
      try {
        if (!a.url) throw new Error("keine Download-Adresse");
        const r = await fetch(a.url, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status})`);
        const daten = new Uint8Array(await r.arrayBuffer());
        if (daten.length > 25 * 1024 * 1024) throw new Error("zu groß (über 25 MB)");
        dateien.push({ name: a.filename, daten });
      } catch (e) {
        fehler.push(`${a.filename}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (dateien.length) {
      const r = await textAusCallDateien(dateien);
      fehler.push(...r.fehler);
      for (const d of r.dateien) if (d.text.trim()) teile.push(dateien.length > 1 ? `=== ${d.name} ===\n${d.text}` : d.text);
    }
    if (k.langerText) teile.push((m.content ?? "").trim());
    for (const l of k.links) {
      try {
        teile.push(await linkText(tenantId, l));
      } catch (e) {
        fehler.push(`${l.url}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      }
    }
    const transkript = bereinigeTranskript(teile.join("\n\n"));
    if (transkript.length < 20) {
      if (!fehler.length) fehler.push("Kein lesbarer Text gefunden (Sprache bzw. Format nicht erkannt).");
      await fehlerAufgabe(tenantId, m, kanalId, fehler);
      await recordJob(tenantId, o.quelle === "netz" ? NETZ_JOB : LIVE_JOB, `Nachricht ${m.id}: ${fehler[0]}`, Date.now() - t0);
      return { status: "fehler", fehler };
    }
    const art: CallArt = cfg.art === "consultant" ? "consultant" : "gruppe";
    const tag = m.timestamp ? m.timestamp.slice(0, 10) : todayIso();
    const titelRoh = callTitelAus(m);
    const datum = datumAusText(`${titelRoh ?? ""} ${(m.content ?? "").slice(0, 300)} ${(m.attachments ?? []).map((a) => a.filename).join(" ")}`, tag);
    const titel = titelRoh || `${CALL_ART_TEXT[art]} ${datum.split("-").reverse().join(".")}`;

    let callId: string;
    let status: LiveErgebnis["status"];
    if (alt) {
      // Bearbeitete Nachricht: gleichen Eintrag ersetzen – nur wenn sich der Inhalt geändert hat.
      const kennung = inhaltKennung(transkript);
      if (kennung && kennung === alt.kennung) return { status: "schon_da", callId: alt.id };
      await db.update(C).set({ titel: titel.slice(0, 200), datum, transkript, inhaltKennung: kennung, auswertung: "offen", auswertungFehler: null, wissenAm: null, wissenFehler: null }).where(eq(C.id, alt.id));
      callId = alt.id;
      status = "ersetzt";
    } else {
      const r = await callImportieren(tenantId, { titel, datum, text: transkript, quelle: "discord", quelleRef: ref, art, auswerten: false });
      if (!r.neu) return { status: "schon_da", callId: r.id };
      callId = r.id;
      status = "neu";
    }
    if (fehler.length) await fehlerAufgabe(tenantId, m, kanalId, fehler);
    return nachAuswerten(tenantId, callId, status, fehler, o, t0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await fehlerAufgabe(tenantId, m, kanalId, [msg]);
    await recordJob(tenantId, o.quelle === "netz" ? NETZ_JOB : LIVE_JOB, msg, Date.now() - t0);
    return { status: "fehler", fehler: [msg] };
  } finally {
    LAEUFT.delete(sperre);
  }
}

/** Direkt im Anschluss auswerten (Punkte, Wissen) und die Inhaber per Push informieren. */
async function nachAuswerten(tenantId: string, callId: string, status: "neu" | "ersetzt", fehler: string[], o: { auswerten?: boolean; quelle?: "live" | "netz" | "hand" }, t0: number): Promise<LiveErgebnis> {
  const job = o.quelle === "netz" ? NETZ_JOB : LIVE_JOB;
  if (o.auswerten === false) {
    await recordJob(tenantId, job, null, Date.now() - t0);
    return { status, callId, fehler: fehler.length ? fehler : undefined };
  }
  const a = await callAuswerten(tenantId, callId);
  const w = await wissenAusCall(tenantId, callId);
  const [c] = await db.select({ titel: C.titel, datum: C.datum, transkript: C.transkript }).from(C).where(eq(C.id, callId));
  const [{ n: aufgaben }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.callPunkte).where(and(eq(schema.callPunkte.tenantId, tenantId), eq(schema.callPunkte.callId, callId), eq(schema.callPunkte.art, "aufgabe")));
  const sprecher = c ? sprecherAus(c.transkript) : [];
  const datum = c ? c.datum.split("-").reverse().join(".") : "";
  const { melden } = await import("@/lib/push/service");
  await melden(tenantId, await inhaberIds(tenantId), {
    titel: `Call vom ${datum} ausgewertet`,
    text: `${c?.titel ?? "Call"}: ${w.eintraege} Wissenseintr${w.eintraege === 1 ? "ag" : "äge"}, ${aufgaben} Aufgabe${aufgaben === 1 ? "" : "n"}${sprecher.length ? ` · Sprecher: ${sprecher.slice(0, 4).join(", ")}` : ""}${status === "ersetzt" ? " (aktualisierte Fassung)" : ""}${a.fehler ? ` · Auswertung: ${a.fehler}` : ""}`,
    link: `/calls/${callId}`,
  });
  await recordJob(tenantId, job, null, Date.now() - t0);
  return { status, callId, wissen: w.eintraege, aufgaben, fehler: fehler.length ? fehler : undefined };
}

/** Nachrichten des Call-Kanals seit `tage` Tagen (neueste zuerst, höchstens `max`). */
export async function kanalNachrichten(tenantId: string, o: { tage?: number; max?: number } = {}): Promise<DiscordNachricht[]> {
  const cfg = await getIntegration(tenantId, "discord_calls");
  if (!cfg?.botToken || !cfg.kanalId) return [];
  const grenze = o.tage ? Date.now() - o.tage * 86_400_000 : 0;
  const max = Math.min(Math.max(o.max ?? 500, 1), 2000);
  const out: DiscordNachricht[] = [];
  let vor: string | null = null;
  while (out.length < max) {
    const limit = Math.min(100, max - out.length);
    const r = await fetch(`${DISCORD()}/channels/${encodeURIComponent(String(cfg.kanalId))}/messages?limit=${limit}${vor ? `&before=${vor}` : ""}`, { headers: { Authorization: `Bot ${cfg.botToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`Discord: Kanal nicht lesbar (${r.status}) – Bot-Token, Kanal-ID und Leserechte des Bots prüfen.`);
    const seite = (await r.json()) as DiscordNachricht[];
    for (const m of seite) {
      if (grenze && m.timestamp && Date.parse(m.timestamp) < grenze) return out;
      out.push({ ...m, channel_id: m.channel_id ?? String(cfg.kanalId) });
    }
    if (seite.length < limit) break;
    vor = seite[seite.length - 1].id;
  }
  return out;
}

/** Sicherheitsnetz (täglich 06:00): die letzten 7 Tage nachlesen und alles verarbeiten, was fehlt. */
export async function callsSicherheitsnetz(tenantId: string, tage = 7): Promise<{ gelesen: number; neu: number; fehler: number }> {
  const t0 = Date.now();
  try {
    const msgs = await kanalNachrichten(tenantId, { tage });
    let neu = 0;
    let fehler = 0;
    for (const m of [...msgs].reverse()) {
      const r = await callNachrichtVerarbeiten(tenantId, m, { quelle: "netz", bearbeitet: Boolean(m.edited_timestamp) });
      if (r.status === "neu" || r.status === "ersetzt") neu++;
      if (r.status === "fehler") fehler++;
    }
    await recordJob(tenantId, NETZ_JOB, null, Date.now() - t0);
    return { gelesen: msgs.length, neu, fehler };
  } catch (e) {
    await recordJob(tenantId, NETZ_JOB, e instanceof Error ? e.message : String(e), Date.now() - t0);
    throw e;
  }
}
