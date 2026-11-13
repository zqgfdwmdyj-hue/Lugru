import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { StoryInhaltsart, StoryThema, VideoStory } from "@/db/tables/video";
import type { Session } from "@/lib/auth/session";
import { medienOrdner } from "@/lib/medien/ablage";
import { openPii, sealPii } from "@/lib/pii";
import { publicUrl } from "@/lib/public-url";
import { freigabeNoetig, istStoryArt, limitErreicht, naechsterVersuch, naechstesThema, profilMitVorgaben, slots, STORY_ARTEN, storyKosten, storyRegeln, themenAus, tokenStand } from "./story-logic";
import { kanalMonatKosten } from "./story-sperre";
import { VideoFehler, videoEinstellungen } from "./service";

// B37 Instagram-Stories im Reiter „Video“: Planer (Zeitplan + Themenliste), Erzeugung durch den Worker (Schritt „story“),
// Freigabe am Handy, Posten zur Planzeit über die Instagram-API (Stufe 2) bzw. „von Hand posten“ (Stufe 1), Kosten und
// Monatslimit. Kein Posten ohne Freigabe, solange der Kanal nicht ausdrücklich auf „automatisch“ steht.

const K = schema.videoKanaele;
const A = schema.videoAuftraege;
const F = schema.videoFotos;
const jetzt = () => new Date();
type Auftrag = typeof A.$inferSelect;
type Kanal = typeof K.$inferSelect;

const aendern = (id: string, werte: Partial<typeof A.$inferInsert>) => db.update(A).set({ ...werte, updatedAt: jetzt() }).where(eq(A.id, id));

async function bestaetigt(tenantId: string) {
  try {
    const { einstellungen } = await import("@/lib/abverkauf/service");
    return (await einstellungen(tenantId)).adelprep.bestaetigt;
  } catch {
    return { flaeche: false, nda: false, gefahrgut: false };
  }
}

async function melden(tenantId: string, titel: string, text: string, link: string) {
  try {
    const p = await import("@/lib/push/service");
    await p.melden(tenantId, await p.empfaenger(tenantId, "marken"), { titel, text, link, art: "story" });
  } catch {
    /* Meldung ist Zusatz – der Status steht auf der Seite */
  }
}

