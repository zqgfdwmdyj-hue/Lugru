import "server-only";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { db as rootDb, schema } from "@/db";
import { ebayDb } from "./db/pg";
import type { AttemptRow } from "./db/db";
import type { InvoiceSettings } from "./invoices/types";

/**
 * Übernahme aus dem bisherigen LuGru eBay-Tool (Datei data/lugru.db).
 *
 * - Einstellungen, eBay-Verbindung, Listing-Versuche, Rechnungen und idealo-Preise werden
 *   übernommen, alles in einer Transaktion.
 * - Rechnungsnummern bleiben unverändert; neue Rechnungen zählen lückenlos weiter.
 * - Neue Listing-Nummern liegen über allen alten: Die Nummer steckt in der eBay-SKU
 *   (LG-<EAN>-<Nummer>), ein neues Angebot darf nie die SKU eines alten überschreiben.
 * - Die Rechnungs-Automatik wird ausgeschaltet – solange das alte Tool noch läuft, würden
 *   sonst zwei Programme Nummern vergeben.
 */

export interface ImportResult {
  settings: number;
  tokens: number;
  listings: number;
  invoices: number;
  idealoPrices: number;
  lastInvoiceNumber?: string;
  automationWasOn: boolean;
}

type Row = Record<string, unknown>;
const SKIP_SETTINGS = new Set(["backupSettings", "backupLastRun"]);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const json = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
};

