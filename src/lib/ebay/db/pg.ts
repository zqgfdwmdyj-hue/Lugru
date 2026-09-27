import "server-only";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { db as rootDb, schema, type Tx } from "@/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { AttemptRow, Db, InvoiceRow } from "./db";

type Conn = typeof rootDb | Tx;

/** Werte, die wie Passwörter behandelt werden: Client-Secret, Keepa-Schlüssel, Rechnungs-Einstellungen (SMTP-Passwort). */
const SECRET_KEY = /(^|\.)clientSecret$|^keepaApiKey$|^invoiceSettings$/;
const seal = (key: string, value: string) => (SECRET_KEY.test(key) && value !== "" ? `enc:${encryptSecret(value)}` : value);
const open = (value: string) => (value.startsWith("enc:") ? decryptSecret(value.slice(4)) : value);

const L = schema.ebayListings;
const I = schema.ebayInvoices;

const attemptColumns: Record<keyof Omit<AttemptRow, "id">, keyof typeof L.$inferInsert> = {
  ean: "ean",
  price: "price",
  quantity: "quantity",
  condition: "condition",
  status: "status",
  epid: "epid",
  catalog_matches: "catalogMatches",
  sku: "sku",
  offer_id: "offerId",
  listing_id: "listingId",
  title: "title",
  description: "description",
  image_urls: "imageUrls",
  aspects: "aspects",
  category_id: "categoryId",
  gpsr: "gpsr",
  warnings: "warnings",
  error_message: "errorMessage",
  purchased_units: "purchasedUnits",
  purchase_price: "purchasePrice",
  purchase_source: "purchaseSource",
  target_price: "targetPrice",
  article_key: "articleKey",
  purchase_price_basis: "purchasePriceBasis",
  fulfillment_policy_id: "fulfillmentPolicyId",
  created_at: "createdAt",
  updated_at: "updatedAt",
};

function toColumns(row: Partial<AttemptRow>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const c = attemptColumns[k as keyof typeof attemptColumns];
    if (c) out[c] = v;
  }
  return out as Partial<typeof L.$inferInsert>;
}

function fromListing(r: typeof L.$inferSelect): AttemptRow {
  const row = { id: r.id } as AttemptRow;
  for (const [k, c] of Object.entries(attemptColumns)) (row as unknown as Record<string, unknown>)[k] = r[c as keyof typeof r] ?? null;
  return row;
}

function fromInvoice(r: typeof I.$inferSelect): InvoiceRow {
  return {
    id: r.id,
    env: r.env,
    number: r.number,
    year: r.year,
    seq: r.seq,
    kind: r.kind,
    order_id: r.orderId,
    cancels_id: r.cancelsId,
    cancelled_by_id: r.cancelledById,
    data: r.data,
    created_at: r.createdAt,
    emailed_at: r.emailedAt,
    email_to: r.emailTo,
    email_error: r.emailError,
  };
}

