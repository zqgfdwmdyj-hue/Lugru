import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { db, schema } from "@/db";
import type { Address } from "@/db/schema";
import { getIntegration } from "@/lib/integrations/store";
import { imBuyLabels, imCreds } from "@/lib/integrations/clients/deutschepost";
import { createLabel, loadOrder, storeFile } from "@/lib/orders/service";
import { getSettings } from "@/lib/settings";
import { syncSoon } from "@/lib/stock/channel-sync";
import { parsePackingSlip, shipChoice, type ShipChoice, type SlipOrder } from "./packing-slip";
import { WARENSENDUNG } from "./internetmarke";
import { orderShipWeight, type SkuWeightInfo } from "./weights-service";
import type { WeightSource } from "./weight";
import { CHANNEL_LABEL } from "@/lib/labels";

// Amazon-Lieferschein → Aufträge → Labels in einem Ablauf: 1 Stück = Warensendung (INTERNETMARKE),
// ab 2 Stück = DHL. Aufträge werden angelegt bzw. den schon abgerufenen zugeordnet (Bestellnummer).

export type SlipRow = {
  orderId: string;
  orderNo: string;
  /** Verkaufskanal (Amazon, eBay …). */
  channel: string;
  name: string;
  place: string;
  quantity: number;
  items: string;
  choice: ShipChoice;
  /** Warum diese Versandart (oder warum prüfen). */
  reason: string;
  weightKg: number;
  /** Rechenweg („2 × 0,3 kg = 0,6 kg“) und Herkunft des Gewichts. */
  weightNote: string;
  weightSource: WeightSource;
  /** Artikel der Sendung mit eingetragenem Versandgewicht (oder null). */
  skus: SkuWeightInfo[];
  /** Auftrag hat schon ein Label bzw. ist versendet – wird nicht noch einmal gekauft. */
  done: string | null;
  warnings: string[];
};

const POST_CARRIER = "Deutsche Post";

/** PDF-Text je Seite. */
export async function slipPages(pdf: Buffer): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: false });
  return text as string[];
}

/** Lieferadresse aus dem Lieferschein nur dort eintragen, wo der Auftrag keine (vollständige) hat. */
function needsAddress(a: Address | null | undefined): boolean {
  return !a?.name1 || !a.street || !a.zip || !a.city;
}

/** Aufträge zu den Bestellungen des Lieferscheins anlegen bzw. finden (Amazon, FBM). */
export async function upsertSlipOrders(tenantId: string, orders: SlipOrder[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (!orders.length) return ids;
  const O = schema.orders;
  const existing = await db
    .select({ id: O.id, externalId: O.externalId, shipTo: O.shipTo })
    .from(O)
    .where(and(eq(O.tenantId, tenantId), eq(O.channel, "amazon"), inArray(O.externalId, orders.map((o) => o.orderNo))));
  const byNo = new Map(existing.map((e) => [e.externalId, e]));
  let created = 0;
  for (const o of orders) {
    const hit = byNo.get(o.orderNo);
    if (hit) {
      ids.set(o.orderNo, hit.id);
      if (needsAddress(hit.shipTo) && o.shipTo.street) await db.update(O).set({ shipTo: o.shipTo, buyerName: o.shipTo.name1, updatedAt: new Date() }).where(and(eq(O.id, hit.id), eq(O.tenantId, tenantId)));
      const [anyItem] = await db.select({ id: schema.orderItems.id }).from(schema.orderItems).where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.orderId, hit.id))).limit(1);
      if (!anyItem && o.items.length) await insertItems(tenantId, hit.id, o);
      continue;
    }
    const [row] = await db
      .insert(O)
      .values({ tenantId, channel: "amazon", externalId: o.orderNo, orderDate: o.orderDate ? new Date(`${o.orderDate}T12:00:00Z`) : new Date(), fulfillment: "FBM", status: "open", shipTo: o.shipTo, buyerName: o.shipTo.name1 ?? null, notes: "aus Amazon-Lieferschein" })
      .onConflictDoNothing()
      .returning({ id: O.id });
    const id = row?.id ?? (await db.select({ id: O.id }).from(O).where(and(eq(O.tenantId, tenantId), eq(O.channel, "amazon"), eq(O.externalId, o.orderNo))))[0]?.id;
    if (!id) continue;
    ids.set(o.orderNo, id);
    if (row) {
      created++;
      if (o.items.length) await insertItems(tenantId, id, o);
    }
  }
  // Neue offene Aufträge reservieren Bestand → Mengen in den Kanälen abgleichen.
  if (created) syncSoon(tenantId);
  return ids;
}

