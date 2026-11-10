import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { driveVorschauPdf } from "@/lib/belege/drive-ablage";

// B34.2 Vorschau: Datei aus dem Drive-Rechnungsordner ansehen, bevor der Vorschlag freigegeben wird (nichts gespeichert).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response("Nicht angemeldet", { status: 401 });
  if (!(["service", "buchhaltung", "geld"] as const).some((a) => canAccess(s, a))) return new Response("Kein Zugriff", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const r = await driveVorschauPdf(s.tenantId, id).catch(() => null);
  if (!r) return new Response("PDF nicht verfügbar", { status: 404 });
  return new Response(new Uint8Array(r.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${r.name.replace(/["\r\n]/g, "")}"`, "Cache-Control": "private, max-age=600" } });
}
