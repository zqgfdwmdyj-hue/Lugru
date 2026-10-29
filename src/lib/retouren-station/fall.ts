import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { RetourenMedienArt, RetourenVerbleib } from "@/db/schema";
import { askClaude, modelFor, SMART_MODEL } from "@/lib/ai/claude";
import { pickOriginLot } from "@/lib/costs/returns";
import { todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { kleinSchluessel, loeschen, teilSchluessel } from "@/lib/medien/ablage";
import { anspruchsArt, BEFUND_TEXT, fallDateien, naechsterZaehler, retSku, verbleibVorschlag } from "./logic";
import { BEFUND_EN, falltextVorlage, FalltextSchema, jsonAus, promptFalltext, type FallFakten, type ProduktKi } from "./ki";
import { entscheidungFuer } from "./service";

// Nach „Fertig“: Entscheidung frisch rechnen, Falltexte (DE/EN), RET-Chargen mit geerbtem EK, Ansprüche anlegen.
// Außerdem: Fälle für die Anspruchs-Erkennung, Fall-Paket für die Seite, Aufräumen nach der Aufbewahrungsfrist.

const P = schema.retourenPruefungen;
const Pos = schema.retourenPositionen;
const M = schema.retourenMedien;
const OFFEN = ["detected", "queued", "submitted", "partial", "escalated"] as ("detected" | "queued" | "submitted" | "partial" | "escalated")[];

/** Fotos eines Artikels fürs Fall-Paket: Etikett/Lieferschein vom Paket, Produkt/Inhalt vom Artikel. */
export async function fallMedien(tenantId: string, pruefungId: string, positionId: string) {
  const med = await db
    .select()
    .from(M)
    .where(and(eq(M.tenantId, tenantId), eq(M.pruefungId, pruefungId), isNull(M.geloeschtAm), or(eq(M.positionId, positionId), and(isNull(M.positionId), inArray(M.art, ["etikett", "lieferschein", "video"])))))
    .orderBy(asc(M.aufgenommenAm));
  return { dateien: fallDateien(med), video: med.find((m) => m.art === "video") ?? null };
}

function fakten(x: typeof Pos.$inferSelect, remissionId: string | null, fotos: string[], en = false): FallFakten {
  return {
    lpn: x.lpn,
    bestellnummer: x.bestellnummer ?? "–",
    asin: x.asin,
    sku: x.sku,
    titel: x.titel,
    rueckgabeDatum: x.rueckgabeDatum,
    erstattet: x.erstattetBetrag,
    rueckgabegrund: x.rueckgabegrund,
    befund: x.befund ? (en ? BEFUND_EN[x.befund] : BEFUND_TEXT[x.befund]) : "–",
    notiz: x.notiz,
    remissionId,
    fotos,
  };
}

/** Falltext DE/EN – von der KI formuliert, sonst die Vorlage. Keine Behauptungen über Befund/Fotos hinaus. */
export async function falltextErzeugen(tenantId: string, positionId: string) {
  const [x] = await db.select().from(Pos).where(and(eq(Pos.tenantId, tenantId), eq(Pos.id, positionId)));
  if (!x || !x.bestellnummer) return null;
  const [p] = await db.select({ remissionId: P.remissionId }).from(P).where(eq(P.id, x.pruefungId));
  const { dateien } = await fallMedien(tenantId, x.pruefungId, x.id);
  const f = fakten(x, p?.remissionId ?? null, dateien.map((d) => d.name));
  let text = falltextVorlage(f);
  const vorlageEn = falltextVorlage(fakten(x, p?.remissionId ?? null, f.fotos, true));
  text = { ...text, text_en: vorlageEn.text_en };
  const ai = await getIntegration(tenantId, "anthropic");
  if (ai?.apiKey) {
    const model = process.env.RETOUREN_KI_MODELL?.trim() || (ai.model?.trim() ? modelFor(ai, "creative") : SMART_MODEL);
    const r = await askClaude(ai.apiKey, promptFalltext(f), { model, task: "simple", maxTokens: 2500, timeoutMs: 90_000 }).catch(() => null);
    const k = r ? jsonAus(r.text, FalltextSchema) : null;
    if (k) text = k;
  }
  await db.update(Pos).set({ fallBetreff: text.betreff, fallTextDe: text.text_de, fallTextEn: text.text_en, updatedAt: new Date() }).where(eq(Pos.id, x.id));
  return text;
}

/** RET-Charge für einen Artikel, der wieder verkauft wird – EK von der Ursprungs-Charge (nicht 0,01 €). */
export async function retChargeAnlegen(tenantId: string, x: typeof Pos.$inferSelect, verbleib: RetourenVerbleib) {
  if (!x.asin || x.retChargeId) return null;
  const L = schema.lots;
  const [prod] = await db.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.tenantId, tenantId), eq(schema.products.asin, x.asin)));
  if (!prod) return null;
  // Gibt es die RET-SKU zu dieser LPN schon (z. B. aus Arbitrage One importiert)? Dann die nehmen.
  if (x.lpn) {
    const [vorhanden] = await db.select({ id: L.id, sku: L.sku }).from(L).where(and(eq(L.tenantId, tenantId), sql`lower(${L.returnLpn}) = lower(${x.lpn})`));
    if (vorhanden) {
      await db.update(Pos).set({ retSku: vorhanden.sku, retChargeId: vorhanden.id, updatedAt: new Date() }).where(eq(Pos.id, x.id));
      return vorhanden;
    }
  }
  const lots = await db.select({ id: L.id, sku: L.sku, kind: L.kind, purchaseDate: L.purchaseDate, unitCostNet: L.unitCostNet }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.productId, prod.id)));
  const zaehler = naechsterZaehler(lots.filter((l) => l.kind === "return").map((l) => l.sku));
  const heute = todayIso();
  const kanal = verbleib === "fba" ? "FBA" : "FBM";
  const sku = retSku({ zaehler, lpn: x.lpn, fnsku: x.fnsku, datum: heute, kanal });
  const origin = pickOriginLot(x.rueckgabeDatum ?? heute, lots.filter((l) => l.kind === "purchase").map((l) => ({ id: l.id, purchaseDate: l.purchaseDate, unitCostNet: l.unitCostNet === null ? null : Number(l.unitCostNet) })));
  const [neu] = await db
    .insert(L)
    .values({
      tenantId,
      productId: prod.id,
      sku,
      kind: "return",
      skuSchema: "RET",
      fnsku: x.fnsku,
      quantity: 1,
      returnLpn: x.lpn,
      returnCode: String(zaehler),
      returnChannel: kanal,
      returnDate: heute,
      unitCostNet: origin ? String(origin.unitCostNet) : null,
      unitCostSource: origin ? "inherited" : null,
      parentLotId: origin?.lotId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: L.id, sku: L.sku });
  if (neu) await db.update(Pos).set({ retSku: neu.sku, retChargeId: neu.id, updatedAt: new Date() }).where(eq(Pos.id, x.id));
  return neu ?? null;
}

