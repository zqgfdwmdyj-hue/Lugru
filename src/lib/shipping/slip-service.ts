import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { db, schema } from "@/db";
import type { Address } from "@/db/schema";
import { getIntegration } from "@/lib/integrations/store";
import { imBuyLabels, imCreds } from "@/lib/integrations/clients/deutschepost";
import { createLabel, loadOrder, storeFile } from "@/lib/orders/service";
import { getSettings } from "@/lib/settings";
import { syncSoon } from "@/lib/stock/channel-sync";
import { parsePackingSlip, type ShipChoice, type SlipOrder } from "./packing-slip";
import { warensendungCheck } from "./warensendung";
import type { ShipperKey } from "./prep";
import { imCsvProblem, internetmarkeCsv, IM_CSV_MAX } from "./internetmarke-csv";
import { mergePdfs } from "./label-pdfs";
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
  /** Warensendung für einen Artikel noch nicht festgelegt – einmal eintragen, dann geht es automatisch. */
  wsNeedsSetup: boolean;
  /** Wer verschickt (ich / Prep Center) – am Auftrag festgelegt oder Vorschlag aus Artikel/Einstellungen. */
  shipper: ShipperKey;
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

/**
 * Zeile der Vorschau zu einem Auftrag: Versandart nach den Bedingungen der Warensendung (je Artikel festgelegt,
 * wie viele Stück hineinpassen; Gewicht; nur Inland) – sonst DHL. Unsicher gelesene Daten → prüfen.
 */
