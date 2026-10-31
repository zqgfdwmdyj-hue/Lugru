import "server-only";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { db, schema } from "@/db";
import { categoryLabel } from "@/lib/amazon-todos/logic";
import { safe } from "@/lib/ebay/invoices/pdf";
import { brandKey, evidenceCheck } from "@/lib/sas/logic";
import { zipErstellen, type ZipEintrag } from "@/lib/zip";
import { abdeckung, abdeckungCsv, auditDateiname, FALL_KATEGORIEN, markeTrifft, type AbdeckungStatus, type SkuAbdeckung } from "./logic";

// Echtheits-Ordner: je Marke die Rechnungen (Text-Treffer, über Chargen verknüpft oder von Hand zugeordnet),
// Abdeckung gekauft/verkauft je SKU, Lücken, offene Amazon-Fälle (Echtheit/Konto) und das Audit-Paket (ZIP + PDF).

const M = schema.echtheitMarken;
const E = schema.echtheitBelege;
const I = schema.invoices;

export type Marke = typeof schema.echtheitMarken.$inferSelect;
export type OrdnerBeleg = {
  id: string;
  fileId: string | null;
  fileName: string;
  vendor: string | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  totalGross: number | null;
  /** sicher / text / pruefen (Text-Treffer), charge (über Charge verknüpft), manuell (von Hand) */
  art: "sicher" | "text" | "pruefen" | "charge" | "manuell";
  grund: string;
  ausschnitt: string | null;
  urteil: "stimmt" | "falsch" | null;
};
export type OrdnerFall = { id: string; kategorie: string; betreff: string | null; frist: string | null; status: string; eingang: Date; asins: string[] };

const monatMinus = (heute: string, n: number) => {
  const [j, m] = heute.split("-").map(Number);
  return new Date(Date.UTC(j, m - 1 - n, 1)).toISOString().slice(0, 7);
};

/** Gemeinsame Grunddaten (einmal laden, für alle Marken auswerten). */
async function grunddaten(t: string, heute: string) {
  const [produkte, monate, rechnungen, urteile, faelle] = await Promise.all([
    db.select({ sku: schema.sellerboardProducts.sku, asin: schema.sellerboardProducts.asin, name: schema.sellerboardProducts.name }).from(schema.sellerboardProducts).where(eq(schema.sellerboardProducts.tenantId, t)),
    db.select({ sku: schema.sellerboardSkuMonths.sku, asin: schema.sellerboardSkuMonths.asin, name: schema.sellerboardSkuMonths.name, units: schema.sellerboardSkuMonths.units }).from(schema.sellerboardSkuMonths).where(and(eq(schema.sellerboardSkuMonths.tenantId, t), gte(schema.sellerboardSkuMonths.month, monatMinus(heute, 11)))),
    db
      .select({ id: I.id, fileId: I.fileId, fileName: I.fileName, vendor: I.vendor, invoiceDate: I.invoiceDate, invoiceNumber: I.invoiceNumber, totalGross: I.totalGross, text: I.textExcerpt })
      .from(I)
      .where(and(eq(I.tenantId, t), eq(I.docType, "rechnung"), ne(I.status, "ignored")))
      .orderBy(desc(I.invoiceDate)),
    db.select().from(E).where(eq(E.tenantId, t)),
    db.select().from(schema.amazonTodos).where(and(eq(schema.amazonTodos.tenantId, t), inArray(schema.amazonTodos.category, [...FALL_KATEGORIEN]))),
  ]);
  // SKU → Name/ASIN aus Produkten und Monatswerten
  const skus = new Map<string, { asin: string | null; name: string | null }>();
  for (const p of [...produkte, ...monate]) {
    const cur = skus.get(p.sku);
    if (!cur) skus.set(p.sku, { asin: p.asin, name: p.name });
    else skus.set(p.sku, { asin: cur.asin ?? p.asin, name: cur.name ?? p.name });
  }
  const verkauft = new Map<string, number>();
  for (const m of monate) verkauft.set(m.sku, (verkauft.get(m.sku) ?? 0) + (m.units ?? 0));
  return { skus, verkauft, rechnungen, urteile, faelle };
}