const seite = (kanalId: string, id?: string) => `/marken/video?kanal=${kanalId}${id ? `#s-${id}` : "#stories"}`;
const uhr = (d: Date | null) => (d ? d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");

// ---- Kanal: Themenliste, Instagram-Zugang ---------------------------------------------------------------------------

async function kanalFuer(s: Session, kanalId: string): Promise<Kanal> {
  if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
  const [k] = await db.select().from(K).where(and(eq(K.tenantId, s.tenantId), eq(K.id, kanalId)));
  if (!k) throw new VideoFehler("Kanal nicht gefunden.");
  if (k.plattform !== "instagram") throw new VideoFehler("Das ist kein Instagram-Kanal.");
  return k;
}

export async function themenSpeichern(s: Session, kanalId: string, text: string): Promise<number> {
  const k = await kanalFuer(s, kanalId);
  const themen = themenAus(text, k.instagram.themen ?? []);
  await db.update(K).set({ instagram: { ...k.instagram, themen } }).where(eq(K.id, k.id));
  return themen.length;
}

export async function kanalInstagramSetzen(tenantId: string, kanalId: string, z: { token: string; bis: Date; userId: string; konto: string | null } | null) {
  await db
    .update(K)
    .set(z ? { instagramToken: sealPii(z.token), instagramTokenBis: z.bis, instagramUserId: z.userId, instagramKonto: z.konto, instagramVerbundenAm: jetzt() } : { instagramToken: null, instagramTokenBis: null, instagramUserId: null, instagramKonto: null, instagramVerbundenAm: null })
    .where(and(eq(K.tenantId, tenantId), eq(K.id, kanalId)));
}

async function igApp(tenantId: string) {
  const { getIntegration } = await import("@/lib/integrations/store");
  const app = await getIntegration(tenantId, "instagram");
  if (!app?.appId || !app.appSecret) throw new VideoFehler("Meta-App (App-ID/App-Secret) fehlt unter Anbindungen → Instagram.");
  return { appId: app.appId, appSecret: app.appSecret };
}

export async function instagramVerbinden(tenantId: string, kanalId: string, code: string, redirectUri: string): Promise<string | null> {
  const { igCodeTauschen } = await import("./instagram");
  const z = await igCodeTauschen(await igApp(tenantId), code, redirectUri);
  await kanalInstagramSetzen(tenantId, kanalId, z);
  // Bereits freigegebene Stories, die auf „von Hand posten“ standen und noch kommen, gehen jetzt automatisch
  await db.update(A).set({ igStatus: "geplant", updatedAt: jetzt() }).where(and(eq(A.tenantId, tenantId), eq(A.kanalId, kanalId), eq(A.art, "story"), eq(A.igStatus, "manuell"), gte(A.geplantFuer, jetzt())));
  return z.konto;
}

export async function instagramAnmeldeUrl(tenantId: string, redirectUri: string, state: string): Promise<string> {
  const { igAnmeldeUrl } = await import("./instagram");
  return igAnmeldeUrl(await igApp(tenantId), redirectUri, state);
}

// ---- Fotos (Einblick) ------------------------------------------------------------------------------------------------

const FOTO_TYPEN: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const fotoOrdner = (tenantId: string, kanalId: string) => {
  if (!/^[0-9a-f-]{36}$/.test(tenantId) || !/^[0-9a-f-]{36}$/.test(kanalId)) throw new VideoFehler("Ungültige Kennung.");
  return path.join(/*turbopackIgnore: true*/ medienOrdner(), "video", tenantId, `kanal-${kanalId}`, "fotos");
};

export const fotos = (tenantId: string, kanalId: string) => db.select().from(F).where(and(eq(F.tenantId, tenantId), eq(F.kanalId, kanalId))).orderBy(asc(F.createdAt));

/** Eigene Lager-Fotos (JPG/PNG/WebP, je ≤ 15 MB) – nur mit Bestätigung „keine Personen im Bild, eigenes Foto“. */
export async function fotosHochladen(s: Session, kanalId: string, dateien: File[], ohnePersonen: boolean): Promise<number> {
  const k = await kanalFuer(s, kanalId);
  if (!ohnePersonen) throw new VideoFehler("Bitte bestätigen: keine Personen im Bild und eigenes Foto (keine fremden Bilder).");
  const ordner = fotoOrdner(s.tenantId, k.id);
  await mkdir(ordner, { recursive: true });
  let n = 0;
  for (const f of dateien.filter((x) => x.size > 0).slice(0, 20)) {
    const endung = FOTO_TYPEN[f.type];
    if (!endung) throw new VideoFehler(`„${f.name}“: nur JPG, PNG oder WebP.`);
    if (f.size > 15 * 1024 ** 2) throw new VideoFehler(`„${f.name}“ ist größer als 15 MB.`);
    const daten = Buffer.from(await f.arrayBuffer());
    const [r] = await db.insert(F).values({ tenantId: s.tenantId, kanalId: k.id, name: f.name.slice(0, 120), typ: f.type, groesse: daten.length, hash: createHash("sha256").update(daten).digest("hex").slice(0, 16), ohnePersonen: true, hochgeladenVon: s.userId }).returning({ id: F.id });
    await writeFile(path.join(ordner, `${r.id}.${endung}`), daten, { mode: 0o600 });
    n++;
  }
  if (!n) throw new VideoFehler("Bitte ein Foto auswählen.");
  return n;
}

export async function fotoLesen(tenantId: string, id: string): Promise<{ daten: Buffer; typ: string; name: string } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [f] = await db.select().from(F).where(and(eq(F.tenantId, tenantId), eq(F.id, id)));
  if (!f) return null;
  const daten = await readFile(path.join(fotoOrdner(tenantId, f.kanalId), `${f.id}.${FOTO_TYPEN[f.typ] ?? "jpg"}`)).catch(() => null);
  return daten ? { daten, typ: f.typ, name: f.name } : null;
}

