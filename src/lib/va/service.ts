import "server-only";
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { linkAllowed, STAFF_AREAS } from "@/lib/auth/areas";
import type { Session } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { publicUrl } from "@/lib/public-url";
import { berlinMidnight } from "@/lib/today/service";
import { anhangLaden, discord, DiscordFehler, type DcDatei, type DcNachricht } from "./discord";
import * as L from "./logic";
import { BOT, notizFuerSprache, type Sprache } from "./sprache";
import { uebersetzen, vaSprache } from "./uebersetzen";

// VA über Discord: Aufgabe zuweisen → eigener Thread (Anleitung, Anhänge, Erwähnung der VA); Abgleich alle 30 s:
// Kanal (neue Nachrichten der VA einordnen, Datenfragen automatisch beantworten, sonst Aufgabe für Ludwig),
// Threads (✅/„erledigt“ → Aufgabe erledigt, Frage/❓ → Rückfrage, Dateien an die Aufgabe), Erinnerungen
// (Fälligkeitstag, überfällig täglich; nie in der Ruhezeit). Ludwigs Antwort aus dem Tool geht in den Thread.

const VT = schema.vaThreads;
const VN = schema.vaNachrichten;
const T = schema.tasks;
const K = schema.knowledgeEntries;

export type VaCfg = { botToken: string; kanalId: string; vaDiscordId: string; serverId?: string; vaEmail?: string };
const SNOWFLAKE = /^\d{15,25}$/;

export async function vaKonfig(tenantId: string): Promise<VaCfg | null> {
  const c = (await getIntegration(tenantId, "discord_va")) as Partial<VaCfg> | null;
  if (!c?.botToken || !SNOWFLAKE.test(c.kanalId ?? "") || !SNOWFLAKE.test(c.vaDiscordId ?? "")) return null;
  return c as VaCfg;
}

/** Bereiche, die die VA nie bekommt (Finanzen, B2B-Kunden, Deal-Eingang, Privat). */
const VA_GESPERRT = new Set(["geld", "b2b", "dealeingang", "privat"]);

/** Konto der VA im System als Lese-Sitzung: ihre Bereiche ohne Finanz-/B2B-/Privatbereiche, nie Inhaber. */
export async function vaSession(tenantId: string, cfg: VaCfg): Promise<Session | null> {
  const mail = cfg.vaEmail?.trim();
  if (!mail) return null;
  const [row] = await db
    .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, areas: schema.memberships.areas, brandIds: schema.memberships.brandIds, tenantName: schema.tenants.name })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(and(eq(schema.memberships.tenantId, tenantId), sql`lower(${schema.users.email}) = lower(${mail})`));
  if (!row) return null;
  return {
    userId: row.userId,
    tenantId,
    role: "staff",
    areas: (row.areas ?? STAFF_AREAS.map((a) => a.key)).filter((a) => !VA_GESPERRT.has(a)),
    brandIds: row.brandIds ?? null,
    readOnly: true,
    privateAccess: false,
    privateScope: "voll",
    privatePin: false,
    privateUnlockedUntil: null,
    sessionId: "va:discord",
    email: row.email,
    name: row.name,
    tenantName: row.tenantName,
  };
}

const basisUrl = () => (publicUrl() ?? process.env.APP_URL ?? "").replace(/\/$/, "");
const datumDe = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });

async function vaEinstellungen(tenantId: string, jetzt = new Date()) {
  const s = (await getSettings(tenantId)).va;
  const lok = L.lokal(jetzt, s.zeitzone);
  return { s, lok, ruhe: L.inRuhezeit(lok.zeit, s.ruheVon, s.ruheBis) };
}

async function notizAnhaengen(tenantId: string, taskId: string, zeile: string) {
  await db
    .update(T)
    .set({ notes: sql`left(coalesce(${T.notes} || E'\n', '') || ${zeile}, 20000)` })
    .where(and(eq(T.tenantId, tenantId), eq(T.id, taskId)));
}

/** Dateien aus Notizen („/datei/<id>“) als Anhänge mitschicken (höchstens 5, je ≤ 8 MB). */
async function notizDateien(tenantId: string, notes: string | null): Promise<DcDatei[]> {
  const ids = [...new Set([...(notes ?? "").matchAll(/\/datei\/([0-9a-f-]{36})/gi)].map((m) => m[1]))].slice(0, 5);
  if (!ids.length) return [];
  const f = await db.select({ name: schema.files.name, typ: schema.files.mimeType, size: schema.files.size, data: schema.files.data }).from(schema.files).where(and(eq(schema.files.tenantId, tenantId), inArray(schema.files.id, ids)));
  return f.filter((x) => x.size <= 8 * 1024 * 1024).map((x) => ({ name: x.name, typ: x.typ, daten: Buffer.from(x.data) }));
}

type AnlRow = { id: string; title: string; anleitung: AnleitungFelder | null; titleEn: string | null; anleitungEn: AnleitungFelder | null; freigegeben: boolean };
type AnleitungFelder = NonNullable<(typeof K.$inferSelect)["anleitung"]>;

/** Englische Fassung einer Anleitung: gespeicherte (freigegeben oder automatisch), sonst jetzt übersetzen und als „automatisch“ speichern. */
export async function anleitungEnglisch(tenantId: string, a: AnlRow): Promise<L.AnleitungKurz & { autoUebersetzt: boolean }> {
  if (a.anleitungEn && a.titleEn) return { titel: a.titleEn, zweck: a.anleitungEn.zweck, schritte: a.anleitungEn.schritte ?? [], zugaenge: a.anleitungEn.zugaenge, fehler: a.anleitungEn.fehler, autoUebersetzt: !a.freigegeben };
  const de = a.anleitung ?? ({ schritte: [] } as unknown as AnleitungFelder);
  const tr = async (x: string | undefined | null) => (x ? (await uebersetzen(tenantId, x, "en", { quelle: "de" })).text : x ?? undefined);
  const liste = async (l: string[] | undefined) => (l ? Promise.all(l.map(async (x) => (await tr(x)) ?? x)) : l);
  const en = { ...de, zweck: await tr(de.zweck), wann: await tr(de.wann), wer: await tr(de.wer), schritte: (await liste(de.schritte)) ?? [], zugaenge: await liste(de.zugaenge), fehler: await liste(de.fehler) } as AnleitungFelder;
  const titleEn = (await tr(a.title)) ?? a.title;
  await db.update(K).set({ anleitungEn: en, titleEn, anleitungEnFreigegeben: false }).where(and(eq(K.tenantId, tenantId), eq(K.id, a.id)));
  return { titel: titleEn, zweck: en.zweck, schritte: en.schritte ?? [], zugaenge: en.zugaenge, fehler: en.fehler, autoUebersetzt: true };
}

// ---- Ludwig → VA --------------------------------------------------------------------------------------

export type ZuweisenErgebnis = { ok: true; threadId: string; neu: boolean } | { ok: false; fehler: string };

