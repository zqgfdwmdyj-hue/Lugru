import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { searchOrderIds } from "@/lib/orders/search";
import { loadOrder } from "@/lib/orders/service";
import { productSearch } from "@/lib/products/service";
import { sellerboardRange } from "@/lib/sellerboard/sales";
import { stockLevels } from "@/lib/stock/channel-sync";
import { getSettings } from "@/lib/settings";
import { monthsBack, parseMonthParam, prepExplain, prepSummary } from "@/lib/shipping/prep";
import { prepMonthRows, unassignedMonthRows } from "@/lib/shipping/prep-service";
import { defineTool } from "../types";
import { abs, berlinDateTime, dmy, isoDate, json, round2, uuid } from "./common";

const O = schema.orders;
const I = schema.orderItems;

const STATUS_IN = { offen: ["open"], label: ["label_created"], versendet: ["shipped", "delivered"], storniert: ["cancelled"], retoure: ["returned"] } as const;
const STATUS_OUT: Record<string, string> = { open: "offen", label_created: "Label erstellt", shipped: "versendet", delivered: "zugestellt", cancelled: "storniert", returned: "Retoure" };

async function itemsOf(tenantId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { sku: string | null; titel: string | null; menge: number }[]>();
  const rows = await db.select({ orderId: I.orderId, sku: I.sku, title: I.title, quantity: I.quantity }).from(I).where(and(eq(I.tenantId, tenantId), inArray(I.orderId, ids)));
  const out = new Map<string, { sku: string | null; titel: string | null; menge: number }[]>();
  for (const r of rows) out.set(r.orderId, [...(out.get(r.orderId) ?? []), { sku: r.sku, titel: r.title, menge: r.quantity }]);
  return out;
}

