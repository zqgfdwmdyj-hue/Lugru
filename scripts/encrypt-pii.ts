import type { Pool } from "pg";
import { INVOICE_PII_PATHS, isSealedPii, sealBytes, sealJsonPaths, sealPii } from "../src/lib/pii";

// Altbestand verschlüsseln: Empfängerdaten, die noch im Klartext in der Datenbank stehen, werden
// einmalig verschlüsselt (siehe src/lib/pii.ts). Läuft bei jedem Start nach den Migrationen und
// fasst nur Zeilen an, die noch nicht verschlüsselt sind – mehrfaches Ausführen ist harmlos.

const BATCH = 200;
const sealText = (v: string | null) => (v === null || isSealedPii(v) ? v : sealPii(v));

/** Zeilen blockweise (nach id) abarbeiten, damit große Tabellen den Speicher nicht sprengen. */
async function eachBatch<R extends { id: string | number }>(pool: Pool, select: string, fn: (rows: R[]) => Promise<void>, batch = BATCH): Promise<number> {
  let after: string | number | null = null;
  let total = 0;
  for (;;) {
    const { rows }: { rows: R[] } = await pool.query<R>(`${select} and ($1::text is null or id::text > $1::text) order by id::text limit ${batch}`, [after === null ? null : String(after)]);
    if (!rows.length) return total;
    await fn(rows);
    total += rows.length;
    after = rows[rows.length - 1].id;
  }
}

export async function encryptLegacyPii(pool: Pool): Promise<Record<string, number>> {
  const done: Record<string, number> = {};

  done.orders = await eachBatch<{ id: string; buyer_name: string | null; ship_to: unknown }>(
    pool,
    `select id, buyer_name, ship_to from orders where ((buyer_name is not null and buyer_name not like 'pii:v1.%') or jsonb_typeof(ship_to) in ('object', 'array'))`,
    async (rows) => {
      for (const r of rows) {
        const shipTo = r.ship_to === null || isSealedPii(r.ship_to) ? r.ship_to : sealPii(JSON.stringify(r.ship_to));
        await pool.query(`update orders set buyer_name = $2, ship_to = $3::jsonb where id = $1`, [r.id, sealText(r.buyer_name), shipTo === null ? null : JSON.stringify(shipTo)]);
      }
    },
  );

  done.cases = await eachBatch<{ id: string; customer: string }>(pool, `select id, customer from cases where customer is not null and customer not like 'pii:v1.%'`, async (rows) => {
    for (const r of rows) await pool.query(`update cases set customer = $2 where id = $1`, [r.id, sealText(r.customer)]);
  });

  done.customers = await eachBatch<{ id: string; contact: string | null; street: string; email: string | null }>(
    pool,
    `select id, contact, street, email from customers where (street not like 'pii:v1.%' or (contact is not null and contact not like 'pii:v1.%') or (email is not null and email not like 'pii:v1.%'))`,
    async (rows) => {
      for (const r of rows) await pool.query(`update customers set contact = $2, street = $3, email = $4 where id = $1`, [r.id, sealText(r.contact), sealText(r.street), sealText(r.email)]);
    },
  );

  done.invoices = await eachBatch<{ id: number; data: Record<string, unknown> }>(
    pool,
    `select id, data from ebay_invoices where jsonb_typeof(data) = 'object' and not data ? 'pii' and (data ?| array['buyer', 'buyerEmail', 'buyerUsername'] or coalesce(data->'b2b', '{}'::jsonb) ?| array['buyerAddress', 'buyerEmail', 'buyerVatId'])`,
    async (rows) => {
      for (const r of rows) await pool.query(`update ebay_invoices set data = $2::jsonb where id = $1`, [r.id, JSON.stringify(sealJsonPaths(r.data, INVOICE_PII_PATHS))]);
    },
  );

  // Dateien (Versandetiketten, Importdateien, Belege) können groß sein → kleinere Blöcke.
  done.files = await eachBatch<{ id: string; data: Buffer }>(
    pool,
    `select id, data from files where substring(data from 1 for 8) <> '\\x504949454e433100'::bytea`,
    async (rows) => {
      for (const r of rows) await pool.query(`update files set data = $2 where id = $1`, [r.id, sealBytes(r.data)]);
    },
    20,
  );

  return done;
}
