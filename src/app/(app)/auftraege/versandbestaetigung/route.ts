import { and, eq, isNotNull, isNull } from "drizzle-orm";
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
    .where(and(eq(O.tenantId, session.tenantId), eq(O.channel, "amazon"), eq(O.fulfillment, "FBM"), isNotNull(O.trackingNumber), isNull(O.trackingUploadedAt)));
  const header = ["order-id", "order-item-id", "quantity", "ship-date", "carrier-code", "carrier-name", "tracking-number", "ship-method"];
  const lines = rows.map((o) => [o.externalId, "", "", (o.shippedAt ?? new Date()).toISOString().slice(0, 10), "DHL", "", o.trackingNumber, ""].join("\t"));
  return new Response([header.join("\t"), ...lines].join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/tab-separated-values; charset=utf-8", "Content-Disposition": 'attachment; filename="Amazon_Versandbestaetigung.txt"' },
  });
}
