import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { portalSitzung } from "@/lib/b2b/portal-auth";
import { belegPdf } from "@/lib/integrations/clients/lexoffice";

/** Rechnung/Gutschrift als PDF – nur für die eigene Reservierung des angemeldeten Portal-Kunden. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; art: string }> }) {
  const s = await portalSitzung();
  if (!s) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  const { id, art } = await params;
  const a = z.enum(["rechnung", "gutschrift"]).safeParse(art);
  if (!a.success || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Ungültig." }, { status: 400 });
  const R = schema.dealReservierungen;
  const [r] = await db.select({ rechnungId: R.rechnungId, rechnungNr: R.rechnungNr, gutschriftId: R.gutschriftId }).from(R).where(and(eq(R.tenantId, s.tenantId), eq(R.kundeId, s.kundeId), eq(R.id, id)));
  const belegId = a.data === "rechnung" ? r?.rechnungId : r?.gutschriftId;
  if (!belegId) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  try {
    const pdf = await belegPdf(s.tenantId, a.data, belegId);
    return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${a.data === "rechnung" ? `Rechnung-${(r!.rechnungNr ?? "").replace(/[^A-Za-z0-9-]/g, "")}` : "Gutschrift"}.pdf"`, "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Beleg gerade nicht abrufbar – bitte später erneut versuchen." }, { status: 502 });
  }
}
