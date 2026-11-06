import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { storeFile } from "@/lib/orders/service";
import { getSettings } from "@/lib/settings";
import { buildReceiptPdf } from "@/lib/invoices/receipt-logic";
import {
  ampelVon,
  besteZuordnung,
  faelligkeit,
  gehoertZumVorigen,
  namensNaehe,
  nummerNorm,
  PDF_STAPEL_PROMPT,
  seitenZusammen,
  stapelAntwortLesen,
  stapelSumme,
  STATION_PROMPT,
  stationAntwortLesen,
  suchText,
  type Ampel,
  type BelegFakten,
  type Kandidat,
} from "./logic";

// Bauauftrag Rechnungsstation: Blätter von der Kamera bzw. PDF-Stapel vom Einzugsscanner erfassen → KI liest →
// Ampel, Mehrseiter, Duplikate → Zuordnung zu Einkäufen (ArbitrageOne-Bestellungen, Deal-Käufe, B2B-Deals) und an den
// ASIN hängen → an Stotax (grün/gelb sofort, rot erst nach Prüfung) und in den Drive-Belegordner. Status je Beleg:
// erfasst (createdAt) → zugeordnet (zugeordnetAm) → an Stotax übertragen (stotaxSentAt).

const I = schema.invoices;
const S = schema.belegStapel;
export type Wer = { userId: string | null; name: string };
export const STATION_QUELLEN = ["station", "ordner"] as const;

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const zeitKurz = (d: Date) => d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

// ── Stapel ───────────────────────────────────────────────────────────────────

export async function stapelNeu(tenantId: string, wer: Wer, quelle: "kamera" | "ordner" | "upload", name?: string): Promise<string> {
  const [r] = await db.insert(S).values({ tenantId, quelle, name: (name ?? `Kamera ${zeitKurz(new Date())}`).slice(0, 120), gestartetVon: wer.userId, gestartetVonName: wer.name }).returning({ id: S.id });
  return r.id;
}

/** Offener Kamera-Stapel dieser Person (letzte 12 Stunden) – sonst ein neuer. */
export async function kameraStapel(tenantId: string, wer: Wer, neu = false): Promise<string> {
  if (!neu && wer.userId) {
    const [s] = await db
      .select({ id: S.id })
      .from(S)
      .where(and(eq(S.tenantId, tenantId), eq(S.quelle, "kamera"), eq(S.gestartetVon, wer.userId), isNull(S.beendetAm), gte(S.createdAt, new Date(Date.now() - 12 * 3_600_000))))
      .orderBy(desc(S.createdAt))
      .limit(1);
    if (s) return s.id;
  }
  return stapelNeu(tenantId, wer, "kamera");
}

// ── KI (nacheinander je Stapel, damit Mehrseiter in der Reihenfolge der Aufnahme erkannt werden) ──────────────────

const ketten = new Map<string, Promise<unknown>>();
function einreihen(key: string, fn: () => Promise<unknown>): Promise<unknown> {
  const p = (ketten.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn).catch((e) => console.error("[Rechnungsstation]", e instanceof Error ? e.message : e));
  ketten.set(key, p);
  void p.finally(() => { if (ketten.get(key) === p) ketten.delete(key); });
  return p;
}
/** Für Prüfungen und das Stapelende: warten, bis alle Belege eines Stapels gelesen sind. */
export const stapelFertigGelesen = (stapelId: string) => ketten.get(stapelId) ?? Promise.resolve();

async function ki(tenantId: string, inhalt: Parameters<typeof askClaude>[1], maxTokens: number): Promise<string | null> {
  const cfg = await getIntegration(tenantId, "anthropic");
  if (!cfg?.apiKey) return null;
  const r = await askClaude(cfg.apiKey, inhalt, { model: modelFor(cfg, "simple"), task: "simple", maxTokens, timeoutMs: 180_000 });
  return r.text;
}

const bildTyp = (t: string) => (/png/i.test(t) ? "image/png" : "image/jpeg");

// ── Kamera: Blatt aufnehmen ─────────────────────────────────────────────────

export class StationFehler extends Error {}

/**
 * Ein Blatt von der Kamera: Original (volle Auflösung) und entzerrtes Bild ablegen, PDF bauen, Beleg anlegen
 * (Status „erfasst“). Die KI liest im Hintergrund – die Kachel aktualisiert sich über `stapelStand`.
 */