async function insertItems(tenantId: string, orderId: string, o: SlipOrder) {
  await db.insert(schema.orderItems).values(o.items.map((it) => ({ tenantId, orderId, sku: it.sku, asin: it.asin, title: it.title.slice(0, 300), quantity: it.quantity, externalItemId: it.lineId })));
}

/** Zeile der Vorschau zu einem Auftrag: Versandart nach Stückzahl, Gewicht, ob schon erledigt. */
export async function slipRow(tenantId: string, orderId: string, slip?: SlipOrder): Promise<SlipRow | null> {
  const data = await loadOrder(tenantId, orderId);
  if (!data) return null;
  const to = data.order.shipTo ?? {};
  const quantity = data.items.reduce((n, i) => n + i.item.quantity, 0);
  const warnings = [...(slip?.warnings ?? [])];
  if (needsAddress(to)) warnings.push("Lieferadresse unvollständig");
  const w = await orderShipWeight(tenantId, data);
  let choice = shipChoice({ quantity, shipTo: to, warnings });
  let reason = choice === "warensendung" ? "1 Stück" : choice === "dhl" ? (quantity === 1 ? "1 Stück, aber Ausland – Warensendung nur innerhalb Deutschlands" : `${quantity} Stück`) : warnings[0] ?? "Menge unklar";
  // Warensendung nur bis 1.000 g: schwerer → DHL (nur bei bekanntem Gewicht, nicht beim Schätzwert).
  if (choice === "warensendung" && w.source !== "geschaetzt" && w.kg * 1000 > WARENSENDUNG.maxGrams) {
    choice = "dhl";
    reason = `1 Stück, aber ${w.kg.toLocaleString("de-DE")} kg – Warensendung nur bis 1 kg`;
  }
  const done = data.order.status !== "open" ? (data.order.status === "label_created" ? `Label schon erstellt${data.order.carrier ? ` (${data.order.carrier})` : ""}` : data.order.status === "cancelled" ? "storniert" : "schon versendet") : null;
  return {
    orderId,
    orderNo: data.order.externalId,
    channel: CHANNEL_LABEL[data.order.channel] ?? data.order.channel,
    name: [to.name1, to.name2].filter(Boolean).join(", ") || data.order.buyerName || "–",
    place: [to.zip, to.city].filter(Boolean).join(" "),
    quantity,
    items: data.items.map((i) => `${i.item.quantity}× ${i.productTitle ?? i.item.title ?? i.item.sku ?? "?"}`).join(" · "),
    choice,
    reason,
    weightKg: w.kg,
    weightNote: w.note,
    weightSource: w.source,
    skus: w.skus,
    done,
    warnings,
  };
}

/** PDF hochladen → Aufträge anlegen/zuordnen → Vorschauzeilen. */
export async function readSlip(tenantId: string, pdf: Buffer): Promise<{ rows: SlipRow[]; unreadable: number }> {
  const pages = await slipPages(pdf);
  const orders = parsePackingSlip(pages);
  if (!orders.length) throw new Error("Keine Amazon-Bestellung im PDF gefunden – bitte den Lieferschein aus Seller Central (Bestellungen → Lieferschein drucken) hochladen.");
  const ids = await upsertSlipOrders(tenantId, orders);
  const rows: SlipRow[] = [];
  for (const o of orders) {
    const id = ids.get(o.orderNo);
    const r = id ? await slipRow(tenantId, id, o) : null;
    if (r) rows.push(r);
  }
  return { rows, unreadable: orders.length - rows.length };
}

