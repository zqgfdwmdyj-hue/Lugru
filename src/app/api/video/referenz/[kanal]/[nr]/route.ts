import { requireSession } from "@/lib/auth/session";
import { referenzLesen } from "@/lib/video/service";

// B36.9: Stil-Referenzbild im Kanalprofil ansehen (nur angemeldet, eigener Mandant).

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ kanal: string; nr: string }> }) {
  const s = await requireSession();
  const { kanal, nr } = await params;
  if (!/^[0-9a-f-]{36}$/.test(kanal) || !/^\d{1,3}$/.test(nr)) return new Response("Nicht gefunden", { status: 404 });
  const r = await referenzLesen(s.tenantId, kanal, Number(nr));
  if (!r) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(r.daten), { headers: { "content-type": r.typ, "cache-control": "private, no-store" } });
}
