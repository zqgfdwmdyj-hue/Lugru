import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { listingsConn } from "@/lib/integrations/clients/amazon";
import { MARKTPLATZ_IDS, type Land } from "@/lib/amazon-markt/logic";
import { kostenJeSku } from "@/lib/money/kapital-service";
import { getSettings } from "@/lib/settings";
import { b2bSummen, staffelPatch, staffelUploadDatei, staffelVorschlag, waehlePerioden, type B2bZeile, type Periode, type Stufe } from "./logic";
export type { Periode };

// Amazon Business: Auswertung je Zeitraum, Staffelpreis-Vorschläge mit Gewinnprüfung, Freigabe, Upload-Datei und
// Übertragung über die Schnittstelle (nur freigegebene, nur auf ausdrücklichen Klick).

const P = schema.amazonB2bPerioden;
const S = schema.amazonStaffelpreise;

export async function b2bPerioden(tenantId: string): Promise<Periode[]> {
  const rows = await db.selectDistinct({ land: P.land, von: P.von, bis: P.bis, quelle: P.quelle, abgerufenAm: P.abgerufenAm }).from(P).where(eq(P.tenantId, tenantId)).orderBy(desc(P.bis));
  return [...new Map(rows.map((r) => [`${r.land}|${r.von}|${r.bis}`, r])).values()];
}

export async function b2bAuswertung(tenantId: string, o: { zeitraum?: string; land?: string } = {}) {
  const alle = await b2bPerioden(tenantId);
  const gewaehlt = waehlePerioden(alle, o.zeitraum, o.land);
  const laender = [];
  for (const p of gewaehlt) {
    const zeilen = await db.select().from(P).where(and(eq(P.tenantId, tenantId), eq(P.land, p.land), eq(P.von, p.von), eq(P.bis, p.bis)));
    const z: (B2bZeile & { land: string })[] = zeilen.map((r) => ({ land: r.land, asin: r.asin, sku: r.sku, titel: r.titel, sitzungen: r.sitzungen, sitzungenB2b: r.sitzungenB2b, einheiten: r.einheiten, einheitenB2b: r.einheitenB2b, umsatz: r.umsatz, umsatzB2b: r.umsatzB2b, buybox: r.buybox, buyboxB2b: r.buyboxB2b }));
    z.sort((a, b) => (b.umsatzB2b ?? 0) - (a.umsatzB2b ?? 0) || (b.sitzungenB2b ?? 0) - (a.sitzungenB2b ?? 0));
    laender.push({ periode: p, summen: b2bSummen(z), zeilen: z });
  }
  const gesamt = b2bSummen(laender.flatMap((l) => l.zeilen));
  return { perioden: alle, laender, gesamt };
}

export type StaffelKandidat = {
  land: string;
  sku: string;
  asin: string;
  titel: string | null;
  preis: number | null;
  preisQuelle: string;
  sitzungenB2b: number | null;
  einheitenB2b: number | null;
  vorschlag: ReturnType<typeof staffelVorschlag> | null;
  gespeichert: typeof schema.amazonStaffelpreise.$inferSelect | null;
};

