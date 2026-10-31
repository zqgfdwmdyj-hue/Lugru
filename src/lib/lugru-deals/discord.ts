import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LugruKeepa } from "@/db/schema";
import { getIntegration } from "@/lib/integrations/store";
import { discord, type DcNachricht } from "@/lib/va/discord";
import { kaufZuDeal, keepaSchnappschuss, type EigenerKauf } from "./auswertung-logic";
import { kaeufeAus, lugruPostLesen, reaktionenFaellig, reaktionenZaehlen, zeitAusId, type LugruPost } from "./post-logic";
import { kanalName } from "./historie-logic";
import { prozentText } from "@/lib/numbers";

// Lugru Deals → Seller-System über Discord (Weg B): Der Bot des Seller-Systems liest die Deal-Kanäle der Gruppe – neue
// Posts jede Minute (→ Deal-Eingang mit Ampel, Push bei Grün/Gelb), Reaktionen in den ersten 48 Std. alle 5 Min., bis
// 30 Tage stündlich, die History einmalig rückwärts (wiederaufnehmbar). Gespeichert werden nur Zahlen: Reaktionen als
// Anzahl je Emoji, nie Namen oder IDs von Mitgliedern, kein Nachrichtentext außer im Deal-Eingang (verschlüsselt).

const L = schema.lugruDealsHistorie;
const K = schema.lugruKanaele;
const E = schema.dealEingaenge;

type Cfg = { botToken?: string; kanalIds?: string; emojiGekauft?: string; emojiWeg?: string; schluessel?: string };
export type LugruDiscordKonfig = { token: string; kanaele: string[]; gekauft: string[]; weg: string[] };

const emojis = (s: string | undefined) => (s ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10);

export async function lugruDiscordKonfig(tenantId: string): Promise<LugruDiscordKonfig | null> {
  const c = (await getIntegration(tenantId, "lugru_deals")) as Cfg | null;
  if (!c) return null;
  const kanaele = [...new Set((c.kanalIds ?? "").split(/[\s,;]+/).filter((x) => /^\d{15,25}$/.test(x)))].slice(0, 20);
  if (!kanaele.length) return null;
  const token = c.botToken || ((await getIntegration(tenantId, "discord_wissen")) as { botToken?: string } | null)?.botToken || ((await getIntegration(tenantId, "discord_va")) as { botToken?: string } | null)?.botToken;
  if (!token) return null;
  return { token, kanaele, gekauft: emojis(c.emojiGekauft), weg: emojis(c.emojiWeg) };
}

/** Mandanten mit eingerichteten Lugru-Kanälen (für den Takt). */
export async function lugruMandanten(): Promise<string[]> {
  const rows = await db.select({ t: schema.integrations.tenantId }).from(schema.integrations).where(eq(schema.integrations.provider, "lugru_deals"));
  return [...new Set(rows.map((r) => r.t))];
}

const zeitVon = (m: DcNachricht) => (m.timestamp && Number.isFinite(Date.parse(m.timestamp)) ? new Date(m.timestamp) : zeitAusId(m.id));

/** Daten für die Tabelle aus einem gelesenen Post (ohne Text, ohne Absender). */
function werteAus(p: LugruPost, m: DcNachricht, k: { kanalId: string; name: string | null; guildId: string | null }, cfg: LugruDiscordKonfig, jetzt: Date) {
  const reaktionen = reaktionenZaehlen(m.reactions);
  const z = kaeufeAus(reaktionen, { gekauft: cfg.gekauft, weg: cfg.weg });
  return {
    quelle: "discord" as const,
    discordKanalId: k.kanalId,
    discordNachrichtId: m.id,
    discordGuildId: k.guildId,
    asin: p.asin!,
    asinUnsicher: p.asinUnsicher,
    titel: p.titel,
    quellmarkt: p.quellmarkt,
    zielmarkt: p.zielmarkt,
    shop: p.shop,
    shopUrl: p.shopUrl,
    ekEur: p.ekEur,
    ekNetto: p.ekNetto,
    vkEur: p.vkEur,
    gewinnEur: p.gewinnEur,
    margeProzent: p.margeProzent,
    verkaeufeMonat: p.verkaeufeMonat,
    maxMenge: p.maxMenge,
    kanal: kanalName(k.name),
    status: p.ausverkauft ? "ausverkauft" : "aktiv",
    reaktionen,
    kaeufe: z.kaeufe,
    nichtVerfuegbar: z.nichtVerfuegbar,
    reaktionenAm: jetzt,
    gepostetAm: zeitVon(m),
    aktualisiertAm: jetzt,
  };
}