export async function blattAufnehmen(tenantId: string, wer: Wer, b: { stapelId: string; bild: Buffer; bildTyp: string; original?: Buffer | null; originalTyp?: string; aufgenommenAm?: Date }): Promise<{ id: string; duplikat: boolean }> {
  const [st] = await db.select({ id: S.id, beendetAm: S.beendetAm }).from(S).where(and(eq(S.tenantId, tenantId), eq(S.id, b.stapelId))).limit(1);
  if (!st) throw new StationFehler("Stapel nicht gefunden.");
  if (!b.bild.length || b.bild.length > 25_000_000) throw new StationFehler("Bild fehlt oder ist zu groß.");
  const hash = sha(b.bild);
  const [schon] = await db.select({ id: I.id }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.source, "station"), eq(I.externalId, hash))).limit(1);
  if (schon) return { id: schon.id, duplikat: true };
  const typ = bildTyp(b.bildTyp);
  const jetzt = b.aufgenommenAm ?? new Date();
  const stempel = jetzt.toISOString().replace(/[:.]/g, "-");
  const bildId = await storeFile(tenantId, `Blatt_${stempel}.${typ === "image/png" ? "png" : "jpg"}`, typ, b.bild);
  const originalId = b.original?.length ? await storeFile(tenantId, `Original_${stempel}.${bildTyp(b.originalTyp ?? "") === "image/png" ? "png" : "jpg"}`, bildTyp(b.originalTyp ?? ""), b.original) : bildId;
  let pdf: Uint8Array;
  try {
    pdf = await buildReceiptPdf([{ bytes: b.bild, type: typ }], { title: `Beleg ${jetzt.toISOString().slice(0, 10)}` });
  } catch {
    throw new StationFehler("Das Bild ließ sich nicht lesen – bitte noch einmal auflegen.");
  }
  const name = `Beleg_${jetzt.toISOString().slice(0, 10)}_${stempel.slice(11, 19)}.pdf`;
  const fileId = await storeFile(tenantId, name, "application/pdf", Buffer.from(pdf));
  const [row] = await db
    .insert(I)
    .values({ tenantId, source: "station", externalId: hash, fileName: name, fileId, kind: "unknown", status: "new", stapelId: b.stapelId, bildFileIds: [originalId, bildId], aufgenommenAm: jetzt, seiten: 1 })
    .returning({ id: I.id });
  void einreihen(b.stapelId, () => blattLesen(tenantId, row.id));
  if (st.beendetAm) await db.update(S).set({ beendetAm: null, updatedAt: new Date() }).where(eq(S.id, b.stapelId));
  return { id: row.id, duplikat: false };
}

async function dateiDaten(tenantId: string, id: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const [f] = await db.select({ data: schema.files.data, mimeType: schema.files.mimeType }).from(schema.files).where(and(eq(schema.files.tenantId, tenantId), eq(schema.files.id, id))).limit(1);
  return f ? { data: Buffer.from(f.data), mimeType: f.mimeType } : null;
}

/** Fakten aus einer gespeicherten Belegzeile (für Mehrseiter und Prüfung). */
function faktenAusZeile(r: typeof I.$inferSelect): BelegFakten {
  const art = r.docType === "quittung" ? "kassenzettel" : r.docType === "lieferschein" ? "lieferschein" : r.docType === "gutschrift" ? "gutschrift" : r.docType === "unbekannt" || r.docType === "keinbeleg" ? "sonstiges" : "rechnung";
  return {
    art,
    lieferant: r.vendor,
    nummer: r.invoiceNumber,
    bestellnummer: r.orderNumber,
    datum: r.invoiceDate,
    netto: r.totalNet,
    brutto: r.totalGross,
    ust: r.ust,
    positionen: r.positionen,
    zahlungszielTage: null,
    faelligAm: r.faelligAm,
    zahlungsart: r.zahlungsart,
    folgeseite: false,
    unsicher: r.pruefGruende.filter((g) => g.endsWith(" unsicher")).map((g) => g.replace(/ unsicher$/, "")),
  };
}

/** KI liest ein Kamera-Blatt; Folgeseite (≤ 5 s, gleiche Rechnungsnummer) wird an den vorigen Beleg gehängt. */
export async function blattLesen(tenantId: string, id: string): Promise<void> {
  const [r] = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id))).limit(1);
  if (!r) return;
  const bildId = r.bildFileIds[1] ?? r.bildFileIds[0];
  const bild = bildId ? await dateiDaten(tenantId, bildId) : null;
  let fakten: BelegFakten | null = null;
  if (bild) {
    const text = await ki(tenantId, [{ type: "image", source: { type: "base64", media_type: bildTyp(bild.mimeType), data: bild.data.toString("base64") } }, { type: "text", text: STATION_PROMPT }], 2500).catch(() => null);
    fakten = text ? stationAntwortLesen(text) : null;
  }
  // Mehrseiter: voriges Blatt desselben Stapels
  if (fakten && r.stapelId && r.aufgenommenAm) {
    const [vor] = await db
      .select()
      .from(I)
      .where(and(eq(I.tenantId, tenantId), eq(I.stapelId, r.stapelId), ne(I.id, id), lt(I.aufgenommenAm, r.aufgenommenAm)))
      .orderBy(desc(I.aufgenommenAm))
      .limit(1);
    // aufgenommenAm des vorigen Belegs = Aufnahme seiner letzten Seite (wird beim Anhängen fortgeschrieben).
    if (vor?.aufgenommenAm && vor.ampel !== null && !vor.stotaxSentAt && gehoertZumVorigen({ nummer: vor.invoiceNumber, aufgenommenAm: vor.aufgenommenAm.getTime() }, { nummer: fakten.nummer, folgeseite: fakten.folgeseite, aufgenommenAm: r.aufgenommenAm.getTime() })) {
      await seiteAnhaengen(tenantId, vor, r, fakten);
      return;
    }
  }
  await abschliessen(tenantId, id, fakten);
}