/** Staffelpreis-Vorschläge für ein Land: Artikel mit Verkäufen oder B2B-Besuchen im jüngsten Zeitraum. */
export async function staffelKandidaten(tenantId: string, land: string): Promise<StaffelKandidat[]> {
  const [p] = waehlePerioden(await b2bPerioden(tenantId), "letzte", land);
  const gespeichert = await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.land, land)));
  if (!p) return gespeichert.map((g) => ({ land, sku: g.sku, asin: g.asin ?? "", titel: g.titel, preis: g.businessPreis, preisQuelle: "gespeichert", sitzungenB2b: null, einheitenB2b: null, vorschlag: null, gespeichert: g }));
  const zeilen = (await db.select().from(P).where(and(eq(P.tenantId, tenantId), eq(P.land, land), eq(P.von, p.von), eq(P.bis, p.bis)))).filter((z) => (z.einheiten ?? 0) > 0 || (z.sitzungenB2b ?? 0) > 0);
  const asins = zeilen.map((z) => z.asin);
  const [listungen, sbProdukte, settings] = await Promise.all([
    asins.length ? db.select({ sku: schema.amazonListungen.sku, asin: schema.amazonListungen.asin, preis: schema.amazonListungen.preis, versand: schema.amazonListungen.versand, titel: schema.amazonListungen.titel }).from(schema.amazonListungen).where(and(eq(schema.amazonListungen.tenantId, tenantId), eq(schema.amazonListungen.land, land), inArray(schema.amazonListungen.asin, asins))) : [],
    asins.length ? db.select({ sku: schema.sellerboardProducts.sku, asin: schema.sellerboardProducts.asin, price: schema.sellerboardProducts.price, name: schema.sellerboardProducts.name }).from(schema.sellerboardProducts).where(and(eq(schema.sellerboardProducts.tenantId, tenantId), inArray(schema.sellerboardProducts.asin, asins))) : [],
    getSettings(tenantId),
  ]);
  const skuVon = (z: (typeof zeilen)[number]) => z.sku ?? listungen.find((l) => l.asin === z.asin)?.sku ?? sbProdukte.find((s) => s.asin === z.asin)?.sku ?? null;
  const mitSku = zeilen.map((z) => ({ z, sku: skuVon(z) })).filter((x): x is { z: (typeof zeilen)[number]; sku: string } => !!x.sku);
  const kosten = await kostenJeSku(tenantId, mitSku.map((x) => x.sku));
  const regel = { stufen: settings.amazonBusiness.stufen, rabatte: settings.amazonBusiness.rabatte, minGewinn: settings.amazonBusiness.minGewinn };
  const out: StaffelKandidat[] = mitSku.map(({ z, sku }) => {
    const l = listungen.find((x) => x.sku === sku);
    const sb = sbProdukte.find((x) => x.sku === sku);
    const avg = z.umsatz && z.einheiten ? Math.round((z.umsatz / z.einheiten) * 100) / 100 : null;
    const preis = l?.preis ?? sb?.price ?? avg;
    const preisQuelle = l?.preis ? "Angebot bei Amazon" : sb?.price ? "sellerboard" : avg ? "Ø Verkaufspreis" : "–";
    const k = kosten.get(sku);
    return {
      land,
      sku,
      asin: z.asin,
      titel: z.titel ?? l?.titel ?? sb?.name ?? null,
      preis,
      preisQuelle,
      sitzungenB2b: z.sitzungenB2b,
      einheitenB2b: z.einheitenB2b,
      vorschlag: preis && k ? staffelVorschlag(preis, k, regel) : null,
      gespeichert: gespeichert.find((g) => g.sku === sku) ?? null,
    };
  });
  // gespeicherte, die gerade nicht im Bericht sind, trotzdem zeigen
  for (const g of gespeichert) if (!out.some((o) => o.sku === g.sku)) out.push({ land, sku: g.sku, asin: g.asin ?? "", titel: g.titel, preis: g.businessPreis, preisQuelle: "gespeichert", sitzungenB2b: null, einheitenB2b: null, vorschlag: null, gespeichert: g });
  return out.sort((a, b) => (b.sitzungenB2b ?? 0) - (a.sitzungenB2b ?? 0));
}

/** Vorschlag übernehmen (Status „vorschlag“). Bereits übertragene/freigegebene gehen bei Änderung zurück auf Vorschlag. */
export async function staffelSpeichern(tenantId: string, land: string, k: { sku: string; asin: string; titel: string | null; businessPreis: number; stufen: Stufe[]; mindestPreis: number | null }) {
  await db
    .insert(S)
    .values({ tenantId, land, sku: k.sku, asin: k.asin, titel: k.titel, businessPreis: k.businessPreis, stufen: k.stufen, mindestPreis: k.mindestPreis, status: "vorschlag" })
    .onConflictDoUpdate({ target: [S.tenantId, S.land, S.sku], set: { asin: k.asin, titel: k.titel, businessPreis: k.businessPreis, stufen: k.stufen, mindestPreis: k.mindestPreis, status: "vorschlag", fehler: null, freigegebenVon: null, freigegebenAm: null, geaendertAm: new Date() } });
}