export type AbgleichZahlen = { gelesen: number; erkannt: number; neu: number; eingaenge: number; zusammengefasst: number; reaktionen: number };

/**
 * Eine Nachricht verarbeiten: als Lugru-Deal speichern (bzw. aktualisieren). `live`: frischer Post → in den
 * Deal-Eingang (Ampel, Deal-Wert, Push bei Grün/Gelb). Doppelte (gleiche ASIN + Shop < 24 Std.) teilen sich den Eingang.
 */
async function verarbeiten(tenantId: string, k: { kanalId: string; name: string | null; guildId: string | null }, m: DcNachricht, cfg: LugruDiscordKonfig, z: AbgleichZahlen, o: { live: boolean; jetzt: Date }) {
  z.gelesen++;
  const p = lugruPostLesen(m.content ?? "");
  if (!p || !p.asin) return;
  z.erkannt++;
  const w = werteAus(p, m, k, cfg, o.jetzt);
  const [alt] = await db.select({ id: L.id, eingangId: L.eingangId, ausverkauftAm: L.ausverkauftAm }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.discordNachrichtId, m.id)));
  let id = alt?.id;
  if (alt) {
    await db.update(L).set({ ...w, ausverkauftAm: p.ausverkauft ? (alt.ausverkauftAm ?? o.jetzt) : null }).where(eq(L.id, alt.id));
  } else {
    const [r] = await db.insert(L).values({ tenantId, ...w, ausverkauftAm: p.ausverkauft ? o.jetzt : null }).onConflictDoNothing().returning({ id: L.id });
    id = r?.id;
    if (id) z.neu++;
  }
  if (!id || !o.live || alt?.eingangId || p.ausverkauft) return;
  const kopf = [
    `Lugru Deals (#${k.name ?? k.kanalId})${p.shop ? ` · Shop: ${p.shop}` : ""}`,
    `Laut Post: EK ${p.ekEur ?? "–"} € ${p.ekNetto ? "netto" : "brutto"} · VK ${p.vkEur ?? "–"} € (${p.zielmarkt}) · Gewinn ${p.gewinnEur} € · Marge ${prozentText(p.margeProzent)} %${p.verkaeufeMonat ? ` · ${p.verkaeufeMonat}+ Verkäufe/Monat` : ""}${p.maxMenge ? ` · max. ${p.maxMenge} Stück` : ""}`,
    p.asinUnsicher ? "ASIN unsicher – frei im Text gefunden, nicht aus einem Amazon-Link." : null,
    p.shopUrl ? `Einkauf: ${p.shopUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const r = await lugruLiveEingang(tenantId, id, { asin: p.asin, titel: p.titel, shop: p.shop, ekEur: p.ekEur, ekNetto: p.ekNetto, gepostetAm: w.gepostetAm, kanal: k.name ?? "deals", text: `${kopf}\n\n${(m.content ?? "").slice(0, 4000)}`, quelleRef: `lugru:${m.id}` });
  if (r === "zusammengefasst") z.zusammengefasst++;
  if (r === "neu") z.eingaenge++;
}

/**
 * Frischer Lugru-Deal → Deal-Eingang „Lugru Deals · #kanal“ mit Deal-Ampel (Push bei Grün/Gelb wie jeder Eingang).
 * Gemeinsam für beide Wege: gelesen aus Discord oder direkt von der Lugru-Deals-Seite geschickt. Doppelt gepostet
 * (gleiche ASIN + Shop < 24 Std.) → derselbe Eingang, nicht erneut prüfen/pushen.
 */
export async function lugruLiveEingang(
  tenantId: string,
  id: string,
  d: { asin: string; titel: string | null; shop: string | null; ekEur: number | null; ekNetto: boolean; gepostetAm: Date; kanal: string; text: string; quelleRef: string },
): Promise<"neu" | "zusammengefasst" | "vorhanden"> {
  const seit = new Date(d.gepostetAm.getTime() - 24 * 3600_000);
  const kandidaten = await db
    .select({ eingangId: L.eingangId, shop: L.shop })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), eq(L.asin, d.asin), gte(L.gepostetAm, seit), sql`${L.eingangId} is not null`, sql`${L.id} <> ${id}`))
    .limit(5);
  const gleich = kandidaten.find((x) => (x.shop ?? "").toLowerCase() === (d.shop ?? "").toLowerCase());
  if (gleich?.eingangId) {
    await db.update(L).set({ eingangId: gleich.eingangId }).where(eq(L.id, id));
    return "zusammengefasst";
  }
  const { eingangAnlegen, eingangPruefen } = await import("@/lib/deal-eingang/service");
  const angebot = { asin: d.asin, ean: null, name: d.titel, marke: null, ek: d.ekEur, ekNetto: d.ekNetto, waehrung: "EUR", menge: null, moq: null, staffel: null, versand: null, lieferzeit: null, zahlung: null, gueltigBis: null, zustand: "neu", packung: null };
  const r = await eingangAnlegen(tenantId, null, { weg: "lugru", text: d.text, quelle: `Lugru Deals · #${d.kanal}`.slice(0, 80), quelleRef: d.quelleRef, angebote: [angebot] });
  await db.update(L).set({ eingangId: r.id }).where(eq(L.id, id));
  if (!r.neu) return "vorhanden";
  await eingangPruefen(tenantId, r.id);
  await ausEingangUebernehmen(tenantId, id);
  return "neu";
}

