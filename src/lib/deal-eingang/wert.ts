import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DAUMEN_GRUENDE, type DealEingangZeile, type DealErgebnis, type DealMerkmale } from "@/db/tables/deal-eingang";
import { getSettings } from "@/lib/settings";
import { prozentText, runde1 } from "@/lib/numbers";
import { bewaehrt, dealWert, eigenesLabel, lernBericht, lugruLabel, lugruMerkmale, merkmaleAus, modellLernen, modellMerkmale, type HistorieDeal, type KeepaLite, type Modell } from "./wert-logic";
import { kanalName } from "@/lib/lugru-deals/historie-logic";

// Abschnitt 11 „Lernender Deal-Wert“: Merkmale beim Eingang (Keepa aus dem Zwischenspeicher, keine Extra-Tokens),
// Historie aus eigenen Deals (Kauf, 👍/👎, reales Ergebnis) und – schwach gewichtet – der Lugru-Deals-History
// (Reaktionen nur als Anzahl). Ergebnisse je gekaufter Charge aus sellerboard (30/60/90 Tage nach Wareneingang).

const E = schema.dealEingaenge;
const L = schema.lugruDealsHistorie;
const MP = new Set(["DE", "FR", "IT", "ES", "UK"]);

/** Historie der letzten 365 Tage (eigene Deals mit Entscheidung/Ergebnis + Lugru-Deals mit ✅). */
async function historie(tenantId: string, zielRoi: number, ohneId?: string): Promise<HistorieDeal[]> {
  const seit = new Date(Date.now() - 365 * 86_400_000);
  const [eigen, lugru] = await Promise.all([
    db
      .select({ id: E.id, zeilen: E.zeilen, status: E.status, daumen: E.daumen, ergebnis: E.ergebnis, createdAt: E.createdAt })
      .from(E)
      .where(and(eq(E.tenantId, tenantId), gte(E.createdAt, seit), or(inArray(E.status, ["gekauft", "verworfen"]), isNotNull(E.daumen))))
      .orderBy(desc(E.createdAt))
      .limit(2000),
    db.select().from(L).where(and(eq(L.tenantId, tenantId), gte(L.gepostetAm, seit), sql`${L.kaeufe} > 0`)).orderBy(desc(L.gepostetAm)).limit(3000),
  ]);
  const out: HistorieDeal[] = [];
  for (const e of eigen) {
    if (e.id === ohneId) continue;
    const z = e.zeilen.filter((x) => x.merkmale).sort((a, b) => (a.ampel === "gruen" ? -1 : 0) - (b.ampel === "gruen" ? -1 : 0))[0];
    if (!z?.merkmale) continue;
    const l = eigenesLabel({ status: e.status, daumen: e.daumen, realerRoi: e.ergebnis?.realerRoi ?? null }, zielRoi);
    if (!l) continue;
    out.push({ id: e.id, quelle: "eigen", titel: z.titel ?? z.angebot.name, asin: z.asin, datum: e.createdAt.toISOString().slice(0, 10), merkmale: z.merkmale, label: l.label, gewicht: l.gewicht, ergebnis: l.ergebnis, realerRoi: e.ergebnis?.realerRoi ?? null });
  }
  for (const d of lugru) {
    const l = lugruLabel({ kaeufe: d.kaeufe, bewaehrt: d.bewaehrt });
    if (!l) continue;
    out.push({ id: null, quelle: "lugru", titel: d.titel, asin: d.asin, datum: d.gepostetAm.toISOString().slice(0, 10), merkmale: lugruMerkmale(d), label: l.label, gewicht: l.gewicht, ergebnis: l.ergebnis, kaeufe: d.kaeufe });
  }
  return out;
}

/** Lernmodell je Mandant, eine Stunde zwischengespeichert; erst ab 100 eigenen Deals mit Ergebnis. */
const modelle = new Map<string, { am: number; modell: Modell | null }>();
async function modellFuer(tenantId: string, h: HistorieDeal[]): Promise<Modell | null> {
  const c = modelle.get(tenantId);
  if (c && Date.now() - c.am < 3600_000) return c.modell;
  const eigen = h.filter((x) => x.quelle === "eigen");
  const modell = modellLernen(eigen.map((x) => ({ merkmale: x.merkmale, label: x.label >= 0.5 ? 1 : 0, gewicht: x.gewicht })));
  modelle.set(tenantId, { am: Date.now(), modell });
  return modell;
}