/** Folgeseite an den vorigen Beleg hängen: PDF neu aus allen Seitenbildern, Fakten zusammenführen, Zeile löschen. */
async function seiteAnhaengen(tenantId: string, vor: typeof I.$inferSelect, neu: typeof I.$inferSelect, fakten: BelegFakten) {
  const bilder = [...vor.bildFileIds, ...neu.bildFileIds];
  const seitenBilder: { bytes: Uint8Array; type: string }[] = [];
  for (let i = 1; i < bilder.length; i += 2) {
    const d = await dateiDaten(tenantId, bilder[i]);
    if (d) seitenBilder.push({ bytes: d.data, type: bildTyp(d.mimeType) });
  }
  const pdf = await buildReceiptPdf(seitenBilder, { title: `Beleg ${vor.invoiceNumber ?? ""}`.trim() });
  const fileId = await storeFile(tenantId, vor.fileName, "application/pdf", Buffer.from(pdf));
  const altDateien = [vor.fileId, neu.fileId].filter((x): x is string => Boolean(x));
  await db.update(I).set({ fileId, bildFileIds: bilder, seiten: vor.seiten + neu.seiten, aufgenommenAm: neu.aufgenommenAm ?? vor.aufgenommenAm, updatedAt: new Date() }).where(eq(I.id, vor.id));
  await db.delete(I).where(and(eq(I.tenantId, tenantId), eq(I.id, neu.id)));
  if (altDateien.length) await db.delete(schema.files).where(and(eq(schema.files.tenantId, tenantId), inArray(schema.files.id, altDateien)));
  // Zuordnung/Ampel mit den zusammengeführten Angaben neu (Stotax bekommt erst danach das ganze PDF – siehe Takt).
  if (vor.zuordnung?.art === "bestellung") await db.update(schema.purchaseOrders).set({ invoiceId: null }).where(and(eq(schema.purchaseOrders.tenantId, tenantId), eq(schema.purchaseOrders.invoiceId, vor.id)));
  await abschliessen(tenantId, vor.id, seitenZusammen(faktenAusZeile(vor), fakten), { mehrseitig: true });
}

// ── Gemeinsam: prüfen, zuordnen, weitergeben ───────────────────────────────

const DOC: Record<BelegFakten["art"], (typeof schema.invoices.$inferInsert)["docType"]> = { rechnung: "rechnung", kassenzettel: "quittung", lieferschein: "lieferschein", gutschrift: "gutschrift", sonstiges: "unbekannt" };

async function duplikatVon(tenantId: string, id: string, f: BelegFakten): Promise<{ id: string; reason: string } | null> {
  const n = nummerNorm(f.nummer);
  if (n.length < 3) return null;
  const rows = await db
    .select({ id: I.id, vendor: I.vendor, datum: I.invoiceDate })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), ne(I.id, id), sql`upper(regexp_replace(coalesce(${I.invoiceNumber}, ''), '[^A-Za-z0-9]', '', 'g')) = ${n}`, ne(I.status, "ignored")))
    .limit(5);
  const d = rows.find((x) => !x.vendor || !f.lieferant || namensNaehe(x.vendor, f.lieferant) >= 0.5);
  return d ? { id: d.id, reason: `Rechnungsnummer ${f.nummer} schon erfasst${d.datum ? ` (${d.datum.split("-").reverse().join(".")})` : ""}` } : null;
}

/** Offene Einkäufe als Kandidaten: Bestellungen (ArbitrageOne, Deal-Käufe, von Hand) ohne Rechnung und B2B-Bestellungen. */
async function kandidaten(tenantId: string, datum: string | null): Promise<Kandidat[]> {
  const PO = schema.purchaseOrders, POI = schema.purchaseOrderItems, SU = schema.suppliers;
  const um = datum ?? new Date().toISOString().slice(0, 10);
  const pos = await db
    .select({
      id: PO.id,
      nummer: PO.number,
      bestellnr: PO.supplierOrderNo,
      lieferant: SU.name,
      datum: PO.orderDate,
      quelle: PO.quelle,
      summe: sql<string>`coalesce((select sum(${POI.quantity} * ${POI.unitCostGross}) from ${POI} where ${POI.poId} = ${PO.id}), 0) + coalesce(${PO.shippingCostGross}, 0)`,
    })
    .from(PO)
    .leftJoin(SU, eq(SU.id, PO.supplierId))
    .where(and(eq(PO.tenantId, tenantId), isNull(PO.invoiceId), sql`(${PO.orderDate} is null or abs(${PO.orderDate} - ${um}::date) <= 60)`))
    .limit(2000);
  const out: Kandidat[] = pos.map((p) => ({ art: "bestellung", id: p.id, text: `Bestellung ${p.nummer}${p.quelle === "arbitrageone" ? " (ArbitrageOne)" : ""}`, lieferant: p.lieferant, betrag: Number(p.summe) > 0 ? Math.round(Number(p.summe) * 100) / 100 : null, datum: p.datum, nummer: p.bestellnr }));
  const D = schema.deals, DB_ = schema.dealBestellungen;
  const b2b = await db
    .select({ id: DB_.dealId, nr: D.nr, lieferant: SU.name, menge: DB_.menge, ek: D.ekNetto, am: DB_.bestelltAm })
    .from(DB_)
    .innerJoin(D, eq(D.id, DB_.dealId))
    .leftJoin(SU, eq(SU.id, D.supplierId))
    .where(and(eq(DB_.tenantId, tenantId), isNull(DB_.grosshaendlerRechnungNr), sql`${DB_.status} <> 'entwurf'`))
    .limit(500);
  for (const b of b2b) out.push({ art: "b2b", id: b.id, text: `B2B-Deal ${b.nr}`, lieferant: b.lieferant, betrag: b.ek !== null ? Math.round(Number(b.ek) * b.menge * 100) / 100 : null, datum: b.am ? b.am.toISOString().slice(0, 10) : null, nummer: null });
  return out;
}