/** Ampel und Keepa-Schnappschuss aus dem geprüften Eingang an den Lugru-Deal übernehmen. */
async function ausEingangUebernehmen(tenantId: string, lugruId: string) {
  const [x] = await db.select({ eingangId: L.eingangId, keepa: L.keepa }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.id, lugruId)));
  if (!x?.eingangId) return;
  const [e] = await db.select({ ampel: E.ampel, zeilen: E.zeilen, geprueftAm: E.geprueftAm }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, x.eingangId)));
  if (!e) return;
  const mk = e.zeilen?.[0]?.merkmale ?? null;
  const keepa: LugruKeepa | null = mk
    ? { stand: (e.geprueftAm ?? new Date()).toISOString(), art: "posten", buyBox: mk.bbJetzt, buyBox30: mk.bb30, buyBox90: mk.bb90, buyBox180: mk.bb180, einbrueche12: mk.einbrueche180, angebote: mk.angebote, angeboteTrend30: mk.angeboteTrend30, amazonAnteil: mk.amazonAnteil, rang: mk.rang, gekauftImMonat: mk.monatlichVerkauft, marke: mk.marke, kategorie: mk.kategorie }
    : x.keepa;
  await db.update(L).set({ ampel: e.ampel, keepa }).where(eq(L.id, lugruId));
}

let laeuft = new Set<string>();

async function kanalZeile(tenantId: string, kanalId: string, dc: ReturnType<typeof discord>) {
  const [k] = await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.kanalId, kanalId)));
  if (k) return { k, neu: false };
  const info = await dc.kanal(kanalId);
  const [n] = await db.insert(K).values({ tenantId, kanalId, name: kanalName(info.name) ?? kanalId, guildId: info.guild_id ?? null }).onConflictDoNothing().returning();
  return { k: n ?? (await db.select().from(K).where(and(eq(K.tenantId, tenantId), eq(K.kanalId, kanalId))))[0], neu: true };
}

/**
 * Takt (jede Minute): neue Posts aller Kanäle; erster Lauf je Kanal nimmt die letzten 100 Posts als History, nur die
 * der letzten 2 Std. kommen in den Deal-Eingang. Danach Reaktionen der frischen Posts (alle 5 Min.) und stündlich bis 30 Tage.
 */
