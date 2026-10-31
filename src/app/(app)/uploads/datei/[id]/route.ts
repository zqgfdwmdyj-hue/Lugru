import { requireOwner } from "@/lib/auth/session";
import { importDatei } from "@/lib/datei-import/service";

// Datei eines Datei-Imports (z. B. Art „sonstiges“ im Posteingang) herunterladen – nur Inhaber, nur solange sie in der
// Ablage liegt (90 Tage).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOwner();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Nicht gefunden", { status: 404 });
  const d = await importDatei(session.tenantId, id);
  if (!d) return new Response("Datei nicht (mehr) vorhanden – nach 90 Tagen gelöscht.", { status: 404 });
  return new Response(new Uint8Array(d.bytes), {
    headers: { "Content-Type": d.typ, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