export async function fotoLoeschen(s: Session, id: string) {
  if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
  const [f] = await db.select().from(F).where(and(eq(F.tenantId, s.tenantId), eq(F.id, id)));
  if (!f) throw new VideoFehler("Foto nicht gefunden.");
  await rm(path.join(fotoOrdner(s.tenantId, f.kanalId), `${f.id}.${FOTO_TYPEN[f.typ] ?? "jpg"}`), { force: true });
  await db.delete(F).where(eq(F.id, f.id));
}

// ---- Planen ----------------------------------------------------------------------------------------------------------

type Neu = { kanal: Kanal; thema: StoryThema; zeit: Date; fotoId: string | null };

async function storyAnlegen(tenantId: string, n: Neu, userId: string | null): Promise<string> {
  const p = profilMitVorgaben(n.kanal.instagram);
  const cfg = await videoEinstellungen(tenantId);
  const art: StoryInhaltsart = n.thema.art;
  const story: VideoStory = { inhaltsart: art, themaId: n.thema.id, werbung: p.werbung && STORY_ARTEN[art].werbung, fotoId: n.fotoId };
  const [r] = await db
    .insert(A)
    .values({ tenantId, kanalId: n.kanal.id, art: "story", thema: n.thema.text, story, geplantFuer: n.zeit, schritt: "story", schritte: { story: { status: "offen" } }, kostenSchaetzung: storyKosten(cfg.preise, cfg.modell, !n.fotoId).summe, erstelltVon: userId })
    .returning({ id: A.id });
  if (n.fotoId) await db.update(F).set({ genutztAuftrag: r.id, genutztAm: jetzt() }).where(eq(F.id, n.fotoId));
  return r.id;
}

async function freieFotos(tenantId: string, kanalId: string) {
  return db.select({ id: F.id }).from(F).where(and(eq(F.tenantId, tenantId), eq(F.kanalId, kanalId), isNull(F.genutztAuftrag), eq(F.ohnePersonen, true))).orderBy(asc(F.createdAt));
}

/**
 * Planer (alle 15 Min.): für jede Planzeit der nächsten 36 Stunden ohne Story eine Story aus der Themenliste anlegen
 * (der Worker erzeugt sie, Ludwig gibt sie frei). Abgelehnte Stories belegen ihre Planzeit weiter (kein Ersatz von selbst).
 * Monatslimit: ist es erreicht, entstehen keine neuen Stories (Hinweis auf der Seite).
 */
export async function storiesPlanen(tenantId: string, o: { jetzt?: Date; stunden?: number; kanalId?: string } = {}): Promise<{ neu: number; limit: string[] }> {
  const t0 = o.jetzt ?? jetzt();
  const bis = new Date(t0.getTime() + (o.stunden ?? 36) * 3_600_000);
  const ks = await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.plattform, "instagram"), eq(K.aktiv, true), o.kanalId ? eq(K.id, o.kanalId) : undefined));
  const cfg = await videoEinstellungen(tenantId);
  let neu = 0;
  const limit: string[] = [];
  for (const k of ks) {
    const p = profilMitVorgaben(k.instagram);
    const zeiten = slots(p, t0, bis);
    if (!p.themen.length || !zeiten.length) continue;
    const belegt = new Set((await db.select({ g: A.geplantFuer }).from(A).where(and(eq(A.tenantId, tenantId), eq(A.kanalId, k.id), eq(A.art, "story"), inArray(A.geplantFuer, zeiten)))).map((x) => x.g?.getTime()));
    let fotosFrei = (await freieFotos(tenantId, k.id)).map((x) => x.id);
    const themen = [...p.themen];
    const geplant: string[] = [];
    for (const z of zeiten.filter((x) => !belegt.has(x.getTime()))) {
      const kosten = await kanalMonatKosten(tenantId, k.id);
      if (limitErreicht(kosten, p.monatslimit, storyKosten(cfg.preise, cfg.modell).summe)) {
        limit.push(k.name);
        break;
      }
      const thema = naechstesThema(themen, p.inhaltsarten, fotosFrei.length, geplant);
      if (!thema) break;
      const fotoId = thema.art === "einblick" ? (fotosFrei[0] ?? null) : null;
      fotosFrei = fotosFrei.filter((x) => x !== fotoId);
      await storyAnlegen(tenantId, { kanal: k, thema, zeit: z, fotoId }, null);
      thema.genutztAm = jetzt().toISOString();
      geplant.push(thema.id);
      neu++;
    }
    if (geplant.length) await db.update(K).set({ instagram: { ...k.instagram, themen } }).where(eq(K.id, k.id));
  }
  return { neu, limit };
}