async function keepaLite(tenantId: string, asin: string, land: string | null, jetzt: Date): Promise<KeepaLite | null> {
  const mp = (land && MP.has(land) ? land : "DE") as "DE" | "FR" | "IT" | "ES" | "UK";
  try {
    const { keepaMarkt } = await import("@/lib/keepa/markt");
    return (await keepaMarkt(tenantId, asin, mp, jetzt.getTime())).stand as KeepaLite | null;
  } catch {
    return null;
  }
}

/** Beim Prüfen: je Zeile Merkmale (Keepa-Schnappschuss) und Deal-Wert anhängen. */
export async function wertAnhaengen(tenantId: string, zeilen: DealEingangZeile[], o: { weg: string; quelle: string | null; jetzt: Date; ohneId?: string }) {
  if (!zeilen.some((z) => z.asin)) return;
  const zielRoi = (await getSettings(tenantId)).dealEingang.zielRoi;
  const h = await historie(tenantId, zielRoi, o.ohneId);
  const modell = await modellFuer(tenantId, h);
  for (const z of zeilen) {
    if (!z.asin) continue;
    const k = await keepaLite(tenantId, z.asin, z.bestesLand, o.jetzt);
    z.merkmale = merkmaleAus(k, { land: z.bestesLand, ekNetto: z.ekNetto, roi: z.roi, marge: z.marge, amazonProzent: z.amazonProzent, angebote: z.angebote }, { marke: z.angebot.marke ?? k?.marke ?? null, kategorie: k?.kategorie ?? null, quelle: o.quelle, weg: o.weg, jetzt: o.jetzt, kapitalAmpel: z.eigen?.kapitalAmpel ?? null, bestand: z.eigen?.bestand ?? null });
    z.wert = dealWert(z.merkmale, { zielRoi, ampel: z.ampel, historie: h.filter((x) => x.asin !== z.asin || x.quelle === "lugru"), modell });
  }
}

/** Deal-Wert für eine ASIN (ohne EK: nur Markt + ähnliche Deals) bzw. den gespeicherten Wert eines Eingangs. */
export async function dealWertFuer(tenantId: string, q: { asin?: string; dealId?: string }, jetzt = new Date()) {
  if (q.dealId) {
    const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, q.dealId)));
    if (!e) return null;
    return { art: "eingang" as const, deal_id: e.id, zeilen: e.zeilen.filter((z) => z.wert).map((z) => ({ nr: z.nr, asin: z.asin, titel: z.titel ?? z.angebot.name, ampel: z.ampel, wert: z.wert! })) };
  }
  if (!q.asin) return null;
  const zielRoi = (await getSettings(tenantId)).dealEingang.zielRoi;
  const h = await historie(tenantId, zielRoi);
  const k = await keepaLite(tenantId, q.asin, "DE", jetzt);
  const m = merkmaleAus(k, { land: "DE", ekNetto: null, roi: null, marge: null, amazonProzent: null, angebote: null }, { marke: k?.marke ?? null, kategorie: k?.kategorie ?? null, quelle: null, weg: "claude", jetzt, kapitalAmpel: null, bestand: null });
  return { art: "asin" as const, asin: q.asin, ohne_ek: true, wert: dealWert(m, { zielRoi, ampel: "gelb", historie: h.filter((x) => x.asin !== q.asin || x.quelle === "lugru"), modell: await modellFuer(tenantId, h) }), merkmale: m };
}

/** 👍/👎 mit Kurzgrund speichern (Seite, Push, Discord, Claude). */
export async function bewerten(tenantId: string, id: string, b: { daumen: "hoch" | "runter"; grund?: string | null; weg: "tool" | "push" | "discord" | "claude" }) {
  // Kurzgrund nur aus der festen Liste (Unbekanntes → „sonstiges“), damit der Bericht zählbar bleibt.
  const g = b.grund?.trim();
  const grund = !g ? null : (DAUMEN_GRUENDE as readonly string[]).includes(g) ? g : "sonstiges";
  const r = await db.update(E).set({ daumen: b.daumen, daumenGrund: grund, daumenWeg: b.weg, daumenAm: new Date() }).where(and(eq(E.tenantId, tenantId), eq(E.id, id))).returning({ id: E.id });
  modelle.delete(tenantId);
  return r.length > 0;
}