/** Offene Aufträge (ohne Lieferschein) übernehmen – z. B. eBay: vorher neu abrufen, dann wie beim Lieferschein. */
export async function readOpenOrders(tenantId: string, channel: "ebay" | "amazon" | "alle", refresh: boolean): Promise<{ rows: SlipRow[]; note?: string }> {
  const notes: string[] = [];
  if (refresh) {
    const { ebayConnected, syncEbayOrders } = await import("@/lib/integrations/clients/ebay");
    const { syncFbmOrders } = await import("@/lib/integrations/clients/amazon");
    const run = async (name: string, fn: () => Promise<{ orders: number }>) => {
      try {
        const r = await fn();
        if (r.orders) notes.push(`${name}: ${r.orders} neu abgerufen`);
      } catch (e) {
        notes.push(`${name}: Abruf fehlgeschlagen (${e instanceof Error ? e.message : String(e)}) – gezeigt wird der letzte Stand`);
      }
    };
    if (channel !== "amazon" && (await ebayConnected(tenantId))) await run("eBay", () => syncEbayOrders(tenantId));
    if (channel !== "ebay" && (await getIntegration(tenantId, "amazon_sp"))) await run("Amazon", () => syncFbmOrders(tenantId));
  }
  const O = schema.orders;
  const where = [eq(O.tenantId, tenantId), eq(O.fulfillment, "FBM"), eq(O.status, "open")];
  if (channel !== "alle") where.push(eq(O.channel, channel));
  const open = await db.select({ id: O.id }).from(O).where(and(...where)).orderBy(asc(O.shipBy), asc(O.orderDate)).limit(200);
  const rows: SlipRow[] = [];
  for (const o of open) {
    const r = await slipRow(tenantId, o.id);
    if (r) rows.push(r);
  }
  if (!rows.length) notes.push(`Keine offenen ${channel === "ebay" ? "eBay-" : channel === "amazon" ? "Amazon-" : ""}Aufträge zum Versenden.`);
  return { rows, note: notes.join(" · ") || undefined };
}

/** Bestimmte Aufträge übernehmen (Auswahl aus der Auftragsliste). */
export async function readOrders(tenantId: string, ids: string[]): Promise<SlipRow[]> {
  const rows: SlipRow[] = [];
  for (const id of ids.slice(0, 200)) {
    const r = await slipRow(tenantId, id);
    if (r) rows.push(r);
  }
  return rows;
}

export type SlipResult = { orderId: string; orderNo: string; ok: boolean; message: string; kind: ShipChoice };
export type SlipLabels = { results: SlipResult[]; fileId: string | null; postFileId: string | null; dhlFileId: string | null; walletCents: number | null };

/** Alle PDFs zu einem zusammenfügen (Warensendungen zuerst, dann DHL). */
async function mergePdfs(parts: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const p of parts) {
    const src = await PDFDocument.load(p);
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  return Buffer.from(await out.save());
}

/**
 * Labels für die gewählten Aufträge: alle Warensendungen in einem Kauf (ein PDF), DHL je Auftrag. Aufträge mit
 * Label oder versendet werden übersprungen (nichts doppelt kaufen). Ergebnis: ein gemeinsames PDF zum Drucken.
 */
export async function createSlipLabels(tenantId: string, picks: { orderId: string; choice: ShipChoice }[]): Promise<SlipLabels> {
  // Doppelklick/zweiter Tab: nie zweimal Porto kaufen.
  if (running.has(tenantId)) throw new Error("Labels werden gerade schon erstellt – bitte kurz warten und die Seite neu laden.");
  running.add(tenantId);
  try {
    return await createSlipLabelsNow(tenantId, picks);
  } finally {
    running.delete(tenantId);
  }
}

const running = new Set<string>();