/** Positionen mit ASIN an die passenden Chargen hängen (VA/`wissen` finden die Rechnung am ASIN). */
async function anChargenHaengen(tenantId: string, invoiceId: string, f: BelegFakten, poId: string | null): Promise<number> {
  const L = schema.lots, P = schema.products;
  const asins = [...new Set(f.positionen.map((p) => p.asin).filter((a): a is string => Boolean(a)))];
  const lotIds = new Set<string>();
  if (poId) for (const r of await db.select({ lot: schema.purchaseOrderItems.lotId }).from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.poId, poId))) if (r.lot) lotIds.add(r.lot);
  if (asins.length) {
    const rows = await db
      .select({ id: L.id, asin: P.asin, datum: L.purchaseDate })
      .from(L)
      .innerJoin(P, eq(P.id, L.productId))
      .where(and(eq(L.tenantId, tenantId), inArray(P.asin, asins)))
      .orderBy(desc(L.purchaseDate))
      .limit(500);
    // Je ASIN die Charge mit dem nächstgelegenen Einkaufsdatum
    for (const a of asins) {
      const k = rows.filter((r) => r.asin === a);
      if (!k.length) continue;
      const best = f.datum ? k.sort((x, y) => Math.abs(Date.parse(x.datum ?? "1970-01-01") - Date.parse(f.datum!)) - Math.abs(Date.parse(y.datum ?? "1970-01-01") - Date.parse(f.datum!)))[0] : k[0];
      lotIds.add(best.id);
    }
  }
  if (!lotIds.size) return 0;
  await db.insert(schema.invoiceLots).values([...lotIds].map((lotId) => ({ tenantId, invoiceId, lotId, matchedBy: "auto" as const }))).onConflictDoNothing();
  return lotIds.size;
}

/** Ampel, Duplikat, Zuordnung, Felder speichern – danach weitergeben (nicht bei Rot). */
export async function abschliessen(tenantId: string, id: string, f: BelegFakten | null, o: { mehrseitig?: boolean; geprueft?: Wer } = {}): Promise<void> {
  const [r] = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id))).limit(1);
  if (!r) return;
  const dup = f && !r.checks.notDuplicate ? await duplikatVon(tenantId, id, f) : null;
  const a = o.geprueft ? { ampel: "gruen" as Ampel, gruende: [] } : ampelVon(f, { duplikat: Boolean(dup) });
  let zuordnung: typeof I.$inferInsert.zuordnung = null;
  let haengt = 0;
  if (f) {
    const best = besteZuordnung(f, await kandidaten(tenantId, f.datum));
    if (best) {
      zuordnung = { art: best.kandidat.art, id: best.kandidat.id, text: best.kandidat.text, punkte: best.punkte };
      if (best.kandidat.art === "bestellung") await db.update(schema.purchaseOrders).set({ invoiceId: id, updatedAt: new Date() }).where(and(eq(schema.purchaseOrders.tenantId, tenantId), eq(schema.purchaseOrders.id, best.kandidat.id), isNull(schema.purchaseOrders.invoiceId)));
      else if (f.nummer) await db.update(schema.dealBestellungen).set({ grosshaendlerRechnungNr: f.nummer }).where(and(eq(schema.dealBestellungen.tenantId, tenantId), eq(schema.dealBestellungen.dealId, best.kandidat.id), isNull(schema.dealBestellungen.grosshaendlerRechnungNr)));
    }
    haengt = await anChargenHaengen(tenantId, id, f, zuordnung?.art === "bestellung" ? zuordnung.id : null);
  }
  const zugeordnet = Boolean(zuordnung) || haengt > 0;
  const datum = f?.datum ?? null;
  const name = f ? `Beleg_${[datum ?? r.createdAt.toISOString().slice(0, 10), f.lieferant?.split(/\s+/).slice(0, 3).join("-"), f.nummer, f.brutto !== null ? `${f.brutto.toFixed(2).replace(".", ",")}EUR` : null].filter(Boolean).join("_")}.pdf`.replace(/[^\wäöüÄÖÜß,.-]+/g, "_").replace(/_+/g, "_") : r.fileName;
  await db
    .update(I)
    .set({
      vendor: f?.lieferant ?? r.vendor,
      invoiceNumber: f?.nummer ?? r.invoiceNumber,
      orderNumber: f?.bestellnummer ?? r.orderNumber,
      invoiceDate: datum ?? r.invoiceDate,
      totalNet: f?.netto ?? r.totalNet,
      totalGross: f?.brutto ?? r.totalGross,
      textExcerpt: f ? suchText(f) || null : r.textExcerpt,
      ampel: a.ampel,
      pruefGruende: a.gruende,
      positionen: f?.positionen ?? r.positionen,
      ust: f?.ust ?? r.ust,
      zahlungsart: f?.zahlungsart ?? r.zahlungsart,
      faelligAm: f ? faelligkeit(f) : r.faelligAm,
      zuordnung,
      zugeordnetAm: zugeordnet ? (r.zugeordnetAm ?? new Date()) : null,
      kind: f?.art === "kassenzettel" ? "expense" : zugeordnet || f?.positionen.some((p) => p.asin) ? "goods" : r.kind,
      docType: f ? DOC[f.art] : r.docType,
      status: a.ampel === "rot" ? "review" : zugeordnet ? "matched" : "new",
      checks: { ...r.checks, duplicateOf: dup ? [dup] : undefined },
      fileName: name,
      ...(o.geprueft ? { geprueftAm: new Date(), geprueftVonName: o.geprueft.name } : {}),
      updatedAt: new Date(),
    })
    .where(eq(I.id, id));
  if (r.fileId && name !== r.fileName) await db.update(schema.files).set({ name }).where(eq(schema.files.id, r.fileId));
  // Nach der Prüfung von Hand sofort weiter; sonst über den Takt „Belege an Stotax“ (alle 15 Min.) – so geht ein
  // Mehrseiter erst vollständig raus.
  if (o.geprueft) await weitergeben(tenantId, id, { sofort: true });
  if (r.stapelId) await stapelAufgabe(tenantId, r.stapelId).catch(() => undefined);
}

