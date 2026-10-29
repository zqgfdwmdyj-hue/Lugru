import "server-only";
import { and, eq, inArray, lt, or, gt } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { mappingWorklist } from "@/lib/products/service";
import { DISCREPANCY_KINDS, DISCREPANCY_LABEL, stockDiscrepancies } from "@/lib/stock/discrepancies";
import { defineTool } from "../types";
import { abs, json } from "./common";

// Gezielte Prüf-Werkzeuge für den Bestand: Abweichungen und fehlende Einkaufspreise. Nur lesen.

export const bestandsabweichungen = defineTool({
  name: "bestandsabweichungen",
  title: "Bestandsabweichungen",
  description:
    "Wo Soll und Ist beim Bestand nicht zusammenpassen: FBA-Sendungen mit Fehlmenge (verschickt > empfangen), offene Inventuren mit Differenz, negativer Bestand im eigenen Lager, Ware, die Amazon gerade sucht oder die unverkäuflich ist, und Bestand, der sich mangels Zuordnung nicht abgleichen lässt. Größte Differenz zuerst. Nur lesen – korrigiert wird nichts. Für „Wo stimmt der Bestand nicht?“.",
  area: "wawi",
  write: false,
  quelle: { text: "FBA-Sendungen, Inventuren, eigenes Lager, Amazon-Bestandsberichte", jobs: ["Amazon-Reports abholen", "Bestandsabgleich Kanäle"], importe: true },
  input: z.object({
    art: z.enum(["alle", ...DISCREPANCY_KINDS]).default("alle").describe("Nur eine Art von Abweichung oder alle"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const want = (k: (typeof DISCREPANCY_KINDS)[number]) => i.art === "alle" || i.art === k;
    const S = schema.sellerboardShipments;
    const A = schema.amazonInventory;
    const [shipments, countLines, own, amazon, mapping] = await Promise.all([
      want("fba_sendung") ? db.select({ name: S.name, amazonId: S.amazonId, status: S.status, lastUpdate: S.lastUpdate, lines: S.lines }).from(S).where(and(eq(S.tenantId, t), inArray(S.status, ["CLOSED", "RECEIVING", "CHECKED_IN", "DELIVERED"]))) : [],
      want("inventur")
        ? db
            .select({ countId: schema.inventoryCounts.id, countName: schema.inventoryCounts.name, sku: schema.inventoryCountLines.sku, expected: schema.inventoryCountLines.expected, counted: schema.inventoryCountLines.counted })
            .from(schema.inventoryCountLines)
            .innerJoin(schema.inventoryCounts, and(eq(schema.inventoryCounts.id, schema.inventoryCountLines.countId), eq(schema.inventoryCounts.tenantId, t)))
            .where(and(eq(schema.inventoryCountLines.tenantId, t), eq(schema.inventoryCounts.status, "open")))
        : [],
      want("negativ") ? db.select({ sku: schema.ownStock.sku, quantity: schema.ownStock.quantity }).from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, t), lt(schema.ownStock.quantity, 0))) : [],
      want("amazon_klaerung") || want("amazon_unverkaeuflich")
        ? db.select({ sku: A.sku, title: A.title, unsellable: A.unsellable, researching: A.researching, unsellableSince: A.unsellableSince }).from(A).where(and(eq(A.tenantId, t), or(gt(A.unsellable, 0), gt(A.researching, 0))))
        : [],
      want("zuordnung") ? mappingWorklist(t) : [],
    ]);
    const all = stockDiscrepancies({ today: ctx.today, shipments, countLines, ownStock: own, amazon, mapping }).filter((d) => want(d.kind));
    const perKind = Object.fromEntries(DISCREPANCY_KINDS.map((k) => [DISCREPANCY_LABEL[k], all.filter((d) => d.kind === k).length]).filter(([, n]) => n));
    return json({
      anzahl: all.length,
      je_art: perKind,
      abweichungen: all.slice(0, i.limit).map((d) => ({ art: DISCREPANCY_LABEL[d.kind], sku: d.sku, titel: d.title ?? undefined, soll: d.expected ?? undefined, ist: d.actual ?? undefined, differenz: d.diff || undefined, hinweis: d.detail, seit: d.since ?? undefined, link: abs(ctx, d.href) })),
      hinweis: all.length > i.limit ? `Nur die ersten ${i.limit} – mit „art“ eingrenzen.` : undefined,
      link: abs(ctx, "/produkte?ansicht=zuordnung"),
    });
  },
});

const num = (detail: string, re: RegExp) => Number(re.exec(detail)?.[1] ?? 0);

export const fehlendeEinkaufspreise = defineTool({
  name: "fehlende_einkaufspreise",
  title: "Fehlende Einkaufspreise",
  description:
    "SKUs mit Bestand oder Verkäufen (90 Tage), für die kein gültiger Einkaufspreis hinterlegt ist (sellerboard-Platzhalter 0,01 € zählen nicht) – meiste Stück zuerst. Optional auch SKUs, bei denen Charge, EK von Hand, eBay-Tool und sellerboard unterschiedliche Preise nennen. Ohne EK sind Gewinn und Lagerwert unvollständig.",
  area: "wawi",
  write: false,
  quelle: { text: "Chargen und Einkaufspreise im Seller-System, Bestand", jobs: ["Amazon-Reports abholen"], importe: true },
  input: z.object({ mit_widerspruechen: z.boolean().default(false).describe("Auch widersprüchliche EK zeigen"), limit: z.number().int().min(1).max(200).default(50) }),
  run: async (ctx, i) => {
    const issues = await mappingWorklist(ctx.session.tenantId);
    const weight = (d: string) => num(d, /(\d+) im Lager/) + num(d, /(\d+) bei Amazon/) + num(d, /(\d+) verkauft/);
    const missing = issues.filter((x) => x.kind === "ek-fehlt").sort((a, b) => weight(b.detail) - weight(a.detail) || a.sku.localeCompare(b.sku));
    const conflicts = i.mit_widerspruechen ? issues.filter((x) => x.kind === "ek-abweichung") : [];
    return json({
      ohne_ek: missing.length,
      skus: missing.slice(0, i.limit).map((x) => ({ sku: x.sku, titel: x.title ?? undefined, menge: x.detail, link: abs(ctx, x.href) })),
      widersprueche: i.mit_widerspruechen ? { anzahl: conflicts.length, skus: conflicts.slice(0, i.limit).map((x) => ({ sku: x.sku, titel: x.title ?? undefined, quellen: x.detail, link: abs(ctx, x.href) })) } : undefined,
      hinweis: "EK trägst du je Produkt unter „Einkauf“ ein; es gilt: Charge → EK von Hand → eBay-Tool → Set-Summe → sellerboard.",
      link: abs(ctx, "/produkte?ansicht=zuordnung&art=ek-fehlt"),
    });
  },
});

export const BESTAND = [bestandsabweichungen, fehlendeEinkaufspreise];