export async function lugruAbgleich(tenantId: string, jetzt = new Date(), o: { erzwingen?: boolean } = {}): Promise<AbgleichZahlen | null> {
  if (laeuft.has(tenantId)) return null;
  const cfg = await lugruDiscordKonfig(tenantId);
  if (!cfg) return null;
  laeuft.add(tenantId);
  const z: AbgleichZahlen = { gelesen: 0, erkannt: 0, neu: 0, eingaenge: 0, zusammengefasst: 0, reaktionen: 0 };
  try {
    const dc = discord(cfg.token);
    for (const kanalId of cfg.kanaele) {
      try {
        const { k, neu } = await kanalZeile(tenantId, kanalId, dc);
        const kk = { kanalId, name: k.name, guildId: k.guildId };
        let cursor = k.cursor;
        if (neu || !cursor) {
          const letzte = (await dc.neueste(kanalId, 100)).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
          for (const m of letzte) await verarbeiten(tenantId, kk, m, cfg, z, { live: jetzt.getTime() - zeitVon(m).getTime() < 2 * 3600_000, jetzt });
          cursor = letzte.length ? letzte[letzte.length - 1].id : "0";
          const aeltester = letzte[0]?.id ?? null;
          await db.update(K).set({ cursor, historieVor: k.historieVor ?? aeltester, historieFertig: letzte.length < 100 ? true : k.historieFertig, historieBis: letzte[0] ? zeitVon(letzte[0]) : k.historieBis, gelesen: k.gelesen + letzte.length, reaktionenAm: jetzt, letzterLauf: jetzt, fehler: null }).where(eq(K.id, k.id));
          continue;
        }
        const neue = await dc.neue(kanalId, cursor);
        for (const m of neue) {
          cursor = m.id;
          // Verpasste Posts (Ausfall) höchstens 24 Std. nachholen; ältere nur als History.
          await verarbeiten(tenantId, kk, m, cfg, z, { live: jetzt.getTime() - zeitVon(m).getTime() < 24 * 3600_000, jetzt });
        }
        // Reaktionen und Änderungen („AUSVERKAUFT“) der jüngsten Posts.
        const frisch = o.erzwingen || !k.reaktionenAm || jetzt.getTime() - k.reaktionenAm.getTime() >= 5 * 60_000 - 15_000;
        if (frisch) z.reaktionen += await reaktionenNachziehen(tenantId, kk, cfg, await dc.neueste(kanalId, 100), jetzt);
        const tief = !k.tiefAbgleichAm || jetzt.getTime() - k.tiefAbgleichAm.getTime() >= 3600_000;
        if (tief) z.reaktionen += await tiefAbgleich(tenantId, kk, cfg, dc, jetzt);
        await db.update(K).set({ cursor, gelesen: k.gelesen + neue.length, ...(frisch ? { reaktionenAm: jetzt } : {}), ...(tief ? { tiefAbgleichAm: jetzt } : {}), letzterLauf: jetzt, fehler: null }).where(eq(K.id, k.id));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.update(K).set({ fehler: msg.slice(0, 300), letzterLauf: jetzt }).where(and(eq(K.tenantId, tenantId), eq(K.kanalId, kanalId)));
        if (cfg.kanaele.length === 1) throw e;
      }
    }
    return z;
  } finally {
    laeuft.delete(tenantId);
  }
}