/** Aufgabe an die VA: eigener Thread mit Titel, Frist, Priorität, Notiz, Links (nur erlaubte), Anleitungen und Anhängen. */
export async function aufgabeAnVa(tenantId: string, taskId: string, o: { notiz?: string | null } = {}): Promise<ZuweisenErgebnis> {
  const cfg = await vaKonfig(tenantId);
  if (!cfg) return { ok: false, fehler: "Discord – VA-Kanal ist nicht eingerichtet (Einstellungen → Anbindungen)." };
  const [task] = await db.select().from(T).where(and(eq(T.tenantId, tenantId), eq(T.id, taskId)));
  if (!task) return { ok: false, fehler: "Aufgabe nicht gefunden." };
  const [va, { ruhe }] = await Promise.all([vaSession(tenantId, cfg), vaEinstellungen(tenantId)]);
  const sprache = await vaSprache(tenantId, va?.userId ?? null);
  const anl = task.anleitungIds.length ? await db.select({ id: K.id, title: K.title, anleitung: K.anleitung, titleEn: K.titleEn, anleitungEn: K.anleitungEn, freigegeben: K.anleitungEnFreigegeben }).from(K).where(and(eq(K.tenantId, tenantId), inArray(K.id, task.anleitungIds))) : [];
  // Link nur, wenn die VA den Bereich sehen darf; sonst Inhalt ohne Beträge.
  const linkOk = Boolean(task.link && va && linkAllowed(va, task.link));
  const notizRoh = task.notes ? (linkOk || !task.link ? task.notes : L.ohneBetraege(task.notes)) : null;
  const dateien = await notizDateien(tenantId, task.notes);
  // Englischsprachige VA: Titel, Notizen und Zusatz übersetzen (Nummern/Beträge/Links bleiben), Anleitungen auf Englisch.
  const tr = async (x: string | null) => (x && sprache !== "de" ? (await uebersetzen(tenantId, x, sprache, { quelle: "de" })).text : x);
  const titel = (await tr(task.title)) ?? task.title;
  const anleitungen = sprache === "de" ? anl.map((a) => ({ titel: a.title, zweck: a.anleitung?.zweck, schritte: a.anleitung?.schritte ?? [], zugaenge: a.anleitung?.zugaenge, fehler: a.anleitung?.fehler })) : await Promise.all(anl.map((a) => anleitungEnglisch(tenantId, a)));
  const text = L.aufgabenText({
    titel,
    faellig: task.dueDate,
    prioritaet: task.priority,
    notiz: await tr(notizRoh ? notizFuerSprache(notizRoh, sprache) : null),
    zusatz: await tr(o.notiz ?? null),
    link: linkOk ? `${basisUrl()}${task.link}` : null,
    anleitungen,
    anhaenge: dateien.map((d) => d.name),
    vaId: cfg.vaDiscordId,
    sprache,
  });
  const dc = discord(cfg.botToken);
  const [alt] = await db.select().from(VT).where(and(eq(VT.tenantId, tenantId), eq(VT.taskId, taskId), eq(VT.art, "aufgabe"))).orderBy(desc(VT.createdAt)).limit(1);
  if (alt && alt.status !== "erledigt") {
    await dc.senden(alt.threadId, `${BOT[sprache].erneut}\n${text}`, { erwaehnen: cfg.vaDiscordId, still: ruhe, dateien });
    await db.update(VT).set({ status: "offen" }).where(eq(VT.id, alt.id));
    return { ok: true, threadId: alt.threadId, neu: false };
  }
  const thread = await dc.threadAnlegen(cfg.kanalId, L.threadName(titel));
  const start = await dc.senden(thread.id, text, { erwaehnen: cfg.vaDiscordId, still: ruhe, dateien });
  await db.insert(VT).values({ tenantId, art: "aufgabe", taskId, threadId: thread.id, startNachrichtId: start, cursor: start, status: "offen" });
  await db.insert(VN).values({ tenantId, discordId: start, kanalId: thread.id, threadId: thread.id, von: "bot", text: text.slice(0, 4000), art: "aufgabe", taskId, gesendetAm: new Date() }).onConflictDoNothing();
  if (o.notiz?.trim()) await notizAnhaengen(tenantId, taskId, `An VA (${datumDe(new Date())}): ${o.notiz.trim()}`);
  return { ok: true, threadId: thread.id, neu: true };
}

/** Aufgabe der VA zuordnen (Konto der VA mit Anleitungen, sonst extern „VA“) – ohne Thread. */
export async function vaZustaendigSetzen(tenantId: string, cfg: VaCfg, taskId: string): Promise<boolean> {
  const va = await vaSession(tenantId, cfg);
  if (va) {
    const { aufgabeZuweisen } = await import("@/lib/zeit/service");
    if (!(await aufgabeZuweisen(tenantId, taskId, va.userId))) return false;
    await db.update(T).set({ zustaendigExtern: null }).where(and(eq(T.tenantId, tenantId), eq(T.id, taskId)));
    return true;
  }
  const [r] = await db.update(T).set({ assigneeId: null, anleitungIds: [], zustaendigExtern: "VA" }).where(and(eq(T.tenantId, tenantId), eq(T.id, taskId))).returning({ id: T.id });
  return Boolean(r);
}

/** „An die VA geben“ (Knopf, Claude): zuständig setzen (Konto der VA mit Anleitungen, sonst extern „VA“) und Thread. */
export async function anVaGeben(tenantId: string, taskId: string, notiz?: string | null): Promise<ZuweisenErgebnis> {
  const cfg = await vaKonfig(tenantId);
  if (!cfg) return { ok: false, fehler: "Discord – VA-Kanal ist nicht eingerichtet (Einstellungen → Anbindungen)." };
  if (!(await vaZustaendigSetzen(tenantId, cfg, taskId))) return { ok: false, fehler: "Aufgabe nicht gefunden." };
  return aufgabeAnVa(tenantId, taskId, { notiz });
}

/** Konto-ID der VA (für den Haken beim Zuweisen). */
export async function vaNutzerId(tenantId: string): Promise<string | null> {
  const cfg = await vaKonfig(tenantId);
  if (!cfg) return null;
  return (await vaSession(tenantId, cfg))?.userId ?? null;
}

/** Haken in „Zuständig setzen“: geht die Aufgabe an das Konto der VA, entsteht der Thread. */
export async function beiZuweisung(tenantId: string, taskId: string, userId: string): Promise<ZuweisenErgebnis | null> {
  if ((await vaNutzerId(tenantId)) !== userId) return null;
  return aufgabeAnVa(tenantId, taskId);
}

// ---- Abgleich ---------------------------------------------------------------------------------------------

export type Ctx = { t: string; cfg: VaCfg; dc: ReturnType<typeof discord>; va: Session | null; s: Awaited<ReturnType<typeof vaEinstellungen>>["s"]; heute: string; zeit: string; ruhe: boolean; jetzt: Date; z: Zaehler; sprache: Sprache; manuell: boolean };
export type Zaehler = { nachrichten: number; erledigt: number; rueckfragen: number; auto: number; erinnerungen: number; anVa: number; verpasst: number; fehler: string[] };

const vonVa = (cfg: VaCfg, m: DcNachricht) => m.author?.id === cfg.vaDiscordId && !m.author.bot && (m.type === undefined || m.type === 0 || m.type === 19);
const zeitVon = (m: DcNachricht) => (m.timestamp ? new Date(m.timestamp) : new Date());

let laeuft = new Set<string>();

/**
 * Ein Abgleich: Kanal, offene Threads, Erinnerungen, VA-Automatik (Ansprüche, Fristen, „Daily overview“). Läuft je
 * Mandant höchstens einmal gleichzeitig. `manuell` (Knopf „Jetzt abgleichen“): auch die seltenen Schritte sofort.
 */