/** Stotax (Mail2Select, wenn „automatisch“) und Drive-Belegordner für einen Beleg. Rot bleibt bis zur Prüfung liegen. */
export async function weitergeben(tenantId: string, id: string, _o: { sofort?: boolean } = {}): Promise<void> {
  const [r] = await db.select({ ampel: I.ampel, geprueft: I.geprueftAm, status: I.status, sent: I.stotaxSentAt }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id))).limit(1);
  if (!r || r.status === "ignored" || r.ampel === null || (r.ampel === "rot" && !r.geprueft)) return;
  const { stotaxConfig } = await import("@/lib/invoices/stotax");
  const cfg = await stotaxConfig(tenantId);
  if (cfg?.auto && !r.sent) await import("@/lib/invoices/receipts").then((m) => m.sendInvoiceToStotax(tenantId, id)).catch(() => undefined);
  await driveAblegen(tenantId, id).catch(() => undefined);
}

/**
 * Takt „Belege an Stotax“ (alle 15 Min.) für die Rechnungsstation: grüne und gelbe Belege (gelbe mit Vermerk), rote erst
 * nach der Prüfung. Kamera-Belege frühestens 1 Minute nach dem letzten Blatt (Mehrseiter vollständig).
 */
export async function ausstehendeWeitergeben(tenantId: string, o: { sofort?: boolean } = {}): Promise<{ stotax: number; drive: number }> {
  const { stotaxConfig } = await import("@/lib/invoices/stotax");
  const cfg = await stotaxConfig(tenantId);
  const drive = Boolean((await getSettings(tenantId)).rechnungsstation.driveOrdnerId?.trim());
  const out = { stotax: 0, drive: 0 };
  if (!cfg?.auto && !drive) return out;
  const rows = await db
    .select({ id: I.id, sent: I.stotaxSentAt, drive: I.driveDateiId, tried: I.stotaxTriedAt, createdAt: I.createdAt })
    .from(I)
    .where(
      and(
        eq(I.tenantId, tenantId),
        inArray(I.source, [...STATION_QUELLEN]),
        ne(I.status, "ignored"),
        sql`${I.ampel} is not null`,
        or(ne(I.ampel, "rot"), sql`${I.geprueftAm} is not null`),
        o.sofort ? undefined : lt(I.updatedAt, new Date(Date.now() - 60_000)),
        or(isNull(I.stotaxSentAt), drive ? isNull(I.driveDateiId) : sql`false`),
      ),
    )
    .limit(100);
  for (const r of rows) {
    if (cfg?.auto && !r.sent && r.createdAt >= cfg.since && (o.sofort || !r.tried || r.tried < new Date(Date.now() - 3_600_000))) {
      const ok = await import("@/lib/invoices/receipts").then((m) => m.sendInvoiceToStotax(tenantId, r.id)).then(() => true).catch(() => false);
      if (ok) out.stotax++;
    }
    if (drive && !r.drive) {
      await driveAblegen(tenantId, r.id).catch(() => undefined);
      out.drive++;
    }
  }
  return out;
}

async function driveAblegen(tenantId: string, id: string) {
  const ordner = (await getSettings(tenantId)).rechnungsstation.driveOrdnerId?.trim();
  if (!ordner) return;
  const cfg = await getIntegration(tenantId, "google_drive");
  if (!cfg?.serviceAccountJson) return;
  const [r] = await db.select({ fileId: I.fileId, fileName: I.fileName, drive: I.driveDateiId }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id))).limit(1);
  if (!r?.fileId || r.drive) return;
  const d = await dateiDaten(tenantId, r.fileId);
  if (!d) return;
  try {
    const { driveHochladen } = await import("@/lib/integrations/clients/drive");
    const driveId = await driveHochladen(cfg.serviceAccountJson, ordner, r.fileName, d.data);
    await db.update(I).set({ driveDateiId: driveId, driveFehler: null }).where(eq(I.id, id));
  } catch (e) {
    await db.update(I).set({ driveFehler: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).where(eq(I.id, id));
  }
}

// ── Stand, Stapelende, Prüfliste ─────────────────────────────────────────────

export type BelegKachel = { id: string; ampel: Ampel | null; lieferant: string | null; betrag: number | null; datum: string | null; nummer: string | null; seiten: number; gruende: string[]; zuordnung: string | null; status: "liest" | "erfasst" | "zugeordnet" | "an Stotax"; stotaxAm: string | null; quelle: string };

const kachel = (r: typeof I.$inferSelect): BelegKachel => ({
  id: r.id,
  ampel: (r.ampel as Ampel | null) ?? null,
  lieferant: r.vendor,
  betrag: r.totalGross,
  datum: r.invoiceDate,
  nummer: r.invoiceNumber,
  seiten: r.seiten,
  gruende: r.pruefGruende,
  zuordnung: r.zuordnung?.text ?? (r.zugeordnetAm ? "Charge (ASIN)" : null),
  status: r.ampel === null ? "liest" : r.stotaxSentAt ? "an Stotax" : r.zugeordnetAm ? "zugeordnet" : "erfasst",
  stotaxAm: r.stotaxSentAt?.toISOString() ?? null,
  quelle: r.source,
});