/** Nach „Fertig“ (im Hintergrund): Entscheidungen, Falltexte, RET-Chargen, Ansprüche. */
export async function nachAbschluss(tenantId: string, pruefungId: string) {
  const pos = await db.select().from(Pos).where(and(eq(Pos.tenantId, tenantId), eq(Pos.pruefungId, pruefungId))).orderBy(asc(Pos.nr));
  let faelle = 0;
  for (const x of pos) {
    if (!x.befund) continue;
    const { entscheidung, erstattet, gezahlt } = await entscheidungFuer(tenantId, x, x.befund);
    await db.update(Pos).set({ entscheidung, erstattetBetrag: erstattet ?? x.erstattetBetrag, amazonGezahlt: gezahlt, updatedAt: new Date() }).where(eq(Pos.id, x.id));
    if (entscheidung === "fall") {
      faelle++;
      if (!x.fallTextDe) await falltextErzeugen(tenantId, x.id).catch((e) => console.error("[Retouren-Station] Falltext:", e instanceof Error ? e.message : e));
    }
    const ki = x.kiEinschaetzung && !("status" in x.kiEinschaetzung) ? (x.kiEinschaetzung as ProduktKi) : null;
    const verbleib = x.verbleib ?? verbleibVorschlag(x.befund, { gebrauchsspuren: ki?.gebrauchsspuren, grund: x.rueckgabegrund });
    if (verbleib && ["fba", "b_ware", "ebay"].includes(verbleib)) {
      if (!x.verbleib) await db.update(Pos).set({ verbleib }).where(eq(Pos.id, x.id));
      await retChargeAnlegen(tenantId, { ...x, verbleib }, verbleib).catch((e) => console.error("[Retouren-Station] RET-Charge:", e instanceof Error ? e.message : e));
    }
  }
  if (faelle) {
    const { syncClaims } = await import("@/lib/claims/service");
    await syncClaims(tenantId);
    await anspruecheVerknuepfen(tenantId);
  }
}

// ---- Ansprüche -------------------------------------------------------------------------------------