export const auftraege = defineTool({
  name: "auftraege",
  title: "Aufträge ansehen",
  description:
    "Aufträge (Amazon FBM, eBay, Temu …) suchen oder nach Status listen: offen (noch zu versenden), Label erstellt, versendet, storniert. Mit Suche nach Käufername, Bestellnummer, PLZ oder Artikel. Für „Was muss heute raus?“, „Hat Frau X schon ein Label?“.",
  area: "wawi",
  write: false,
  quelle: { text: "Aufträge aus Amazon, eBay und Temu", jobs: ["Amazon-Bestellungen", "eBay-Bestellungen", "Temu-Bestellungen"] },
  input: z.object({
    suche: z.string().trim().min(2).max(100).optional(),
    status: z.enum(["offen", "label", "versendet", "storniert", "retoure", "alle"]).default("offen"),
    verschickt_von: z.enum(["alle", "ich", "prep_center"]).default("alle").describe("Nur Aufträge, die ich selbst bzw. das Prep Center verschickt"),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    let rows: (typeof O.$inferSelect)[];
    const shipper = i.verschickt_von === "prep_center" ? "prep" : i.verschickt_von === "ich" ? "self" : null;
    if (i.suche) {
      const ids = await searchOrderIds(t, i.suche, i.limit);
      rows = ids.length ? await db.select().from(O).where(and(eq(O.tenantId, t), inArray(O.id, ids))).orderBy(desc(O.orderDate)) : [];
      if (i.status !== "alle") rows = rows.filter((o) => (STATUS_IN[i.status as keyof typeof STATUS_IN] as readonly string[]).includes(o.status));
      if (shipper) rows = rows.filter((o) => o.shippedBy === shipper);
    } else {
      const where = [eq(O.tenantId, t)];
      if (i.status !== "alle") where.push(inArray(O.status, [...STATUS_IN[i.status]]));
      if (i.status === "offen" || i.status === "label") where.push(eq(O.fulfillment, "FBM"));
      if (shipper) where.push(eq(O.shippedBy, shipper));
      rows = await db
        .select()
        .from(O)
        .where(and(...where))
        .orderBy(i.status === "offen" || i.status === "label" ? sql`${O.shipBy} asc nulls last` : desc(O.orderDate))
        .limit(i.limit);
    }
    const items = await itemsOf(t, rows.map((o) => o.id));
    // Link zur passenden Liste – auch wenn sie gerade leer ist (z. B. alles versendet).
    const ansicht = i.suche ? "alle" : i.status === "storniert" || i.status === "retoure" ? "alle" : i.status;
    return json({
      anzahl: rows.length,
      link: abs(ctx, i.suche ? `/auftraege?q=${encodeURIComponent(i.suche)}` : `/auftraege?ansicht=${ansicht}`),
      auftraege: rows.map((o) => ({
        id: o.id,
        kanal: o.channel,
        nummer: o.externalId,
        bestellt: berlinDateTime(o.orderDate),
        versand_bis: berlinDateTime(o.shipBy),
        status: STATUS_OUT[o.status] ?? o.status,
        versand: o.fulfillment,
        kaeufer: o.buyerName,
        summe: round2(o.total),
        versanddienst: o.carrier,
        sendungsnummer: o.trackingNumber,
        verschickt_von: o.shippedBy === "prep" ? "Prep Center" : o.shippedBy === "self" ? "ich" : undefined,
        positionen: items.get(o.id) ?? [],
        link: abs(ctx, `/auftraege/${o.id}`),
      })),
    });
  },
});

export const prepCenter = defineTool({
  name: "prep_center",
  title: "Versand über das Prep Center",
  description:
    "Alles zum Prep Center (externer Versanddienstleister, der FBM-Aufträge für uns verschickt – NICHT das Palettenlager): je Monat Sendungen, Stück, Versandarten und erwartete Kosten laut hinterlegten Gebühren; mit „monate“ die Entwicklung über mehrere Monate (Kosten je Monat); dazu, wie viele Sendungen noch keinem Versender zugeordnet sind, und eine feste Erklärung, wie „verschickt von“ und die Abrechnung funktionieren. Optional die Liste je Sendung. Immer dieses Werkzeug nutzen bei Fragen wie „Was macht das Prep Center?“, „Wie viele Sendungen hat das Prep Center diesen Monat?“, „Was kostet das Prep Center je Monat?“, „Stimmt die Rechnung vom Prep Center?“.",
  area: "wawi",
  write: false,
  quelle: { text: "Aufträge aus Amazon, eBay und Temu (verschickt von)", jobs: ["Amazon-Bestellungen", "eBay-Bestellungen", "Temu-Bestellungen"] },
  input: z.object({
    monat: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Monat als JJJJ-MM").optional().describe("Standard: aktueller Monat"),
    monate: z.number().int().min(1).max(12).default(1).describe("Anzahl Monate bis einschließlich „monat“ – ab 2 mit Verlauf je Monat"),
    mit_liste: z.boolean().default(false).describe("Auch die einzelnen Sendungen des Monats zeigen"),
    limit: z.number().int().min(1).max(300).default(50),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const month = parseMonthParam(i.monat, ctx.today);
    const settings = await getSettings(t);
    const fees = { feeShipment: settings.prep.feeShipment, feeExtraItem: settings.prep.feeExtraItem };
    const months = monthsBack(month, i.monate);
    const per = await Promise.all(months.map(async (m) => ({ m, rows: await prepMonthRows(t, m), open: (await unassignedMonthRows(t, m)).length })));
    const cur = per.at(-1)!;
    const sum = prepSummary(cur.rows, fees);
    return json({
      prep_center: settings.prep.name || "Prep Center",
      so_funktioniert_es: prepExplain(settings.prep),
      einstellungen: {
        standard_versender: settings.prep.defaultShipper === "prep" ? settings.prep.name || "Prep Center" : "ich selbst",
        gebuehr_je_sendung: settings.prep.feeShipment || undefined,
        gebuehr_je_weiteres_stueck: settings.prep.feeExtraItem || undefined,
      },
      monat: month,
      sendungen: sum.shipments,
      stueck: sum.units,
      je_versandart: sum.byProduct.map((b) => ({ versandart: b.product, sendungen: b.shipments, stueck: b.units })),
      erwartete_kosten: sum.expected ?? undefined,
      kosten_hinweis: sum.expected === null ? "Keine Gebühren hinterlegt (Einstellungen → Prep Center)." : undefined,
      noch_nicht_zugeordnet: cur.open || undefined,
      zuordnung_hinweis: cur.open ? `${cur.open} Sendung(en) in diesem Monat ohne Angabe, wer verschickt hat – in der Monatsübersicht zuordnen, sonst fehlen sie hier.` : undefined,
      verlauf:
        per.length > 1
          ? per.map(({ m, rows, open }) => {
              const s = prepSummary(rows, fees);
              return { monat: m, sendungen: s.shipments, stueck: s.units, erwartete_kosten: s.expected ?? undefined, noch_nicht_zugeordnet: open || undefined };
            })
          : undefined,
      liste: i.mit_liste ? cur.rows.slice(0, i.limit).map((r) => ({ tag: r.day, kanal: r.channel, bestellnummer: r.externalId, stueck: r.units, artikel: r.items, versandart: r.product, sendungsnummer: r.tracking ?? undefined, status: r.status, link: abs(ctx, `/auftraege/${r.orderId}`) })) : undefined,
      link: abs(ctx, `/auftraege/prep-center?monat=${month}`),
      einstellungen_link: abs(ctx, "/einstellungen#prep"),
    });
  },
});

export const auftrag = defineTool({
  name: "auftrag",
  title: "Auftrag im Detail",
  description: "Ein Auftrag mit Positionen, Lieferadresse, Status, Sendungsnummer, Paketen und Notiz. Kennung (id) oder Bestellnummer angeben.",
  area: "wawi",
  write: false,
  quelle: { text: "Aufträge aus Amazon, eBay und Temu", jobs: ["Amazon-Bestellungen", "eBay-Bestellungen", "Temu-Bestellungen"] },
  input: z.object({ id_oder_nummer: z.string().trim().min(3).max(80) }),
  run: async (ctx, { id_oder_nummer }) => {
    const t = ctx.session.tenantId;
    let id = /^[0-9a-f-]{36}$/i.test(id_oder_nummer) ? id_oder_nummer : null;
    if (!id) {
      const [o] = await db.select({ id: O.id }).from(O).where(and(eq(O.tenantId, t), eq(O.externalId, id_oder_nummer))).limit(1);
      id = o?.id ?? null;
    }
    const data = id ? await loadOrder(t, id) : null;
    if (!data) return { text: "Auftrag nicht gefunden.", isError: true };
    const o = data.order;
    return json({
      id: o.id,
      kanal: o.channel,
      nummer: o.externalId,
      bestellt: berlinDateTime(o.orderDate),
      versand_bis: berlinDateTime(o.shipBy),
      versendet: berlinDateTime(o.shippedAt),
      status: STATUS_OUT[o.status] ?? o.status,
      kanal_status: o.externalStatus,
      kaeufer: o.buyerName,
      lieferadresse: o.shipTo,
      summe: round2(o.total),
      gebuehren: round2(o.fees),
      versanddienst: o.carrier,
      sendungsnummer: o.trackingNumber,
      sendungsnummer_gemeldet: berlinDateTime(o.trackingUploadedAt),
      meldefehler: o.trackingUploadError,
      notiz: o.notes,
      positionen: data.items.map((x) => ({ sku: x.item.sku, titel: x.productTitle ?? x.item.title, menge: x.item.quantity, preis: round2(x.item.price), gewicht_g: x.weightGrams })),
      pakete: data.parcels.map((p) => ({ versanddienst: p.carrier, sendungsnummer: p.trackingNumber, status: p.status, erstellt: berlinDateTime(p.createdAt) })),
      link: abs(ctx, `/auftraege/${o.id}`),
    });
  },
});

export const auftragNotiz = defineTool({
  name: "auftrag_notiz",
  title: "Notiz am Auftrag",
  description: "Ergänzt die interne Notiz eines Auftrags (mit Datum und Name). Ändert nichts beim Marktplatz.",
  area: "wawi",
  write: true,
  input: z.object({ id: uuid, notiz: z.string().trim().min(1).max(1000) }),
  summary: (i) => `Notiz am Auftrag: „${i.notiz.slice(0, 80)}“`,
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const [o] = await db.select({ notes: O.notes, externalId: O.externalId }).from(O).where(and(eq(O.tenantId, t), eq(O.id, i.id)));
    if (!o) return { text: "Auftrag nicht gefunden.", isError: true };
    const line = `${ctx.today.split("-").reverse().join(".")} ${ctx.session.name || ctx.session.email}: ${i.notiz}`;
    await db.update(O).set({ notes: o.notes ? `${o.notes}\n${line}` : line }).where(and(eq(O.tenantId, t), eq(O.id, i.id)));
    return json({ ok: true, meldung: `Notiz an Auftrag ${o.externalId} ergänzt.` });
  },
});

export const produkte = defineTool({
  name: "produkte",
  title: "Produkte und Bestand",
  description: "Sucht Produkte (SKU, EAN, ASIN, Name) und zeigt je SKU den Wawi-Bestand: im Lager, in offenen Aufträgen reserviert, verfügbar – dazu FBA-Bestand bei Amazon, falls vorhanden. Für „Wie viele haben wir noch von …?“.",
  area: "wawi",
  write: false,
  quelle: { text: "Produkte, Chargen und Bestand (eigenes Lager, Amazon, eBay)", jobs: ["Amazon-Reports abholen", "Bestandsabgleich Kanäle"] },
  input: z.object({ suche: z.string().trim().min(2).max(100), limit: z.number().int().min(1).max(30).default(10) }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const found = await productSearch(t, i.suche, i.limit);
    const skus = [...new Set(found.rows.flatMap((r) => r.skus))].slice(0, 200);
    const [levels, own, fba] = await Promise.all([
      stockLevels(t, skus),
      skus.length ? db.select({ sku: schema.ownStock.sku, location: schema.ownStock.location, quantity: schema.ownStock.quantity }).from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, t), inArray(schema.ownStock.sku, skus))) : Promise.resolve([]),
      skus.length
        ? db
            .select({ sku: schema.amazonInventory.sku, fulfillable: schema.amazonInventory.fulfillable, reserved: schema.amazonInventory.reserved, inbound: sql<number>`coalesce(${schema.amazonInventory.inboundWorking},0)+coalesce(${schema.amazonInventory.inboundShipped},0)+coalesce(${schema.amazonInventory.inboundReceiving},0)` })
            .from(schema.amazonInventory)
            .where(and(eq(schema.amazonInventory.tenantId, t), inArray(schema.amazonInventory.sku, skus)))
        : Promise.resolve([]),
    ]);
    return json({
      treffer: found.total,
      produkte: found.rows.map((r) => ({
        titel: r.title,
        asin: r.asin,
        ean: r.ean,
        link: abs(ctx, r.href),
        skus: r.skus.map((sku) => {
          const l = levels.get(sku);
          const f = fba.find((x) => x.sku === sku);
          return {
            sku,
            lager: l?.onHand ?? 0,
            reserviert: l?.reserved ?? 0,
            verfuegbar: l ? Math.max(0, l.onHand - l.reserved) : 0,
            lagerplatz: own.filter((x) => x.sku === sku && x.location).map((x) => `${x.location} (${x.quantity})`).join(", ") || undefined,
            fba: f ? { verkaufbar: f.fulfillable, reserviert: f.reserved, unterwegs: Number(f.inbound) } : undefined,
          };
        }),
      })),
    });
  },
});