export async function stapelStand(tenantId: string, stapelId: string) {
  const [st] = await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.id, stapelId))).limit(1);
  if (!st) return null;
  const rows = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.stapelId, stapelId))).orderBy(desc(I.aufgenommenAm), desc(I.createdAt)).limit(1000);
  const belege = rows.map(kachel);
  return { stapel: { id: st.id, name: st.name, quelle: st.quelle, beendet: Boolean(st.beendetAm), aufgabeId: st.aufgabeId }, belege, summe: stapelSumme(belege.map((b) => ({ brutto: b.betrag, ampel: b.ampel }))), zugeordnet: belege.filter((b) => b.status === "zugeordnet" || (b.status === "an Stotax" && b.zuordnung)).length };
}

/** Aufgabe „Rechnungsstapel prüfen“ anlegen/aktualisieren (nach Stapelende); erledigt sich, wenn nichts mehr unklar ist. */
async function stapelAufgabe(tenantId: string, stapelId: string) {
  const [st] = await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.id, stapelId))).limit(1);
  if (!st?.beendetAm) return;
  const rows = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.stapelId, stapelId)));
  const offen = rows.filter((r) => r.status !== "ignored" && !r.geprueftAm && (r.ampel === "rot" || r.ampel === null));
  const gelb = rows.filter((r) => r.status !== "ignored" && !r.geprueftAm && r.ampel === "gelb");
  const z = stapelSumme(rows.map((r) => ({ brutto: r.totalGross, ampel: r.geprueftAm ? "gruen" : ((r.ampel as Ampel | null) ?? null) })));
  const T = schema.tasks;
  const key = `rechnungsstapel:${stapelId}`;
  const title = `Rechnungsstapel prüfen: ${z.n} Beleg${z.n === 1 ? "" : "e"}, ${euro(z.summe)}, ${offen.length} unklar`;
  const notes = [
    `${st.name} – ${rows.filter((r) => r.zugeordnetAm).length} zugeordnet, ${rows.filter((r) => r.stotaxSentAt).length} an Stotax, ${gelb.length} unsicher (mit Vermerk gesendet).`,
    ...offen.slice(0, 25).map((r) => `• ${r.vendor ?? "?"} ${r.invoiceNumber ?? ""} ${r.totalGross !== null ? euro(r.totalGross) : ""} – ${r.pruefGruende.join(", ") || "wird gelesen"}`.replace(/\s+/g, " ")),
  ].join("\n");
  const link = `/rechnungsstation/pruefen?stapel=${stapelId}`;
  const [alt] = await db.select({ id: T.id, status: T.status }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.systemKey, key))).limit(1);
  const fertig = offen.length === 0 && gelb.length === 0;
  if (alt) {
    await db.update(T).set({ title, notes, ...(fertig && alt.status === "open" ? { status: "done", completedAt: new Date() } : {}) }).where(eq(T.id, alt.id));
    return;
  }
  const [neu] = await db.insert(T).values({ tenantId, systemKey: key, title, notes, link, dueDate: new Date().toISOString().slice(0, 10), priority: offen.length ? "normal" : "low", category: "geld", ...(fertig ? { status: "done", completedAt: new Date() } : {}) }).onConflictDoNothing().returning({ id: T.id });
  if (neu) await db.update(S).set({ aufgabeId: neu.id }).where(eq(S.id, stapelId));
}

/** Stapelende: Zusammenfassung (n Belege, Summe, k unklar) als Aufgabe „Rechnungsstapel prüfen“. */
export async function stapelBeenden(tenantId: string, stapelId: string, o: { warten?: boolean } = {}) {
  await db.update(S).set({ beendetAm: new Date(), updatedAt: new Date() }).where(and(eq(S.tenantId, tenantId), eq(S.id, stapelId)));
  if (o.warten) await stapelFertigGelesen(stapelId);
  await stapelAufgabe(tenantId, stapelId);
  return stapelStand(tenantId, stapelId);
}

export async function stapelListe(tenantId: string, limit = 20) {
  const rows = await db
    .select({ id: S.id, name: S.name, quelle: S.quelle, beendetAm: S.beendetAm, createdAt: S.createdAt, wer: S.gestartetVonName, n: sql<number>`(select count(*)::int from invoices i where i.stapel_id = ${S.id})`, unklar: sql<number>`(select count(*)::int from invoices i where i.stapel_id = ${S.id} and i.status <> 'ignored' and i.geprueft_am is null and (i.ampel is null or i.ampel in ('rot','gelb')))` })
    .from(S)
    .where(eq(S.tenantId, tenantId))
    .orderBy(desc(S.createdAt))
    .limit(limit);
  return rows;
}

/** Prüfliste: gelbe und rote Belege (Kamera und Scanner), noch nicht geprüft. */
export async function pruefListe(tenantId: string, stapelId?: string | null) {
  return db
    .select()
    .from(I)
    .where(and(eq(I.tenantId, tenantId), inArray(I.source, [...STATION_QUELLEN]), ne(I.status, "ignored"), isNull(I.geprueftAm), inArray(I.ampel, ["gelb", "rot"]), stapelId ? eq(I.stapelId, stapelId) : undefined))
    .orderBy(sql`case ${I.ampel} when 'rot' then 0 else 1 end`, desc(I.createdAt))
    .limit(200);
}