/**
 * 👍/👎 als Reaktion auf die ProfitPath-Nachricht in Discord (letzte 7 Tage, nur ohne Bewertung). Reaktionen des
 * Bots selbst zählen nicht. Grund bleibt leer (in der Seite nachtragbar).
 */
export async function discordDaumen(tenantId: string): Promise<number> {
  const offen = await db.select({ id: E.id, ref: E.discordRef }).from(E).where(and(eq(E.tenantId, tenantId), isNotNull(E.discordRef), isNull(E.daumen), gte(E.createdAt, new Date(Date.now() - 7 * 86_400_000)))).limit(100);
  if (!offen.length) return 0;
  const { profitPathKonfig } = await import("./profitpath");
  const cfg = await profitPathKonfig(tenantId);
  if (!cfg) return 0;
  const { discord } = await import("@/lib/va/discord");
  const dc = discord(cfg.token);
  let n = 0;
  for (const o of offen) {
    const [kanal, nachricht] = (o.ref ?? "").split("/");
    if (!kanal || !nachricht) continue;
    const m = await dc.nachricht(kanal, nachricht).catch(() => null);
    const zahl = (emoji: string[]) => (m?.reactions ?? []).filter((r) => r.emoji.name && emoji.includes(r.emoji.name)).reduce((s, r) => s + r.count - (r.me ? 1 : 0), 0);
    const hoch = zahl(["👍", "👍🏻", "👍🏼", "👍🏽", "👍🏾", "👍🏿"]);
    const runter = zahl(["👎", "👎🏻", "👎🏼", "👎🏽", "👎🏾", "👎🏿"]);
    if (hoch === runter) continue;
    await bewerten(tenantId, o.id, { daumen: hoch > runter ? "hoch" : "runter", weg: "discord" });
    n++;
  }
  return n;
}

// ---- Reales Ergebnis je gekaufter Charge -------------------------------------------------------------------------

/**
 * 30/60/90 Tage nach Wareneingang (bzw. Kauf + 7 Tage, wenn kein Wareneingang gebucht ist): verkaufte Stück, Ø VK,
 * Gewinn (sellerboard je Monat, anteilig auf die gekaufte Menge) und realer ROI. Ältere Stufen werden überschrieben.
 */