/** Knopf „Stories aus der Themenliste erzeugen“: je Thema eine Story auf die nächsten freien Planzeiten (bis 30 Tage). */
export async function storiesAusThemen(s: Session, kanalId: string): Promise<{ neu: number; limit: boolean }> {
  const k = await kanalFuer(s, kanalId);
  const p = profilMitVorgaben(k.instagram);
  if (!p.themen.length) throw new VideoFehler("Die Themenliste ist leer – erst Themen eintragen.");
  if (!p.tage.length) throw new VideoFehler("Im Zeitplan ist kein Tag ausgewählt.");
  const cfg = await videoEinstellungen(s.tenantId);
  const zeiten = slots(p, jetzt(), new Date(Date.now() + 30 * 86_400_000));
  const belegt = new Set((await db.select({ g: A.geplantFuer }).from(A).where(and(eq(A.tenantId, s.tenantId), eq(A.kanalId, k.id), eq(A.art, "story"), gte(A.geplantFuer, jetzt())))).map((x) => x.g?.getTime()));
  const frei = zeiten.filter((z) => !belegt.has(z.getTime()));
  let fotosFrei = (await freieFotos(s.tenantId, k.id)).map((x) => x.id);
  const themen = [...p.themen];
  let neu = 0;
  for (const thema of themen.filter((t) => p.inhaltsarten.includes(t.art))) {
    const z = frei.shift();
    if (!z) break;
    if (limitErreicht(await kanalMonatKosten(s.tenantId, k.id), p.monatslimit, storyKosten(cfg.preise, cfg.modell).summe)) return { neu, limit: true };
    const fotoId = thema.art === "einblick" ? (fotosFrei[0] ?? null) : null;
    fotosFrei = fotosFrei.filter((x) => x !== fotoId);
    await storyAnlegen(s.tenantId, { kanal: k, thema, zeit: z, fotoId }, s.userId);
    thema.genutztAm = jetzt().toISOString();
    neu++;
  }
  await db.update(K).set({ instagram: { ...k.instagram, themen } }).where(eq(K.id, k.id));
  return { neu, limit: false };
}

// ---- Worker meldet „story fertig“ ------------------------------------------------------------------------------------

function storyAus(roh: unknown, vorher: VideoStory): VideoStory {
  const r = (roh ?? {}) as Record<string, unknown>;
  const t = (x: unknown, n: number) => (typeof x === "string" ? x.trim().slice(0, n) || null : null);
  const st = r.sticker as { art?: unknown; frage?: unknown; optionen?: unknown } | null | undefined;
  return {
    ...vorher,
    ueberschrift: t(r.ueberschrift, 120),
    text: t(r.text, 600),
    cta: t(r.cta, 160),
    sticker: st && typeof st.frage === "string" ? { art: st.art === "frage" ? "frage" : "umfrage", frage: st.frage.slice(0, 200), optionen: Array.isArray(st.optionen) ? st.optionen.filter((x): x is string => typeof x === "string").slice(0, 4).map((x) => x.slice(0, 40)) : [] } : null,
    werbung: typeof r.werbung === "boolean" ? r.werbung : vorher.werbung,
    motivKey: t(r.motivKey, 60),
    format: r.format === "png" ? "png" : r.format === "mp4" ? "mp4" : null,
    dauerSek: typeof r.dauerSek === "number" ? Math.round(r.dauerSek * 10) / 10 : null,
    motivNeu: false,
  };
}

