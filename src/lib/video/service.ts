import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { InstagramProfil, SchrittStand, VideoDatei, VideoFreigabe, VideoKosten, VideoPaket, VideoQuelle, VideoReferenz, VideoSchritt, VideoStory, VideoSzene } from "@/db/tables/video";
import type { Session } from "@/lib/auth/session";
import { medienOrdner } from "@/lib/medien/ablage";
import { openPii, sealPii } from "@/lib/pii";
import { storySperre } from "./story-sperre";
import { BILD_MODELL_STANDARD, FREIGABE_VOR, figurenAus, istBildModell, istVideoModell, istVideoStil, kostenSchaetzung, kostenSumme, laengeZiel, nachSchritt, SCHRITTE, slugAus, startAbAus, titelTreffer, typischFuer, VIDEO_MODELL_STANDARD, VIDEO_PREISE_STANDARD, WORKER_MIN_FREI_GB, WORKER_VERSION_AKTUELL, workerStand, workerVeraltet, type BildModell, type VideoModell, type VideoPreise } from "./logic";

// B36 Video-Pipeline: Steuerung im Seller-System. Der Worker am Arbeits-PC holt Aufträge ab, meldet Schritte, lädt
// fertige Dateien hoch und ruft Claude/ElevenLabs/OpenAI über die Anbieter-Brücke auf (Schlüssel bleiben hier, Kosten
// werden hier gezählt). Freigaben, „Schritt wiederholen“, „Privat hochladen“ nur auf der Seite Video.

export class VideoFehler extends Error {}

const K = schema.videoKanaele;
const A = schema.videoAuftraege;
const W = schema.videoWorker;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const jetzt = () => new Date();

// ---- Einstellungen -----------------------------------------------------------------------------------------------

/**
 * modell: Claude-Modell für Recherche/Skript/Paket. ablage: wohin die fertigen Dateien gehen – „drive“ = Google Drive
 * (der Worker lädt direkt dorthin, der Seller-Server bekommt nur die kleinen Dateien), „server“ = Medienablage.
 * drive: Refresh-Token (verschlüsselt, Bereich drive.file) und Wurzelordner „Seller-System Videos“.
 */
export type VideoDrive = { token: string; ordnerId: string; verbundenAm: string };
export type VideoEinstellungen = { preise: VideoPreise; serverReserveGb: number; modell: VideoModell; bildModell: BildModell; ablage: "drive" | "server"; drive: VideoDrive | null };
const STANDARD: VideoEinstellungen = { preise: VIDEO_PREISE_STANDARD, serverReserveGb: 2, modell: VIDEO_MODELL_STANDARD, bildModell: BILD_MODELL_STANDARD, ablage: "server", drive: null };