export async function ergebnisseAktualisieren(tenantId: string, jetzt = new Date()): Promise<number> {
  const kaeufe = await db
    .select({ id: E.id, zeilen: E.zeilen, menge: E.gekauftMenge, preis: E.gekauftPreis, am: E.gekauftAm, bestellungId: E.bestellungId, ergebnis: E.ergebnis })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), eq(E.status, "gekauft"), isNotNull(E.gekauftAm), lte(E.gekauftAm, new Date(jetzt.getTime() - 30 * 86_400_000)), gte(E.gekauftAm, new Date(jetzt.getTime() - 200 * 86_400_000))))
    .limit(500);
  let n = 0;
  const PO = schema.purchaseOrders;
  const S = schema.sellerboardSkuMonths;
  for (const k of kaeufe) {
    const z = k.zeilen.find((x) => x.asin);
    if (!z?.asin || !k.menge || !k.am) continue;
    const [po] = k.bestellungId ? await db.select({ am: PO.receivedAt }).from(PO).where(and(eq(PO.tenantId, tenantId), eq(PO.id, k.bestellungId))) : [];
    const eingang = po?.am ?? new Date(k.am.getTime() + 7 * 86_400_000);
    const alter = Math.floor((jetzt.getTime() - eingang.getTime()) / 86_400_000);
    const stufe = alter >= 90 ? 90 : alter >= 60 ? 60 : alter >= 30 ? 30 : 0;
    if (!stufe || (k.ergebnis && k.ergebnis.tage >= stufe)) continue;
    const ab = eingang.toISOString().slice(0, 7);
    const rows = await db.select({ month: S.month, units: S.units, sales: S.sales, netProfit: S.netProfit }).from(S).where(and(eq(S.tenantId, tenantId), eq(S.asin, z.asin), gte(S.month, ab)));
    const units = rows.reduce((s, r) => s + (r.units ?? 0), 0);
    const sales = rows.reduce((s, r) => s + Number(r.sales ?? 0), 0);
    const gewinn = rows.reduce((s, r) => s + Number(r.netProfit ?? 0), 0);
    // Erstattungen: Kundenrücksendungen (Amazon-Bericht) zur ASIN seit Wareneingang, höchstens die gekaufte Menge.
    const R = schema.amazonCustomerReturns;
    const [ret] = await db.select({ n: sql<number>`coalesce(sum(${R.quantity}), 0)::int` }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.asin, z.asin), gte(R.returnDate, eingang.toISOString().slice(0, 10))));
    const erstattet = Math.min(ret?.n ?? 0, k.menge);
    const verkauft = Math.min(units, k.menge);
    const anteil = units > 0 ? verkauft / units : 0;
    const einsatz = verkauft * (k.preis ?? z.ekNetto ?? 0);
    const ergebnis: DealErgebnis = {
      wareneingang: eingang.toISOString().slice(0, 10),
      tage: stufe,
      verkauft,
      erstattet,
      oVk: units > 0 ? Math.round((sales / units) * 100) / 100 : null,
      realerGewinn: units > 0 ? Math.round(gewinn * anteil * 100) / 100 : null,
      realerRoi: einsatz > 0 ? Math.round(((gewinn * anteil) / einsatz) * 100) : null,
      tageBisAbverkauf: verkauft >= k.menge * 0.9 ? stufe : null,
      stand: jetzt.toISOString(),
    };
    await db.update(E).set({ ergebnis }).where(eq(E.id, k.id));
    n++;
  }
  if (n) modelle.delete(tenantId);
  return n;
}

// ---- Lugru Deals (Shop-Monitor) ----------------------------------------------------------------------------------

export type LugruDealImport = { id: number; asin: string; titel?: string | null; quellmarkt?: string | null; zielmarkt?: string | null; ek_eur?: number | null; vk_eur?: number | null; gewinn_eur?: number | null; marge_prozent?: number | null; verkaeufe_monat?: number | null; gruppe?: string | null; kanal?: string | null; status?: string | null; kaeufe?: number; nicht_verfuegbar?: number; reaktionen_am?: string | null; gepostet_am: string; discord_kanal_id?: string | null; discord_nachricht_id?: string | null; shop?: string | null; einkaufslink?: string | null; ek_art?: string | null; max_menge?: number | null };

/** Live-Eingang nur für Deals, die höchstens so alt sind (direkt nach dem Posten von der Lugru-Deals-Seite). */
const LIVE_STUNDEN = 2;