export type StationFall = {
  id: string;
  key: string;
  type: "return_wrong_item" | "return_condition";
  orderId: string;
  sku: string | null;
  fnsku: string | null;
  asin: string | null;
  lpn: string | null;
  title: string | null;
  returnDate: string | null;
  inspectedAt: string;
  refund: number;
  befund: string;
  notiz: string | null;
  remissionId: string | null;
};

/**
 * Fälle aus der Station für die Anspruchs-Erkennung. Die Entscheidung wird frisch gerechnet (Erstattung an den
 * Kunden kann später kommen, Amazon kann inzwischen gezahlt haben) und gespeichert.
 */
export async function stationFaelle(tenantId: string): Promise<StationFall[]> {
  const rows = await db
    .select({ x: Pos, remissionId: P.remissionId })
    .from(Pos)
    .innerJoin(P, eq(P.id, Pos.pruefungId))
    .where(and(eq(Pos.tenantId, tenantId), eq(P.status, "abgeschlossen"), isNotNull(Pos.befund), ne(Pos.befund, "ok"), isNotNull(Pos.bestellnummer), inArray(Pos.entscheidung, ["fall", "warten", "laeuft_schon"])));
  const out: StationFall[] = [];
  for (const { x, remissionId } of rows) {
    const { entscheidung, erstattet, gezahlt } = await entscheidungFuer(tenantId, x, x.befund);
    if (entscheidung !== x.entscheidung || erstattet !== x.erstattetBetrag || gezahlt !== x.amazonGezahlt) {
      await db.update(Pos).set({ entscheidung, erstattetBetrag: erstattet ?? x.erstattetBetrag, amazonGezahlt: gezahlt, updatedAt: new Date() }).where(eq(Pos.id, x.id));
    }
    if (entscheidung !== "fall" || erstattet === null) continue;
    out.push({
      id: x.id,
      key: `station:${x.id}`,
      type: anspruchsArt(x.befund!),
      orderId: x.bestellnummer!,
      sku: x.sku,
      fnsku: x.fnsku,
      asin: x.asin,
      lpn: x.lpn,
      title: x.titel,
      returnDate: x.rueckgabeDatum,
      inspectedAt: x.updatedAt.toISOString().slice(0, 10),
      refund: erstattet,
      befund: BEFUND_TEXT[x.befund!],
      notiz: x.notiz,
      remissionId,
    });
  }
  return out;
}

/** Positionen mit „ihrem“ Anspruch verknüpfen (eigener Schlüssel oder zusammengeführt mit dem Retouren-Abgleich). */
export async function anspruecheVerknuepfen(tenantId: string) {
  const C = schema.claims;
  const offen = await db.select({ id: Pos.id, order: Pos.bestellnummer, sku: Pos.sku, befund: Pos.befund }).from(Pos).where(and(eq(Pos.tenantId, tenantId), eq(Pos.entscheidung, "fall"), isNull(Pos.anspruchId)));
  for (const x of offen) {
    const [eigen] = await db.select({ id: C.id, key: C.detectionKey }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.detectionKey, `station:${x.id}`)));
    const c =
      eigen ??
      (
        await db
          .select({ id: C.id, key: C.detectionKey })
          .from(C)
          .where(and(eq(C.tenantId, tenantId), eq(C.reference, x.order!), inArray(C.type, ["return_wrong_item", "return_damaged", "return_condition"]), x.sku ? or(eq(C.sku, x.sku), isNull(C.sku)) : undefined))
          .orderBy(desc(C.createdAt))
          .limit(1)
      )[0];
    if (c) await db.update(Pos).set({ anspruchId: c.id, anspruchSchluessel: c.key, updatedAt: new Date() }).where(eq(Pos.id, x.id));
  }
}

// ---- Fall-Paket und Listen --------------------------------------------------------------------------

export async function fallPaket(tenantId: string, positionId: string) {
  const [row] = await db.select({ x: Pos, p: P }).from(Pos).innerJoin(P, eq(P.id, Pos.pruefungId)).where(and(eq(Pos.tenantId, tenantId), eq(Pos.id, positionId)));
  if (!row) return null;
  const { dateien, video } = await fallMedien(tenantId, row.p.id, row.x.id);
  const [claim] = row.x.anspruchId ? await db.select().from(schema.claims).where(and(eq(schema.claims.tenantId, tenantId), eq(schema.claims.id, row.x.anspruchId))) : [];
  return { position: row.x, pruefung: row.p, dateien, video, anspruch: claim ?? null };
}

export type FallZeile = { positionId: string; pruefungId: string; datum: Date; titel: string | null; lpn: string | null; bestellnummer: string | null; befund: string | null; entscheidung: string | null; betrag: number | null; frist: string | null; status: string | null; fallnummer: string | null; anspruchId: string | null; ki_abweichung: boolean };

