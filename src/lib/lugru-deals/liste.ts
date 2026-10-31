import "server-only";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { lugruStatistik, NUR_KAUFZEICHEN, reaktionenVon, type StatDeal } from "./auswertung-logic";
import { kanalName, TEST_KANAL_SQL } from "./historie-logic";
import { nachrichtLink } from "./post-logic";
import { runde1 } from "@/lib/numbers";

// Lugru Deals im Seller-System: Liste mit Filtern, Detail und Statistik – aus der Tabelle lugru_deals_historie
// (Discord gelesen bzw. aus Lugru Deals übertragen) plus Deal-Eingang (Ampel, Entscheidung, reales Ergebnis).

const L = schema.lugruDealsHistorie;
const E = schema.dealEingaenge;

/** mitTest: auch Deals aus Testkanälen („test“, „test1“) – sonst ausgeblendet. */
export type LugruFilter = { von?: string | null; bis?: string | null; kanal?: string | null; ampel?: "gruen" | "gelb" | "rot" | null; gekauft?: boolean | null; minWert?: number | null; suche?: string | null; limit?: number; offset?: number; mitTest?: boolean };

const ohneTest = () => sql`coalesce(btrim(${L.kanal}), '') !~* ${TEST_KANAL_SQL}`;

function bedingungen(tenantId: string, f: LugruFilter): SQL[] {
  const w: SQL[] = [eq(L.tenantId, tenantId)];
  if (f.von && /^\d{4}-\d{2}-\d{2}$/.test(f.von)) w.push(gte(L.gepostetAm, new Date(`${f.von}T00:00:00Z`)));
  if (f.bis && /^\d{4}-\d{2}-\d{2}$/.test(f.bis)) w.push(lte(L.gepostetAm, new Date(`${f.bis}T23:59:59Z`)));
  if (f.kanal) w.push(sql`btrim(${L.kanal}) = ${kanalName(f.kanal) ?? ""}`);
  if (!f.mitTest && !f.kanal) w.push(ohneTest());
  if (f.ampel) w.push(eq(L.ampel, f.ampel));
  if (f.suche?.trim()) {
    const q = `%${f.suche.trim().slice(0, 60).replace(/[%_]/g, "")}%`;
    w.push(sql`(${L.titel} ilike ${q} or ${L.asin} ilike ${q} or ${L.shop} ilike ${q})`);
  }
  return w;
}

type Zeile = typeof L.$inferSelect;
type Eingang = { id: string; status: string; ampel: string | null; gekauftMenge: number | null; gekauftPreis: number | null; ergebnis: { realerRoi: number | null } | null; wert: number | null };

async function eingaengeZu(tenantId: string, ids: string[]): Promise<Map<string, Eingang>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: E.id, status: E.status, ampel: E.ampel, gekauftMenge: E.gekauftMenge, gekauftPreis: E.gekauftPreis, ergebnis: E.ergebnis, zeilen: E.zeilen }).from(E).where(and(eq(E.tenantId, tenantId), inArray(E.id, ids)));
  return new Map(rows.map((r) => [r.id, { id: r.id, status: r.status, ampel: r.ampel, gekauftMenge: r.gekauftMenge, gekauftPreis: r.gekauftPreis, ergebnis: r.ergebnis ? { realerRoi: r.ergebnis.realerRoi ?? null } : null, wert: r.zeilen?.[0]?.wert?.wert ?? null }]));
}

const gekauftVon = (z: Zeile, e: Eingang | undefined) => z.gekauftErkannt || e?.status === "gekauft";

function zeileAus(z: Zeile, e: Eingang | undefined, wert: number | null) {
  const r = reaktionenVon(z);
  return {
    id: z.id,
    gepostet_am: z.gepostetAm.toISOString(),
    kanal: kanalName(z.kanal),
    titel: z.titel,
    asin: z.asin,
    asin_unsicher: z.asinUnsicher || undefined,
    shop: z.shop,
    ek: z.ekEur,
    ek_netto: z.ekNetto,
    vk: z.vkEur,
    zielmarkt: z.zielmarkt,
    gewinn: z.gewinnEur,
    marge: runde1(z.margeProzent),
    verkaeufe_monat: z.verkaeufeMonat,
    max_menge: z.maxMenge,
    status: z.status,
    ausverkauft_am: z.ausverkauftAm?.toISOString() ?? null,
    reaktionen: r.reaktionen,
    reaktionen_hinweis: r.nurKaufzeichen ? NUR_KAUFZEICHEN : undefined,
    gruppen_kaeufe: z.kaeufe,
    nicht_verfuegbar: z.nichtVerfuegbar,
    ampel: z.ampel ?? (e?.ampel as Zeile["ampel"]) ?? null,
    deal_wert: wert,
    gekauft: gekauftVon(z, e),
    gekauft_quelle: e?.status === "gekauft" ? "Deal-Eingang" : z.gekauftErkannt ? `automatisch erkannt (${z.gekauftErkanntRef ?? "Bestellung"})` : null,
    realer_roi: runde1(e?.ergebnis?.realerRoi),
    eingang_id: z.eingangId,
    quelle: z.quelle,
    link_discord: z.discordKanalId && z.discordNachrichtId ? nachrichtLink(z.discordGuildId, z.discordKanalId, z.discordNachrichtId) : null,
  };
}