export async function vaAbgleich(tenantId: string, jetzt = new Date(), o: { manuell?: boolean } = {}): Promise<Zaehler | null> {
  if (laeuft.has(tenantId)) return null;
  const cfg = await vaKonfig(tenantId);
  if (!cfg) return null;
  laeuft.add(tenantId);
  const t0 = Date.now();
  const { recordJob } = await import("@/lib/today/jobs");
  const { s, lok, ruhe } = await vaEinstellungen(tenantId, jetzt);
  const va = await vaSession(tenantId, cfg);
  const c: Ctx = { t: tenantId, cfg, dc: discord(cfg.botToken), va, s, heute: lok.datum, zeit: lok.zeit, ruhe, jetzt, z: { nachrichten: 0, erledigt: 0, rueckfragen: 0, auto: 0, erinnerungen: 0, anVa: 0, verpasst: 0, fehler: [] }, sprache: await vaSprache(tenantId, va?.userId ?? null), manuell: Boolean(o.manuell) };
  try {
    await kanalAbgleichen(c);
    await threadsAbgleichen(c);
    if (!ruhe) await erinnern(c);
    await (await import("./automatik")).automatikTakt(c);
    await db.insert(schema.vaStand).values({ tenantId, letzterAbgleich: new Date(), letzterFehler: c.z.fehler[0] ?? null }).onConflictDoUpdate({ target: schema.vaStand.tenantId, set: { letzterAbgleich: new Date(), letzterFehler: c.z.fehler[0] ?? null } });
    await recordJob(tenantId, "VA (Discord)", c.z.fehler[0] ?? null, Date.now() - t0);
    return c.z;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.insert(schema.vaStand).values({ tenantId, letzterFehler: msg.slice(0, 300) }).onConflictDoUpdate({ target: schema.vaStand.tenantId, set: { letzterFehler: msg.slice(0, 300) } });
    await recordJob(tenantId, "VA (Discord)", msg, Date.now() - t0);
    throw e;
  } finally {
    laeuft.delete(tenantId);
  }
}

/** Nur für Tests: Sperre zurücksetzen. */
export function _vaZuruecksetzen() {
  laeuft = new Set();
}

async function kanalAbgleichen(c: Ctx) {
  const [st] = await db.select().from(schema.vaStand).where(eq(schema.vaStand.tenantId, c.t));
  let cursor = st?.kanalCursor ?? null;
  let neu: DcNachricht[];
  if (!cursor) {
    // Erster Abgleich: kein alter Verlauf – nur Nachrichten der VA aus den letzten 2 Stunden.
    const letzte = await c.dc.neue(c.cfg.kanalId, null);
    neu = letzte.filter((m) => zeitVon(m).getTime() > c.jetzt.getTime() - 2 * 3600_000).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    cursor = letzte.reduce((mx, m) => (BigInt(m.id) > BigInt(mx) ? m.id : mx), "0");
  } else neu = await c.dc.neue(c.cfg.kanalId, cursor);
  for (const m of neu) {
    if (BigInt(m.id) > BigInt(cursor)) cursor = m.id;
    if (!vonVa(c.cfg, m)) continue;
    try {
      await kanalNachricht(c, m, null);
    } catch (e) {
      c.z.fehler.push(e instanceof Error ? e.message : String(e));
    }
  }
  await db.insert(schema.vaStand).values({ tenantId: c.t, kanalCursor: cursor }).onConflictDoUpdate({ target: schema.vaStand.tenantId, set: { kanalCursor: cursor } });
}

export async function schonDa(t: string, discordId: string) {
  const [r] = await db.select({ id: VN.id }).from(VN).where(and(eq(VN.tenantId, t), eq(VN.discordId, discordId)));
  return Boolean(r);
}

/** Anhänge der VA speichern (Dateiablage, verschlüsselt). */
export async function anhaengeSpeichern(t: string, m: DcNachricht): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  const { storeFile } = await import("@/lib/orders/service");
  for (const a of (m.attachments ?? []).slice(0, 10)) {
    const daten = await anhangLaden(a.url).catch(() => null);
    if (!daten) continue;
    const id = await storeFile(t, a.filename.slice(0, 120), a.content_type || "application/octet-stream", daten);
    out.push({ id, name: a.filename });
  }
  return out;
}

export const dateiZeilen = (d: { id: string; name: string }[]) => d.map((x) => `📎 ${x.name}: /datei/${x.id}`).join("\n");

/** Offene Aufgaben der VA (für die Einordnung von Infos). */
async function vaOffene(t: string) {
  return db
    .select({ id: T.id, title: T.title })
    .from(VT)
    .innerJoin(T, eq(T.id, VT.taskId))
    .where(and(eq(VT.tenantId, t), eq(VT.art, "aufgabe"), ne(VT.status, "erledigt"), eq(T.status, "open")))
    .orderBy(desc(VT.createdAt))
    .limit(30);
}

/** Text der VA auf Deutsch (Original nur, wenn übersetzt wurde). */
export async function alsDeutsch(t: string, roh: string): Promise<{ text: string; original: string | null; sprache: string | null }> {
  if (!roh) return { text: roh, original: null, sprache: null };
  const u = await uebersetzen(t, roh, "de");
  return u.uebersetzt ? { text: u.text, original: roh, sprache: u.von } : { text: roh, original: null, sprache: u.von };
}

async function einordnen(t: string, text: string, offen: string[], heute: string): Promise<L.Einordnung> {
  const ai = (await getIntegration(t, "anthropic")) as { apiKey?: string; tier?: string; model?: string } | null;
  if (ai?.apiKey) {
    try {
      const r = await askClaude(ai.apiKey, L.kiEinordnenAuftrag(text, offen, heute), { model: modelFor(ai, "simple"), task: "simple", maxTokens: 400, timeoutMs: 30_000 });
      const e = L.leseEinordnung(r.text, text, heute);
      if (e) return e;
    } catch (e) {
      console.error("[VA] Einordnung:", e instanceof Error ? e.message : e);
    }
  }
  return L.regelEinordnung(text, heute, offen);
}

/**
 * Neue Nachricht der VA im Kanal (oder Folge-Nachricht in einem beantworteten Anfrage-Thread): einordnen,
 * Datenfragen beantworten, sonst Aufgabe für Ludwig; Infos an die passende Aufgabe, Smalltalk ignorieren.
 */