export type Korrektur = { lieferant: string; nummer: string; datum: string; netto: number | null; brutto: number | null; faelligAm: string | null; art: BelegFakten["art"]; keinDuplikat?: boolean };

/** Prüfung von Hand: Felder übernehmen → grün → Zuordnung neu → an Stotax (auch die vorher roten). */
export async function belegPruefen(tenantId: string, wer: Wer, id: string, k: Korrektur): Promise<{ ok: boolean; text: string }> {
  const [r] = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id), inArray(I.source, [...STATION_QUELLEN]))).limit(1);
  if (!r) return { ok: false, text: "Beleg nicht gefunden." };
  if (!k.lieferant.trim() || k.brutto === null || !/^\d{4}-\d{2}-\d{2}$/.test(k.datum)) return { ok: false, text: "Lieferant, Datum und Brutto sind Pflicht." };
  if (k.keinDuplikat) await db.update(I).set({ checks: { ...r.checks, notDuplicate: true, duplicateOf: undefined } }).where(eq(I.id, id));
  else if (r.checks.duplicateOf?.length) return { ok: false, text: "Möglicherweise doppelt erfasst – „Kein Duplikat“ anhaken oder den Beleg verwerfen." };
  const f: BelegFakten = { ...faktenAusZeile(r), art: k.art, lieferant: k.lieferant.trim(), nummer: k.nummer.trim() || null, datum: k.datum, netto: k.netto, brutto: k.brutto, faelligAm: k.faelligAm, unsicher: [] };
  await abschliessen(tenantId, id, f, { geprueft: wer });
  return { ok: true, text: `Geprüft: ${f.lieferant} ${f.nummer ?? ""} ${euro(f.brutto!)} – wird an Stotax übertragen.`.replace(/\s+/g, " ") };
}

/** Kein Beleg (Werbung, Doppelaufnahme): nicht weitergeben, bleibt im Protokoll. */
export async function belegVerwerfen(tenantId: string, wer: Wer, id: string): Promise<{ ok: boolean; text: string }> {
  const [r] = await db.select({ id: I.id, stapelId: I.stapelId, sent: I.stotaxSentAt }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id), inArray(I.source, [...STATION_QUELLEN]))).limit(1);
  if (!r) return { ok: false, text: "Beleg nicht gefunden." };
  if (r.sent) return { ok: false, text: "Schon an Stotax übertragen – dort bitte entfernen bzw. dem Steuerberater Bescheid geben." };
  await db.update(I).set({ status: "ignored", docType: "keinbeleg", geprueftAm: new Date(), geprueftVonName: wer.name, updatedAt: new Date() }).where(eq(I.id, id));
  await db.update(schema.purchaseOrders).set({ invoiceId: null }).where(and(eq(schema.purchaseOrders.tenantId, tenantId), eq(schema.purchaseOrders.invoiceId, id)));
  if (r.stapelId) await stapelAufgabe(tenantId, r.stapelId).catch(() => undefined);
  return { ok: true, text: "Als „kein Beleg“ markiert – wird nicht weitergegeben." };
}

// ── Einzugsscanner: PDF-Stapel trennen ─────────────────────────────────────

const TEIL = 30;

/**
 * Eine PDF mit vielen Belegen: KI trennt an den Rechnungsnummern und liest je Beleg (je bis zu 30 Seiten ein Aufruf).
 * Ohne KI wird jede Seite ein eigener (roter) Beleg. Jeder Beleg wird eine eigene PDF (volle Auflösung der Seiten).
 */
export async function pdfStapelVerarbeiten(tenantId: string, wer: Wer, bytes: Buffer, dateiName: string, quelle: "ordner" | "upload"): Promise<{ stapelId: string; belege: number; seiten: number }> {
  let quellPdf: PDFDocument;
  try {
    quellPdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new StationFehler(`„${dateiName}“ ist keine lesbare PDF.`);
  }
  const n = quellPdf.getPageCount();
  if (!n) throw new StationFehler("Die PDF hat keine Seiten.");
  const hash = sha(bytes);
  const [schon] = await db.select({ stapelId: I.stapelId }).from(I).where(and(eq(I.tenantId, tenantId), inArray(I.source, [...STATION_QUELLEN]), sql`${I.externalId} like ${`${hash}:%`}`)).limit(1);
  if (schon?.stapelId) return { stapelId: schon.stapelId, belege: 0, seiten: n };
  const stapelId = await stapelNeu(tenantId, wer, quelle === "ordner" ? "ordner" : "upload", dateiName);
  const gruppen: { seiten: number[]; fakten: BelegFakten | null }[] = [];
  for (let ab = 1; ab <= n; ab += TEIL) {
    const bis = Math.min(n, ab + TEIL - 1);
    let teil: Buffer = bytes;
    if (n > TEIL) {
      const t = await PDFDocument.create();
      (await t.copyPages(quellPdf, Array.from({ length: bis - ab + 1 }, (_, i) => ab - 1 + i))).forEach((p) => t.addPage(p));
      teil = Buffer.from(await t.save());
    }
    const text = await ki(tenantId, [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: teil.toString("base64") } }, { type: "text", text: PDF_STAPEL_PROMPT(bis - ab + 1, ab) }], 16_000).catch(() => null);
    gruppen.push(...(text ? stapelAntwortLesen(text, bis - ab + 1, ab) : Array.from({ length: bis - ab + 1 }, (_, i) => ({ seiten: [ab + i], fakten: null }))));
  }
  const stempel = new Date().toISOString().slice(0, 10);
  let i = 0;
  for (const g of gruppen) {
    i++;
    const doc = await PDFDocument.create();
    (await doc.copyPages(quellPdf, g.seiten.map((s) => s - 1))).forEach((p) => doc.addPage(p));
    const pdf = Buffer.from(await doc.save());
    const name = `Beleg_${stempel}_${dateiName.replace(/\.pdf$/i, "").slice(0, 40)}_${String(i).padStart(3, "0")}.pdf`.replace(/[^\wäöüÄÖÜß,.-]+/g, "_");
    const fileId = await storeFile(tenantId, name, "application/pdf", pdf);
    const [row] = await db
      .insert(I)
      .values({ tenantId, source: "ordner", externalId: `${hash}:${g.seiten.join(",")}`, fileName: name, fileId, kind: "unknown", status: "new", stapelId, seiten: g.seiten.length, aufgenommenAm: new Date() })
      .onConflictDoNothing()
      .returning({ id: I.id });
    if (row) await abschliessen(tenantId, row.id, g.fakten);
  }
  await stapelBeenden(tenantId, stapelId);
  return { stapelId, belege: gruppen.length, seiten: n };
}