/** Regeln prüfen und je Freigabe-Modus weiter: Freigabe (Vorschau) oder direkt eingeplant. */
export async function storyFertig(a: Auftrag, k: Kanal, werte: Partial<typeof A.$inferInsert>, roh: unknown): Promise<{ status: "freigabe" | "fertig"; freigabe: "story" | null }> {
  const p = profilMitVorgaben(k.instagram);
  const st = storyAus(roh, a.story ?? { inhaltsart: "tipp" });
  const text = [st.ueberschrift, st.text, st.cta, st.sticker?.frage, ...(st.sticker?.optionen ?? [])].filter(Boolean).join("\n");
  st.regeln = storyRegeln(text, { art: st.inhaltsart, werbungAn: p.werbung, werbungGesetzt: !!st.werbung, bestaetigt: await bestaetigt(a.tenantId) });
  const [{ nr }] = await db.select({ nr: sql<number>`count(*)::int` }).from(A).where(and(eq(A.tenantId, a.tenantId), eq(A.kanalId, k.id), eq(A.art, "story"), lte(A.createdAt, a.createdAt)));
  const wiederholung = !!a.freigegeben.story || a.wiederholen === "story";
  const noetig = freigabeNoetig(p.freigabeModus, nr, st.regeln.length) || wiederholung;
  if (noetig) {
    await aendern(a.id, { ...werte, story: st, status: "freigabe", schritt: "story", freigabeOffen: "story", wiederholen: null, igStatus: null, igFehler: null });
    await melden(a.tenantId, `Story wartet auf Freigabe (${k.name})`, `${STORY_ARTEN[st.inhaltsart].name} für ${uhr(a.geplantFuer)}: ${(st.ueberschrift ?? a.thema).slice(0, 80)}${st.regeln.length ? ` – ${st.regeln.length} Regel-Hinweis(e)` : ""}`, seite(k.id, a.id));
    return { status: "freigabe", freigabe: "story" };
  }
  await aendern(a.id, { ...werte, story: st, status: "fertig", schritt: "story", freigabeOffen: null, wiederholen: null, freigegeben: { ...a.freigegeben, story: `automatisch ${jetzt().toISOString()}` }, igStatus: k.instagramToken ? "geplant" : "manuell", fertigAm: jetzt() });
  return { status: "fertig", freigabe: null };
}

// ---- Freigabe am Handy -----------------------------------------------------------------------------------------------

async function storyFuer(s: Session, id: string) {
  if (s.readOnly) throw new VideoFehler("Nur ansehen – nichts geändert.");
  const [r] = await db.select({ a: A, k: K }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, s.tenantId), eq(A.id, id), eq(A.art, "story")));
  if (!r) throw new VideoFehler("Story nicht gefunden.");
  return r;
}

export async function storyFreigeben(s: Session, id: string): Promise<string> {
  const { a, k } = await storyFuer(s, id);
  if (a.freigabeOffen !== "story") throw new VideoFehler("Diese Story steht gerade nicht zur Freigabe an.");
  if (a.story?.regeln?.length) throw new VideoFehler(`Freigabe gesperrt – Regel verletzt: ${a.story.regeln[0]}. Bitte „Neu erzeugen“.`);
  const verbunden = !!k.instagramToken;
  await aendern(id, { status: "fertig", freigabeOffen: null, freigegeben: { ...a.freigegeben, story: jetzt().toISOString() }, igStatus: verbunden ? "geplant" : "manuell", igVersuche: 0, igFehler: null, igNaechsterVersuch: null, fertigAm: jetzt() });
  return verbunden ? `Freigegeben – wird ${uhr(a.geplantFuer)} auf Instagram gepostet.` : `Freigegeben – zum Zeitpunkt (${uhr(a.geplantFuer)}) kommt eine Erinnerung: herunterladen und in Instagram posten.`;
}

