import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { PLACEHOLDER_COST_MAX, pickOriginLot } from "@/lib/costs/returns";
import { parseSku, type SkuSchema } from "@/lib/sku/parse";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import type { ParsedImport } from "./arbitrageone";

export type ImportStats = {
  source: ParsedImport["source"];
  rows: number;
  created: number;
  updated: number;
  skipped: ParsedImport["skipped"];
  schemas: Partial<Record<SkuSchema, number>>;
  returnsInherited: number;
  returnsWithoutOrigin: number;
  costConflicts: number;
  estimatedDates: number;
  referenceDate: string;
};

const CHUNK = 500;
const chunks = <T,>(xs: T[]) =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

/** Stichtag aus Dateinamen wie "…_Export_27.09.2026.csv", sonst heute. */
export function referenceDateFromFileName(fileName: string | null | undefined): Date {
  const m = fileName ? /(\d{2})\.(\d{2})\.(\d{4})/.exec(fileName) : null;
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return new Date();
}

export async function applyImport(opts: {
  tenantId: string;
  userId: string;
  fileName: string;
  parsed: ParsedImport;
  vatRate?: number;
}): Promise<ImportStats> {
  const { tenantId, parsed } = opts;
  const reference = referenceDateFromFileName(opts.fileName);

  // Zeilen mit gleicher SKU in einer Datei: die letzte gewinnt.
  const bySku = new Map(parsed.rows.map((r) => [r.sku, r]));
  const rows = [...bySku.values()].map((r) => ({
    row: r,
    sku: parseSku(r.sku, { reference, vatRate: opts.vatRate }),
  }));

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(schema.importRuns)
      .values({ tenantId, userId: opts.userId, source: parsed.source, fileName: opts.fileName })
      .returning({ id: schema.importRuns.id });

    // Shops
    const codes = [...new Set(rows.map((r) => r.sku.supplierCode).filter((c): c is string => !!c))];
    for (const part of chunks(codes)) {
      await tx
        .insert(schema.suppliers)
        .values(part.map((code) => ({ tenantId, code })))
        .onConflictDoNothing();
    }
    const supplierIds = new Map(
      codes.length
        ? (
            await tx
              .select({ id: schema.suppliers.id, code: schema.suppliers.code })
              .from(schema.suppliers)
              .where(and(eq(schema.suppliers.tenantId, tenantId), inArray(schema.suppliers.code, codes)))
          ).map((s) => [s.code, s.id])
        : [],
    );

    // Artikel
    const titles = new Map<string, string | null>();
    for (const { row } of rows) {
      if (!titles.has(row.asin) || row.title) titles.set(row.asin, row.title ?? null);
    }
    const asins = [...titles.keys()];
    for (const part of chunks(asins)) {
      await tx
        .insert(schema.products)
        .values(part.map((asin) => ({ tenantId, asin, title: titles.get(asin) })))
        .onConflictDoUpdate({
          target: [schema.products.tenantId, schema.products.asin],
          set: { title: sql`coalesce(excluded.title, ${schema.products.title})` },
        });
    }
    const productIds = new Map<string, string>();
    for (const part of chunks(asins)) {
      const found = await tx
        .select({ id: schema.products.id, asin: schema.products.asin })
        .from(schema.products)
        .where(and(eq(schema.products.tenantId, tenantId), inArray(schema.products.asin, part)));
      for (const p of found) productIds.set(p.asin, p.id);
    }

    // Chargen
    let created = 0;
    let updated = 0;
    const lotIds = new Map<string, string>();
    const num = (n: number | null | undefined) => (n === null || n === undefined ? null : String(n));
    for (const part of chunks(rows)) {
      const values = part.map(({ row, sku }) => {
        const isReturn = sku.schema === "RET";
        return {
          tenantId,
          productId: productIds.get(row.asin)!,
          sku: row.sku,
          kind: isReturn ? ("return" as const) : sku.schema === "UNKNOWN" ? ("unknown" as const) : ("purchase" as const),
          skuSchema: sku.schema,
          supplierId: sku.supplierCode ? (supplierIds.get(sku.supplierCode) ?? null) : null,
          fnsku: row.fnsku ?? null,
          purchaseDate: isReturn ? null : (row.purchaseDate ?? sku.date),
          purchaseDateEstimated: isReturn ? false : !row.purchaseDate && sku.dateEstimated,
          quantity: row.quantity ?? null,
          currency: row.currency ?? "EUR",
          skuCostNet: num(sku.costNet),
          skuCostGross: num(sku.costGross),
          skuTargetPrice: num(sku.targetPrice),
          returnLpn: sku.ret?.lpn ?? null,
          returnCode: sku.ret?.code ?? null,
          returnChannel: sku.ret?.channel ?? null,
          returnDate: isReturn ? sku.date : null,
        };
      });
      const L = schema.lots;
      const res = await tx
        .insert(L)
        .values(values)
        .onConflictDoUpdate({
          target: [L.tenantId, L.sku],
          set: {
            productId: sql`excluded.product_id`,
            kind: sql`excluded.kind`,
            skuSchema: sql`excluded.sku_schema`,
            supplierId: sql`coalesce(excluded.supplier_id, ${L.supplierId})`,
            fnsku: sql`coalesce(excluded.fnsku, ${L.fnsku})`,
            // Ein echtes Datum aus der Vorlage schlägt ein geschätztes aus der SKU.
            purchaseDate: sql`case when ${L.purchaseDateEstimated} or ${L.purchaseDate} is null then coalesce(excluded.purchase_date, ${L.purchaseDate}) else ${L.purchaseDate} end`,
            purchaseDateEstimated: sql`case when ${L.purchaseDateEstimated} or ${L.purchaseDate} is null then excluded.purchase_date_estimated else false end`,
            quantity: sql`coalesce(excluded.quantity, ${L.quantity})`,
            currency: sql`excluded.currency`,
            skuCostNet: sql`excluded.sku_cost_net`,
            skuCostGross: sql`excluded.sku_cost_gross`,
            skuTargetPrice: sql`excluded.sku_target_price`,
            returnLpn: sql`excluded.return_lpn`,
            returnCode: sql`excluded.return_code`,
            returnChannel: sql`excluded.return_channel`,
            returnDate: sql`excluded.return_date`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: L.id, sku: L.sku, inserted: sql<boolean>`(xmax = 0)` });
      for (const r of res) {
        lotIds.set(r.sku, r.id);
        if (r.inserted) created++;
        else updated++;
      }
    }

    // EK-Beobachtungen dieser Quelle. 0,01 € / 0,10 € bei Retouren sind nur Platzhalter.
    const observations = rows
      .filter(({ row, sku }) => row.costNet !== null && !(sku.schema === "RET" && row.costNet <= PLACEHOLDER_COST_MAX))
      .map(({ row }) => ({
        tenantId,
        lotId: lotIds.get(row.sku)!,
        source: parsed.source,
        valueNet: String(row.costNet),
        importRunId: run.id,
      }));
    for (const part of chunks(observations)) {
      await tx
        .insert(schema.costObservations)
        .values(part)
        .onConflictDoUpdate({
          target: [schema.costObservations.lotId, schema.costObservations.source],
          set: {
            valueNet: sql`excluded.value_net`,
            importRunId: sql`excluded.import_run_id`,
            observedAt: sql`now()`,
          },
        });
    }

    await applyCostPriority(tx, tenantId);
    const returns = await recomputeReturnCosts(tx, tenantId);
    const costConflicts = await countCostConflicts(tx, tenantId);
    const [{ estimated }] = await tx
      .select({ estimated: sql<number>`count(*)::int` })
      .from(schema.lots)
      .where(and(eq(schema.lots.tenantId, tenantId), eq(schema.lots.purchaseDateEstimated, true)));

    await refreshDataQualityTasks(tx, tenantId, {
      returnsWithoutOrigin: returns.withoutOrigin,
      costConflicts,
    });

    const schemas: ImportStats["schemas"] = {};
    for (const { sku } of rows) schemas[sku.schema] = (schemas[sku.schema] ?? 0) + 1;

    const stats: ImportStats = {
      source: parsed.source,
      rows: rows.length,
      created,
      updated,
      skipped: parsed.skipped,
      schemas,
      returnsInherited: returns.inherited,
      returnsWithoutOrigin: returns.withoutOrigin,
      costConflicts,
      estimatedDates: estimated,
      referenceDate: reference.toISOString().slice(0, 10),
    };
    await tx.update(schema.importRuns).set({ stats }).where(eq(schema.importRuns.id, run.id));
    return stats;
  });
}