type Grund = Awaited<ReturnType<typeof grunddaten>>;

async function auswerten(t: string, marke: Marke, g: Grund) {
  const markeSkus = [...g.skus.entries()].filter(([, v]) => markeTrifft(marke.marke, marke.aliase, v.name)).map(([sku, v]) => ({ sku, ...v }));
  const skuListe = markeSkus.map((s) => s.sku);
  // Chargen der Marken-SKUs mit/ohne verknüpfte Rechnung
  const L = schema.lots;
  const lots = skuListe.length ? await db.select({ id: L.id, sku: L.sku, menge: L.quantity }).from(L).where(and(eq(L.tenantId, t), eq(L.kind, "purchase"), inArray(L.sku, skuListe))) : [];
  const links = lots.length ? await db.select({ lotId: schema.invoiceLots.lotId, invoiceId: schema.invoiceLots.invoiceId }).from(schema.invoiceLots).where(and(eq(schema.invoiceLots.tenantId, t), inArray(schema.invoiceLots.lotId, lots.map((l) => l.id)))) : [];
  const belegteLots = new Set(links.map((l) => l.lotId));
  const ueberCharge = new Set(links.map((l) => l.invoiceId));

  const urteil = new Map(g.urteile.filter((u) => u.markeId === marke.id).map((u) => [u.invoiceId, u]));
  const belege: OrdnerBeleg[] = [];
  for (const r of g.rechnungen) {
    const u = urteil.get(r.id);
    const basis = { id: r.id, fileId: r.fileId, fileName: r.fileName, vendor: r.vendor, invoiceDate: r.invoiceDate, invoiceNumber: r.invoiceNumber, totalGross: r.totalGross, urteil: u?.urteil ?? null };
    if (u?.manuell) {
      belege.push({ ...basis, art: "manuell", grund: "von Hand zugeordnet", ausschnitt: null });
      continue;
    }
    if (ueberCharge.has(r.id)) {
      belege.push({ ...basis, art: "charge", grund: "über Charge einer Marken-SKU verknüpft", ausschnitt: null });
      continue;
    }
    let treffer: ReturnType<typeof evidenceCheck> = null;
    for (const name of [marke.marke, ...marke.aliase]) {
      treffer = evidenceCheck(name, r.vendor, r.text ?? "");
      if (treffer) break;
    }
    if (treffer) belege.push({ ...basis, art: treffer.level, grund: treffer.reason, ausschnitt: treffer.snippet });
  }
  const order = (b: OrdnerBeleg) => (b.urteil === "falsch" ? 9 : b.urteil === null && b.art === "pruefen" ? 0 : 1);
  belege.sort((a, b) => order(a) - order(b) || (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""));
  const gezaehlt = belege.filter((b) => b.urteil !== "falsch");

  const zeilen: SkuAbdeckung[] = markeSkus.map((s) => ({
    sku: s.sku,
    asin: s.asin,
    name: s.name,
    verkauft: g.verkauft.get(s.sku) ?? 0,
    gekauftBelegt: lots.filter((l) => l.sku === s.sku && belegteLots.has(l.id)).reduce((n, l) => n + (l.menge ?? 0), 0),
    gekauftOhneBeleg: lots.filter((l) => l.sku === s.sku && !belegteLots.has(l.id)).reduce((n, l) => n + (l.menge ?? 0), 0),
  }));
  const ab = abdeckung(zeilen);
  const asins = new Set(markeSkus.map((s) => s.asin).filter((a): a is string => !!a));
  const faelle: OrdnerFall[] = g.faelle
    .filter((f) => f.asins.some((a) => asins.has(a)) || markeTrifft(marke.marke, marke.aliase, `${f.subject ?? ""} ${f.summary ?? ""}`))
    .map((f) => ({ id: f.id, kategorie: categoryLabel(f.category), betreff: f.subject, frist: f.deadline, status: f.status, eingang: f.receivedAt, asins: f.asins }))
    .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.eingang.getTime() - a.eingang.getTime());
  return {
    marke,
    belege,
    abdeckung: ab,
    faelle,
    summe: {
      belege: gezaehlt.length,
      pruefen: gezaehlt.filter((b) => b.urteil === null && b.art === "pruefen").length,
      bestaetigt: gezaehlt.filter((b) => b.urteil === "stimmt" || b.art === "manuell").length,
      falsch: belege.length - gezaehlt.length,
      skus: markeSkus.length,
      offeneFaelle: faelle.filter((f) => f.status === "open").length,
    },
  };
}