export async function storyAblehnen(s: Session, id: string): Promise<string> {
  const { a } = await storyFuer(s, id);
  if (a.igStatus === "gepostet") throw new VideoFehler("Schon gepostet.");
  await aendern(id, { status: "abgebrochen", freigabeOffen: null, igStatus: null, aufraeumen: true });
  if (a.story?.fotoId) await db.update(F).set({ genutztAuftrag: null, genutztAm: null }).where(and(eq(F.tenantId, s.tenantId), eq(F.id, a.story.fotoId)));
  return "Story abgelehnt – an diesem Termin wird nichts gepostet.";
}

/** „Neu erzeugen“: neuer Text; das Motiv bleibt (bezahlt, aus der Bibliothek), außer „Motiv neu“ ist gewählt. */
export async function storyNeu(s: Session, id: string, o: { motivNeu: boolean; hinweis: string | null }): Promise<string> {
  const { a } = await storyFuer(s, id);
  if (a.igStatus === "gepostet") throw new VideoFehler("Schon gepostet.");
  const story: VideoStory = { ...(a.story ?? { inhaltsart: "tipp" }), motivNeu: o.motivNeu, regeln: null };
  await aendern(id, { status: "wartet", schritt: "story", wiederholen: "story", freigabeOffen: null, story, hinweis: o.hinweis?.trim().slice(0, 1000) || a.hinweis, schritte: { ...a.schritte, story: { status: "offen" } }, igStatus: null, igFehler: null, fertigAm: null });
  return o.motivNeu ? "Wird neu erzeugt – mit neuem Motiv." : "Wird neu erzeugt – neuer Text, das Motiv bleibt (kostet nicht doppelt).";
}

export async function storyManuellGepostet(s: Session, id: string): Promise<string> {
  const { a } = await storyFuer(s, id);
  if (a.status !== "fertig") throw new VideoFehler("Erst freigeben.");
  await aendern(id, { igStatus: "gepostet", gepostetAm: jetzt(), igFehler: null });
  return "Als gepostet vermerkt.";
}

// ---- Öffentlicher, befristeter Link (Instagram holt die Datei selbst ab) -------------------------------------------------

function linkSchluessel() {
  const sec = process.env.APP_SECRET;
  if (!sec || sec.length < 32) throw new Error("APP_SECRET fehlt oder ist zu kurz.");
  return createHmac("sha256", sec).update("story-link").digest();
}
export function storyLinkSignatur(id: string, datei: string, ablauf: number): string {
  return `${ablauf}.${createHmac("sha256", linkSchluessel()).update(`${id}|${datei}|${ablauf}`).digest("base64url")}`;
}
export function storyLinkGueltig(id: string, datei: string, signatur: string, nun = Date.now()): boolean {
  const [ablaufRoh, sig] = signatur.split(".");
  const ablauf = Number(ablaufRoh);
  if (!sig || !Number.isFinite(ablauf) || ablauf < nun) return false;
  const soll = Buffer.from(storyLinkSignatur(id, datei, ablauf).split(".")[1], "base64url");
  const ist = Buffer.from(sig, "base64url");
  return soll.length === ist.length && timingSafeEqual(soll, ist);
}
/** Öffentliche Adresse der Story-Datei (24 h gültig) – braucht PUBLIC_URL bzw. APP_URL mit https. */
export function storyMedienUrl(a: Pick<Auftrag, "id" | "dateien">): { url: string; video: boolean } | null {
  const basis = publicUrl() ?? (process.env.APP_URL?.replace(/\/$/, "") || null);
  if (!basis) return null;
  const video = !!a.dateien.story_mp4;
  const datei = video ? "story.mp4" : a.dateien.story_png ? "story.png" : null;
  if (!datei) return null;
  return { url: `${basis}/api/public/story/${a.id}/${storyLinkSignatur(a.id, datei, Date.now() + 24 * 3_600_000)}/${datei}`, video };
}