async function kanalNachricht(c: Ctx, m: DcNachricht, imThread: { id: string; threadId: string } | null) {
  if (await schonDa(c.t, m.id)) return;
  c.z.nachrichten++;
  const roh = (m.content ?? "").trim();
  const dateien = await anhaengeSpeichern(c.t, m);
  const offen = await vaOffene(c.t);
  // Nachrichten der VA (meist Englisch) für Ludwig auf Deutsch speichern, Original bleibt aufklappbar.
  const de = await alsDeutsch(c.t, roh);
  const text = de.text;
  const e = await einordnen(c.t, roh || "(Datei ohne Text)", offen.map((o) => o.title), c.heute);
  if (de.original) e.titel = (await uebersetzen(c.t, e.titel, "de")).text.slice(0, 80);
  const basis = { tenantId: c.t, discordId: m.id, kanalId: imThread?.threadId ?? c.cfg.kanalId, threadId: imThread?.threadId ?? null, von: "va" as const, text: text || "(Datei)", original: de.original, sprache: de.sprache, anfrage: e.anfrage, dateiIds: dateien.map((d) => d.id), gesendetAm: zeitVon(m) };

  if (e.art === "smalltalk") {
    await db.insert(VN).values({ ...basis, art: "smalltalk" }).onConflictDoNothing();
    return;
  }
  if (e.art === "info" || e.art === "erledigt") {
    const ziel = e.aufgabe ? offen[e.aufgabe - 1] : undefined;
    await db.insert(VN).values({ ...basis, art: e.art, taskId: ziel?.id ?? null }).onConflictDoNothing();
    if (ziel) await notizAnhaengen(c.t, ziel.id, `VA (${datumDe(zeitVon(m))}, Kanal): ${text}${de.original ? `\nOriginal (EN): ${de.original}` : ""}${dateien.length ? `\n${dateiZeilen(dateien)}` : ""}`);
    return;
  }

  // Bitte/Frage: zuerst selbst beantworten, wenn es Daten aus dem System sind.
  let gefunden: string | null = null;
  if (e.anfrage) {
    const r = await autoAntwort(c, e.anfrage, roh).catch((x) => ({ ok: false as const, gefunden: `Fehler beim Suchen: ${x instanceof Error ? x.message : String(x)}` }));
    if (r.ok) {
      const threadId = imThread?.threadId ?? (await c.dc.threadAnNachricht(c.cfg.kanalId, m.id, L.threadName(e.titel))).id;
      const antwortId = await c.dc.senden(threadId, r.text, { still: c.ruhe, dateien: r.dateien });
      await db.insert(VN).values({ ...basis, threadId, art: e.art, autoBeantwortet: true, antwort: r.text.slice(0, 4000), beantwortetAm: new Date() }).onConflictDoNothing();
      if (!imThread) await db.insert(VT).values({ tenantId: c.t, art: "vom_va", taskId: null, threadId, startNachrichtId: m.id, cursor: antwortId, status: "erledigt", erledigtAm: new Date() }).onConflictDoNothing();
      c.z.auto++;
      return;
    }
    gefunden = r.gefunden;
  }

  // Sonst: Aufgabe „vom VA“ für Ludwig (Frist aus dem Text oder nächster Werktag) mit Erinnerung.
  const faellig = e.faellig ?? L.naechsterWerktag(c.heute);
  const [lt] = await db
    .insert(T)
    .values({
      tenantId: c.t,
      systemKey: `va-nachricht:${m.id}`,
      title: `VA: ${e.titel}`.slice(0, 200),
      notes: [text, de.original ? `Original (EN): ${de.original}` : null, dateien.length ? dateiZeilen(dateien) : null, gefunden ? `Gefunden: ${gefunden}` : null, "Antwort unter Delegation → VA (Discord); sie erscheint im Thread der VA."].filter(Boolean).join("\n\n"),
      dueDate: faellig,
      priority: "normal",
      category: "eigene",
      link: "/delegation/va",
    })
    .onConflictDoNothing()
    .returning({ id: T.id });
  let threadId = imThread?.threadId ?? null;
  try {
    if (!threadId) threadId = (await c.dc.threadAnNachricht(c.cfg.kanalId, m.id, L.threadName(e.titel))).id;
    const hinweis = await c.dc.senden(threadId, BOT[c.sprache].angekommen, { still: true });
    if (!imThread) await db.insert(VT).values({ tenantId: c.t, art: "vom_va", taskId: lt?.id ?? null, threadId, startNachrichtId: m.id, cursor: hinweis, status: "offen" }).onConflictDoNothing();
    else if (lt) await db.update(VT).set({ taskId: lt.id, status: "offen", erledigtAm: null }).where(and(eq(VT.tenantId, c.t), eq(VT.id, imThread.id)));
  } catch (x) {
    c.z.fehler.push(x instanceof Error ? x.message : String(x));
  }
  await db.insert(VN).values({ ...basis, threadId, art: e.art, ludwigTaskId: lt?.id ?? null }).onConflictDoNothing();
  c.z.rueckfragen++;
  const { notifyDiscord } = await import("@/lib/integrations/clients/discord");
  await notifyDiscord(c.t, `📨 VA ${e.art === "frage" ? "fragt" : "bittet"}: ${e.titel}`).catch(() => false);
}

async function threadsAbgleichen(c: Ctx) {
  const vor14 = new Date(c.jetzt.getTime() - 14 * 86_400_000);
  const rows = await db
    .select({ th: VT, taskStatus: T.status, taskTitle: T.title, assignee: T.assigneeId })
    .from(VT)
    .leftJoin(T, eq(T.id, VT.taskId))
    .where(and(eq(VT.tenantId, c.t), or(ne(VT.status, "erledigt"), and(eq(VT.art, "vom_va"), gte(VT.createdAt, vor14)))))
    .orderBy(VT.createdAt)
    .limit(200);
  for (const r of rows) {
    try {
      await threadAbgleichen(c, r.th, r.taskStatus, r.taskTitle, r.assignee);
    } catch (e) {
      if (e instanceof DiscordFehler && e.status === 404) {
        // Thread gelöscht: nicht weiter abfragen.
        await db.update(VT).set({ status: "erledigt", erledigtAm: new Date() }).where(eq(VT.id, r.th.id));
        continue;
      }
      c.z.fehler.push(e instanceof Error ? e.message : String(e));
    }
  }
}

export type ThreadRow = typeof VT.$inferSelect;

async function threadAbgleichen(c: Ctx, th: ThreadRow, taskStatus: string | null, taskTitle: string | null, assignee: string | null) {
  const neu = await c.dc.neue(th.threadId, th.cursor ?? th.startNachrichtId ?? "0");
  let cursor = th.cursor;
  let status = th.status;
  for (const m of neu) {
    cursor = m.id;
    if (!vonVa(c.cfg, m)) continue;
    if (th.art === "vom_va" && !th.taskId) {
      // Folgefrage in einem automatisch beantworteten Thread – wie eine neue Nachricht behandeln.
      await kanalNachricht(c, m, { id: th.id, threadId: th.threadId });
      continue;
    }
    if (th.art === "anspruch" || th.art === "sammel") {
      // Ansprüche/Sammel-Thread (B18): Fallnummer → eingereicht, Fragen an Ludwig.
      status = await (await import("./automatik")).automatikAntwort(c, { ...th, status }, m);
      continue;
    }
    status = await threadNachricht(c, { ...th, status }, m, taskTitle);
  }
  if (cursor !== th.cursor) await db.update(VT).set({ cursor }).where(eq(VT.id, th.id));
  if (th.art !== "aufgabe" || status === "erledigt") return;
  // Im System erledigt oder jemand anderem zugewiesen → Thread schließen.
  const vaId = c.va?.userId ?? null;
  if (taskStatus === "done" || taskStatus === null || (vaId && assignee !== vaId && assignee !== null)) {
    await db.update(VT).set({ status: "erledigt", erledigtAm: new Date() }).where(eq(VT.id, th.id));
    await c.dc.senden(th.threadId, taskStatus === "done" ? BOT[c.sprache].imSystemErledigt : BOT[c.sprache].andereZustaendig, { still: true }).catch(() => "");
    return;
  }
  if (!th.startNachrichtId) return;
  const start = await c.dc.nachricht(th.threadId, th.startNachrichtId);
  const r = L.reaktionsArt(start.reactions);
  if (r.erledigt) await alsErledigt(c, th, null);
  else if (r.frage && !th.frageReaktion) {
    await db.update(VT).set({ frageReaktion: true }).where(eq(VT.id, th.id));
    await rueckfrage(c, th, "❓ (Reaktion an der Aufgabe – bitte im Thread nachsehen)", null, taskTitle);
  }
}