export type MarkenOrdner = Awaited<ReturnType<typeof auswerten>>;

export async function markenListe(tenantId: string, heute: string) {
  const marken = await db.select().from(M).where(eq(M.tenantId, tenantId)).orderBy(M.marke);
  if (!marken.length) return [];
  const g = await grunddaten(tenantId, heute);
  const out: MarkenOrdner[] = [];
  for (const m of marken) out.push(await auswerten(tenantId, m, g));
  return out;
}

export async function markenOrdner(tenantId: string, markeId: string, heute: string): Promise<MarkenOrdner | null> {
  const [m] = await db.select().from(M).where(and(eq(M.tenantId, tenantId), eq(M.id, markeId)));
  if (!m) return null;
  return auswerten(tenantId, m, await grunddaten(tenantId, heute));
}

export async function markeFinden(tenantId: string, name: string): Promise<Marke | null> {
  const k = brandKey(name);
  const alle = await db.select().from(M).where(eq(M.tenantId, tenantId));
  return alle.find((m) => m.markeKey === k || m.aliase.some((a) => brandKey(a) === k)) ?? alle.find((m) => m.markeKey.includes(k)) ?? null;
}

export async function markeAnlegen(tenantId: string, marke: string, aliase: string[]): Promise<{ id: string; neu: boolean }> {
  const name = marke.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 80);
  const al = [...new Set(aliase.map((a) => a.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 80)).filter((a) => a && brandKey(a) !== brandKey(name)))].slice(0, 10);
  const r = await db.insert(M).values({ tenantId, marke: name, markeKey: brandKey(name), aliase: al }).onConflictDoNothing().returning({ id: M.id });
  if (r[0]) return { id: r[0].id, neu: true };
  const [alt] = await db.select({ id: M.id }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.markeKey, brandKey(name))));
  return { id: alt.id, neu: false };
}

/** Marken aus der SAS-Markenliste übernehmen (nur die für den Audit ausgewählten). */
export async function ausSasUebernehmen(tenantId: string): Promise<number> {
  const sas = await db.select({ brand: schema.sasBrands.brand }).from(schema.sasBrands).where(and(eq(schema.sasBrands.tenantId, tenantId), eq(schema.sasBrands.selected, true)));
  let n = 0;
  for (const s of sas) if ((await markeAnlegen(tenantId, s.brand, [])).neu) n++;
  return n;
}

export async function belegUrteil(tenantId: string, userId: string, markeId: string, invoiceId: string, urteil: "stimmt" | "falsch" | null, manuell = false): Promise<boolean> {
  const [[m], [inv]] = await Promise.all([
    db.select({ id: M.id }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.id, markeId))),
    db.select({ id: I.id }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, invoiceId))),
  ]);
  if (!m || !inv) return false;
  if (urteil === null) await db.delete(E).where(and(eq(E.tenantId, tenantId), eq(E.markeId, markeId), eq(E.invoiceId, invoiceId)));
  else
    await db
      .insert(E)
      .values({ tenantId, markeId, invoiceId, urteil, manuell, geprueftVon: userId })
      .onConflictDoUpdate({ target: [E.markeId, E.invoiceId], set: { urteil, manuell, geprueftVon: userId, geprueftAm: new Date() } });
  return true;
}

// ---- Audit-Paket

const A4 = { w: 595.28, h: 841.89 };
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.46, 0.53);
const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–");
const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }).replace(/[  ]/g, " "));
const STATUS: Record<AbdeckungStatus, string> = { belegt: "belegt", teilweise: "teilweise", luecke: "Lücke", kein_verkauf: "kein Verkauf" };