/** Prüfungen/Fälle mit Filter – für die Liste und das Claude-Werkzeug. */
export async function retourenFaelle(tenantId: string, f: { status: "fall_bereit" | "eingereicht" | "abgeschlossen" | "alle"; von?: string | null; bis?: string | null; suche?: string | null; limit?: number }): Promise<FallZeile[]> {
  const C = schema.claims;
  const q = f.suche?.trim();
  const rows = await db
    .select({ x: Pos, status: C.status, frist: C.deadline, fallnummer: C.amazonCaseId, betrag: C.expectedAmount })
    .from(Pos)
    .leftJoin(C, eq(C.id, Pos.anspruchId))
    .where(
      and(
        eq(Pos.tenantId, tenantId),
        f.status === "fall_bereit" ? and(eq(Pos.entscheidung, "fall"), or(isNull(C.status), inArray(C.status, ["detected", "queued"]))) : undefined,
        f.status === "eingereicht" ? inArray(C.status, ["submitted", "partial", "escalated"]) : undefined,
        f.status === "abgeschlossen" ? inArray(C.status, ["reimbursed", "rejected", "dismissed"]) : undefined,
        f.status === "alle" ? isNotNull(Pos.befund) : undefined,
        f.von ? sql`${Pos.createdAt} >= ${f.von}::date` : undefined,
        f.bis ? sql`${Pos.createdAt} < (${f.bis}::date + 1)` : undefined,
        q ? or(ilike(Pos.lpn, `%${q}%`), ilike(Pos.bestellnummer, `%${q}%`), ilike(Pos.sku, `%${q}%`), ilike(Pos.titel, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(sql`${C.deadline} asc nulls last`, desc(Pos.erstattetBetrag), desc(Pos.createdAt))
    .limit(f.limit ?? 200);
  return rows.map((r) => ({
    positionId: r.x.id,
    pruefungId: r.x.pruefungId,
    datum: r.x.createdAt,
    titel: r.x.titel,
    lpn: r.x.lpn,
    bestellnummer: r.x.bestellnummer,
    befund: r.x.befund,
    entscheidung: r.x.entscheidung,
    betrag: r.betrag ?? r.x.erstattetBetrag,
    frist: r.frist,
    status: r.status,
    fallnummer: r.fallnummer,
    anspruchId: r.x.anspruchId,
    ki_abweichung: r.x.kiAbweichung,
  }));
}

// ---- Aufbewahrung -----------------------------------------------------------------------------------

/**
 * Fotos und Videos nach der Aufbewahrungsfrist löschen – außer, ein Artikel des Pakets hat noch einen offenen
 * Anspruch (dann bleiben sie als Beweis, bis der Fall erledigt ist).
 */
export async function medienAufraeumen(heute = todayIso()) {
  const C = schema.claims;
  const faellig = await db.select().from(M).where(and(isNull(M.geloeschtAm), isNotNull(M.loeschenAb), lte(M.loeschenAb, heute))).limit(2000);
  if (!faellig.length) return { geloescht: 0, behalten: 0 };
  const pruefungen = [...new Set(faellig.map((m) => m.pruefungId))];
  const gesperrt = new Set(
    (
      await db
        .select({ id: Pos.pruefungId })
        .from(Pos)
        .innerJoin(C, eq(C.id, Pos.anspruchId))
        .where(and(inArray(Pos.pruefungId, pruefungen), inArray(C.status, OFFEN)))
    ).map((r) => r.id),
  );
  let geloescht = 0;
  for (const m of faellig) {
    if (gesperrt.has(m.pruefungId)) continue;
    if (m.art === "video") for (let i = 1; i <= m.teile; i++) await loeschen(teilSchluessel(m.pfad, i));
    else {
      await loeschen(m.pfad);
      await loeschen(kleinSchluessel(m.pfad));
    }
    await db.update(M).set({ geloeschtAm: new Date() }).where(eq(M.id, m.id));
    geloescht++;
  }
  return { geloescht, behalten: faellig.length - geloescht };
}

/** Für Seiten: Medium eines Mandanten (ohne gelöschte). */
export async function medium(tenantId: string, id: string) {
  const [m] = await db.select().from(M).where(and(eq(M.tenantId, tenantId), eq(M.id, id), isNull(M.geloeschtAm)));
  return m ?? null;
}

export const ART_LABEL: Record<RetourenMedienArt, string> = { etikett: "Versandetikett", lieferschein: "Lieferschein", produkt_lpn: "Produkt mit LPN", inhalt: "Inhalt", video: "Video" };

export async function einstellungenStation(tenantId: string) {
  return (await getSettings(tenantId)).retourenStation;
}