/**
 * Gültiger EK je Charge: manuell > eigene Vorlage (mit Versandkosten) > AccountOne > Sellerboard.
 */
export async function applyCostPriority(tx: Tx, tenantId: string) {
  await tx.execute(sql`
    update lots l
       set unit_cost_net = o.value_net,
           unit_cost_source = o.source,
           updated_at = now()
      from (
        select distinct on (lot_id) lot_id, value_net, source
          from cost_observations
         where tenant_id = ${tenantId}
         order by lot_id,
                  case source when 'template' then 1 when 'accountone' then 2 when 'sellerboard' then 3 else 9 end
      ) o
     where l.id = o.lot_id
       and l.tenant_id = ${tenantId}
       and coalesce(l.unit_cost_source, '') <> 'manual'
       and (l.unit_cost_net is distinct from o.value_net or l.unit_cost_source is distinct from o.source)
  `);
}

/** Retouren ohne eigenen EK erben ihn von der passenden Einkaufs-Charge derselben ASIN. */
export async function recomputeReturnCosts(tx: Tx, tenantId: string) {
  const L = schema.lots;
  const returns = await tx
    .select({ id: L.id, productId: L.productId, returnDate: L.returnDate })
    .from(L)
    .where(
      and(
        eq(L.tenantId, tenantId),
        eq(L.kind, "return"),
        or(isNull(L.unitCostSource), eq(L.unitCostSource, "inherited")),
      ),
    );
  if (returns.length === 0) return { inherited: 0, withoutOrigin: 0 };

  const productIds = [...new Set(returns.map((r) => r.productId))];
  const purchases = await tx
    .select({ id: L.id, productId: L.productId, purchaseDate: L.purchaseDate, unitCostNet: L.unitCostNet })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), eq(L.kind, "purchase"), inArray(L.productId, productIds)));
  const byProduct = new Map<string, typeof purchases>();
  for (const p of purchases) byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p]);

  let inherited = 0;
  let withoutOrigin = 0;
  for (const r of returns) {
    const candidates = (byProduct.get(r.productId) ?? []).map((p) => ({
      id: p.id,
      purchaseDate: p.purchaseDate,
      unitCostNet: p.unitCostNet === null ? null : Number(p.unitCostNet),
    }));
    const origin = pickOriginLot(r.returnDate, candidates);
    if (origin) {
      inherited++;
      await tx
        .update(L)
        .set({
          unitCostNet: String(origin.unitCostNet),
          unitCostSource: "inherited",
          parentLotId: origin.lotId,
          updatedAt: new Date(),
        })
        .where(eq(L.id, r.id));
    } else {
      withoutOrigin++;
      await tx
        .update(L)
        .set({ unitCostNet: null, unitCostSource: null, parentLotId: null, updatedAt: new Date() })
        .where(and(eq(L.id, r.id), eq(L.unitCostSource, "inherited")));
    }
  }
  return { inherited, withoutOrigin };
}

