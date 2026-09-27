import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { CHANNELS, type Channel } from "@/db/schema";
import { registerOwnImport } from "@/lib/imports/own-formats";
import { parseAmount, parseDateTime } from "@/lib/numbers";
import { splitStreet } from "@/lib/shipping/countries";
import { columnAccessor } from "@/lib/tabular";

// Eigene CSV-Vorlage für Aufträge aus beliebigen Kanälen (eBay, TikTok, Temu, Shop …).
export const ORDER_TEMPLATE_HEADERS = [
  "Kanal", "Bestellnummer", "Datum", "Name", "Adresszusatz", "Straße", "Hausnummer", "PLZ", "Ort", "Land", "E-Mail", "Telefon", "SKU", "Artikel", "Menge", "Preis", "Versand bis",
];

const CHANNEL_ALIASES: Record<string, Channel> = { amazon: "amazon", ebay: "ebay", tiktok: "tiktok", "tiktok shop": "tiktok", temu: "temu", kaufland: "kaufland", shop: "shop", manuell: "manual", manual: "manual" };

registerOwnImport({
  kind: "orders-csv",
  detect: (t) => {
    const a = columnAccessor(t.headers);
    return a.has("bestellnummer") && a.has("kanal") && a.has("sku");
  },
  apply: async ({ tenantId, fileName, table }) => {
    const a = columnAccessor(table.headers);
    type O = { channel: Channel; externalId: string; date: Date; row: string[]; items: { sku: string; title: string | null; quantity: number; price: number | null }[] };
    const orders = new Map<string, O>();
    let skipped = 0;
    for (const r of table.rows) {
      const channel = CHANNEL_ALIASES[a.get(r, "kanal").toLowerCase()] ?? (CHANNELS.includes(a.get(r, "kanal") as Channel) ? (a.get(r, "kanal") as Channel) : null);
      const externalId = a.get(r, "bestellnummer");
      if (!channel || !externalId) {
        skipped++;
        continue;
      }
      const key = `${channel}|${externalId}`;
      const o = orders.get(key) ?? { channel, externalId, date: parseDateTime(a.get(r, "datum")) ?? new Date(), row: r, items: [] };
      const sku = a.get(r, "sku");
      if (sku) o.items.push({ sku, title: a.get(r, "artikel") || null, quantity: Math.max(1, Math.round(parseAmount(a.get(r, "menge")) ?? 1)), price: parseAmount(a.get(r, "preis")) });
      orders.set(key, o);
    }
    let created = 0;
    for (const o of orders.values()) {
      const r = o.row;
      let street = a.get(r, "straße", "strasse", "street");
      let houseNo = a.get(r, "hausnummer", "hausnr", "house-number");
      if (street && !houseNo) ({ street, houseNo } = splitStreet(street));
      const shipTo = {
        name1: a.get(r, "name", "käufer", "kaeufer"),
        name2: a.get(r, "adresszusatz") || undefined,
        street,
        houseNo,
        zip: a.get(r, "plz", "postleitzahl"),
        city: a.get(r, "ort", "stadt"),
        country: a.get(r, "land") || "DE",
        email: a.get(r, "e-mail", "email") || undefined,
        phone: a.get(r, "telefon") || undefined,
      };
      const total = o.items.reduce((n, i) => n + (i.price ?? 0) * i.quantity, 0);
      const [row] = await db
        .insert(schema.orders)
        .values({ tenantId, channel: o.channel, externalId: o.externalId, orderDate: o.date, fulfillment: "FBM", status: "open", buyerName: shipTo.name1, shipTo, total, shipBy: parseDateTime(a.get(r, "versand-bis")) })
        .onConflictDoUpdate({
          target: [schema.orders.tenantId, schema.orders.channel, schema.orders.externalId],
          set: { shipTo: sql`excluded.ship_to`, buyerName: sql`excluded.buyer_name`, total: sql`excluded.total`, updatedAt: sql`now()` },
        })
        .returning({ id: schema.orders.id, inserted: sql<boolean>`(xmax = 0)` });
      if (row.inserted) created++;
      await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, row.id));
      if (o.items.length) await db.insert(schema.orderItems).values(o.items.map((i) => ({ ...i, tenantId, orderId: row.id })));
    }
    return {
      fileName,
      ok: true,
      label: "Aufträge (eigene Vorlage)",
      summary: `${orders.size} Aufträge gelesen, ${created} neu.`,
      hints: skipped ? [`${skipped} Zeilen ohne Kanal oder Bestellnummer übersprungen`] : [],
    };
  },
});