/** Datenzugriff des eBay-Tools für einen Mandanten. */
export function ebayDb(tenantId: string, conn: Conn = rootDb, inTx = false): Db {
  const S = schema.ebaySettings;
  const T = schema.ebayTokens;
  const P = schema.ebayIdealoPrices;
  const self: Db = {
    async getSetting(key) {
      const [r] = await conn.select({ value: S.value }).from(S).where(and(eq(S.tenantId, tenantId), eq(S.key, key)));
      return r ? open(r.value) : null;
    },
    async setSetting(key, value) {
      const v = seal(key, value);
      await conn.insert(S).values({ tenantId, key, value: v }).onConflictDoUpdate({ target: [S.tenantId, S.key], set: { value: v } });
    },
    async getToken(env, type) {
      const [r] = await conn.select().from(T).where(and(eq(T.tenantId, tenantId), eq(T.env, env), eq(T.type, type)));
      if (!r) return null;
      return {
        accessToken: decryptSecret(r.accessToken),
        accessExpiresAt: r.accessExpiresAt,
        refreshToken: r.refreshToken ? decryptSecret(r.refreshToken) : undefined,
        refreshExpiresAt: r.refreshExpiresAt ?? undefined,
      };
    },
    async saveToken(env, type, t) {
      const values = {
        accessToken: encryptSecret(t.accessToken),
        accessExpiresAt: t.accessExpiresAt,
        refreshToken: t.refreshToken ? encryptSecret(t.refreshToken) : null,
        refreshExpiresAt: t.refreshExpiresAt ?? null,
      };
      await conn
        .insert(T)
        .values({ tenantId, env, type, ...values })
        .onConflictDoUpdate({ target: [T.tenantId, T.env, T.type], set: values });
    },

    async insertAttempt(row) {
      const [r] = await conn
        .insert(L)
        .values({ ...(toColumns(row) as typeof L.$inferInsert), tenantId })
        .returning({ id: L.id });
      return r.id;
    },
    async updateAttempt(id, columns) {
      const set = toColumns(columns);
      if (Object.keys(set).length === 0) return;
      await conn.update(L).set(set).where(and(eq(L.tenantId, tenantId), eq(L.id, id)));
    },
    async getAttempt(id) {
      const [r] = await conn.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.id, id)));
      return r ? fromListing(r) : null;
    },
    async listAttempts() {
      return (await conn.select().from(L).where(eq(L.tenantId, tenantId)).orderBy(desc(L.id))).map(fromListing);
    },

    async listInvoices() {
      return (await conn.select().from(I).where(eq(I.tenantId, tenantId)).orderBy(desc(I.id))).map(fromInvoice);
    },
    async getInvoice(id) {
      const [r] = await conn.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, id)));
      return r ? fromInvoice(r) : null;
    },
    async maxInvoiceSeq(year) {
      const [r] = await conn.select({ m: max(I.seq) }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.year, year)));
      return r?.m ?? null;
    },
    async insertInvoice(row) {
      const [r] = await conn
        .insert(I)
        .values({
          tenantId,
          env: row.env,
          number: row.number,
          year: row.year,
          seq: row.seq,
          kind: row.kind,
          orderId: row.order_id,
          cancelsId: row.cancels_id,
          cancelledById: row.cancelled_by_id,
          data: row.data,
          createdAt: row.created_at,
          emailedAt: row.emailed_at,
          emailTo: row.email_to,
          emailError: row.email_error,
        })
        .returning({ id: I.id });
      return r.id;
    },
    async updateInvoice(id, c) {
      const set: Partial<typeof I.$inferInsert> = {};
      if ("cancelled_by_id" in c) set.cancelledById = c.cancelled_by_id;
      if ("emailed_at" in c) set.emailedAt = c.emailed_at;
      if ("email_to" in c) set.emailTo = c.email_to;
      if ("email_error" in c) set.emailError = c.email_error;
      if (Object.keys(set).length) await conn.update(I).set(set).where(and(eq(I.tenantId, tenantId), eq(I.id, id)));
    },

    async recordIdealoPrice(productKey, day, price) {
      await conn
        .insert(P)
        .values({ tenantId, productKey, day, price })
        .onConflictDoUpdate({ target: [P.tenantId, P.productKey, P.day], set: { price: sql`least(${P.price}, excluded.price)` } });
    },
    async idealoHistory(productKey) {
      return conn.select({ day: P.day, price: P.price }).from(P).where(and(eq(P.tenantId, tenantId), eq(P.productKey, productKey))).orderBy(P.day);
    },

    async transaction(fn, lock) {
      if (inTx) {
        if (lock) await conn.execute(sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:${lock}`}))`);
        return fn(self);
      }
      return rootDb.transaction(async (tx) => {
        if (lock) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${tenantId}:${lock}`}))`);
        return fn(ebayDb(tenantId, tx, true));
      });
    },
  };
  return self;
}