/** Rückwirkender bzw. laufender Import aus Lugru Deals: je Deal Zahlen und Reaktionen als Anzahl (keine Personen). */
export async function lugruImport(tenantId: string, deals: LugruDealImport[], jetzt = new Date()): Promise<{ neu: number; aktualisiert: number; ungueltig: number; eingaenge: number }> {
  let neu = 0;
  let aktualisiert = 0;
  let ungueltig = 0;
  // Frische Deals (direkt nach dem Posten geschickt) → Deal-Eingang mit Ampel, wie beim Lesen aus Discord.
  const live: { id: string; d: LugruDealImport; asin: string; am: Date }[] = [];
  const zahl = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  for (const d of deals.slice(0, 1000)) {
    if (!d || typeof d !== "object") {
      ungueltig++;
      continue;
    }
    const asin = String(d.asin ?? "").trim().toUpperCase();
    const am = Date.parse(String(d.gepostet_am ?? ""));
    if (!Number.isSafeInteger(d.id) || !/^[A-Z0-9]{10}$/.test(asin) || !Number.isFinite(am)) {
      ungueltig++;
      continue;
    }
    const werte = {
      asin,
      titel: d.titel ? String(d.titel).slice(0, 300) : null,
      quellmarkt: d.quellmarkt ? String(d.quellmarkt).slice(0, 40) : null,
      zielmarkt: d.zielmarkt ? String(d.zielmarkt).slice(0, 40) : null,
      ekEur: zahl(d.ek_eur),
      vkEur: zahl(d.vk_eur),
      gewinnEur: zahl(d.gewinn_eur),
      margeProzent: runde1(zahl(d.marge_prozent)),
      verkaeufeMonat: zahl(d.verkaeufe_monat) !== null ? Math.round(d.verkaeufe_monat!) : null,
      gruppe: d.gruppe ? String(d.gruppe).slice(0, 80) : null,
      kanal: d.kanal ? kanalName(String(d.kanal))?.slice(0, 80) ?? null : null,
      status: d.status ? String(d.status).slice(0, 20) : null,
      kaeufe: Math.max(0, Math.round(zahl(d.kaeufe) ?? 0)),
      nichtVerfuegbar: Math.max(0, Math.round(zahl(d.nicht_verfuegbar) ?? 0)),
      reaktionenAm: d.reaktionen_am && Number.isFinite(Date.parse(d.reaktionen_am)) ? new Date(d.reaktionen_am) : null,
      gepostetAm: new Date(am),
      aktualisiertAm: new Date(),
      ...(d.shop ? { shop: String(d.shop).slice(0, 120) } : {}),
      ...(d.einkaufslink && /^https?:\/\//i.test(String(d.einkaufslink)) ? { shopUrl: String(d.einkaufslink).slice(0, 500) } : {}),
      ...(d.ek_art === "netto" || d.ek_art === "brutto" ? { ekNetto: d.ek_art === "netto" } : {}),
      ...(zahl(d.max_menge) ? { maxMenge: Math.round(d.max_menge!) } : {}),
    };
    const frisch = am >= jetzt.getTime() - LIVE_STUNDEN * 3600_000 && (werte.status ?? "aktiv") === "aktiv";
    // Schon vom Seller-System in Discord gelesen (Weg B)? Dann diese Zeile ergänzen statt eine zweite anzulegen –
    // die Zahlen aus Lugru Deals sind genauer, die Reaktionen aus Discord bleiben die jüngeren.
    const nachricht = typeof d.discord_nachricht_id === "string" && /^\d{15,25}$/.test(d.discord_nachricht_id) ? d.discord_nachricht_id : null;
    if (nachricht) {
      const [ausDiscord] = await db.select({ id: L.id, externId: L.externId }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.discordNachrichtId, nachricht)));
      if (ausDiscord && (ausDiscord.externId === null || ausDiscord.externId === d.id)) {
        const { kaeufe: _k, nichtVerfuegbar: _n, reaktionenAm: _r, kanal: _c, status: _s, ...zahlen } = werte;
        await db.update(L).set({ externId: d.id, ...zahlen }).where(eq(L.id, ausDiscord.id));
        aktualisiert++;
        if (frisch) live.push({ id: ausDiscord.id, d, asin, am: new Date(am) });
        continue;
      }
    }
    const r = await db
      .insert(L)
      .values({ tenantId, externId: d.id, quelle: "app", ...werte, ...(nachricht ? { discordNachrichtId: nachricht, discordKanalId: typeof d.discord_kanal_id === "string" ? d.discord_kanal_id.slice(0, 30) : null } : {}) })
      .onConflictDoUpdate({ target: [L.tenantId, L.externId], set: werte })
      .returning({ id: L.id, neu: sql<boolean>`xmax = 0` });
    if (r[0]?.neu) neu++;
    else aktualisiert++;
    if (frisch && r[0]) live.push({ id: r[0].id, d, asin, am: new Date(am) });
  }
  if (neu + aktualisiert) modelle.delete(tenantId);
  let eingaenge = 0;
  if (live.length) {
    const { lugruLiveEingang } = await import("@/lib/lugru-deals/discord");
    for (const x of live.slice(0, 20)) {
      const [z] = await db.select({ eingangId: L.eingangId, shop: L.shop, shopUrl: L.shopUrl, ekNetto: L.ekNetto, kanal: L.kanal, ausverkauftAm: L.ausverkauftAm }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.id, x.id)));
      if (!z || z.eingangId || z.ausverkauftAm) continue;
      const d = x.d;
      const text = [
        `Lugru Deals (#${z.kanal ?? "deals"}) – direkt von der Lugru-Deals-Seite${z.shop ? ` · Shop: ${z.shop}` : ""}`,
        `${d.titel ?? ""}`.trim() || null,
        `Laut Lugru Deals: EK ${d.ek_eur ?? "–"} € ${z.ekNetto ? "netto" : "brutto"} · VK ${d.vk_eur ?? "–"} €${d.zielmarkt ? ` (${d.zielmarkt})` : ""}${d.gewinn_eur != null ? ` · Gewinn ${d.gewinn_eur} €` : ""}${d.marge_prozent != null ? ` · Marge ${prozentText(d.marge_prozent)} %` : ""}${d.verkaeufe_monat ? ` · ${d.verkaeufe_monat}+ Verkäufe/Monat` : ""}${d.max_menge ? ` · max. ${d.max_menge} Stück` : ""}`,
        `ASIN ${x.asin}`,
        z.shopUrl ? `Einkauf: ${z.shopUrl}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const nachricht = typeof d.discord_nachricht_id === "string" && /^\d{15,25}$/.test(d.discord_nachricht_id) ? d.discord_nachricht_id : null;
      const r = await lugruLiveEingang(tenantId, x.id, { asin: x.asin, titel: d.titel ?? null, shop: z.shop, ekEur: typeof d.ek_eur === "number" ? d.ek_eur : null, ekNetto: z.ekNetto ?? false, gepostetAm: x.am, kanal: z.kanal ?? "deals", text, quelleRef: nachricht ? `lugru:${nachricht}` : `lugru-app:${d.id}` }).catch((e) => {
        console.error("[Lugru Deals] Live-Eingang:", e instanceof Error ? e.message : e);
        return null;
      });
      if (r === "neu") eingaenge++;
    }
  }
  return { neu, aktualisiert, ungueltig, eingaenge };
}

/** Bewährt? Nur aus dem Keepa-Zwischenspeicher (keine neuen Abfragen), Deals 21–120 Tage nach dem Posten. */
export async function lugruBewaehrtPruefen(tenantId: string, jetzt = new Date()): Promise<number> {
  const offen = await db
    .select()
    .from(L)
    .where(and(eq(L.tenantId, tenantId), isNull(L.bewaehrt), sql`${L.kaeufe} > 0`, lte(L.gepostetAm, new Date(jetzt.getTime() - 21 * 86_400_000)), gte(L.gepostetAm, new Date(jetzt.getTime() - 120 * 86_400_000))))
    .limit(300);
  if (!offen.length) return 0;
  const C = schema.keepaCache;
  const cache = await db.select({ asin: C.asin, stand: C.stand, am: C.abgerufenAm }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.marktplatz, "DE"), inArray(C.asin, [...new Set(offen.map((d) => d.asin))])));
  let n = 0;
  for (const d of offen) {
    const c = cache.find((x) => x.asin === d.asin && x.stand && x.am.getTime() > d.gepostetAm.getTime() + 21 * 86_400_000);
    if (!c?.stand) continue;
    const b = bewaehrt({ vkEur: d.vkEur, gepostetAm: d.gepostetAm.toISOString() }, c.stand as unknown as KeepaLite);
    if (b.bewaehrt === null) continue;
    await db.update(L).set({ bewaehrt: b.bewaehrt, bewaehrtGrund: b.grund }).where(eq(L.id, d.id));
    n++;
  }
  return n;
}

export async function lugruStand(tenantId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int`, mitKauf: sql<number>`count(*) filter (where ${L.kaeufe} > 0)::int`, kaeufe: sql<number>`coalesce(sum(${L.kaeufe}), 0)::int`, zuletzt: sql<Date | null>`max(${L.aktualisiertAm})` }).from(L).where(eq(L.tenantId, tenantId));
  return { deals: r?.n ?? 0, mitKauf: r?.mitKauf ?? 0, kaeufe: r?.kaeufe ?? 0, zuletzt: r?.zuletzt ? new Date(r.zuletzt) : null };
}

