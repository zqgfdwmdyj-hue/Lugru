import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { buildPickupPdf } from "@/lib/pallets/pickup-pdf";
import { getSettings } from "@/lib/settings";

/** Abholschein als PDF (mit Unterschrift). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(session, "paletten")) return new Response("Keine Freigabe", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const PU = schema.palletPickups;
  const [pu] = await db.select().from(PU).where(and(eq(PU.id, id), eq(PU.tenantId, session.tenantId)));
  if (!pu) return new Response("Nicht gefunden", { status: 404 });
  const pallets = pu.palletIds.length
    ? await db.select().from(schema.pallets).where(and(eq(schema.pallets.tenantId, session.tenantId), inArray(schema.pallets.id, pu.palletIds)))
    : [];
  const [sig] = pu.signatureFileId ? await db.select().from(schema.files).where(and(eq(schema.files.id, pu.signatureFileId), eq(schema.files.tenantId, session.tenantId))) : [];
  const s = (await getSettings(session.tenantId)).shipper;
  const number = `A-${pu.day.replace(/-/g, "")}-${pu.id.slice(0, 4).toUpperCase()}`;
  const pdf = await buildPickupPdf({
    sender: { name: s.name1, street: s.street, houseNo: s.houseNo, zip: s.zip, city: s.city, phone: s.phone, email: s.email },
    number,
    day: pu.day,
    customer: pu.customer,
    pickedBy: pu.pickedBy,
    plate: pu.plate,
    note: pu.note,
    pallets: pallets.sort((a, b) => a.code.localeCompare(b.code, "de", { numeric: true })).map((p) => ({ code: p.code, location: p.location, contents: p.contents, inAt: p.inAt })),
    signaturePng: sig ? new Uint8Array(sig.data) : null,
  });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Abholschein-${number}.pdf"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