/** Chargen, für die verschiedene Quellen verschiedene EK liefern (> 2 Cent). */
export async function countCostConflicts(tx: Tx, tenantId: string): Promise<number> {
  const res = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from (
      select lot_id from cost_observations
       where tenant_id = ${tenantId}
       group by lot_id
      having max(value_net) - min(value_net) > 0.02
    ) x
  `);
  return res.rows[0]?.n ?? 0;
}

async function refreshDataQualityTasks(
  tx: Tx,
  tenantId: string,
  counts: { returnsWithoutOrigin: number; costConflicts: number },
) {
  if (counts.returnsWithoutOrigin > 0) {
    await upsertSystemTask(tx, tenantId, "returns-without-origin", {
      title: `${counts.returnsWithoutOrigin} Retouren ohne Ursprungs-Charge – EK fehlt`,
      notes:
        "Zu diesen Retouren gibt es keinen Einkauf derselben ASIN mit EK. Ohne EK fehlen sie im COG-Export. EK von Hand eintragen oder den passenden Einkauf importieren.",
      category: "einkauf",
      link: "/chargen?filter=ohne-ek",
    });
  } else {
    await resolveSystemTask(tx, tenantId, "returns-without-origin");
  }

  if (counts.costConflicts > 0) {
    await upsertSystemTask(tx, tenantId, "cost-conflicts", {
      title: `${counts.costConflicts} Chargen mit unterschiedlichem EK je nach Export`,
      notes:
        "Arbitrage One liefert für dieselbe SKU je nach Export verschiedene Werte. Verwendet wird: eigene Vorlage > AccountOne > Sellerboard. Bitte prüfen.",
      category: "einkauf",
      priority: "low",
      link: "/chargen?filter=abweichung",
    });
  } else {
    await resolveSystemTask(tx, tenantId, "cost-conflicts");
  }
}
