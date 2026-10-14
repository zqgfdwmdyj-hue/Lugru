import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Channel } from "@/db/schema";

type Listing = typeof schema.listings.$inferSelect;
/** `status`: z. B. „draft“, wenn der Kanal das Angebot erst prüft (Temu). */
type Publisher = (tenantId: string, listing: Listing) => Promise<{ externalId: string; status?: "active" | "draft"; lastError?: string | null }>;
const publishers = new Map<Channel, Publisher>();

export function registerListingPublisher(channel: Channel, fn: Publisher) {
  publishers.set(channel, fn);
}

export async function publishListing(tenantId: string, listing: Listing) {
  await import("@/lib/integrations/clients");
  const fn = publishers.get(listing.channel);
  if (!fn) {
    await db.update(schema.listings).set({ lastError: "Für diesen Kanal gibt es noch keine Schnittstelle – bitte im Kanal selbst einstellen.", updatedAt: new Date() }).where(eq(schema.listings.id, listing.id));
    return false;
  }
  try {
    const r = await fn(tenantId, listing);
    await db.update(schema.listings).set({ status: r.status ?? "active", externalId: r.externalId, lastError: r.lastError ?? null, lastSyncAt: new Date(), pushedQuantity: listing.quantity, pushedAt: new Date(), updatedAt: new Date() }).where(eq(schema.listings.id, listing.id));
    return true;
  } catch (e) {
    await db.update(schema.listings).set({ status: "error", lastError: e instanceof Error ? e.message : String(e), updatedAt: new Date() }).where(eq(schema.listings.id, listing.id));
    return false;
  }
}
