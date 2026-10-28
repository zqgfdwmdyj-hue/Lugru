import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";

// Amazon-Versandbestätigung als Datei (Seller Central → Bestellungen → Bestellberichte hochladen),
// für Aufträge, deren Sendungsnummer noch nicht per Schnittstelle gemeldet wurde.
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  const O = schema.orders;
  const rows = await db
    .select()
    .from(O)
    .where(and(eq(O.tenantId, session.tenantId), eq(O.channel, "amazon"), eq(O.fulfillment, "FBM"), or(isNotNull(O.trackingNumber), and(eq(O.carrier, "Deutsche Post"), eq(O.status, "shipped"))), isNull(O.trackingUploadedAt)));
  const header = ["order-id", "order-item-id", "quantity", "ship-date", "carrier-code", "carrier-name", "tracking-number", "ship-method"];
  // Warensendung (Deutsche Post): ohne Sendungsnummer, Versandart „Warensendung“.
  const lines = rows.map((o) => [o.externalId, "", "", (o.shippedAt ?? new Date()).toISOString().slice(0, 10), o.carrier === "Deutsche Post" ? "Deutsche Post" : "DHL", "", o.trackingNumber ?? "", o.carrier === "Deutsche Post" ? "Warensendung" : ""].join("\t"));
  return new Response([header.join("\t"), ...lines].join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/tab-separated-values; charset=utf-8", "Content-Disposition": 'attachment; filename="Amazon_Versandbestaetigung.txt"' },
  });
}
