import { requireSession } from "@/lib/auth/session";
import { clipVorschauLesen } from "@/lib/video/clips";

// B36.12 Clip-Bibliothek: Vorschaubild eines eigenen Clips (nur angemeldet, eigener Mandant).

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const b = await clipVorschauLesen(s.tenantId, id);
  if (!b) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(b), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } });
}
