import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { preislisteAuswerten, scanCsv } from "@/lib/b2b/scanner";

/** Scanner-Ergebnis als CSV (Ampel-Filter wie auf der Seite: ?ampel=gruen). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!canAccess(session, "b2b")) return NextResponse.json({ error: "Keine Freigabe für B2B-Deals." }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Ungültig." }, { status: 400 });
  const a = await preislisteAuswerten(session.tenantId, id);
  if (!a) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  const ampel = new URL(req.url).searchParams.get("ampel");
  const zeilen = ampel ? a.zeilen.filter((z) => z.ampel === ampel) : a.zeilen;
  return new NextResponse(scanCsv(zeilen), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="Preisliste-Auswertung.csv"`, "cache-control": "private, no-store" } });
}