/** Reaktionen bekannter Posts aus einer Liste von Nachrichten aktualisieren (nur wenn fällig bzw. geändert). */
async function reaktionenNachziehen(tenantId: string, k: { kanalId: string; name: string | null; guildId: string | null }, cfg: LugruDiscordKonfig, liste: DcNachricht[], jetzt: Date): Promise<number> {
  if (!liste.length) return 0;
  const bekannt = await db.select({ id: L.id, msg: L.discordNachrichtId, gepostetAm: L.gepostetAm, reaktionenAm: L.reaktionenAm, status: L.status, ausverkauftAm: L.ausverkauftAm, reaktionen: L.reaktionen }).from(L).where(and(eq(L.tenantId, tenantId), inArray(L.discordNachrichtId, liste.map((m) => m.id))));
  const map = new Map(bekannt.map((b) => [b.msg, b]));
  let n = 0;
  for (const m of liste) {
    const b = map.get(m.id);
    if (!b) continue;
    const reaktionen = reaktionenZaehlen(m.reactions);
    const ausverkauft = /AUSVERKAUFT/i.test(m.content ?? "");
    const geaendert = JSON.stringify(reaktionen) !== JSON.stringify(b.reaktionen ?? {}) || ausverkauft !== (b.status === "ausverkauft");
    if (!geaendert && !reaktionenFaellig(b.gepostetAm, b.reaktionenAm, jetzt)) continue;
    const zk = kaeufeAus(reaktionen, { gekauft: cfg.gekauft, weg: cfg.weg });
    await db.update(L).set({ reaktionen, kaeufe: zk.kaeufe, nichtVerfuegbar: zk.nichtVerfuegbar, reaktionenAm: jetzt, status: ausverkauft ? "ausverkauft" : "aktiv", ausverkauftAm: ausverkauft ? (b.ausverkauftAm ?? jetzt) : null, aktualisiertAm: jetzt }).where(eq(L.id, b.id));
    if (geaendert) n++;
  }
  return n;
}

/** Stündlich: Reaktionen der Posts bis 30 Tage zurück (seitenweise, höchstens 10 Seiten je Kanal). */
async function tiefAbgleich(tenantId: string, k: { kanalId: string; name: string | null; guildId: string | null }, cfg: LugruDiscordKonfig, dc: ReturnType<typeof discord>, jetzt: Date): Promise<number> {
  let n = 0;
  let vor: string | null = null;
  for (let seite = 0; seite < 10; seite++) {
    const liste: DcNachricht[] = vor ? await dc.vor(k.kanalId, vor, 100) : await dc.neueste(k.kanalId, 100);
    if (!liste.length) break;
    n += await reaktionenNachziehen(tenantId, k, cfg, liste, jetzt);
    const aeltester: DcNachricht = liste.reduce((a, b) => (BigInt(a.id) < BigInt(b.id) ? a : b));
    if (jetzt.getTime() - zeitVon(aeltester).getTime() > 30 * 86_400_000 || liste.length < 100) break;
    vor = aeltester.id;
  }
  return n;
}

/**
 * History einmalig rückwärts einlesen (wiederaufnehmbar): je Kanal höchstens `seiten` × 100 Nachrichten pro Aufruf.
 * Alte Posts kommen nicht in den Deal-Eingang (kein Push), sondern nur in die Lugru-Liste.
 */
export async function lugruHistorie(tenantId: string, o: { seiten?: number; jetzt?: Date } = {}): Promise<{ gelesen: number; erkannt: number; neu: number; fertig: boolean } | null> {
  const cfg = await lugruDiscordKonfig(tenantId);
  if (!cfg) return null;
  const jetzt = o.jetzt ?? new Date();
  const dc = discord(cfg.token);
  const z: AbgleichZahlen = { gelesen: 0, erkannt: 0, neu: 0, eingaenge: 0, zusammengefasst: 0, reaktionen: 0 };
  let alleFertig = true;
  for (const kanalId of cfg.kanaele) {
    const { k } = await kanalZeile(tenantId, kanalId, dc).catch(() => ({ k: null }));
    if (!k || k.historieFertig) continue;
    const kk = { kanalId, name: k.name, guildId: k.guildId };
    let vor = k.historieVor;
    let fertig = false;
    let bis = k.historieBis;
    const vorher = { gelesen: z.gelesen, erkannt: z.erkannt };
    try {
      for (let s = 0; s < (o.seiten ?? 10); s++) {
        const liste = vor ? await dc.vor(kanalId, vor, 100) : await dc.neueste(kanalId, 100);
        if (!liste.length) {
          fertig = true;
          break;
        }
        for (const m of liste) await verarbeiten(tenantId, kk, m, cfg, z, { live: false, jetzt });
        const aeltester = liste.reduce((a, b) => (BigInt(a.id) < BigInt(b.id) ? a : b));
        vor = aeltester.id;
        bis = zeitVon(aeltester);
        if (liste.length < 100) {
          fertig = true;
          break;
        }
      }
      await db.update(K).set({ historieVor: vor, historieFertig: fertig, historieBis: bis, gelesen: k.gelesen + (z.gelesen - vorher.gelesen), erkannt: k.erkannt + (z.erkannt - vorher.erkannt), letzterLauf: jetzt, fehler: null }).where(eq(K.id, k.id));
    } catch (e) {
      await db.update(K).set({ historieVor: vor, fehler: (e instanceof Error ? e.message : String(e)).slice(0, 300), letzterLauf: jetzt }).where(eq(K.id, k.id));
    }
    if (!fertig) alleFertig = false;
  }
  return { gelesen: z.gelesen, erkannt: z.erkannt, neu: z.neu, fertig: alleFertig };
}