export async function videoEinstellungen(tenantId: string): Promise<VideoEinstellungen> {
  const [t] = await db.select({ s: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const roh = ((t?.s as Record<string, unknown> | null)?.video ?? {}) as Partial<VideoEinstellungen>;
  const cfg = { ...STANDARD, ...roh, preise: { ...STANDARD.preise, ...(roh.preise ?? {}) } };
  if (!istVideoModell(cfg.modell)) cfg.modell = VIDEO_MODELL_STANDARD;
  if (!istBildModell(cfg.bildModell)) cfg.bildModell = BILD_MODELL_STANDARD;
  // Drive nur, wenn verbunden – sonst Seller-Server
  if (cfg.ablage === "drive" && !cfg.drive?.token) cfg.ablage = "server";
  return cfg;
}

export async function videoEinstellungenSpeichern(s: Session, patch: Partial<VideoEinstellungen>) {
  if (s.role !== "owner" || s.readOnly) throw new VideoFehler("Nur der Inhaber ändert die Video-Einstellungen.");
  const neu = { ...(await videoEinstellungen(s.tenantId)), ...patch };
  await db.update(schema.tenants).set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('video', ${JSON.stringify(neu)}::jsonb)` }).where(eq(schema.tenants.id, s.tenantId));
  return neu;
}

// ---- Kanäle ------------------------------------------------------------------------------------------------------

export type KanalEingabe = { name: string; handle: string | null; sprache: string; themenbereich: string | null; zielgruppe?: string | null; stimmeId: string | null; bildstil: string | null; sicherheitsstufe: "normal" | "streng"; musik: string | null; freigaben: Partial<Record<VideoFreigabe, boolean>>; aktiv: boolean; stil?: string | null; figuren?: string | null; bildQualitaet?: string | null; plattform?: string | null; tempo?: string | null; instagram?: InstagramProfil | null };

export const kanaele = (tenantId: string) => db.select().from(K).where(eq(K.tenantId, tenantId)).orderBy(asc(K.createdAt));

export async function kanalSpeichern(s: Session, id: string | null, e: KanalEingabe): Promise<string> {
  if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
  const name = e.name.trim().slice(0, 80);
  if (!name) throw new VideoFehler("Bitte einen Kanalnamen angeben.");
  const werte = { name, handle: e.handle?.trim().slice(0, 80) || null, sprache: e.sprache.trim().slice(0, 10) || "de", themenbereich: e.themenbereich?.trim().slice(0, 500) || null, zielgruppe: e.zielgruppe?.trim().slice(0, 300) || null, stimmeId: e.stimmeId?.trim().slice(0, 80) || null, bildstil: e.bildstil?.trim().slice(0, 500) || null, sicherheitsstufe: e.sicherheitsstufe, musik: e.musik?.trim().replace(/[\\/]/g, "").slice(0, 120) || null, freigaben: { gliederung: e.freigaben.gliederung !== false, skript: e.freigaben.skript !== false, szenen: e.freigaben.szenen === true, vorschau: e.freigaben.vorschau !== false }, aktiv: e.aktiv, stil: istVideoStil(e.stil) ? e.stil : "vollbild", figuren: e.figuren?.trim().slice(0, 3000) || null, bildQualitaet: e.bildQualitaet === "low" || e.bildQualitaet === "high" ? e.bildQualitaet : "medium", plattform: e.plattform === "instagram" ? "instagram" : "youtube", tempo: e.tempo === "ruhig" || e.tempo === "schnell" ? e.tempo : "normal" } as const;
  // B37: Instagram-Profil nur übernehmen, wenn mitgeschickt (Themenliste bleibt beim Speichern des Profils erhalten)
  const instagram = e.instagram ? await instagramProfilMischen(s.tenantId, id, e.instagram) : undefined;
  if (id) {
    const [r] = await db.update(K).set({ ...werte, ...(instagram ? { instagram } : {}) }).where(and(eq(K.tenantId, s.tenantId), eq(K.id, id))).returning({ id: K.id });
    if (!r) throw new VideoFehler("Kanal nicht gefunden.");
    return r.id;
  }
  let slug = slugAus(name);
  const vorhanden = new Set((await db.select({ slug: K.slug }).from(K).where(eq(K.tenantId, s.tenantId))).map((x) => x.slug));
  for (let i = 2; vorhanden.has(slug); i++) slug = `${slugAus(name)}-${i}`;
  const [r] = await db.insert(K).values({ tenantId: s.tenantId, slug, ...werte, ...(instagram ? { instagram } : {}) }).returning({ id: K.id });
  return r.id;
}

/** Profil-Felder ersetzen, Themenliste behalten (die pflegt man getrennt). */
async function instagramProfilMischen(tenantId: string, id: string | null, neu: InstagramProfil): Promise<InstagramProfil> {
  const [alt] = id ? await db.select({ instagram: K.instagram }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.id, id))) : [];
  return { ...(alt?.instagram ?? {}), ...neu, themen: neu.themen ?? alt?.instagram?.themen ?? [] };
}

/** YouTube-Zugang eines Kanals speichern (Refresh-Token verschlüsselt) bzw. trennen. */
export async function kanalYoutubeSetzen(tenantId: string, kanalId: string, refreshToken: string | null, kanalName: string | null) {
  await db.update(K).set({ youtubeToken: refreshToken ? sealPii(refreshToken) : null, youtubeKanal: refreshToken ? kanalName : null, youtubeVerbundenAm: refreshToken ? jetzt() : null }).where(and(eq(K.tenantId, tenantId), eq(K.id, kanalId)));
}

// ---- Aufträge ----------------------------------------------------------------------------------------------------

/** vorlageArt „vorlage“: englisches Transkript/Gliederung eines erfolgreichen Videos (nur Muster für Aufbau, Hook und
 *  Spannungsbogen – nicht übersetzen); „skript“: eigenes Skript, wird möglichst wörtlich übernommen. */
export type AuftragEingabe = { kanalId: string; thema: string; startWahl: string; zeitpunkt: string | null; vidiqKeywords: string | null; vidiqTitel: string | null; vorlage?: string | null; vorlageArt?: "vorlage" | "skript" | null };
export const VORLAGE_MAX = 40_000;

export async function auftragAnlegen(s: Session, e: AuftragEingabe): Promise<string> {
  if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
  const thema = e.thema.trim().slice(0, 300);
  if (thema.length < 5) throw new VideoFehler("Bitte ein Thema eingeben.");
  const [kanal] = await db.select().from(K).where(and(eq(K.tenantId, s.tenantId), eq(K.id, e.kanalId)));
  if (!kanal || !kanal.aktiv) throw new VideoFehler("Kanal nicht gefunden oder ausgeschaltet.");
  const cfg = await videoEinstellungen(s.tenantId);
  const schaetzung = kostenSchaetzung(cfg.preise, typischFuer(kanal.stil), cfg.modell, cfg.bildModell);
  const vorlage = e.vorlage?.trim() || null;
  if (vorlage && vorlage.length > VORLAGE_MAX) throw new VideoFehler(`Vorlage/Skript ist zu lang (${vorlage.length.toLocaleString("de-DE")} Zeichen, höchstens ${VORLAGE_MAX.toLocaleString("de-DE")}).`);
  if (vorlage && vorlage.length < 200) throw new VideoFehler("Vorlage/Skript ist sehr kurz – bitte den ganzen Text einfügen (oder das Feld leer lassen).");
  const [r] = await db
    .insert(A)
    .values({ tenantId: s.tenantId, kanalId: kanal.id, thema, vidiqKeywords: e.vidiqKeywords?.trim().slice(0, 2000) || null, vidiqTitel: e.vidiqTitel?.trim().slice(0, 2000) || null, vorlage, vorlageArt: vorlage ? (e.vorlageArt === "skript" ? "skript" : "vorlage") : null, startAb: startAbAus(e.startWahl, e.zeitpunkt), kostenSchaetzung: schaetzung.summe, erstelltVon: s.userId, schritte: Object.fromEntries(SCHRITTE.map((x) => [x, { status: "offen" }])) as Partial<Record<VideoSchritt, SchrittStand>> })
    .returning({ id: A.id });
  return r.id;
}

export async function auftraege(tenantId: string, kanalId?: string | null, limit = 50, art: "video" | "story" | null = null) {
  return db
    .select({ a: A, kanal: K.name, kanalSlug: K.slug })
    .from(A)
    .innerJoin(K, eq(K.id, A.kanalId))
    .where(and(eq(A.tenantId, tenantId), kanalId ? eq(A.kanalId, kanalId) : undefined, art ? eq(A.art, art) : undefined))
    .orderBy(art === "story" ? sql`${A.geplantFuer} desc nulls last` : desc(A.createdAt))
    .limit(limit);
}

export async function auftragLesen(tenantId: string, id: string) {
  const [r] = await db.select({ a: A, kanal: K }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, tenantId), eq(A.id, id)));
  return r ?? null;
}

async function auftragFuer(s: Session, id: string) {
  if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
  const r = await auftragLesen(s.tenantId, id);
  if (!r) throw new VideoFehler("Auftrag nicht gefunden.");
  return r;
}

const aendern = (id: string, werte: Partial<typeof A.$inferInsert>) => db.update(A).set({ ...werte, updatedAt: jetzt() }).where(eq(A.id, id));

/** Freigabe-Punkt bestätigen → nächster Schritt (bzw. bei „Vorschau“: Upload, wenn „Privat hochladen“ an, sonst fertig). */
export async function freigeben(s: Session, id: string, f: VideoFreigabe, o: { hinweis?: string | null; titelWahl?: number | null } = {}) {
  const { a } = await auftragFuer(s, id);
  if (a.freigabeOffen !== f) throw new VideoFehler("Diese Freigabe steht gerade nicht an.");
  const freigegeben = { ...a.freigegeben, [f]: jetzt().toISOString() };
  const paket = f === "vorschau" && a.paket && o.titelWahl !== undefined && o.titelWahl !== null ? { ...a.paket, titelGewaehlt: Math.max(0, Math.min(a.paket.titel.length - 1, o.titelWahl)) } : a.paket;
  if (f === "szenen") {
    await aendern(id, { freigegeben, freigabeOffen: null, neuMotive: [], status: "wartet", schritt: "render", hinweis: o.hinweis?.trim().slice(0, 2000) || a.hinweis });
    return "Szenen freigegeben – der Worker rendert das Video.";
  }
  if (f === "vorschau" && !a.hochladen) {
    await aendern(id, { freigegeben, freigabeOffen: null, paket, status: "fertig", fertigAm: jetzt(), aufraeumen: true });
    return "Freigegeben – fertig. Zum Hochladen „Privat hochladen“ einschalten.";
  }
  await aendern(id, { freigegeben, freigabeOffen: null, paket, status: "wartet", schritt: FREIGABE_VOR[f], hinweis: o.hinweis?.trim().slice(0, 2000) || a.hinweis });
  return f === "vorschau" ? "Freigegeben – der Worker lädt das Video privat hoch." : "Freigegeben – der Worker macht weiter.";
}

/** „Neu recherchieren“ / „Skript neu schreiben“ (mit Anmerkung) – spätere Freigaben verfallen. */
export async function neuMachen(s: Session, id: string, schritt: "research" | "script", hinweis: string | null) {
  const { a } = await auftragFuer(s, id);
  const freigegeben = schritt === "research" ? {} : { gliederung: a.freigegeben.gliederung };
  await aendern(id, { status: "wartet", schritt, wiederholen: schritt, freigabeOffen: null, freigegeben, hinweis: hinweis?.trim().slice(0, 2000) || a.hinweis, fertigAm: null });
}

/** Szenen-Übersicht (B36.9.6): ausgewählte Motive verwerfen und neu erzeugen lassen – alles andere bleibt (Bibliothek). */
export async function motiveNeu(s: Session, id: string, keys: string[]) {
  const { a } = await auftragFuer(s, id);
  if (a.freigabeOffen !== "szenen") throw new VideoFehler("Die Szenen-Übersicht steht gerade nicht zur Freigabe an.");
  const vorhanden = new Set((a.skript ?? []).flatMap((x) => (x.motive ?? []).map((m) => m.key)));
  const neu = [...new Set(keys)].filter((k) => vorhanden.has(k)).slice(0, 60);
  if (!neu.length) throw new VideoFehler("Bitte mindestens ein Motiv auswählen.");
  const { szenen: _s, vorschau: _v, ...freigegeben } = a.freigegeben;
  const schritte = { ...a.schritte, visuals: { status: "offen" as const } };
  // „#…“ = Kennung dieser Runde: der Worker löscht die Motive je Runde nur einmal (kein Doppel-Bezahlen nach Neustart)
  await aendern(id, { status: "wartet", schritt: "visuals", wiederholen: "visuals", neuMotive: [...neu, `#${Date.now().toString(36)}`], freigabeOffen: null, freigegeben, schritte });
  return `${neu.length} Motiv${neu.length === 1 ? "" : "e"} werden neu erzeugt – danach kommt die Szenen-Übersicht wieder.`;
}

/** Nach Fehler: denselben Schritt erneut (bereits bezahlte Dateien nutzt der Worker weiter). */
export async function schrittWiederholen(s: Session, id: string) {
  const { a } = await auftragFuer(s, id);
  if (a.status !== "fehler") throw new VideoFehler("Nur nach einem Fehler.");
  const schritte = { ...a.schritte, [a.schritt]: { status: "offen" as const } };
  await aendern(id, { status: "wartet", wiederholen: a.schritt, schritte });
}

export async function abbrechen(s: Session, id: string) {
  const { a } = await auftragFuer(s, id);
  if (a.status === "fertig") throw new VideoFehler("Schon fertig.");
  await aendern(id, { status: "abgebrochen", freigabeOffen: null, aufraeumen: true });
}

/** Schalter „Privat hochladen“. Ist der Auftrag schon fertig (Vorschau freigegeben), startet der Upload. */
export async function hochladenSchalten(s: Session, id: string, an: boolean) {
  const { a, kanal } = await auftragFuer(s, id);
  if (an && !kanal.youtubeToken) throw new VideoFehler("YouTube ist für diesen Kanal noch nicht verbunden (Kanalprofil → „Mit YouTube verbinden“).");
  if (a.youtubeId) throw new VideoFehler("Schon hochgeladen.");
  const vorschauOk = !!a.freigegeben.vorschau || kanal.freigaben.vorschau === false;
  if (an && a.status === "fertig" && vorschauOk) {
    await aendern(id, { hochladen: true, status: "wartet", schritt: "upload", aufraeumen: false, fertigAm: null });
    return "Upload gestartet – privat.";
  }
  await aendern(id, { hochladen: an });
  return an ? "„Privat hochladen“ an – nach der Freigabe der Vorschau lädt der Worker privat hoch." : "„Privat hochladen“ aus.";
}

/** vidIQ Stufe 1: Keywords/Titelvorschläge eintragen (von Hand oder per Claude). */
export async function vidiqEintragen(tenantId: string, id: string, o: { keywords?: string | null; titel?: string | null }) {
  const [a] = await db.select({ id: A.id, status: A.status }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.id, id)));
  if (!a) throw new VideoFehler("Auftrag nicht gefunden.");
  await aendern(id, { ...(o.keywords !== undefined ? { vidiqKeywords: o.keywords?.trim().slice(0, 2000) || null } : {}), ...(o.titel !== undefined ? { vidiqTitel: o.titel?.trim().slice(0, 2000) || null } : {}) });
}