/** Antwort der VA in einem Aufgaben- oder Anfrage-Thread. Liefert den neuen Thread-Status. */
async function threadNachricht(c: Ctx, th: ThreadRow, m: DcNachricht, taskTitle: string | null): Promise<ThreadRow["status"]> {
  if (await schonDa(c.t, m.id)) return th.status;
  c.z.nachrichten++;
  const roh = (m.content ?? "").trim();
  const dateien = await anhaengeSpeichern(c.t, m);
  const art = roh ? L.threadAntwortArt(roh) : "notiz";
  const de = await alsDeutsch(c.t, roh);
  const text = de.text;
  const [row] = await db
    .insert(VN)
    .values({ tenantId: c.t, discordId: m.id, kanalId: th.threadId, threadId: th.threadId, von: "va", text: text || "(Datei)", original: de.original, sprache: de.sprache, art, taskId: th.art === "aufgabe" ? th.taskId : null, ludwigTaskId: th.art === "vom_va" ? th.taskId : null, dateiIds: dateien.map((d) => d.id), gesendetAm: zeitVon(m) })
    .onConflictDoNothing()
    .returning({ id: VN.id });
  if (th.taskId && (text || dateien.length)) await notizAnhaengen(c.t, th.taskId, `VA (${datumDe(zeitVon(m))}): ${text}${de.original ? `\nOriginal (EN): ${de.original}` : ""}${dateien.length ? `${text ? "\n" : ""}${dateiZeilen(dateien)}` : ""}`);
  if (th.art === "vom_va") {
    // Nachfrage zur eigenen Anfrage: Ludwigs Aufgabe wieder öffnen, wenn schon beantwortet.
    if (art === "rueckfrage" && th.taskId) {
      await db.update(T).set({ status: "open", completedAt: null, dueDate: c.heute }).where(and(eq(T.tenantId, c.t), eq(T.id, th.taskId)));
      await db.update(VT).set({ status: "offen", erledigtAm: null }).where(eq(VT.id, th.id));
      return "offen";
    }
    return th.status;
  }
  if (th.taskId && roh) await fallnummerAnFall(c, th.taskId, roh);
  if (art === "erledigt") {
    await alsErledigt(c, th, text);
    return "erledigt";
  }
  if (art === "rueckfrage") {
    await rueckfrage(c, th, text, row?.id ?? null, taskTitle);
    return "rueckfrage";
  }
  return th.status;
}

/** Aufgabe aus der Fall-Zentrale (amazon-fall:<id>): nennt die VA eine Fallnummer, steht der Vorgang auf „eingereicht“. */
async function fallnummerAnFall(c: Ctx, taskId: string, roh: string) {
  const { fallnummerInAntwort } = await import("./automatik-logic");
  const fall = fallnummerInAntwort(roh);
  if (!fall) return;
  const [t] = await db.select({ key: T.systemKey }).from(T).where(and(eq(T.tenantId, c.t), eq(T.id, taskId)));
  const vorgangId = /^amazon-fall:([0-9a-f-]{36})$/.exec(t?.key ?? "")?.[1];
  if (!vorgangId) return;
  const { fallStatusSetzen } = await import("@/lib/amazon-faelle/service");
  await fallStatusSetzen(c.t, vorgangId, { phase: "eingereicht", fallnummer: fall }, "VA (Discord)").catch((e) => c.z.fehler.push(e instanceof Error ? e.message : String(e)));
}

async function alsErledigt(c: Ctx, th: ThreadRow, text: string | null) {
  if (th.taskId) await db.update(T).set({ status: "done", completedAt: new Date() }).where(and(eq(T.tenantId, c.t), eq(T.id, th.taskId), eq(T.status, "open")));
  await db.update(VT).set({ status: "erledigt", erledigtAm: new Date() }).where(eq(VT.id, th.id));
  c.z.erledigt++;
  await c.dc.senden(th.threadId, BOT[c.sprache].erledigtDanke(Boolean(text)), { still: true }).catch(() => "");
}

export async function rueckfrage(c: Ctx, th: ThreadRow, text: string, nachrichtId: string | null, taskTitle: string | null) {
  await db.update(VT).set({ status: "rueckfrage" }).where(eq(VT.id, th.id));
  const key = `va-rueckfrage:${nachrichtId ?? `${th.id}:reaktion`}`;
  const [lt] = await db
    .insert(T)
    .values({ tenantId: c.t, systemKey: key, title: `Rückfrage VA: ${taskTitle ?? "Aufgabe"}`.slice(0, 200), notes: `${text}\n\nAntwort unter Delegation → VA (Discord); sie erscheint im Thread der VA.`, dueDate: c.heute, priority: "normal", category: "eigene", link: "/delegation/va" })
    .onConflictDoNothing()
    .returning({ id: T.id });
  if (nachrichtId && lt) await db.update(VN).set({ ludwigTaskId: lt.id }).where(and(eq(VN.tenantId, c.t), eq(VN.id, nachrichtId)));
  else if (!nachrichtId && lt)
    await db.insert(VN).values({ tenantId: c.t, discordId: `reaktion:${th.id}`, kanalId: th.threadId, threadId: th.threadId, von: "va", text: "❓ (Reaktion)", art: "rueckfrage", taskId: th.taskId, ludwigTaskId: lt.id, gesendetAm: new Date() }).onConflictDoNothing();
  c.z.rueckfragen++;
  await c.dc.senden(th.threadId, BOT[c.sprache].rueckfrageBeiLudwig, { still: true }).catch(() => "");
  const { notifyDiscord } = await import("@/lib/integrations/clients/discord");
  await notifyDiscord(c.t, `❓ Rückfrage der VA zu „${taskTitle ?? "Aufgabe"}“: ${text.slice(0, 300)}`).catch(() => false);
  // SMS (B13, falls eingerichtet): nur bei Rückfragen zu wichtigen Aufgaben – ohne den Text der VA.
  if (lt && th.taskId) {
    const [orig] = await db.select({ priority: T.priority }).from(T).where(and(eq(T.tenantId, c.t), eq(T.id, th.taskId)));
    if (orig?.priority === "critical") {
      const { smsMelden } = await import("@/lib/mobil/sms");
      await smsMelden(c.t, { art: "va", kern: `VA-Rückfrage zu „${(taskTitle ?? "Aufgabe").slice(0, 60)}“`, schluessel: `va:${key}`, bezug: `task:${lt.id}`, codes: ["SPÄTER", "OK"] }).catch(() => null);
    }
  }
}