/** Übersicht als PDF (A4): Marke, Firma, Abdeckung, Rechnungsliste mit Dateinamen im Paket. */
export async function uebersichtPdf(o: MarkenOrdner, firma: string, heute: string, dateien: Map<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Einkaufsnachweise ${o.marke.marke}`);
  doc.setProducer("Seller-System");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - 50;
  const text = (s: string, x: number, size = 9, f: PDFFont = reg, color = INK) => page.drawText(safe(s).slice(0, 140), { x, y, size, font: f, color });
  const neueZeile = (h = 13) => {
    y -= h;
    if (y < 60) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - 50;
    }
  };
  text(`Einkaufsnachweise – Marke ${o.marke.marke}`, 50, 16, bold);
  neueZeile(20);
  text(`${firma} · Stand ${dmy(heute)}`, 50, 10, reg, MUTED);
  neueZeile(24);
  const a = o.abdeckung;
  text("Abdeckung (letzte 12 Monate)", 50, 11, bold);
  neueZeile(16);
  text(`Verkauft: ${a.verkauft} Stück · gekauft mit Rechnung: ${a.gekauftBelegt} Stück · gedeckt: ${a.quote === null ? "–" : `${a.quote.toLocaleString("de-DE")} %`}`, 50);
  neueZeile(18);
  text("SKU", 50, 8, bold);
  text("Produkt", 160, 8, bold);
  text("verkauft", 400, 8, bold);
  text("mit Rechnung", 450, 8, bold);
  text("Status", 515, 8, bold);
  neueZeile(12);
  for (const z of a.zeilen.slice(0, 200)) {
    text(z.sku.slice(0, 22), 50, 8);
    text((z.name ?? "").slice(0, 48), 160, 8);
    text(String(z.verkauft), 400, 8);
    text(String(z.gekauftBelegt), 450, 8);
    text(STATUS[z.status], 515, 8);
    neueZeile(11);
  }
  neueZeile(14);
  text(`Rechnungen (${o.belege.filter((b) => b.urteil !== "falsch").length})`, 50, 11, bold);
  neueZeile(16);
  for (const b of o.belege.filter((x) => x.urteil !== "falsch")) {
    text(`${dmy(b.invoiceDate)}  ${b.vendor ?? "–"}  Nr. ${b.invoiceNumber ?? "–"}  ${eur(b.totalGross)}`, 50, 8);
    neueZeile(10);
    text(dateien.get(b.id) ?? "Datei fehlt im System", 62, 7, reg, MUTED);
    neueZeile(12);
  }
  return doc.save();
}

/** ZIP: Übersicht.pdf, Abdeckung.csv und alle (nicht als falsch markierten) Rechnungsdateien. */
export async function auditPaket(tenantId: string, markeId: string, heute: string): Promise<{ name: string; daten: Uint8Array } | null> {
  const o = await markenOrdner(tenantId, markeId, heute);
  if (!o) return null;
  const [t] = await db.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const belege = o.belege.filter((b) => b.urteil !== "falsch" && b.fileId);
  const ids = belege.map((b) => b.fileId!) as string[];
  const files = ids.length ? await db.select({ id: schema.files.id, name: schema.files.name, data: schema.files.data }).from(schema.files).where(and(eq(schema.files.tenantId, tenantId), inArray(schema.files.id, ids))) : [];
  const vergeben = new Set<string>();
  const dateien = new Map<string, string>();
  const eintraege: ZipEintrag[] = [];
  for (const b of belege) {
    const f = files.find((x) => x.id === b.fileId);
    if (!f) continue;
    const name = auditDateiname({ datum: b.invoiceDate, lieferant: b.vendor, nummer: b.invoiceNumber, original: f.name || b.fileName }, vergeben);
    dateien.set(b.id, name);
    eintraege.push({ name, daten: new Uint8Array(f.data) });
  }
  const pdf = await uebersichtPdf(o, t?.name ?? "", heute, dateien);
  const csv = new TextEncoder().encode("﻿" + abdeckungCsv(o.abdeckung.zeilen));
  const datei = `Einkaufsnachweise_${o.marke.marke.replace(/[^A-Za-z0-9-]+/g, "-")}_${heute}.zip`;
  return { name: datei, daten: zipErstellen([{ name: "Uebersicht.pdf", daten: pdf }, { name: "Abdeckung.csv", daten: csv }, ...eintraege]) };
}