// ---- Monatsbericht -----------------------------------------------------------------------------------------------

/** „Wie gut lag der Deal-Wert?“ für einen Monat (YYYY-MM): Trefferquote, verpasste gute Deals, Fehlkäufe, Merkmale. */
export async function lernBerichtFuer(tenantId: string, monat: string) {
  const s = (await getSettings(tenantId)).dealEingang;
  const von = new Date(`${monat}-01T00:00:00Z`);
  const bis = new Date(Date.UTC(von.getUTCFullYear(), von.getUTCMonth() + 1, 1));
  const rows = await db.select({ id: E.id, zeilen: E.zeilen, status: E.status, daumen: E.daumen, ergebnis: E.ergebnis, createdAt: E.createdAt }).from(E).where(and(eq(E.tenantId, tenantId), gte(E.createdAt, von), sql`${E.createdAt} < ${bis}`));
  const deals = rows.map((e) => {
    const z = e.zeilen.filter((x) => x.wert).sort((a, b) => (b.wert?.wert ?? 0) - (a.wert?.wert ?? 0))[0];
    return { id: e.id, titel: z?.titel ?? z?.angebot.name ?? null, datum: e.createdAt.toISOString().slice(0, 10), wert: z?.wert?.wert ?? null, status: e.status, daumen: e.daumen, realerRoi: e.ergebnis?.realerRoi ?? null };
  });
  const b = lernBericht(deals, { schwelle: s.wertSchwelle ?? 70, zielRoi: s.zielRoi });
  const h = await historie(tenantId, s.zielRoi);
  const modell = await modellFuer(tenantId, h);
  const lg = await lugruStand(tenantId);
  return {
    monat,
    ...b,
    schwelle: s.wertSchwelle ?? 70,
    verfahren: modell ? `Lernmodell aus ${modell.n} eigenen Deals + Kennzahlen + ähnliche Deals` : `Kennzahlen + ähnliche Deals (Lernmodell ab 100 eigenen Deals mit Ergebnis, aktuell ${h.filter((x) => x.quelle === "eigen").length})`,
    wichtigsteMerkmale: modell ? modellMerkmale(modell).slice(0, 5) : null,
    lugru: lg,
  };
}