async function erinnern(c: Ctx) {
  const rows = await db
    .select({ th: VT, faellig: T.dueDate, titel: T.title })
    .from(VT)
    .innerJoin(T, eq(T.id, VT.taskId))
    .where(and(eq(VT.tenantId, c.t), eq(VT.art, "aufgabe"), ne(VT.status, "erledigt"), eq(T.status, "open"), isNotNull(T.dueDate)));
  for (const r of rows) {
    const art = L.erinnerungFaellig({ faellig: r.faellig, heute: c.heute, letzte: r.th.letzteErinnerung, ruhe: c.ruhe, ueberfaelligTaeglich: c.s.erinnerungUeberfaellig });
    if (!art || !r.faellig) continue;
    try {
      const titel = c.sprache === "de" ? r.titel : (await uebersetzen(c.t, r.titel, c.sprache, { quelle: "de" })).text;
      await c.dc.senden(r.th.threadId, L.erinnerungText(art, titel, r.faellig, c.cfg.vaDiscordId, c.sprache), { erwaehnen: c.cfg.vaDiscordId });
      await db.update(VT).set({ letzteErinnerung: c.heute }).where(eq(VT.id, r.th.id));
      c.z.erinnerungen++;
    } catch (e) {
      c.z.fehler.push(e instanceof Error ? e.message : String(e));
    }
  }
}

// ---- Automatische Antworten -------------------------------------------------------------------------------

type Auto = { ok: true; text: string; dateien: DcDatei[] } | { ok: false; gefunden: string | null };

async function autoAntwort(c: Ctx, a: L.Einordnung["anfrage"] & object, text: string): Promise<Auto> {
  if (a.typ === "rechnung") {
    if (!c.s.darfEinkaufsrechnungen) return { ok: false, gefunden: "Einstellung: VA darf Einkaufsrechnungen nicht sehen." };
    const r = await rechnungenFuer(c.t, a, c.heute);
    if (!r.wofuer) return { ok: false, gefunden: "Keine ASIN, SKU, Marke oder Lieferant erkannt." };
    if (!r.liste.length) return { ok: false, gefunden: `Keine Rechnung zu ${r.wofuer} gefunden.` };
    const mitDatei = r.liste.filter((x) => x.fileId).slice(0, 3);
    const files = mitDatei.length
      ? await db.select({ id: schema.files.id, name: schema.files.name, typ: schema.files.mimeType, size: schema.files.size, data: schema.files.data }).from(schema.files).where(and(eq(schema.files.tenantId, c.t), inArray(schema.files.id, mitDatei.map((x) => x.fileId!))))
      : [];
    const dateien = files.filter((f) => f.size <= 8 * 1024 * 1024).map((f) => ({ name: f.name, typ: f.typ, daten: Buffer.from(f.data) }));
    const zeilen = r.liste.map((x) => ({ datum: x.invoiceDate, lieferant: x.vendor, nummer: x.invoiceNumber, datei: x.fileName }));
    return { ok: true, text: L.rechnungenText(r.wofuer, zeilen, dateien.length, c.sprache), dateien };
  }
  if (!c.va) return { ok: false, gefunden: "Kein Konto der VA hinterlegt (Anbindung → „Konto der VA“) – ohne ihre Rechte keine automatische Antwort." };
  const such = a.sendung ?? a.auftrag ?? a.asin ?? a.sku ?? a.suchtext ?? a.marke ?? null;
  const aufruf: Record<Exclude<L.AnfrageTyp, "rechnung">, [string, Record<string, unknown>] | null> = {
    sendung: such ? ["fba_sendungen", { ansicht: "alle", suche: such.slice(0, 60) }] : ["fba_sendungen", { ansicht: "mit_fehlmenge", limit: 10 }],
    anspruch: ["ansprueche", { status: "alle_offenen", limit: 100 }],
    auftrag: such && such.length >= 2 ? ["auftraege", { status: "alle", suche: such.slice(0, 100), limit: 10 }] : null,
    produkt: such && such.length >= 2 ? ["produkte", { suche: such.slice(0, 100), limit: 10 }] : null,
    anleitung: ["wissen", { suche: (a.suchtext ?? text).replace(/[?!.]+$/, "").slice(0, 100) || "Anleitung", herkunft: "anleitung", limit: 5 }],
  };
  const x = aufruf[a.typ];
  if (!x) return { ok: false, gefunden: "Kein Suchbegriff erkannt." };
  const { runTool } = await import("@/lib/assistant/registry");
  const out = await runTool({ session: c.va, channel: "app", canWrite: false, privat: false, today: c.heute, baseUrl: basisUrl() }, x[0], x[1]);
  if (out.isError) return { ok: false, gefunden: `Nicht freigegeben für das Konto der VA oder Fehler: ${out.text.slice(0, 200)}` };
  let j: unknown;
  try {
    j = JSON.parse(out.text);
  } catch {
    return { ok: false, gefunden: "Ergebnis zu groß – bitte genauer fragen." };
  }
  let liste = L.hauptliste(j);
  if (liste === null) return { ok: false, gefunden: null };
  if (a.typ === "anspruch" && such) liste = liste.filter((o) => JSON.stringify(o).toLowerCase().includes(such.toLowerCase()));
  const genau = Boolean(a.sendung || a.auftrag || a.asin || a.sku);
  const urteil = L.eindeutig(liste.length, genau);
  const zeilen = liste.slice(0, 5).map(L.trefferZeile);
  if (urteil === "keins") return { ok: false, gefunden: `Nichts gefunden (${L.ANFRAGE_TEXT[a.typ]}${such ? ` „${such}“` : ""}).` };
  if (urteil === "mehrdeutig") return { ok: false, gefunden: `${liste.length} Treffer – nicht eindeutig:\n${zeilen.slice(0, 3).join("\n")}` };
  const kopf = { sendung: "📦", anspruch: "💶", auftrag: "🧾", produkt: "🏷️", anleitung: "📖" }[a.typ];
  const antwort = `${kopf} ${L.ANFRAGE_TEXT[a.typ]}${such ? ` zu „${such}“` : ""}:\n${zeilen.join("\n")}`;
  if (c.sprache === "de") return { ok: true, text: antwort, dateien: [] };
  // Für die englischsprachige VA: Kopf auf Englisch, Trefferzeilen übersetzt (Nummern und Beträge bleiben).
  const zeilenEn = (await uebersetzen(c.t, zeilen.join("\n"), c.sprache, { quelle: "de" })).text;
  return { ok: true, text: `${kopf} ${L.ANFRAGE_TEXT_EN[a.typ]}${such ? ` for “${such}”` : ""}:\n${zeilenEn}`, dateien: [] };
}