export async function auftragLoeschen(s: Session, id: string) {
  if (s.role !== "owner" || s.readOnly) throw new VideoFehler("Nur der Inhaber löscht Aufträge.");
  const r = await auftragLesen(s.tenantId, id);
  if (!r) throw new VideoFehler("Auftrag nicht gefunden.");
  await rm(auftragOrdner(s.tenantId, id), { recursive: true, force: true });
  await db.delete(A).where(and(eq(A.tenantId, s.tenantId), eq(A.id, id)));
}

// ---- Kosten ------------------------------------------------------------------------------------------------------

/** Kosten je Kanal im Monat (Ist) und Anzahl Videos – für Seite und Wochenbericht. */
export async function kostenUebersicht(tenantId: string) {
  const monat = sql`date_trunc('month', now())`;
  const woche = sql`now() - interval '7 days'`;
  const [jeKanal, [w]] = await Promise.all([
    db.select({ kanal: K.name, videos: sql<number>`count(*)::int`, kosten: sql<number>`coalesce(sum(${A.kostenIst}), 0)::float` }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, tenantId), gte(A.createdAt, monat))).groupBy(K.name),
    db.select({ videos: sql<number>`count(*)::int`, fertig: sql<number>`count(*) filter (where ${A.status} = 'fertig')::int`, kosten: sql<number>`coalesce(sum(${A.kostenIst}), 0)::float`, offen: sql<number>`count(*) filter (where ${A.status} = 'freigabe')::int` }).from(A).where(and(eq(A.tenantId, tenantId), gte(A.createdAt, woche))),
  ]);
  return { jeKanal, monatSumme: jeKanal.reduce((s, x) => s + x.kosten, 0), woche: w };
}

