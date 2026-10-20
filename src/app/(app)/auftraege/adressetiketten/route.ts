import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { buildAddressLabels } from "@/lib/shipping/address-label";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Adressetiketten 62 × 29 mm (Brother QL-800, DK-11209) für die ausgewählten Aufträge –
// nur Name und Anschrift, ein Etikett je Auftrag, in der Reihenfolge der Auswahl.
export async function GET(req: Request) {
  const session = await requireArea("wawi");
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => UUID.test(s)).slice(0, 500);
  if (!ids.length) return new Response("Bitte Aufträge auswählen.", { status: 400 });
  const O = schema.orders;
  const rows = await db
    .select({ id: O.id, shipTo: O.shipTo, buyerName: O.buyerName })
    .from(O)
    .where(and(eq(O.tenantId, session.tenantId), inArray(O.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => Boolean(r));
  const { pdf, printed, skipped } = await buildAddressLabels(ordered.map((r) => ({ address: r.shipTo, fallbackName: r.buyerName })));
  if (!printed) return new Response("Für die Auswahl fehlt die Lieferadresse (Straße, PLZ, Ort) – im Auftrag eintragen.", { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Adressetiketten_62x29.pdf"`,
      "Cache-Control": "no-store",
      "X-Etiketten": String(printed),
      "X-Ohne-Adresse": String(skipped),
    },
  });
}