async function readSqlite(bytes: Uint8Array) {
  // node:sqlite liest nur Dateien – deshalb kurz in einen Temp-Ordner schreiben.
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "lugru-"));
  const file = join(dir, "lugru.db");
  writeFileSync(file, bytes);
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    const tables = new Set((db.prepare("select name from sqlite_master where type = 'table'").all() as Row[]).map((r) => String(r.name)));
    if (!tables.has("listing_attempts") || !tables.has("settings")) {
      throw new Error("Das ist keine Datenbank des LuGru eBay-Tools (lugru.db).");
    }
    const all = (t: string, order = "") => (tables.has(t) ? (db.prepare(`select * from ${t} ${order}`).all() as Row[]) : []);
    const data = {
      settings: all("settings"),
      tokens: all("oauth_tokens"),
      attempts: all("listing_attempts", "order by id"),
      invoices: all("invoices", "order by id"),
      idealo: all("idealo_prices"),
    };
    db.close();
    return data;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function importLugruDb(tenantId: string, bytes: Uint8Array): Promise<ImportResult> {
  const head = Buffer.from(bytes.slice(0, 16)).toString("latin1");
  if (!head.startsWith("SQLite format 3")) throw new Error("Bitte die Datei lugru.db aus dem Ordner data des bisherigen eBay-Tools wählen.");
  const src = await readSqlite(bytes);

  const [[listings], [invoices]] = await Promise.all([
    rootDb.select({ n: count() }).from(schema.ebayListings).where(eq(schema.ebayListings.tenantId, tenantId)),
    rootDb.select({ n: count() }).from(schema.ebayInvoices).where(eq(schema.ebayInvoices.tenantId, tenantId)),
  ]);
  if (listings.n > 0 || invoices.n > 0) {
    throw new Error("Im eBay-Bereich gibt es schon Angebote oder Rechnungen. Die Übernahme geht nur einmal in einen leeren Bereich.");
  }

  const settings = new Map(src.settings.map((r) => [String(r.key), String(r.value)]));
  // Wie das bisherige Tool beim Start: ein alter USt-Satz je Umgebung wird global (Production vor Sandbox).
  if (!settings.get("vatPercentage")) {
    const legacy = settings.get("production.vatPercentage") || settings.get("sandbox.vatPercentage");
    if (legacy) settings.set("vatPercentage", legacy);
  }
  let automationWasOn = false;
  const inv = settings.get("invoiceSettings");
  if (inv) {
    const parsed = json(inv) as InvoiceSettings | null;
    if (parsed) {
      automationWasOn = Boolean(parsed.autoCreate);
      settings.set("invoiceSettings", JSON.stringify({ ...parsed, autoCreate: false }));
    }
  }

  const maxOldId = Math.max(0, ...src.attempts.map((a) => Number(a.id) || 0));

  return rootDb.transaction(async (tx) => {
    const edb = ebayDb(tenantId, tx, true);
    let settingsCount = 0;
    for (const [key, value] of settings) {
      if (SKIP_SETTINGS.has(key)) continue;
      await edb.setSetting(key, value);
      settingsCount++;
    }
    for (const t of src.tokens) {
      await edb.saveToken(String(t.env) as "sandbox" | "production", String(t.type) as "app" | "user", {
        accessToken: String(t.access_token),
        accessExpiresAt: String(t.access_expires_at),
        refreshToken: str(t.refresh_token) ?? undefined,
        refreshExpiresAt: str(t.refresh_expires_at) ?? undefined,
      });
    }

    // Neue Nummern über allen alten beginnen lassen (siehe oben: SKU).
    await tx.execute(sql`select setval(pg_get_serial_sequence('ebay_listings', 'id'), greatest((select coalesce(max(id), 0) from ebay_listings), ${maxOldId}) + 1, false)`);
    for (const a of src.attempts) {
      const row: Omit<AttemptRow, "id"> = {
        ean: String(a.ean ?? ""),
        price: Number(a.price),
        quantity: Number(a.quantity),
        condition: String(a.condition),
        status: String(a.status),
        epid: str(a.epid),
        catalog_matches: json(a.catalog_matches),
        // Die alte Nummer bleibt in der SKU erhalten (veröffentlichte und fehlgeschlagene Versuche).
        sku: str(a.sku),
        offer_id: str(a.offer_id),
        listing_id: str(a.listing_id),
        title: str(a.title),
        description: str(a.description),
        image_urls: json(a.image_urls),
        aspects: json(a.aspects),
        category_id: str(a.category_id),
        gpsr: json(a.gpsr),
        warnings: json(a.warnings),
        error_message: str(a.error_message),
        purchased_units: num(a.purchased_units),
        purchase_price: num(a.purchase_price),
        purchase_source: str(a.purchase_source),
        target_price: num(a.target_price),
        // Ohne gespeicherten Artikelschlüssel würde er aus der neuen Nummer abgeleitet – deshalb aus der alten festschreiben.
        article_key: str(a.article_key) ?? (a.ean ? `ean:${a.ean}` : a.epid ? `epid:${a.epid}` : `attempt:${a.id}`),
        purchase_price_basis: str(a.purchase_price_basis),
        fulfillment_policy_id: str(a.fulfillment_policy_id),
        created_at: String(a.created_at),
        updated_at: String(a.updated_at),
      };
      await edb.insertAttempt(row);
    }

    // Rechnungen: Nummern bleiben, Storno-Verweise werden auf die neuen IDs umgeschrieben.
    const idMap = new Map<number, number>();
    for (const r of src.invoices) {
      const newId = await edb.insertInvoice({
        env: String(r.env),
        number: String(r.number),
        year: Number(r.year),
        seq: Number(r.seq),
        kind: String(r.kind),
        order_id: String(r.order_id),
        cancels_id: null,
        cancelled_by_id: null,
        data: json(r.data),
        created_at: String(r.created_at),
        emailed_at: str(r.emailed_at),
        email_to: str(r.email_to),
        email_error: str(r.email_error),
      });
      idMap.set(Number(r.id), newId);
    }
    for (const r of src.invoices) {
      const id = idMap.get(Number(r.id))!;
      const cancels = r.cancels_id === null ? null : (idMap.get(Number(r.cancels_id)) ?? null);
      const cancelledBy = r.cancelled_by_id === null ? null : (idMap.get(Number(r.cancelled_by_id)) ?? null);
      if (cancels !== null || cancelledBy !== null) {
        await tx
          .update(schema.ebayInvoices)
          .set({ cancelsId: cancels, cancelledById: cancelledBy, importedAt: new Date() })
          .where(eq(schema.ebayInvoices.id, id));
      }
    }
    if (idMap.size) await tx.update(schema.ebayInvoices).set({ importedAt: new Date() }).where(eq(schema.ebayInvoices.tenantId, tenantId));

    for (const p of src.idealo) await edb.recordIdealoPrice(String(p.product_key), String(p.day), Number(p.price));

    const last = [...src.invoices].sort((a, b) => Number(b.year) - Number(a.year) || Number(b.seq) - Number(a.seq))[0];
    return {
      settings: settingsCount,
      tokens: src.tokens.length,
      listings: src.attempts.length,
      invoices: src.invoices.length,
      idealoPrices: src.idealo.length,
      lastInvoiceNumber: last ? String(last.number) : undefined,
      automationWasOn,
    };
  });
}
