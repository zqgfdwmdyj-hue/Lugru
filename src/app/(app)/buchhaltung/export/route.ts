import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { belegeZip, BuchhaltungFehler, datevExport, monatOk } from "@/lib/buchhaltung/service";

// Download: DATEV-Buchungsstapel (CSV, Windows-1252) oder CSV + Belege als ZIP – je Firma und Monat.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Nicht angemeldet", { status: 401 });
  if (!canAccess(session, "geld")) return new Response("Kein Zugriff", { status: 403 });
  const url = new URL(request.url);
  const monat = url.searchParams.get("monat");
  const firma = url.searchParams.get("firma");
  if (!monatOk(monat)) return new Response("Monat fehlt", { status: 400 });
  const wer = { tenantId: session.tenantId, userId: session.userId, name: session.name, email: session.email };
  try {
    if (url.searchParams.get("art") === "zip") {
      const z = await belegeZip(wer, firma, monat);
      return new Response(new Uint8Array(z.bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.name}"` } });
    }
    const d = await datevExport(wer, firma, monat);
    return new Response(new Uint8Array(d.bytes), { headers: { "Content-Type": "text/csv; charset=windows-1252", "Content-Disposition": `attachment; filename="${d.name}"` } });
  } catch (e) {
    if (e instanceof BuchhaltungFehler) return Response.redirect(new URL(`/buchhaltung?firma=${encodeURIComponent(firma ?? "")}&monat=${monat}&fehler=${encodeURIComponent(e.message)}`, url), 303);
    throw e;
  }
}