async function createSlipLabelsNow(tenantId: string, picks: { orderId: string; choice: ShipChoice }[]): Promise<SlipLabels> {
  const settings = await getSettings(tenantId);
  const results: SlipResult[] = [];
  const post: SlipRow[] = [];
  const dhl: SlipRow[] = [];
  for (const p of picks) {
    const row = await slipRow(tenantId, p.orderId);
    if (!row) continue;
    if (row.done) {
      results.push({ orderId: row.orderId, orderNo: row.orderNo, ok: false, message: `${row.done} – nichts gekauft`, kind: p.choice });
      continue;
    }
    if (p.choice === "warensendung") post.push(row);
    else if (p.choice === "dhl") dhl.push(row);
    else results.push({ orderId: row.orderId, orderNo: row.orderNo, ok: false, message: "übersprungen (bitte prüfen)", kind: "pruefen" });
  }

  let postPdf: Buffer | null = null;
  let postFileId: string | null = null;
  let walletCents: number | null = null;
  if (post.length) {
    try {
      const creds = imCreds(await getIntegration(tenantId, "deutschepost"));
      if (!creds) throw new Error("Deutsche Post (INTERNETMARKE) ist noch nicht eingerichtet – Anbindungen → Deutsche Post.");
      const s = settings.shipper;
      if (!s.name1 || !s.street || !s.zip || !s.city) throw new Error("Absenderadresse fehlt (Einstellungen → Versand).");
      const orders = await Promise.all(post.map((r) => loadOrder(tenantId, r.orderId)));
      const labels = orders.map((d, i) => ({ ref: post[i].orderNo, to: d!.order.shipTo! }));
      const res = await imBuyLabels(creds, {
        sender: s,
        labels,
        productCode: settings.post.productCode,
        priceCents: Math.round(settings.post.price * 100),
        pageFormat: { id: settings.post.pageFormatId, labelX: settings.post.labelX, labelY: settings.post.labelY },
      });
      postPdf = res.pdf;
      walletCents = res.walletCents;
      const fileId = await storeFile(tenantId, `Warensendung_${res.shopOrderId}.pdf`, "application/pdf", res.pdf);
      postFileId = fileId;
      for (const [i, r] of post.entries()) {
        const voucher = res.vouchers[i]?.voucherId || null;
        await db.insert(schema.parcels).values({ tenantId, orderId: r.orderId, carrier: POST_CARRIER, product: `Warensendung ${settings.post.productCode}`, weightKg: String(r.weightKg), trackingNumber: voucher, labelFileId: fileId, status: "created" });
        // Warensendung hat keine Sendungsverfolgung: Versanddienst merken, Sendungsnummer bleibt leer.
        await db.update(schema.orders).set({ status: "label_created", carrier: POST_CARRIER, trackingNumber: null, updatedAt: new Date() }).where(and(eq(schema.orders.id, r.orderId), eq(schema.orders.tenantId, tenantId)));
        results.push({ orderId: r.orderId, orderNo: r.orderNo, ok: true, message: `Warensendung${voucher ? ` · Frankier-ID ${voucher}` : ""}`, kind: "warensendung" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const r of post) results.push({ orderId: r.orderId, orderNo: r.orderNo, ok: false, message: msg, kind: "warensendung" });
    }
  }

  const dhlPdfs: Buffer[] = [];
  for (const r of dhl) {
    const klein = r.weightKg <= settings.dhl.kleinpaketMaxKg && Boolean(settings.dhl.billingNumberKleinpaket);
    try {
      const res = await createLabel({ tenantId, orderId: r.orderId, weightKg: r.weightKg, product: klein ? "kleinpaket" : "paket" });
      const [f] = await db.select({ data: schema.files.data }).from(schema.files).where(and(eq(schema.files.id, res.fileId), eq(schema.files.tenantId, tenantId)));
      if (f) dhlPdfs.push(Buffer.from(f.data));
      results.push({ orderId: r.orderId, orderNo: r.orderNo, ok: true, message: `DHL ${klein ? "Kleinpaket" : "Paket"} ${res.trackingNumber} (${r.weightKg.toLocaleString("de-DE")} kg)${res.sandbox ? " – Sandbox/Test" : ""}`, kind: "dhl" });
    } catch (e) {
      results.push({ orderId: r.orderId, orderNo: r.orderNo, ok: false, message: e instanceof Error ? e.message : String(e), kind: "dhl" });
    }
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const dhlFileId = dhlPdfs.length ? await storeFile(tenantId, `DHL_${stamp}.pdf`, "application/pdf", await mergePdfs(dhlPdfs)) : null;
  const all = [...(postPdf ? [postPdf] : []), ...dhlPdfs];
  const fileId = all.length > 1 ? await storeFile(tenantId, `Labels_${stamp}.pdf`, "application/pdf", await mergePdfs(all)) : (postFileId ?? dhlFileId);
  return { results, fileId, postFileId, dhlFileId, walletCents };
}