export type LugruZeile = ReturnType<typeof zeileAus>;

/** Liste mit Filtern (neueste zuerst). Deal-Wert: aus dem Eingang, sonst aus Post-Zahlen + Keepa-Schnappschuss. */
export async function lugruListe(tenantId: string, f: LugruFilter = {}) {
  const limit = Math.min(500, Math.max(1, f.limit ?? 100));
  const w = and(...bedingungen(tenantId, f));
  // Bei Filtern auf berechnete Werte (gekauft, Deal-Wert) mehr laden und danach filtern.
  const nachfiltern = f.gekauft !== undefined && f.gekauft !== null || (f.minWert ?? null) !== null;
  const rows = await db.select().from(L).where(w).orderBy(desc(L.gepostetAm)).limit(nachfiltern ? 2000 : limit).offset(nachfiltern ? 0 : (f.offset ?? 0));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(L).where(w);
  const eing = await eingaengeZu(tenantId, [...new Set(rows.map((r) => r.eingangId).filter((x): x is string => Boolean(x)))]);
  let liste = rows;
  if (f.gekauft !== undefined && f.gekauft !== null) liste = liste.filter((z) => gekauftVon(z, z.eingangId ? eing.get(z.eingangId) : undefined) === f.gekauft);
  // Deal-Wert berechnen nur für die angezeigten (bzw. für den Filter nötig).
  const { lugruWerte } = await import("@/lib/deal-eingang/wert");
  const kandidaten = nachfiltern ? liste : liste.slice(0, limit);
  const ohneEingangWert = kandidaten.filter((z) => !(z.eingangId && eing.get(z.eingangId)?.wert !== null && eing.get(z.eingangId)?.wert !== undefined));
  const werte = await lugruWerte(tenantId, ohneEingangWert.slice(0, 600));
  const wertVon = (z: Zeile) => (z.eingangId ? (eing.get(z.eingangId)?.wert ?? null) : null) ?? werte.get(z.id)?.wert ?? null;
  if ((f.minWert ?? null) !== null) liste = liste.filter((z) => (wertVon(z) ?? -1) >= f.minWert!);
  const seite = nachfiltern ? liste.slice(f.offset ?? 0, (f.offset ?? 0) + limit) : liste;
  return { gesamt: nachfiltern ? liste.length : n, deals: seite.map((z) => zeileAus(z, z.eingangId ? eing.get(z.eingangId) : undefined, wertVon(z))) };
}

/** Ein Lugru-Deal mit Statistik, Keepa-Schnappschuss, Ergebnis, Deal-Wert (Begründung) und ähnlichen früheren Deals. */
export async function lugruDeal(tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [z] = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.id, id)));
  if (!z) return null;
  const eing = z.eingangId ? (await eingaengeZu(tenantId, [z.eingangId])).get(z.eingangId) : undefined;
  const { lugruWerte, dealWertFuer } = await import("@/lib/deal-eingang/wert");
  const ausEingang = z.eingangId ? await dealWertFuer(tenantId, { dealId: z.eingangId }) : null;
  const gespeichert = ausEingang && ausEingang.art === "eingang" ? ausEingang.zeilen[0]?.wert : null;
  const wert = gespeichert ?? (await lugruWerte(tenantId, [z])).get(z.id) ?? null;
  // Weitere Posts derselben ASIN (Zusammenfassung, frühere Deals)
  const gleicheAsin = await db.select({ id: L.id, gepostetAm: L.gepostetAm, kanal: L.kanal, ekEur: L.ekEur, kaeufe: L.kaeufe, shop: L.shop }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.asin, z.asin), sql`${L.id} <> ${z.id}`)).orderBy(desc(L.gepostetAm)).limit(10);
  return {
    ...zeileAus(z, eing, wert?.wert ?? null),
    keepa_beim_posten: z.keepa,
    deal_wert_begruendung: wert ? { wert: wert.wert, begruendung: wert.begruendung, dafuer: wert.dafuer.slice(0, 3), dagegen: wert.dagegen.slice(0, 3), verfahren: wert.verfahren, gedeckelt: wert.gedeckelt } : null,
    aehnliche: (wert?.aehnliche ?? []).slice(0, 5),
    entscheidung: eing ? { status: eing.status, menge: eing.gekauftMenge, preis: eing.gekauftPreis } : null,
    weitere_posts_gleiche_asin: gleicheAsin.map((g) => ({ id: g.id, gepostet_am: g.gepostetAm.toISOString(), kanal: g.kanal, ek: g.ekEur, shop: g.shop, gruppen_kaeufe: g.kaeufe })),
  };
}