export type { DealMerkmale };

/**
 * Deal-Wert für Lugru-Deals (auch History ohne Eingang): Zahlen aus dem Post (ROI, Marge, Verkäufe) plus
 * Keepa-Schnappschuss zum Zeitpunkt des Postens, verglichen mit früheren Deals (ohne den Deal selbst).
 * Ohne Keepa-Abruf – günstig auch für Listen.
 */
export async function lugruWerte(tenantId: string, rows: { id: string; asin: string; gepostetAm: Date; ampel: "gruen" | "gelb" | "rot" | null; ekEur: number | null; gewinnEur: number | null; margeProzent: number | null; verkaeufeMonat: number | null; keepa: import("@/db/schema").LugruKeepa | null }[]) {
  const out = new Map<string, import("@/db/tables/deal-eingang").DealWert>();
  if (!rows.length) return out;
  const zielRoi = (await getSettings(tenantId)).dealEingang.zielRoi;
  const h = await historie(tenantId, zielRoi);
  const modell = await modellFuer(tenantId, h);
  for (const r of rows) {
    const k = r.keepa;
    const m: Partial<DealMerkmale> = {
      ...lugruMerkmale(r),
      ...(k
        ? {
            bbJetzt: k.buyBox,
            bb30: k.buyBox30,
            bb90: k.buyBox90,
            bb180: k.buyBox180,
            bbAbweichung90: k.buyBox !== null && k.buyBox90 ? Math.round(((k.buyBox - k.buyBox90) / k.buyBox90) * 1000) / 10 : null,
            einbrueche180: k.einbrueche12,
            angebote: k.angebote,
            angeboteTrend30: k.angeboteTrend30,
            amazonAnteil: k.amazonAnteil,
            rang: k.rang,
            monatlichVerkauft: k.gekauftImMonat ?? r.verkaeufeMonat,
            marke: k.marke,
            kategorie: k.kategorie,
          }
        : {}),
    };
    const tag = r.gepostetAm.toISOString().slice(0, 10);
    out.set(r.id, dealWert(m, { zielRoi, ampel: r.ampel ?? "gelb", historie: h.filter((x) => !(x.asin === r.asin && x.datum === tag)), modell }));
  }
  return out;
}
