import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { getSettings } from "@/lib/settings";
import { exportZeilen } from "@/lib/b2b/ablauf";
import { exportCsv, exportPdf, exportXlsx } from "@/lib/b2b/export";
import { ladeDeal } from "@/lib/b2b/service";

/** Export für das Prep-Tool: ?format=csv|xlsx|pdf&kunde=<id> (ohne Kunde: alle). Nur lesen – Übergabe separat. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!canAccess(session, "b2b")) return NextResponse.json({ error: "Keine Freigabe für B2B-Deals." }, { status: 403 });
  const { id } = await params;
  const url = new URL(req.url);
  const format = z.enum(["csv", "xlsx", "pdf"]).catch("csv").parse(url.searchParams.get("format"));
  const kunde = z.string().uuid().nullable().catch(null).parse(url.searchParams.get("kunde"));
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Ungültig." }, { status: 400 });
  const d = await ladeDeal(session.tenantId, id);
  if (!d) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  const zeilen = await exportZeilen(session.tenantId, id, kunde);
  const name = `Deal-${d.nr}-Prep${kunde && zeilen[0] ? `-${zeilen[0].kunde.replace(/[^A-Za-z0-9ÄÖÜäöüß]+/g, "_").slice(0, 40)}` : ""}`;
  const kopf = (typ: string, endung: string) => ({ "content-type": typ, "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}.${endung}"; filename*=UTF-8''${encodeURIComponent(name)}.${endung}`, "cache-control": "private, no-store" });
  if (format === "xlsx") return new NextResponse(new Uint8Array(exportXlsx(zeilen)), { headers: kopf("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
  if (format === "pdf") {
    const s = await getSettings(session.tenantId);
    return new NextResponse(Buffer.from(await exportPdf(zeilen, { titel: `Deal #${d.nr}`, firma: s.b2b.firma.handelsname || s.b2b.firma.name })), { headers: kopf("application/pdf", "pdf") });
  }
  return new NextResponse(exportCsv(zeilen), { headers: kopf("text/csv; charset=utf-8", "csv") });
}