// ---- Posten zur Planzeit, Wiederholung, Meldungen ---------------------------------------------------------------------

export async function storiesPosten(tenantId: string, nun = jetzt()): Promise<{ gepostet: number; fehler: number; erinnert: number }> {
  let gepostet = 0;
  let fehler = 0;
  let erinnert = 0;
  // Freigabe fehlt zur Planzeit → einmal melden (nichts wird gepostet)
  const ohneFreigabe = await db.select({ a: A, k: K }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, tenantId), eq(A.art, "story"), eq(A.status, "freigabe"), lte(A.geplantFuer, nun), isNull(A.igFehler)));
  for (const { a, k } of ohneFreigabe) {
    await aendern(a.id, { igFehler: "Zum geplanten Zeitpunkt nicht freigegeben – nicht gepostet." });
    await melden(tenantId, `Story nicht gepostet (${k.name})`, `Die Story für ${uhr(a.geplantFuer)} wartet noch auf Freigabe.`, seite(k.id, a.id));
    erinnert++;
  }
  const faellig = await db
    .select({ a: A, k: K })
    .from(A)
    .innerJoin(K, eq(K.id, A.kanalId))
    .where(and(eq(A.tenantId, tenantId), eq(A.art, "story"), eq(A.status, "fertig"), inArray(A.igStatus, ["geplant", "manuell"]), lte(A.geplantFuer, nun), or(isNull(A.igNaechsterVersuch), lte(A.igNaechsterVersuch, nun))))
    .orderBy(asc(A.geplantFuer))
    .limit(20);
  for (const { a, k } of faellig) {
    if (a.igStatus === "manuell" || !k.instagramToken || !k.instagramUserId) {
      // Stufe 1: einmal erinnern – herunterladen und in der Instagram-App posten
      if (a.igVersuche === 0) {
        await aendern(a.id, { igStatus: "manuell", igVersuche: 1 });
        await melden(tenantId, `Story jetzt posten (${k.name})`, `Die freigegebene Story für ${uhr(a.geplantFuer)} liegt bereit: herunterladen und in Instagram posten${a.story?.sticker ? ` (Sticker: ${a.story.sticker.frage})` : ""}.`, seite(k.id, a.id));
        erinnert++;
      }
      continue;
    }
    const zugang = tokenStand(k.instagramTokenBis, nun);
    if (zugang.stand === "abgelaufen") {
      await aendern(a.id, { igStatus: "fehler", igFehler: "Instagram-Zugang abgelaufen – Kanal neu verbinden, dann „Erneut posten“." });
      await melden(tenantId, `Instagram-Zugang abgelaufen (${k.name})`, `Die Story für ${uhr(a.geplantFuer)} wurde nicht gepostet. Bitte im Kanalprofil neu verbinden.`, seite(k.id, a.id));
      fehler++;
      continue;
    }
    const medien = storyMedienUrl(a);
    try {
      if (!medien) throw new Error("Keine Story-Datei oder keine öffentliche Adresse (PUBLIC_URL) – Instagram kann die Datei nicht abholen.");
      const { igStoryPosten } = await import("./instagram");
      const mediaId = await igStoryPosten(openPii(k.instagramToken), k.instagramUserId, medien.url, medien.video);
      await aendern(a.id, { igStatus: "gepostet", igMediaId: mediaId, gepostetAm: jetzt(), igFehler: null, igNaechsterVersuch: null, igVersuche: a.igVersuche + 1 });
      gepostet++;
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      const abgelaufen = !!(e as { abgelaufen?: boolean }).abgelaufen;
      const versuche = a.igVersuche + 1;
      const naechster = abgelaufen ? null : naechsterVersuch(versuche, nun);
      if (naechster) {
        await aendern(a.id, { igVersuche: versuche, igFehler: text.slice(0, 500), igNaechsterVersuch: naechster });
      } else {
        await aendern(a.id, { igStatus: "fehler", igVersuche: versuche, igFehler: text.slice(0, 500), igNaechsterVersuch: null });
        await melden(tenantId, `Story nicht gepostet (${k.name})`, `${abgelaufen ? text : `Nach ${versuche} Versuchen: ${text}`}`.slice(0, 300), seite(k.id, a.id));
        fehler++;
      }
    }
  }
  return { gepostet, fehler, erinnert };
}