/** Statistik im Zeitraum (Standard: letzte 90 Tage) – mit Gesamtzahl aller Deals; Testkanäle nur mit mitTest. */
export async function lugruStatistikFuer(tenantId: string, o: { von?: string | null; bis?: string | null; mitTest?: boolean } = {}) {
  const bis = o.bis && /^\d{4}-\d{2}-\d{2}$/.test(o.bis) ? new Date(`${o.bis}T23:59:59Z`) : new Date();
  const von = o.von && /^\d{4}-\d{2}-\d{2}$/.test(o.von) ? new Date(`${o.von}T00:00:00Z`) : new Date(bis.getTime() - 90 * 86_400_000);
  const test = o.mitTest ? [] : [ohneTest()];
  const rows = await db.select().from(L).where(and(eq(L.tenantId, tenantId), gte(L.gepostetAm, von), lte(L.gepostetAm, bis), ...test)).limit(20000);
  const [g] = await db
    .select({ n: sql<number>`count(*)::int`, kaeufe: sql<number>`coalesce(sum(${L.kaeufe}), 0)::int`, erster: sql<Date | null>`min(${L.gepostetAm})`, test: sql<number>`count(*) filter (where coalesce(btrim(${L.kanal}), '') ~* ${TEST_KANAL_SQL})::int`, kaeufeTest: sql<number>`coalesce(sum(${L.kaeufe}) filter (where coalesce(btrim(${L.kanal}), '') ~* ${TEST_KANAL_SQL}), 0)::int` })
    .from(L)
    .where(eq(L.tenantId, tenantId));
  const eing = await eingaengeZu(tenantId, [...new Set(rows.map((r) => r.eingangId).filter((x): x is string => Boolean(x)))]);
  const deals: StatDeal[] = rows.map((z) => {
    const e = z.eingangId ? eing.get(z.eingangId) : undefined;
    return { gepostetAm: z.gepostetAm, kanal: kanalName(z.kanal), ampel: z.ampel ?? (e?.ampel as StatDeal["ampel"]) ?? null, reaktionen: reaktionenVon(z).reaktionen, kaeufe: z.kaeufe, gekauft: gekauftVon(z, e), realerRoi: e?.ergebnis?.realerRoi ?? null, marke: z.keepa?.marke ?? null, kategorie: z.keepa?.kategorie ?? null, titel: z.titel };
  });
  const nurKaufzeichen = rows.some((z) => reaktionenVon(z).nurKaufzeichen);
  const gesamt = (g?.n ?? 0) - (o.mitTest ? 0 : (g?.test ?? 0));
  // B20.2: „Anteil grün“ aus derselben Zählbasis wie Lugru-Seite, Trefferquote und Deal-Eingang (im Eingang mit Ampel).
  const { lugruZaehlung, ZAEHLBASIS } = await import("./historie");
  const zl = await lugruZaehlung(tenantId, { von, bis, mitTest: o.mitTest });
  return {
    ...lugruStatistik(deals, von, bis),
    anteilGruen: zl.anteilGruen,
    mitAmpel: zl.basis,
    gruen: zl.gruen,
    zaehlbasis: ZAEHLBASIS,
    /** Alle Deals seit dem ersten Post (Zeitraum oben gilt nur für die übrigen Zahlen). */
    gesamt: { deals: gesamt, seit: g?.erster ? new Date(g.erster).toISOString().slice(0, 10) : null, gruppenKaeufe: (g?.kaeufe ?? 0) - (o.mitTest ? 0 : (g?.kaeufeTest ?? 0)), testAusgeblendet: o.mitTest ? 0 : (g?.test ?? 0) },
    reaktionenHinweis: nurKaufzeichen ? NUR_KAUFZEICHEN : null,
  };
}

/** Kanäle (für den Filter), Namen ohne Leerzeichen am Rand; Testkanäle nur mit mitTest. */
export async function lugruKanalNamen(tenantId: string, o: { mitTest?: boolean } = {}): Promise<string[]> {
  const rows = await db.selectDistinct({ k: L.kanal }).from(L).where(and(eq(L.tenantId, tenantId), ...(o.mitTest ? [] : [ohneTest()])));
  return [...new Set(rows.map((r) => kanalName(r.k)).filter((x): x is string => Boolean(x)))].sort();
}