/** History von vorn beginnen (z. B. nach neuen Kanälen) – vorhandene Deals bleiben, nichts wird gelöscht. */
export async function lugruHistorieNeu(tenantId: string) {
  await db.update(K).set({ historieFertig: false, historieVor: null }).where(eq(K.tenantId, tenantId));
}

/**
 * Eigene Käufe erkennen: Charge mit Kaufdatum (SKU bzw. EK-Import), Einkaufs-Bestellung oder „gekauft“ im Deal-Eingang
 * mit gleicher ASIN in den 14 Tagen nach dem Posten → „gekauft (automatisch erkannt)“. Nur ergänzend, nie
 * zurückgesetzt. Alle offenen Deals der letzten 400 Tage, neueste zuerst.
 */
export async function lugruKaufAbgleich(tenantId: string, jetzt = new Date()): Promise<number> {
  const seit = new Date(jetzt.getTime() - 400 * 86_400_000);
  const offen = await db
    .select({ id: L.id, asin: L.asin, gepostetAm: L.gepostetAm, eingangId: L.eingangId })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), eq(L.gekauftErkannt, false), gte(L.gepostetAm, seit)))
    .orderBy(desc(L.gepostetAm));
  if (!offen.length) return 0;
  const asins = [...new Set(offen.map((o) => o.asin.toUpperCase()))];
  const PO = schema.purchaseOrders;
  const POI = schema.purchaseOrderItems;
  const LO = schema.lots;
  const P = schema.products;
  const kaeufe: EigenerKauf[] = [];
  for (let i = 0; i < asins.length; i += 1000) {
    const teil = asins.slice(i, i + 1000);
    const pos = await db
      .select({ asin: POI.asin, am: PO.createdAt, nr: PO.number, status: PO.status })
      .from(POI)
      .innerJoin(PO, eq(PO.id, POI.poId))
      .where(and(eq(POI.tenantId, tenantId), inArray(POI.asin, teil), gte(PO.createdAt, seit)));
    kaeufe.push(...pos.filter((p) => p.asin && p.status !== "draft" && p.status !== "cancelled").map((p) => ({ asin: p.asin!, am: p.am, ref: `Bestellung ${p.nr}` })));
    // Chargen: Kaufdatum aus der SKU bzw. dem EK-Import – dort stehen die eigenen Käufe meistens (Rücksendungen zählen nicht).
    const chargen = await db
      .select({ asin: P.asin, tag: LO.purchaseDate, sku: LO.sku })
      .from(LO)
      .innerJoin(P, eq(P.id, LO.productId))
      .where(and(eq(LO.tenantId, tenantId), sql`${LO.kind} <> 'return'`, inArray(P.asin, teil), gte(LO.purchaseDate, seit.toISOString().slice(0, 10))));
    kaeufe.push(...chargen.filter((c) => c.tag).map((c) => ({ asin: c.asin, am: new Date(`${c.tag}T12:00:00Z`), ref: `Charge ${c.sku}`, nurTag: true })));
  }
  const eingaenge = await db.select({ id: E.id, angebote: E.angebote, am: E.gekauftAm }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.status, "gekauft"), gte(E.createdAt, seit)));
  kaeufe.push(...eingaenge.flatMap((e) => (e.angebote ?? []).filter((a) => a.asin && e.am).map((a) => ({ asin: a.asin!, am: e.am!, ref: `Deal-Eingang ${e.id.slice(0, 8)}` }))));
  let n = 0;
  for (const d of offen) {
    const eigenerEingang = d.eingangId ? eingaenge.find((e) => e.id === d.eingangId) : null;
    const t = eigenerEingang?.am ? { ref: "im Deal-Eingang als gekauft markiert" } : kaufZuDeal(d, kaeufe);
    if (!t) continue;
    await db.update(L).set({ gekauftErkannt: true, gekauftErkanntRef: t.ref.slice(0, 120) }).where(eq(L.id, d.id));
    n++;
  }
  return n;
}