export async function slipRow(tenantId: string, orderId: string, slip?: SlipOrder): Promise<SlipRow | null> {
  const data = await loadOrder(tenantId, orderId);
  if (!data) return null;
  const to = data.order.shipTo ?? {};
  const quantity = data.items.reduce((n, i) => n + i.item.quantity, 0);
  const warnings = [...(slip?.warnings ?? [])];
  if (needsAddress(to)) warnings.push("Lieferadresse unvollständig");
  const w = await orderShipWeight(tenantId, data);
  // Groß-/Kleinschreibung egal: „Lieferadresse unvollständig“ ist genauso unsicher wie „Adresse unvollständig“.
  const unsure = quantity < 1 || warnings.some((x) => /adresse|positionen|land/i.test(x));
  const ws = warensendungCheck({ country: to.country, items: w.items, weightKg: w.kg });
  const choice: ShipChoice = unsure ? "pruefen" : ws.ok ? "warensendung" : "dhl";
  const reason = unsure ? warnings[0] ?? "Menge unklar" : ws.reason;
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
    wsNeedsSetup: !unsure && ws.needsSetup,
    shipper: w.shipper,
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
export type SlipLabels = { results: SlipResult[]; fileId: string | null; postFileId: string | null; dhlFileId: string | null; walletCents: number | null; csvFileId: string | null; csvCount: number };

/** Warensendung über die Schnittstelle kaufen oder als CSV-Datei für den Internetmarke-Shop. */
export type PostMode = "api" | "csv";

/** Vorgabe: Schnittstelle, wenn eingerichtet – sonst CSV-Datei. */
export async function defaultPostMode(tenantId: string): Promise<PostMode> {
  return imCreds(await getIntegration(tenantId, "deutschepost")) ? "api" : "csv";
}


/**
 * Labels für die gewählten Aufträge: alle Warensendungen in einem Kauf (ein PDF), DHL je Auftrag. Aufträge mit
 * Label oder versendet werden übersprungen (nichts doppelt kaufen). Ergebnis: ein gemeinsames PDF zum Drucken.
 */
export async function createSlipLabels(tenantId: string, picks: { orderId: string; choice: ShipChoice; shipper?: ShipperKey }[], postMode?: PostMode): Promise<SlipLabels> {
  // Doppelklick/zweiter Tab: nie zweimal Porto kaufen.
  if (running.has(tenantId)) throw new Error("Labels werden gerade schon erstellt – bitte kurz warten und die Seite neu laden.");
  running.add(tenantId);
  try {
    return await createSlipLabelsNow(tenantId, picks, postMode ?? (await defaultPostMode(tenantId)));
  } finally {
    running.delete(tenantId);
  }
}

const running = new Set<string>();

async function createSlipLabelsNow(tenantId: string, picks: { orderId: string; choice: ShipChoice; shipper?: ShipperKey }[], postMode: PostMode): Promise<SlipLabels> {
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
  let csvFileId: string | null = null;
  let csvCount = 0;
  if (post.length && postMode === "csv") {
    // Ohne Schnittstelle: Adressdatei für den Internetmarke-Shop (Produkt „Warensendung“ dort wählen).
    const s = settings.shipper;
    const ready: { row: SlipRow; to: Address }[] = [];
    if (!s.name1 || !s.street || !s.zip || !s.city) {
      for (const r of post) results.push({ orderId: r.orderId, orderNo: r.orderNo, ok: false, message: "Absenderadresse fehlt (Einstellungen → Versand).", kind: "warensendung" });
    } else {
      for (const r of post) {
        const d = await loadOrder(tenantId, r.orderId);
        const to = d?.order.shipTo ?? {};
        const problem = imCsvProblem(to);
        if (problem) results.push({ orderId: r.orderId, orderNo: r.orderNo, ok: false, message: `nicht in der CSV: ${problem} – im Auftrag ergänzen`, kind: "warensendung" });
        else ready.push({ row: r, to });
      }
    }
    if (ready.length > IM_CSV_MAX - 1) {
      for (const x of ready.splice(IM_CSV_MAX - 1)) results.push({ orderId: x.row.orderId, orderNo: x.row.orderNo, ok: false, message: `mehr als ${IM_CSV_MAX - 1} Adressen – bitte in einem zweiten Durchgang`, kind: "warensendung" });
    }
    if (ready.length) {
      const stampCsv = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      csvFileId = await storeFile(tenantId, `Internetmarke_Warensendung_${stampCsv}.csv`, "text/csv; charset=windows-1252", internetmarkeCsv(s, ready.map((x) => x.to)));
      csvCount = ready.length;
      for (const [i, { row: r }] of ready.entries()) {
        await db.insert(schema.parcels).values({ tenantId, orderId: r.orderId, carrier: POST_CARRIER, product: "Warensendung (CSV für Internetmarke-Shop)", weightKg: String(r.weightKg), trackingNumber: null, labelFileId: null, status: "created" });
        // Wie beim Kauf über die Schnittstelle: „Label erstellt“, damit nichts doppelt entsteht; Porto im Shop.
        await db.update(schema.orders).set({ status: "label_created", carrier: POST_CARRIER, trackingNumber: null, updatedAt: new Date() }).where(and(eq(schema.orders.id, r.orderId), eq(schema.orders.tenantId, tenantId)));
        results.push({ orderId: r.orderId, orderNo: r.orderNo, ok: true, message: `Warensendung · CSV-Zeile ${i + 1} (Porto im Internetmarke-Shop kaufen)`, kind: "warensendung" });
      }
    }
  } else if (post.length) {
    // Unvollständige Anschrift: diese Sendung einzeln melden – sie darf den Kauf der übrigen nicht aufhalten.
    for (const r of [...post]) {
      const d = await loadOrder(tenantId, r.orderId);
      const to = d?.order.shipTo ?? {};
      if (!to.name1?.trim() || !to.street?.trim() || !to.zip?.trim() || !to.city?.trim()) {
        post.splice(post.indexOf(r), 1);
        results.push({ orderId: r.orderId, orderNo: r.orderNo, ok: false, message: "Anschrift unvollständig – im Auftrag ergänzen, dann erneut", kind: "warensendung" });
      }
    }
  }
  if (post.length && postMode !== "csv") {
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
  // Wer verschickt: für jeden erfolgreichen Auftrag festhalten (Auswahl in der Tabelle, sonst Vorschlag) –
  // daraus entsteht die Monatsübersicht fürs Prep Center.
  const shipperOf = new Map<string, ShipperKey>();
  for (const p of picks) shipperOf.set(p.orderId, p.shipper ?? (await slipRow(tenantId, p.orderId))?.shipper ?? settings.prep.defaultShipper);
  for (const r of results) {
    if (!r.ok) continue;
    await db.update(schema.orders).set({ shippedBy: shipperOf.get(r.orderId) ?? settings.prep.defaultShipper }).where(and(eq(schema.orders.id, r.orderId), eq(schema.orders.tenantId, tenantId)));
  }
  return { results, fileId, postFileId, dhlFileId, walletCents, csvFileId, csvCount };
}

/** Nach einem Label ohne Auswahl (Sammel-Labels, Auftragsseite): „Versand durch“ setzen, falls noch leer. */
export async function ensureShipper(tenantId: string, orderId: string) {
  const data = await loadOrder(tenantId, orderId);
  if (!data || data.order.shippedBy) return;
  const w = await orderShipWeight(tenantId, data);
  await db.update(schema.orders).set({ shippedBy: w.shipper }).where(and(eq(schema.orders.id, orderId), eq(schema.orders.tenantId, tenantId)));
}
