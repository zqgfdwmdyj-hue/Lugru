import { requireSession } from "@/lib/auth/session";
import { fotoLesen } from "@/lib/video/story";

// B37 Foto-Mediathek: Vorschau eines eigenen Lager-Fotos (nur angemeldet, eigener Mandant).

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const f = await fotoLesen(s.tenantId, id);
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(f.daten), { headers: { "content-type": f.typ, "cache-control": "private, no-store" } });
}