/**
 * Keepa-Schnappschuss für History-Deals der letzten 90 Tage nachholen – aus dem Keepa-Verlauf (Zwischenspeicher,
 * sonst Abruf), höchstens `max` ASINs je Lauf (Keepa-Tokens schonen).
 */
export async function lugruKeepaNachholen(tenantId: string, max = 20, jetzt = new Date()): Promise<number> {
  const rows = await db
    .select({ id: L.id, asin: L.asin, zielmarkt: L.zielmarkt, gepostetAm: L.gepostetAm })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), isNull(L.keepa), gte(L.gepostetAm, new Date(jetzt.getTime() - 90 * 86_400_000)), lte(L.gepostetAm, jetzt)))
    .orderBy(desc(L.gepostetAm))
    .limit(max * 3);
  if (!rows.length) return 0;
  const { keepaMarkt } = await import("@/lib/keepa/markt");
  const { MARKTPLAETZE } = await import("@/lib/keepa/auswertung");
  let n = 0;
  const gesehen = new Set<string>();
  for (const r of rows) {
    const mp = (r.zielmarkt && r.zielmarkt in MARKTPLAETZE ? r.zielmarkt : "DE") as keyof typeof MARKTPLAETZE;
    const key = `${r.asin}|${mp}`;
    if (!gesehen.has(key) && gesehen.size >= max) break;
    gesehen.add(key);
    try {
      const k = await keepaMarkt(tenantId, r.asin, mp, jetzt.getTime());
      if (!k.stand) continue;
      const marke = k.stand.marke ?? null;
      const kategorie = k.stand.kategorie ?? null;
      const snap = keepaSchnappschuss(k.stand.verlauf, r.gepostetAm, { art: "verlauf", jetzt, gekauftImMonat: jetzt.getTime() - r.gepostetAm.getTime() < 3 * 86_400_000 ? k.stand.aktuell.monatlich_verkauft : null, marke, kategorie });
      await db.update(L).set({ keepa: snap ?? { stand: jetzt.toISOString(), art: "heute", buyBox: k.stand.aktuell.buybox, buyBox30: k.stand.kennzahlen["30"]?.buybox?.schnitt ?? null, buyBox90: k.stand.kennzahlen["90"]?.buybox?.schnitt ?? null, buyBox180: k.stand.kennzahlen["180"]?.buybox?.schnitt ?? null, einbrueche12: null, angebote: k.stand.aktuell.angebote_neu, angeboteTrend30: null, amazonAnteil: null, rang: k.stand.aktuell.verkaufsrang, gekauftImMonat: k.stand.aktuell.monatlich_verkauft, marke, kategorie } }).where(eq(L.id, r.id));
      n++;
    } catch {
      break; // Keepa nicht verbunden oder Tokens leer – beim nächsten Lauf weiter
    }
  }
  return n;
}

/**
 * B19.1: Marke und Kategorie für Keepa-Schnappschüsse ohne Kategorie nachziehen – erst aus dem Keepa-Zwischenspeicher
 * (kostenlos), sonst höchstens `max` Keepa-Abrufe je Lauf. Gilt für alle Deals derselben ASIN; „kategorieAm“ merkt
 * sich den Versuch, damit ASINs ohne Kategorie bei Keepa nicht immer wieder abgefragt werden.
 */