/** Überwachter Ordner des Einzugsscanners (Docker: ./scan-eingang → /scan-eingang). */
export const eingangsOrdner = () => process.env.BELEG_EINGANG_DIR?.trim() || null;

/**
 * Neue PDFs im Scanner-Ordner verarbeiten: erst nach Ruhezeit (Scanner schreibt noch), dann nach „in-arbeit/“ schieben
 * (kein doppeltes Verarbeiten), danach nach „verarbeitet/“ bzw. bei Fehlern nach „fehler/“ (mit Aufgabe).
 */
export async function ordnerPruefen(tenantId: string, wer: Wer = { userId: null, name: "Scanner-Ordner" }): Promise<{ dateien: number; belege: number; fehler: string[] }> {
  const dir = eingangsOrdner();
  const out = { dateien: 0, belege: 0, fehler: [] as string[] };
  if (!dir) return out;
  if (!(await getSettings(tenantId)).rechnungsstation.ordnerAn) return out;
  const ruheMs = Number(process.env.BELEG_EINGANG_RUHE_MS ?? 20_000);
  const eintraege = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const unter of ["in-arbeit", "verarbeitet", "fehler"]) await fs.mkdir(path.join(dir, unter), { recursive: true }).catch(() => undefined);
  for (const e of eintraege) {
    if (!e.isFile() || !/\.pdf$/i.test(e.name) || e.name.startsWith(".")) continue;
    const quelle = path.join(dir, e.name);
    const st = await fs.stat(quelle).catch(() => null);
    if (!st || Date.now() - st.mtimeMs < ruheMs) continue;
    const arbeit = path.join(dir, "in-arbeit", e.name);
    try {
      await fs.rename(quelle, arbeit);
    } catch {
      continue; // schon von einem anderen Lauf genommen
    }
    out.dateien++;
    const ziel = (unter: string) => path.join(dir, unter, `${new Date().toISOString().replace(/[:.]/g, "-")}_${e.name}`);
    try {
      const r = await pdfStapelVerarbeiten(tenantId, wer, await fs.readFile(arbeit), e.name, "ordner");
      out.belege += r.belege;
      await fs.rename(arbeit, ziel("verarbeitet"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.fehler.push(`${e.name}: ${msg}`);
      await fs.rename(arbeit, ziel("fehler")).catch(() => undefined);
      const { upsertSystemTask } = await import("@/lib/tasks/system");
      await upsertSystemTask(db, tenantId, `rechnungsstation:ordner-fehler:${e.name}`, { title: `Scanner-PDF nicht verarbeitet: ${e.name}`, notes: `${msg}\nDie Datei liegt im Scanner-Ordner unter „fehler/“.`, priority: "normal", category: "geld", link: "/rechnungsstation/pruefen" });
    }
  }
  return out;
}

/** Kamera-Stapel, die seit 30 Minuten ruhen, schließen (Zusammenfassung als Aufgabe). */
export async function ruhendeStapelBeenden(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: S.id })
    .from(S)
    .where(and(eq(S.tenantId, tenantId), eq(S.quelle, "kamera"), isNull(S.beendetAm), lt(S.updatedAt, new Date(Date.now() - 30 * 60_000)), sql`not exists (select 1 from invoices i where i.stapel_id = ${S.id} and i.created_at > now() - interval '30 minutes')`, sql`exists (select 1 from invoices i where i.stapel_id = ${S.id})`))
    .limit(20);
  for (const r of rows) await stapelBeenden(tenantId, r.id);
  return rows.length;
}

/** Belege, deren KI-Lesung abgebrochen ist (Neustart), erneut lesen. */
export async function liegengebliebeneLesen(tenantId: string): Promise<number> {
  const rows = await db.select({ id: I.id, stapelId: I.stapelId }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.source, "station"), isNull(I.ampel), lt(I.createdAt, new Date(Date.now() - 10 * 60_000)), or(isNull(I.stapelId), sql`true`))).limit(50);
  for (const r of rows) void einreihen(r.stapelId ?? r.id, () => blattLesen(tenantId, r.id));
  return rows.length;
}