const PRESETS = ["heute", "gestern", "7_tage", "30_tage", "monat", "letzter_monat"] as const;

export const umsatz = defineTool({
  name: "umsatz",
  title: "Umsatz und Gewinn",
  description: "Umsatz (brutto), Bestellungen, Einheiten und Gewinn laut sellerboard für einen Zeitraum – vordefiniert (heute, gestern, 7_tage, 30_tage, monat = laufender Monat, letzter_monat) oder mit von/bis.",
  area: "geld",
  write: false,
  quelle: { text: "sellerboard", jobs: ["sellerboard:*"] },
  input: z.object({ zeitraum: z.enum(PRESETS).optional(), von: isoDate.optional(), bis: isoDate.optional() }),
  run: async (ctx, i) => {
    const today = ctx.today;
    let from = i.von ?? today;
    let to = i.bis ?? today;
    if (i.zeitraum === "gestern") from = to = addDaysIso(today, -1);
    else if (i.zeitraum === "7_tage") from = addDaysIso(today, -6);
    else if (i.zeitraum === "30_tage") from = addDaysIso(today, -29);
    else if (i.zeitraum === "monat") from = `${today.slice(0, 7)}-01`;
    else if (i.zeitraum === "letzter_monat") {
      const first = `${today.slice(0, 7)}-01`;
      to = addDaysIso(first, -1);
      from = `${to.slice(0, 7)}-01`;
    }
    if (to < from) return { text: "„bis“ liegt vor „von“.", isError: true };
    const r = await sellerboardRange(ctx.session.tenantId, from, to);
    if (!r) return "Keine sellerboard-Werte für diesen Zeitraum (sellerboard nicht verbunden oder noch nicht abgeglichen).";
    return json({ zeitraum: `${dmy(r.from)} – ${dmy(r.to)}`, von: r.from, bis: r.to, link: abs(ctx, "/gewinn"), umsatz_brutto: round2(r.sales), bruttogewinn: round2(r.grossProfit), nettogewinn: round2(r.netProfit), bestellungen: r.orders, einheiten: r.units, kanaele: r.channels, vollstaendig: r.complete, tage: `${r.daysCovered} von ${r.daysWanted}`, ek_fehlt_teilweise: r.missingCost || undefined });
  },
});

export const WAWI = [auftraege, auftrag, auftragNotiz, prepCenter, produkte, umsatz];