/** Zeile für den Wochenbericht (null, wenn nichts los war). */
export async function videoWochenZeile(tenantId: string): Promise<string | null> {
  const { woche, monatSumme } = await kostenUebersicht(tenantId);
  if (!woche.videos && !monatSumme) return null;
  return `Video: ${woche.videos} Auftrag/Aufträge in 7 Tagen (${woche.fertig} fertig${woche.offen ? `, ${woche.offen} warten auf Freigabe` : ""}), Kosten Monat ${monatSumme.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

/** Kosten eines Anbieter-Aufrufs am Auftrag verbuchen (atomar). */
export async function kostenBuchen(tenantId: string, auftragId: string, pos: VideoKosten[]) {
  if (!pos.length) return;
  await db
    .update(A)
    .set({ kostenPositionen: sql`${A.kostenPositionen} || ${JSON.stringify(pos)}::jsonb`, kostenIst: sql`${A.kostenIst} + ${kostenSumme(pos)}` })
    .where(and(eq(A.tenantId, tenantId), eq(A.id, auftragId)));
}

// ---- Worker ------------------------------------------------------------------------------------------------------

export type Worker = typeof W.$inferSelect;

export async function workerAnlegen(s: Session, name: string): Promise<{ id: string; token: string }> {
  if (s.role !== "owner" || s.readOnly) throw new VideoFehler("Nur der Inhaber legt Worker an.");
  const token = `vw_${randomBytes(32).toString("base64url")}`;
  const [w] = await db.insert(W).values({ tenantId: s.tenantId, name: name.trim().slice(0, 80) || "Arbeits-PC", tokenHash: hash(token), tokenAnfang: token.slice(0, 7), angelegtVon: s.userId }).returning({ id: W.id });
  return { id: w.id, token };
}

export async function workerDeaktivieren(s: Session, id: string) {
  if (s.role !== "owner" || s.readOnly) throw new VideoFehler("Nur der Inhaber.");
  await db.update(W).set({ deaktiviertAm: jetzt() }).where(and(eq(W.tenantId, s.tenantId), eq(W.id, id)));
}

export const workerListe = (tenantId: string) => db.select().from(W).where(and(eq(W.tenantId, tenantId), isNull(W.deaktiviertAm))).orderBy(desc(W.zuletztGesehen));

/** Zuletzt gesehener aktiver Worker (für „Worker zuletzt gesehen: …“). */
export async function workerZuletzt(tenantId: string) {
  const [w] = await db.select().from(W).where(and(eq(W.tenantId, tenantId), isNull(W.deaktiviertAm))).orderBy(sql`${W.zuletztGesehen} desc nulls last`).limit(1);
  return w ? { ...w, stand: workerStand(w.zuletztGesehen) } : null;
}

/** Token aus „Authorization: Bearer …“ oder „x-api-key“ (Claude-SDK über die Anbieter-Brücke). */
export async function workerPerToken(request: Request): Promise<Worker | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = (/^Bearer\s+(vw_[A-Za-z0-9_-]{20,})$/.exec(auth)?.[1] ?? request.headers.get("x-api-key") ?? "").trim();
  if (!/^vw_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const [w] = await db.select().from(W).where(eq(W.tokenHash, hash(token))).limit(1);
  return w && !w.deaktiviertAm ? w : null;
}

export type Meldung = { version?: string; freiGb?: number; os?: string; python?: string; ffmpeg?: string; laeuft?: string | null; aufgeraeumt?: string[] };

/** Lebenszeichen: zuletzt gesehen, freie Platte; Antwort: welche Arbeitsordner gelöscht werden dürfen. */
export async function workerMelden(w: Worker, m: Meldung) {
  await db.update(W).set({ zuletztGesehen: jetzt(), version: m.version?.slice(0, 40) ?? w.version, freiGb: typeof m.freiGb === "number" && Number.isFinite(m.freiGb) ? Math.round(m.freiGb * 10) / 10 : w.freiGb, info: { os: m.os?.slice(0, 80), python: m.python?.slice(0, 40), ffmpeg: m.ffmpeg?.slice(0, 80), laeuft: m.laeuft ?? null } }).where(eq(W.id, w.id));
  const erledigt = (m.aufgeraeumt ?? []).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (erledigt.length) await db.update(A).set({ aufraeumen: false }).where(and(eq(A.tenantId, w.tenantId), inArray(A.id, erledigt)));
  const frei = await db.select({ id: A.id }).from(A).where(and(eq(A.tenantId, w.tenantId), eq(A.aufraeumen, true))).limit(50);
  return { ok: true, aufraeumen: frei.map((x) => x.id), minFreiGb: WORKER_MIN_FREI_GB };
}

/** Was der Worker zum Auftrag braucht (Kanalprofil, Daten der vorigen Schritte, vidIQ, Anmerkung). */
function auftragFuerWorker(a: typeof A.$inferSelect, k: typeof K.$inferSelect, cfg: VideoEinstellungen) {
  return {
    id: a.id,
    modell: cfg.modell,
    ablage: cfg.ablage,
    dateien: Object.fromEntries(Object.entries(a.dateien).map(([art, d]) => [art, { groesse: d?.groesse ?? 0, drive: d?.drive ?? null }])),
    thema: a.thema,
    schritt: a.schritt,
    wiederholen: a.wiederholen,
    hinweis: a.hinweis,
    hochladen: a.hochladen,
    vidiq: { keywords: a.vidiqKeywords, titel: a.vidiqTitel },
    vorlage: a.vorlage ? { art: a.vorlageArt ?? "vorlage", text: a.vorlage } : null,
    neuMotive: a.neuMotive,
    laenge: laengeZiel(),
    art: a.art,
    // B37 Story: Inhalt/Thema, geplanter Zeitpunkt; Fakten/Farben/Hinweis aus dem Kanalprofil
    story: a.art === "story" ? { ...(a.story ?? { inhaltsart: "tipp" }), geplantFuer: a.geplantFuer?.toISOString() ?? null } : null,
    kanal: { id: k.id, slug: k.slug, name: k.name, handle: k.handle, sprache: k.sprache, themenbereich: k.themenbereich, zielgruppe: k.zielgruppe, stil: k.stil, figuren: figurenAus(k.figuren), bildQualitaet: k.bildQualitaet, referenzen: k.referenzen.map((r) => ({ nr: r.nr, groesse: r.groesse, hash: r.hash, typ: r.typ })), stimmeId: k.stimmeId, bildstil: k.bildstil, sicherheitsstufe: k.sicherheitsstufe, musik: k.musik, plattform: k.plattform, tempo: k.tempo, instagram: k.plattform === "instagram" ? (() => { const { themen: _t, ...rest } = k.instagram; return rest; })() : null },
    daten: { gliederung: a.gliederung, quellen: a.quellen, skript: a.skript, paket: a.paket },
  };
}

/**
 * Nächster Auftrag für den Worker. Nur einer gleichzeitig (eine Render-Warteschlange): läuft schon einer bei diesem
 * Worker (z. B. nach Neustart), kommt derselbe zurück und der Worker macht dort weiter (state.json).
 */
export async function naechsterAuftrag(w: Worker): Promise<{ auftrag: ReturnType<typeof auftragFuerWorker> | null; grund?: string }> {
  await db.update(W).set({ zuletztGesehen: jetzt() }).where(eq(W.id, w.id));
  const [eigener] = await db.select({ a: A, k: K }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, w.tenantId), eq(A.status, "laeuft"), eq(A.workerId, w.id))).limit(1);
  if (eigener) return { auftrag: auftragFuerWorker(eigener.a, eigener.k, await videoEinstellungen(w.tenantId)) };
  if (w.freiGb !== null && w.freiGb < WORKER_MIN_FREI_GB) return { auftrag: null, grund: `Zu wenig freier Speicher am Worker (${w.freiGb} GB, mindestens ${WORKER_MIN_FREI_GB} GB) – kein Lauf` };
  const still = new Date(Date.now() - 10 * 60_000);
  const [anderer] = await db.select({ id: A.id }).from(A).where(and(eq(A.tenantId, w.tenantId), eq(A.status, "laeuft"), gte(A.zuletztVomWorker, still))).limit(1);
  if (anderer) return { auftrag: null, grund: "Ein anderer Auftrag läuft gerade (nur ein Render gleichzeitig)" };
  const kandidaten = await db
    .select({ id: A.id, art: A.art })
    .from(A)
    .where(and(eq(A.tenantId, w.tenantId), or(eq(A.status, "wartet"), and(eq(A.status, "laeuft"), or(isNull(A.zuletztVomWorker), lt(A.zuletztVomWorker, still)))), or(isNull(A.startAb), lte(A.startAb, jetzt()))))
    .orderBy(asc(A.createdAt))
    .limit(5);
  let grund: string | undefined;
  for (const k of kandidaten) {
    // B37: Stories erst ab Worker 1.2.0 (ältere kennen den Schritt nicht) und nur unter dem Monatslimit des Kanals
    if (k.art === "story" && workerVeraltet(w.version)) {
      grund = `Worker v${w.version ?? "?"} kann keine Stories – bitte auf v${WORKER_VERSION_AKTUELL} aktualisieren`;
      continue;
    }
    const sperre = await storySperre(w.tenantId, k.id);
    if (sperre) continue;
    const [r] = await db
      .update(A)
      .set({ status: "laeuft", workerId: w.id, zuletztVomWorker: jetzt(), updatedAt: jetzt() })
      .where(and(eq(A.id, k.id), or(eq(A.status, "wartet"), eq(A.status, "laeuft"))))
      .returning();
    if (!r) continue;
    const [kanal] = await db.select().from(K).where(eq(K.id, r.kanalId));
    return { auftrag: auftragFuerWorker(r, kanal, await videoEinstellungen(w.tenantId)) };
  }
  return { auftrag: null, grund };
}

export type SchrittMeldung = {
  schritt: VideoSchritt;
  status: "laeuft" | "fertig" | "fehler";
  fortschritt?: { fertig: number; gesamt: number } | null;
  fehler?: string | null;
  hinweise?: string[] | null;
  daten?: { gliederung?: (typeof A.$inferSelect)["gliederung"]; quellen?: VideoQuelle[]; skript?: VideoSzene[]; woerter?: number; dauerSek?: number; paket?: VideoPaket; story?: VideoStory };
};

/** Schritt-Meldung des Workers: Stand, Daten, nächster Schritt bzw. Freigabe. */
export async function schrittMelden(w: Worker, id: string, m: SchrittMeldung): Promise<{ weiter: boolean; status: string; naechster: VideoSchritt | null; freigabe: VideoFreigabe | null }> {
  if (!SCHRITTE.includes(m.schritt) && m.schritt !== "story") throw new VideoFehler("Unbekannter Schritt.");
  const [r] = await db.select({ a: A, k: K }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, w.tenantId), eq(A.id, id)));
  if (!r) throw new VideoFehler("Auftrag nicht gefunden.");
  const { a, k } = r;
  if (a.status === "abgebrochen") return { weiter: false, status: "abgebrochen", naechster: null, freigabe: null };
  // Veraltete Meldung (Auftrag inzwischen zurückgesetzt, freigegeben oder an anderen Worker gegangen): ignorieren.
  if (a.status !== "laeuft" || a.workerId !== w.id) return { weiter: false, status: a.status, naechster: null, freigabe: a.freigabeOffen };
  const hinweise = Array.isArray(m.hinweise) ? m.hinweise.filter((x) => typeof x === "string").slice(0, 20).map((x) => x.slice(0, 300)) : null;
  const vorher = a.schritte[m.schritt];
  const stand: SchrittStand = { status: m.status, fortschritt: m.fortschritt ?? null, fehler: m.fehler?.slice(0, 1000) ?? null, hinweise: hinweise ?? (m.status === "laeuft" ? (vorher?.hinweise ?? null) : null), am: jetzt().toISOString() };
  const schritte = { ...a.schritte, [m.schritt]: stand };
  const werte: Partial<typeof A.$inferInsert> = { schritte, zuletztVomWorker: jetzt(), workerId: w.id };
  if (m.status === "laeuft") {
    await aendern(id, { ...werte, schritt: m.schritt, status: "laeuft" });
    return { weiter: true, status: "laeuft", naechster: m.schritt, freigabe: null };
  }
  if (m.status === "fehler") {
    await aendern(id, { ...werte, status: "fehler", schritt: m.schritt });
    return { weiter: false, status: "fehler", naechster: null, freigabe: null };
  }
  // B37 Story fertig: Regeln prüfen, Freigabe nach Modus (jedes Mal / Stichprobe / automatisch)
  if (a.art === "story") {
    const { storyFertig } = await import("./story");
    const r2 = await storyFertig(a, k, werte, m.daten?.story ?? null);
    return { weiter: false, status: r2.status, naechster: null, freigabe: r2.freigabe };
  }
  // fertig: Daten übernehmen
  const d = m.daten ?? {};
  if (d.gliederung !== undefined) werte.gliederung = d.gliederung;
  if (d.quellen) werte.quellen = d.quellen.slice(0, 60);
  // B36.10: Whiteboard hat 55–80 kurze Szenen
  if (d.skript) werte.skript = d.skript.slice(0, 160);
  if (typeof d.woerter === "number") werte.woerter = Math.round(d.woerter);
  if (typeof d.dauerSek === "number") werte.dauerSek = Math.round(d.dauerSek);
  if (d.paket) werte.paket = { ...d.paket, titel: d.paket.titel.slice(0, 5), warnungen: [...(d.paket.warnungen ?? []), ...d.paket.titel.map((t) => (titelTreffer(t) ? `Titel „${t}“ enthält „${titelTreffer(t)}“` : null)).filter((x): x is string => !!x)] };
  if (a.wiederholen === m.schritt) werte.wiederholen = null;
  if (m.schritt === "visuals") werte.neuMotive = [];
  const n = nachSchritt(m.schritt, { freigaben: k.freigaben, freigegeben: a.freigegeben, hochladen: a.hochladen });
  const fertig = n.status === "fertig";
  await aendern(id, { ...werte, status: n.status, schritt: n.schritt, freigabeOffen: n.freigabeOffen, ...(fertig ? { fertigAm: jetzt(), aufraeumen: true } : {}) });
  return { weiter: n.status === "laeuft", status: n.status, naechster: n.status === "laeuft" ? n.schritt : null, freigabe: n.freigabeOffen };
}

// ---- Dateien (fertiges MP4, Thumbnail, Skript, Quellen, Untertitel) ------------------------------------------------

export const DATEI_ARTEN: Record<string, { name: string; typ: string; max: number }> = {
  mp4: { name: "video.mp4", typ: "video/mp4", max: 4 * 1024 ** 3 },
  thumbnail: { name: "thumbnail.png", typ: "image/png", max: 20 * 1024 ** 2 },
  skript: { name: "skript.txt", typ: "text/plain; charset=utf-8", max: 5 * 1024 ** 2 },
  quellen: { name: "quellen.json", typ: "application/json", max: 5 * 1024 ** 2 },
  untertitel: { name: "untertitel.srt", typ: "application/x-subrip", max: 5 * 1024 ** 2 },
  /** Whiteboard: Szenen-Übersicht (alle Szenen als Raster) zur Freigabe vor dem Render. */
  uebersicht: { name: "uebersicht.jpg", typ: "image/jpeg", max: 30 * 1024 ** 2 },
  /** B37 Instagram-Story (Hochformat 1080×1920): Video mit Aufdeck-Animation oder Standbild, dazu ein Vorschaubild. */
  story_mp4: { name: "story.mp4", typ: "video/mp4", max: 200 * 1024 ** 2 },
  story_png: { name: "story.png", typ: "image/png", max: 20 * 1024 ** 2 },
  story_vorschau: { name: "story-vorschau.jpg", typ: "image/jpeg", max: 10 * 1024 ** 2 },
};

// ---- Stil-Referenzbilder je Kanal (B36.9.1) -----------------------------------------------------------------------

export const REFERENZ_MAX = 4;
const REFERENZ_TYPEN: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const referenzOrdner = (tenantId: string, kanalId: string) => {
  if (!/^[0-9a-f-]{36}$/.test(tenantId) || !/^[0-9a-f-]{36}$/.test(kanalId)) throw new VideoFehler("Ungültige Kennung.");
  return path.join(/*turbopackIgnore: true*/ medienOrdner(), "video", tenantId, `kanal-${kanalId}`);
};

/** Bis zu 4 Bilder (PNG/JPG/WebP, je ≤ 5 MB) als Stil-Vorlage fürs Bildmodell. */
export async function referenzenHinzufuegen(s: Session, kanalId: string, dateien: File[]): Promise<number> {
  if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
  const [kanal] = await db.select().from(K).where(and(eq(K.tenantId, s.tenantId), eq(K.id, kanalId)));
  if (!kanal) throw new VideoFehler("Kanal nicht gefunden.");
  const liste = [...kanal.referenzen];
  const ordner = referenzOrdner(s.tenantId, kanalId);
  await mkdir(ordner, { recursive: true });
  let neu = 0;
  for (const f of dateien.filter((x) => x.size > 0)) {
    if (liste.length >= REFERENZ_MAX) throw new VideoFehler(`Höchstens ${REFERENZ_MAX} Referenzbilder je Kanal – erst eines entfernen.`);
    const endung = REFERENZ_TYPEN[f.type];
    if (!endung) throw new VideoFehler(`„${f.name}“: nur PNG, JPG oder WebP.`);
    if (f.size > 5 * 1024 ** 2) throw new VideoFehler(`„${f.name}“ ist größer als 5 MB.`);
    const daten = Buffer.from(await f.arrayBuffer());
    const nr = Math.max(0, ...liste.map((r) => r.nr)) + 1;
    await writeFile(path.join(ordner, `referenz-${nr}.${endung}`), daten);
    liste.push({ nr, name: f.name.slice(0, 120), typ: f.type, groesse: daten.length, hash: createHash("sha256").update(daten).digest("hex").slice(0, 16) });
    neu++;
  }
  if (!neu) throw new VideoFehler("Bitte ein Bild auswählen.");
  await db.update(K).set({ referenzen: liste }).where(and(eq(K.tenantId, s.tenantId), eq(K.id, kanalId)));
  return neu;
}

export async function referenzEntfernen(s: Session, kanalId: string, nr: number) {
  if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
  const [kanal] = await db.select().from(K).where(and(eq(K.tenantId, s.tenantId), eq(K.id, kanalId)));
  const r = kanal?.referenzen.find((x) => x.nr === nr);
  if (!kanal || !r) throw new VideoFehler("Referenzbild nicht gefunden.");
  await rm(path.join(referenzOrdner(s.tenantId, kanalId), `referenz-${nr}.${REFERENZ_TYPEN[r.typ] ?? "png"}`), { force: true });
  await db.update(K).set({ referenzen: kanal.referenzen.filter((x) => x.nr !== nr) }).where(and(eq(K.tenantId, s.tenantId), eq(K.id, kanalId)));
}

/** Referenzbild lesen (Seite: Vorschau; Worker: Vorlage fürs Bildmodell) – immer mit Mandant. */
export async function referenzLesen(tenantId: string, kanalId: string, nr: number): Promise<{ daten: Buffer; typ: string; ref: VideoReferenz } | null> {
  const [kanal] = await db.select({ referenzen: K.referenzen }).from(K).where(and(eq(K.tenantId, tenantId), eq(K.id, kanalId)));
  const ref = kanal?.referenzen.find((x) => x.nr === nr);
  if (!ref) return null;
  const daten = await readFile(path.join(referenzOrdner(tenantId, kanalId), `referenz-${nr}.${REFERENZ_TYPEN[ref.typ] ?? "png"}`)).catch(() => null);
  return daten ? { daten, typ: ref.typ, ref } : null;
}

const auftragOrdner = (tenantId: string, id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(tenantId) || !/^[0-9a-f-]{36}$/.test(id)) throw new VideoFehler("Ungültige Kennung.");
  return path.join(/*turbopackIgnore: true*/ medienOrdner(), "video", tenantId, id);
};

/** Freier Platz in der Medienablage (GB). */
export async function serverFreiGb(): Promise<number | null> {
  try {
    await mkdir(medienOrdner(), { recursive: true });
    const s = await statfs(medienOrdner());
    return Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    return null;
  }
}

/** Upload einer fertigen Datei – als Strom auf die Platte (kein Puffer im Speicher), mit Platz-Prüfung. */
export async function dateiSpeichern(w: Worker, id: string, art: string, body: ReadableStream<Uint8Array> | null, groesse: number | null): Promise<{ ok: true; groesse: number } | { ok: false; status: number; fehler: string }> {
  const def = DATEI_ARTEN[art];
  if (!def) return { ok: false, status: 400, fehler: "Unbekannte Dateiart" };
  if (!body) return { ok: false, status: 400, fehler: "Datei fehlt" };
  const [a] = await db.select({ id: A.id, dateien: A.dateien }).from(A).where(and(eq(A.tenantId, w.tenantId), eq(A.id, id)));
  if (!a) return { ok: false, status: 404, fehler: "Auftrag nicht gefunden" };
  if (groesse !== null && groesse > def.max) return { ok: false, status: 413, fehler: `Datei zu groß (höchstens ${Math.round(def.max / 1024 ** 2)} MB)` };
  const cfg = await videoEinstellungen(w.tenantId);
  const frei = await serverFreiGb();
  const brauche = (groesse ?? 0) / 1024 ** 3 + cfg.serverReserveGb;
  if (frei !== null && frei < brauche) return { ok: false, status: 507, fehler: `Zu wenig Platz auf dem Seller-Server (${frei} GB frei, nötig ${Math.round(brauche * 10) / 10} GB inkl. Reserve) – bitte Platz schaffen` };
  const ordner = auftragOrdner(w.tenantId, id);
  await mkdir(ordner, { recursive: true });
  const ziel = path.join(ordner, def.name);
  const teil = `${ziel}.teil`;
  let n = 0;
  const zaehler = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      if (n > def.max) cb(new Error("zu groß"));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), zaehler, createWriteStream(teil, { mode: 0o600 }));
  } catch (e) {
    await rm(teil, { force: true });
    return { ok: false, status: 400, fehler: `Upload abgebrochen: ${e instanceof Error ? e.message : "Fehler"}` };
  }
  if (groesse !== null && n !== groesse) {
    await rm(teil, { force: true });
    return { ok: false, status: 400, fehler: `Upload unvollständig (${n} von ${groesse} Byte)` };
  }
  await rename(teil, ziel);
  const vorher = a.dateien[art];
  const datei: VideoDatei = { key: `${id}/${def.name}`, name: def.name, typ: def.typ, groesse: n, drive: vorher?.drive ?? null, link: vorher?.link ?? null };
  await db.update(A).set({ dateien: sql`${A.dateien} || ${JSON.stringify({ [art]: datei })}::jsonb`, updatedAt: jetzt() }).where(eq(A.id, id));
  return { ok: true, groesse: n };
}

/** Datei zum Ansehen/Herunterladen (mit Range für den Video-Player). */
export async function dateiOeffnen(tenantId: string, id: string, art: string): Promise<{ pfad: string; groesse: number; typ: string; name: string } | { drive: string } | null> {
  const def = DATEI_ARTEN[art];
  if (!def) return null;
  const r = await auftragLesen(tenantId, id);
  const d = r?.a.dateien[art];
  if (!d) return null;
  if (d.drive && !d.key.startsWith(id)) return { drive: d.drive };
  const pfad = path.join(auftragOrdner(tenantId, id), def.name);
  const st = await stat(pfad).catch(() => null);
  return st ? { pfad, groesse: st.size, typ: def.typ, name: def.name } : null;
}

export const dateiStrom = (pfad: string, start?: number, ende?: number) => Readable.toWeb(createReadStream(pfad, start !== undefined ? { start, end: ende } : undefined)) as ReadableStream<Uint8Array>;

// ---- YouTube (Zugang für den Worker, Prüfung „privat“) ------------------------------------------------------------

async function googleApp(tenantId: string) {
  const { getIntegration } = await import("@/lib/integrations/store");
  const app = await getIntegration(tenantId, "google");
  if (!app?.clientId || !app.clientSecret) throw new VideoFehler("Google-App (Client-ID/Secret) fehlt unter Anbindungen → Google.");
  return { clientId: app.clientId, clientSecret: app.clientSecret };
}

/** Kurzlebiges Zugangs-Token zum privaten Upload – nur mit Schalter „Privat hochladen“ und freigegebener Vorschau. */
export async function youtubeZugangFuerWorker(w: Worker, id: string): Promise<{ accessToken: string; uploadBasis: string; ablaufSek: number }> {
  const [r] = await db.select({ a: A, k: K }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, w.tenantId), eq(A.id, id)));
  if (!r) throw new VideoFehler("Auftrag nicht gefunden.");
  if (!r.a.hochladen) throw new VideoFehler("„Privat hochladen“ ist für diesen Auftrag aus.");
  if (r.k.freigaben.vorschau !== false && !r.a.freigegeben.vorschau) throw new VideoFehler("Vorschau noch nicht freigegeben.");
  if (!r.k.youtubeToken) throw new VideoFehler("YouTube für diesen Kanal nicht verbunden.");
  const { ytZugang, ytUploadBasis } = await import("./youtube");
  const t = await ytZugang(await googleApp(w.tenantId), openPii(r.k.youtubeToken));
  return { accessToken: t.access_token, uploadBasis: ytUploadBasis(), ablaufSek: t.expires_in ?? 3600 };
}

/** Worker meldet die Video-ID: Sichtbarkeit prüfen (muss „private“ sein). Danach meldet der Worker „upload fertig“. */
export async function youtubeBestaetigen(w: Worker, id: string, videoId: string): Promise<{ privat: boolean; sichtbarkeit: string | null }> {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new VideoFehler("Ungültige Video-ID.");
  const [r] = await db.select({ a: A, k: K }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, w.tenantId), eq(A.id, id)));
  if (!r?.k.youtubeToken) throw new VideoFehler("Auftrag/Kanal nicht gefunden.");
  const { ytSichtbarkeit, ytZugang } = await import("./youtube");
  const t = await ytZugang(await googleApp(w.tenantId), openPii(r.k.youtubeToken));
  const sicht = await ytSichtbarkeit(t.access_token, videoId);
  const privat = sicht === "private";
  if (privat) {
    await aendern(id, { youtubeId: videoId, youtubeStatus: "privat" });
  } else {
    const schritte = { ...r.a.schritte, upload: { status: "fehler" as const, fehler: `Sichtbarkeit „${sicht ?? "unbekannt"}“ statt privat – bitte sofort in YouTube Studio prüfen`, am: jetzt().toISOString() } };
    await aendern(id, { youtubeId: videoId, youtubeStatus: `NICHT privat (${sicht ?? "unbekannt"})`, schritte, status: "fehler" });
  }
  return { privat, sichtbarkeit: sicht };
}

// ---- Google Drive als Ablage (B36.6) --------------------------------------------------------------------------------

export const DRIVE_WURZEL = "Seller-System Videos";
const driveApi = () => (process.env.DRIVE_API_BASE_URL || "https://www.googleapis.com/drive/v3").replace(/\/$/, "");
const driveUpload = () => (process.env.DRIVE_UPLOAD_BASE_URL || "https://www.googleapis.com/upload/drive/v3").replace(/\/$/, "");
export const driveLink = (fileId: string) => `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;

/** Drive verbinden (Refresh-Token verschlüsselt) und den Wurzelordner anlegen bzw. trennen. */
export async function videoDriveSetzen(tenantId: string, refreshToken: string | null): Promise<void> {
  const cfg = await videoEinstellungen(tenantId);
  let drive: VideoDrive | null = null;
  if (refreshToken) {
    const { ytZugang } = await import("./youtube");
    const { ordnerSichern } = await import("@/lib/integrations/clients/drive");
    const t = await ytZugang(await googleApp(tenantId), refreshToken);
    const ordnerId = await ordnerSichern(t.access_token, "root", DRIVE_WURZEL);
    drive = { token: sealPii(refreshToken), ordnerId, verbundenAm: jetzt().toISOString() };
  }
  const neu = { ...cfg, drive, ablage: drive ? "drive" : "server" };
  await db.update(schema.tenants).set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('video', ${JSON.stringify(neu)}::jsonb)` }).where(eq(schema.tenants.id, tenantId));
}

/**
 * Kurzlebiger Drive-Zugang für den Worker: Ordner „Seller-System Videos/<Kanal>/<Datum Thema>“ (wird angelegt) und die
 * Upload-Adresse. Der Worker lädt MP4 & Co. direkt nach Drive – nichts davon läuft über den Seller-Server.
 */
export async function driveZugangFuerWorker(w: Worker, id: string): Promise<{ ablage: "drive"; accessToken: string; ordnerId: string; uploadUrl: string; apiBasis: string } | { ablage: "server" }> {
  const cfg = await videoEinstellungen(w.tenantId);
  if (cfg.ablage !== "drive" || !cfg.drive) return { ablage: "server" };
  const [r] = await db.select({ a: A, k: K }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, w.tenantId), eq(A.id, id)));
  if (!r) throw new VideoFehler("Auftrag nicht gefunden.");
  const { ytZugang } = await import("./youtube");
  const { ordnerSichern } = await import("@/lib/integrations/clients/drive");
  const t = await ytZugang(await googleApp(w.tenantId), openPii(cfg.drive.token));
  const tag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(r.a.createdAt);
  const name = (x: string) => x.replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
  const ordnerId = await ordnerSichern(t.access_token, cfg.drive.ordnerId, `${name(r.k.name)}/${tag} ${name(r.a.thema)}`);
  return { ablage: "drive", accessToken: t.access_token, ordnerId, uploadUrl: `${driveUpload()}/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`, apiBasis: driveApi() };
}

/** Worker meldet eine nach Drive geladene Datei. */
export async function driveDateiMerken(w: Worker, id: string, art: string, d: { fileId: string; groesse: number; link?: string | null }): Promise<void> {
  const def = DATEI_ARTEN[art];
  if (!def) throw new VideoFehler("Unbekannte Dateiart");
  if (!/^[A-Za-z0-9_-]{5,100}$/.test(d.fileId)) throw new VideoFehler("Ungültige Drive-Datei-ID");
  const [a] = await db.select({ id: A.id, dateien: A.dateien }).from(A).where(and(eq(A.tenantId, w.tenantId), eq(A.id, id)));
  if (!a) throw new VideoFehler("Auftrag nicht gefunden");
  const vorher = a.dateien[art];
  // Liegt die Datei zusätzlich auf dem Seller-Server (kleine Dateien), bleibt der Schlüssel dorthin erhalten.
  const datei: VideoDatei = { key: vorher && !vorher.drive ? vorher.key : `drive:${d.fileId}`, name: def.name, typ: def.typ, groesse: Math.max(0, Math.round(d.groesse)), drive: d.fileId, link: d.link && /^https:\/\//.test(d.link) ? d.link : driveLink(d.fileId) };
  await db.update(A).set({ dateien: sql`${A.dateien} || ${JSON.stringify({ [art]: datei })}::jsonb`, updatedAt: jetzt() }).where(eq(A.id, id));
}