export async function lugruKategorieNachholen(tenantId: string, max = 20, jetzt = new Date()): Promise<number> {
  const ohne = sql`${L.keepa} is not null and ${L.keepa} ->> 'kategorie' is null and not (${L.keepa} ? 'kategorieAm')`;
  const asins = await db
    .select({ asin: L.asin, zielmarkt: sql<string | null>`max(${L.zielmarkt})`, zuletzt: sql<Date>`max(${L.gepostetAm})` })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), ohne, gte(L.gepostetAm, new Date(jetzt.getTime() - 365 * 86_400_000))))
    .groupBy(L.asin)
    .orderBy(sql`max(${L.gepostetAm}) desc`)
    .limit(max * 5);
  if (!asins.length) return 0;
  const C = schema.keepaCache;
  const cache = await db.select({ asin: C.asin, stand: C.stand }).from(C).where(and(eq(C.tenantId, tenantId), inArray(C.asin, asins.map((a) => a.asin))));
  const { keepaMarkt } = await import("@/lib/keepa/markt");
  const { MARKTPLAETZE } = await import("@/lib/keepa/auswertung");
  let abrufe = 0;
  let n = 0;
  for (const a of asins) {
    let st = cache.map((c) => c.stand).find((x) => x && "kategorie" in x) ?? null;
    if (!st) {
      if (abrufe >= max) continue;
      const mp = (a.zielmarkt && a.zielmarkt in MARKTPLAETZE ? a.zielmarkt : "DE") as keyof typeof MARKTPLAETZE;
      try {
        abrufe++;
        const k = await keepaMarkt(tenantId, a.asin, mp, jetzt.getTime());
        st = k.stand && "kategorie" in k.stand ? k.stand : null;
      } catch {
        break; // Keepa nicht verbunden oder Tokens leer – beim nächsten Lauf weiter
      }
    }
    if (!st) continue;
    const kat = st.kategorie ?? null;
    const marke = st.marke ?? null;
    await db
      .update(L)
      .set({ keepa: sql`${L.keepa} || jsonb_build_object('kategorie', ${kat}::text, 'kategorieAm', ${jetzt.toISOString()}::text) || case when ${L.keepa} ->> 'marke' is null and ${marke}::text is not null then jsonb_build_object('marke', ${marke}::text) else '{}'::jsonb end` })
      .where(and(eq(L.tenantId, tenantId), eq(L.asin, a.asin), ohne));
    if (kat) n++;
  }
  return n;
}

/** Fortschritt je Kanal (für Seite, Anbindungen und MCP). */
export async function lugruKanalStand(tenantId: string) {
  const ks = await db.select().from(K).where(eq(K.tenantId, tenantId)).orderBy(K.createdAt);
  const [z] = await db.select({ n: sql<number>`count(*)::int`, discord: sql<number>`count(*) filter (where ${L.quelle} = 'discord')::int`, appZuletzt: sql<Date | null>`max(${L.aktualisiertAm}) filter (where ${L.quelle} = 'app')`, appGepostet: sql<Date | null>`max(${L.gepostetAm}) filter (where ${L.quelle} = 'app')` }).from(L).where(eq(L.tenantId, tenantId));
  const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
  return { appZuletzt: iso(z?.appZuletzt), appNeuesterPost: iso(z?.appGepostet), kanaele: ks.map((k) => ({ kanal: kanalName(k.name) ?? k.kanalId, kanalId: k.kanalId, gelesen: k.gelesen, erkannt: k.erkannt, historieFertig: k.historieFertig, historieBis: k.historieBis?.toISOString() ?? null, letzterLauf: k.letzterLauf?.toISOString() ?? null, fehler: k.fehler })), deals: z?.n ?? 0, ausDiscord: z?.discord ?? 0 };
}

export function _lugruZuruecksetzen() {
  laeuft = new Set();
}
