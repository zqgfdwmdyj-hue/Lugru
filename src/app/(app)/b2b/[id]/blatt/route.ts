import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { blattBild } from "@/lib/b2b/blatt-bild";
import { blattPdf, type BlattPdfInput } from "@/lib/b2b/blatt-pdf";
import { dealBlatt, ladeDeal, portalLink } from "@/lib/b2b/service";

/** Deal-Blatt als PDF (Standard) oder als Bild (?format=svg) – ohne EK und eigenen Verdienst. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!canAccess(session, "b2b")) return NextResponse.json({ error: "Keine Freigabe für B2B-Deals." }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Ungültig." }, { status: 400 });
  const d = await ladeDeal(session.tenantId, id);
  if (!d) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  const b = await dealBlatt(session.tenantId, d);
  const daten: BlattPdfInput = { firma: b.firma, nr: d.nr, titel: d.titel, asin: d.asin, ean: d.ean, marke: d.marke, preis: d.kundenpreisNetto, mindestmenge: d.mindestmengeKunde, maxProKunde: d.maxProKunde, rest: b.rest, frist: d.frist, hinweis: d.hinweis, laender: b.laender, link: portalLink(d.id), stand: d.updatedAt };
  if (new URL(req.url).searchParams.get("format") === "svg") {
    return new NextResponse(blattBild(daten), { headers: { "content-type": "image/svg+xml; charset=utf-8", "content-disposition": `inline; filename="Deal-${d.nr}.svg"`, "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });
  }
  const pdf = await blattPdf(daten);
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Deal-${d.nr}.pdf"`, "cache-control": "private, no-store" } });
}