/** Einkaufsrechnungen zu ASIN/SKU (über Chargen und Rechnungstext), Lieferant oder Marke (Echtheits-Ordner bzw. Text). */
export async function rechnungenFuer(t: string, a: { asin: string | null; sku: string | null; marke: string | null; lieferant: string | null }, heute = todayIso()) {
  const I = schema.invoices;
  const ids = new Set<string>();
  const wofuer = [a.marke, a.asin ?? a.sku ?? null, !a.asin && !a.sku && !a.marke ? a.lieferant : null].filter(Boolean).join(" ");
  if (a.asin || a.sku) {
    const prod = a.asin ? await db.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.tenantId, t), eq(schema.products.asin, a.asin))) : [];
    const lots = await db
      .select({ id: schema.lots.id })
      .from(schema.lots)
      .where(and(eq(schema.lots.tenantId, t), or(prod.length ? inArray(schema.lots.productId, prod.map((p) => p.id)) : sql`false`, a.sku ? eq(schema.lots.sku, a.sku) : sql`false`)));
    if (lots.length) {
      const l = await db.select({ id: schema.invoiceLots.invoiceId }).from(schema.invoiceLots).where(and(eq(schema.invoiceLots.tenantId, t), inArray(schema.invoiceLots.lotId, lots.map((x) => x.id).slice(0, 1000))));
      l.forEach((x) => ids.add(x.id));
    }
    const kenn = (a.asin ?? a.sku)!;
    const txt = await db.select({ id: I.id }).from(I).where(and(eq(I.tenantId, t), ilike(I.textExcerpt, `%${kenn.replace(/[%_]/g, "")}%`))).limit(30);
    txt.forEach((x) => ids.add(x.id));
  }
  if (!ids.size && a.lieferant) {
    const muster = `%${a.lieferant.replace(/[%_]/g, "")}%`;
    const sup = await db.select({ id: schema.suppliers.id }).from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, t), ilike(schema.suppliers.name, muster))).limit(10);
    const r = await db
      .select({ id: I.id })
      .from(I)
      .where(and(eq(I.tenantId, t), or(ilike(I.vendor, muster), sup.length ? inArray(I.supplierId, sup.map((s) => s.id)) : sql`false`)))
      .orderBy(desc(I.invoiceDate))
      .limit(30);
    r.forEach((x) => ids.add(x.id));
  }
  if (!ids.size && a.marke && !a.asin && !a.sku) {
    const { markeFinden, markenOrdner } = await import("@/lib/echtheit/service");
    const m = await markeFinden(t, a.marke);
    const o = m ? await markenOrdner(t, m.id, heute) : null;
    if (o) o.belege.filter((b) => b.urteil !== "falsch" && b.art !== "pruefen").forEach((b) => ids.add(b.id));
    else {
      const muster = `%${a.marke.replace(/[%_]/g, "")}%`;
      const r = await db.select({ id: I.id }).from(I).where(and(eq(I.tenantId, t), or(ilike(I.textExcerpt, muster), ilike(I.vendor, muster)))).orderBy(desc(I.invoiceDate)).limit(30);
      r.forEach((x) => ids.add(x.id));
    }
  }
  const liste = ids.size
    ? await db
        .select({ id: I.id, invoiceDate: I.invoiceDate, invoiceNumber: I.invoiceNumber, vendor: I.vendor, fileId: I.fileId, fileName: I.fileName })
        .from(I)
        .where(and(eq(I.tenantId, t), inArray(I.id, [...ids].slice(0, 500)), ne(I.status, "ignored"), notInArray(I.docType, ["keinbeleg", "lieferschein", "bestaetigung", "mahnung"]), ne(I.kind, "expense")))
        .orderBy(sql`${I.invoiceDate} desc nulls last`)
    : [];
  return { wofuer, liste };
}

// ---- Ludwig antwortet aus dem Tool ----------------------------------------------------------------------

/**
 * Antwort an die VA: in den Thread der Nachricht bzw. der Aufgabe (ohne beides: in den Kanal). Beantwortete
 * Rückfragen/Anfragen werden abgehakt.
 */
export async function antwortAnVa(tenantId: string, ziel: { nachrichtId?: string | null; taskId?: string | null }, text: string, absender: string | null, o: { englisch?: string | null } = {}): Promise<{ ok: true; wo: "thread" | "kanal"; gesendet: string } | { ok: false; fehler: string }> {
  const cfg = await vaKonfig(tenantId);
  if (!cfg) return { ok: false, fehler: "Discord – VA-Kanal ist nicht eingerichtet." };
  const inhalt = text.trim().slice(0, 3800);
  if (!inhalt) return { ok: false, fehler: "Text fehlt." };
  // Ludwig schreibt Deutsch; an eine englischsprachige VA geht die (ggf. von Hand bearbeitete) englische Fassung.
  const sprache = await vaSprache(tenantId, (await vaSession(tenantId, cfg))?.userId ?? null);
  const senden = sprache === "de" ? inhalt : o.englisch?.trim().slice(0, 3800) || (await uebersetzen(tenantId, inhalt, sprache, { quelle: "de" })).text;
  let threadId: string | null = null;
  let nachrichten: { id: string; ludwigTaskId: string | null }[] = [];
  if (ziel.nachrichtId) {
    const [n] = await db.select().from(VN).where(and(eq(VN.tenantId, tenantId), eq(VN.id, ziel.nachrichtId)));
    if (!n) return { ok: false, fehler: "Nachricht nicht gefunden." };
    threadId = n.threadId;
    nachrichten = [{ id: n.id, ludwigTaskId: n.ludwigTaskId }];
    if (!threadId && n.kanalId === cfg.kanalId && !n.discordId.startsWith("reaktion:")) {
      threadId = (await discord(cfg.botToken).threadAnNachricht(cfg.kanalId, n.discordId, L.threadName(L.titelAus(n.text)))).id;
      await db.insert(VT).values({ tenantId, art: "vom_va", taskId: n.ludwigTaskId, threadId, startNachrichtId: n.discordId, status: "offen" }).onConflictDoNothing();
      await db.update(VN).set({ threadId }).where(eq(VN.id, n.id));
    }
  } else if (ziel.taskId) {
    const [th] = await db
      .select()
      .from(VT)
      .where(and(eq(VT.tenantId, tenantId), eq(VT.taskId, ziel.taskId)))
      .orderBy(desc(VT.createdAt))
      .limit(1);
    if (!th) return { ok: false, fehler: "Zu dieser Aufgabe gibt es keinen Thread bei der VA." };
    threadId = th.threadId;
  }
  if (threadId) {
    // Alle offenen Fragen dieses Threads gelten als beantwortet.
    const offen = await db.select({ id: VN.id, ludwigTaskId: VN.ludwigTaskId }).from(VN).where(and(eq(VN.tenantId, tenantId), eq(VN.threadId, threadId), eq(VN.von, "va"), isNotNull(VN.ludwigTaskId), isNull(VN.beantwortetAm)));
    nachrichten = [...nachrichten, ...offen.filter((o) => !nachrichten.some((n) => n.id === o.id))];
  }
  const dc = discord(cfg.botToken);
  await dc.senden(threadId ?? cfg.kanalId, `<@${cfg.vaDiscordId}> 💬 ${absender ?? "Ludwig"}: ${senden}`, { erwaehnen: cfg.vaDiscordId });
  const jetzt = new Date();
  for (const n of nachrichten) {
    await db.update(VN).set({ antwort: inhalt, beantwortetAm: jetzt }).where(and(eq(VN.tenantId, tenantId), eq(VN.id, n.id)));
    if (n.ludwigTaskId) await db.update(T).set({ status: "done", completedAt: jetzt }).where(and(eq(T.tenantId, tenantId), eq(T.id, n.ludwigTaskId), eq(T.status, "open")));
  }
  if (threadId) {
    const [th] = await db.select().from(VT).where(and(eq(VT.tenantId, tenantId), eq(VT.threadId, threadId)));
    if ((th?.art === "aufgabe" || th?.art === "anspruch" || th?.art === "sammel") && th.status === "rueckfrage") await db.update(VT).set({ status: "offen" }).where(eq(VT.id, th.id));
    if (th?.art === "vom_va" && th.status !== "erledigt") await db.update(VT).set({ status: "erledigt", erledigtAm: jetzt }).where(eq(VT.id, th.id));
  }
  return { ok: true, wo: threadId ? "thread" : "kanal", gesendet: senden };
}