/** „Erneut posten“ nach Fehler (z. B. nach neuer Verbindung). */
export async function storyErneutPosten(s: Session, id: string): Promise<string> {
  const { a, k } = await storyFuer(s, id);
  if (a.igStatus !== "fehler") throw new VideoFehler("Nur nach einem Fehler beim Posten.");
  await aendern(id, { igStatus: k.instagramToken ? "geplant" : "manuell", igVersuche: 0, igFehler: null, igNaechsterVersuch: null, ...(a.geplantFuer && a.geplantFuer < jetzt() ? {} : {}) });
  return k.instagramToken ? "Wird gleich erneut gepostet." : "Instagram nicht verbunden – Erinnerung zum Posten von Hand.";
}

/** Täglich: Zugang 7 Tage vor Ablauf erneuern (bzw. warnen), abgelaufen → Meldung statt stillem Fehler. */
export async function instagramZugangPflegen(tenantId: string, nun = jetzt()): Promise<{ erneuert: number; gewarnt: number }> {
  const ks = await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.plattform, "instagram")));
  let erneuert = 0;
  let gewarnt = 0;
  for (const k of ks) {
    if (!k.instagramToken) continue;
    const st = tokenStand(k.instagramTokenBis, nun);
    if (st.stand === "ok") continue;
    if (st.stand === "bald") {
      try {
        const { igTokenErneuern } = await import("./instagram");
        const neu = await igTokenErneuern(openPii(k.instagramToken));
        await db.update(K).set({ instagramToken: sealPii(neu.token), instagramTokenBis: neu.bis }).where(eq(K.id, k.id));
        erneuert++;
        continue;
      } catch (e) {
        await melden(tenantId, `Instagram-Zugang läuft bald ab (${k.name})`, `Noch ${st.tage} Tag(e); automatisches Erneuern ging nicht (${e instanceof Error ? e.message : "Fehler"}). Bitte im Kanalprofil neu verbinden.`, seite(k.id));
        gewarnt++;
        continue;
      }
    }
    await melden(tenantId, `Instagram-Zugang abgelaufen (${k.name})`, "Stories werden nicht automatisch gepostet. Bitte im Kanalprofil neu verbinden.", seite(k.id));
    gewarnt++;
  }
  return { erneuert, gewarnt };
}

/** Übersicht für die Seite: Monatskosten, Limit, Schätzung je Story, freie Fotos. */
export async function storyUebersicht(tenantId: string, k: Kanal) {
  const cfg = await videoEinstellungen(tenantId);
  const p = profilMitVorgaben(k.instagram);
  const [kosten, frei] = await Promise.all([kanalMonatKosten(tenantId, k.id), freieFotos(tenantId, k.id)]);
  return { profil: p, monatKosten: kosten, schaetzung: storyKosten(cfg.preise, cfg.modell), schaetzungFoto: storyKosten(cfg.preise, cfg.modell, false), limitErreicht: limitErreicht(kosten, p.monatslimit), fotosFrei: frei.length, zugang: tokenStand(k.instagramTokenBis) };
}

export { istStoryArt };