export async function staffelFreigeben(tenantId: string, land: string, skus: string[], von: string): Promise<number> {
  if (!skus.length) return 0;
  const r = await db.update(S).set({ status: "freigegeben", freigegebenVon: von, freigegebenAm: new Date(), fehler: null }).where(and(eq(S.tenantId, tenantId), eq(S.land, land), inArray(S.sku, skus), inArray(S.status, ["vorschlag", "fehler"]))).returning({ sku: S.sku });
  return r.length;
}

export async function staffelVerwerfen(tenantId: string, land: string, sku: string) {
  await db.delete(S).where(and(eq(S.tenantId, tenantId), eq(S.land, land), eq(S.sku, sku)));
}

/** Upload-Datei (Tabulator) mit allen freigegebenen Staffelpreisen eines Landes. */
export async function staffelDatei(tenantId: string, land: string): Promise<{ text: string; anzahl: number }> {
  const rows = await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.land, land), inArray(S.status, ["freigegeben", "uebertragen"])));
  return { text: staffelUploadDatei(rows.map((r) => ({ sku: r.sku, businessPreis: r.businessPreis, stufen: r.stufen }))), anzahl: rows.length };
}

/**
 * Freigegebene Staffelpreise über die Listings-Schnittstelle setzen: erst Prüflauf (VALIDATION_PREVIEW), nur ohne
 * Fehler echt übertragen. Ergebnis je SKU im Status („uebertragen“ / „fehler“ mit Meldung).
 */
export async function staffelUebertragen(tenantId: string, land: string, skus: string[]): Promise<{ ok: number; fehler: number }> {
  const rows = await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.land, land), inArray(S.sku, skus.length ? skus : ["-"]), eq(S.status, "freigegeben")));
  if (!rows.length) return { ok: 0, fehler: 0 };
  const c = await listingsConn(tenantId, "haupt");
  const mp = MARKTPLATZ_IDS[land as Land] ?? c.marketplaceId;
  let ok = 0;
  let fehler = 0;
  for (const r of rows) {
    const path = `/listings/2021-08-01/items/${encodeURIComponent(c.sellerId)}/${encodeURIComponent(r.sku)}`;
    try {
      if (r.businessPreis === null) throw new Error("Business-Preis fehlt");
      const item = await c.call<{ summaries?: { productType?: string }[] }>("GET", `${path}?marketplaceIds=${mp}&includedData=summaries`);
      const productType = item.summaries?.[0]?.productType;
      if (!productType) throw new Error("Angebot in diesem Land nicht gefunden");
      const body = { productType, patches: staffelPatch(mp, r.businessPreis, r.stufen) };
      const check = await c.call<{ status?: string; issues?: { severity?: string; message?: string }[] }>("PATCH", `${path}?marketplaceIds=${mp}&mode=VALIDATION_PREVIEW`, body);
      const err = (check.issues ?? []).filter((i) => i.severity === "ERROR").map((i) => i.message).join("; ");
      if (err || (check.status && check.status !== "VALID" && check.status !== "ACCEPTED")) throw new Error(err || `Prüfung: ${check.status}`);
      const res = await c.call<{ status?: string; issues?: { severity?: string; message?: string }[] }>("PATCH", `${path}?marketplaceIds=${mp}`, body);
      if (res.status && res.status !== "ACCEPTED") throw new Error((res.issues ?? []).filter((i) => i.severity === "ERROR").map((i) => i.message).join("; ") || `Amazon-Status ${res.status}`);
      await db.update(S).set({ status: "uebertragen", uebertragenAm: new Date(), fehler: null }).where(and(eq(S.tenantId, tenantId), eq(S.land, land), eq(S.sku, r.sku)));
      ok++;
    } catch (e) {
      await db.update(S).set({ status: "fehler", fehler: (e instanceof Error ? e.message : String(e)).slice(0, 400) }).where(and(eq(S.tenantId, tenantId), eq(S.land, land), eq(S.sku, r.sku)));
      fehler++;
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return { ok, fehler };
}