/** Sprache der VA, wie sie gerade gilt (Konto, sonst Einstellung). */
export async function vaSpracheAktuell(tenantId: string): Promise<Sprache> {
  const cfg = await vaKonfig(tenantId);
  return vaSprache(tenantId, cfg ? ((await vaSession(tenantId, cfg))?.userId ?? null) : null);
}

/** Vorschau: so geht Ludwigs Antwort an die VA (bei englischsprachiger VA übersetzt). */
export async function antwortVorschau(tenantId: string, text: string): Promise<{ sprache: Sprache; text: string; uebersetzt: boolean }> {
  const cfg = await vaKonfig(tenantId);
  const sprache = await vaSprache(tenantId, cfg ? ((await vaSession(tenantId, cfg))?.userId ?? null) : null);
  if (sprache === "de") return { sprache, text, uebersetzt: false };
  const u = await uebersetzen(tenantId, text, sprache, { quelle: "de" });
  return { sprache, text: u.text, uebersetzt: u.uebersetzt };
}

// ---- Lesen: Übersicht, Feierabend, MCP --------------------------------------------------------------------

export async function vaHeute(tenantId: string, heute: string) {
  if (!(await vaKonfig(tenantId))) return null;
  const von = berlinMidnight(heute);
  const bis = berlinMidnight(new Date(Date.parse(`${heute}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
  const CE = schema.claimEvents;
  const [[erl], [rf], [auto], [offen], [verpasstAufg], [verpasstAnspr], [eingereicht]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(VT).where(and(eq(VT.tenantId, tenantId), eq(VT.art, "aufgabe"), gte(VT.erledigtAm, von), lt(VT.erledigtAm, bis))),
    db.select({ n: sql<number>`count(*)::int` }).from(VN).where(and(eq(VN.tenantId, tenantId), eq(VN.von, "va"), isNotNull(VN.ludwigTaskId), gte(VN.gesendetAm, von), lt(VN.gesendetAm, bis))),
    db.select({ n: sql<number>`count(*)::int` }).from(VN).where(and(eq(VN.tenantId, tenantId), eq(VN.autoBeantwortet, true), gte(VN.gesendetAm, von), lt(VN.gesendetAm, bis))),
    db.select({ n: sql<number>`count(*)::int` }).from(VN).where(and(eq(VN.tenantId, tenantId), eq(VN.von, "va"), isNotNull(VN.ludwigTaskId), isNull(VN.beantwortetAm))),
    // Fristen verpasst: Aufgaben der VA heute überfällig geworden, Ansprüche ohne Einreichung abgelaufen (B18).
    db.select({ n: sql<number>`count(*)::int` }).from(VT).where(and(eq(VT.tenantId, tenantId), eq(VT.art, "aufgabe"), gte(VT.verpasstAm, von), lt(VT.verpasstAm, bis))),
    db.select({ n: sql<number>`count(*)::int` }).from(CE).where(and(eq(CE.tenantId, tenantId), eq(CE.action, "Frist bei der VA verpasst"), gte(CE.createdAt, von), lt(CE.createdAt, bis))),
    // Von der VA eingereichte Ansprüche (Fallnummer im Thread) zählen als erledigt.
    db.select({ n: sql<number>`count(*)::int` }).from(CE).where(and(eq(CE.tenantId, tenantId), ilike(CE.action, "%über VA (Discord)"), gte(CE.createdAt, von), lt(CE.createdAt, bis))),
  ]);
  const z = { erledigt: (erl?.n ?? 0) + (eingereicht?.n ?? 0), rueckfragen: rf?.n ?? 0, auto: auto?.n ?? 0, offen: offen?.n ?? 0, fristenVerpasst: (verpasstAufg?.n ?? 0) + (verpasstAnspr?.n ?? 0) };
  return { ...z, stufe: z.fristenVerpasst > 0 ? ("rot" as const) : ("ok" as const), text: L.vaHeuteText(z) };
}

export const VT_STATUS: Record<string, string> = { offen: "offen", rueckfrage: "Rückfrage", erledigt: "erledigt" };
export const VN_ART: Record<string, string> = { erledigt: "erledigt", rueckfrage: "Rückfrage", notiz: "Notiz", bitte: "Bitte", frage: "Frage", info: "Info", smalltalk: "Smalltalk", aufgabe: "Aufgabe", antwort: "Antwort", erinnerung: "Erinnerung", auto: "automatisch" };

export async function vaAufgaben(tenantId: string, status?: "offen" | "rueckfrage" | "erledigt" | null) {
  return db
    .select({ id: VT.id, taskId: VT.taskId, threadId: VT.threadId, status: VT.status, seit: VT.createdAt, erledigtAm: VT.erledigtAm, letzteErinnerung: VT.letzteErinnerung, titel: T.title, faellig: T.dueDate, prioritaet: T.priority, taskStatus: T.status })
    .from(VT)
    .innerJoin(T, eq(T.id, VT.taskId))
    .where(and(eq(VT.tenantId, tenantId), eq(VT.art, "aufgabe"), status ? eq(VT.status, status) : undefined))
    .orderBy(desc(VT.createdAt))
    .limit(100);
}

export async function vaNachrichtenListe(tenantId: string, o: { seit?: Date; nurOffen?: boolean; limit?: number } = {}) {
  return db
    .select({ n: VN, aufgabe: T.title })
    .from(VN)
    .leftJoin(T, eq(T.id, sql`coalesce(${VN.taskId}, ${VN.ludwigTaskId})`))
    .where(and(eq(VN.tenantId, tenantId), eq(VN.von, "va"), o.seit ? gte(VN.gesendetAm, o.seit) : undefined, o.nurOffen ? and(isNotNull(VN.ludwigTaskId), isNull(VN.beantwortetAm)) : undefined))
    .orderBy(desc(VN.gesendetAm))
    .limit(o.limit ?? 50);
}

export async function vaStatus(tenantId: string) {
  const [cfg, [st]] = await Promise.all([vaKonfig(tenantId), db.select().from(schema.vaStand).where(eq(schema.vaStand.tenantId, tenantId))]);
  const va = cfg ? await vaSession(tenantId, cfg) : null;
  return { eingerichtet: Boolean(cfg), vaKonto: va ? va.name || va.email : null, kontoFehlt: Boolean(cfg && cfg.vaEmail && !va), letzterAbgleich: st?.letzterAbgleich ?? null, letzterFehler: st?.letzterFehler ?? null };
}

/** Mandanten mit eingerichtetem VA-Kanal (für den 30-Sekunden-Abgleich). */
export async function vaMandanten(): Promise<string[]> {
  const rows = await db.select({ t: schema.integrations.tenantId }).from(schema.integrations).where(eq(schema.integrations.provider, "discord_va"));
  return [...new Set(rows.map((r) => r.t))];
}

/** Offene Aufgaben zur Auswahl „An die VA geben“ (ohne laufenden VA-Thread, ohne Privates). */
export async function vaAuswahl(tenantId: string) {
  const laufend = db.select({ id: VT.taskId }).from(VT).where(and(eq(VT.tenantId, tenantId), eq(VT.art, "aufgabe"), ne(VT.status, "erledigt"), isNotNull(VT.taskId)));
  return db
    .select({ id: T.id, title: T.title, dueDate: T.dueDate })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), sql`${T.id} not in (${laufend})`, sql`coalesce(${T.link}, '') not like '/privat%'`))
    .orderBy(sql`${T.dueDate} asc nulls last`, desc(T.createdAt))
    .limit(150);
}
