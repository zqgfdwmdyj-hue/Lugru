import { requireOwner } from "@/lib/auth/session";
import { debugBild } from "@/lib/automatik/runner";
import { DEBUG_NAME } from "@/lib/automatik/login-logic";

// B24: Bildschirmfoto eines Fehlschlags der Browser-Automatik – nur Inhaber, nach 7 Tagen gelöscht.
export async function GET(_req: Request, { params }: { params: Promise<{ datei: string }> }) {
  const session = await requireOwner();
  const { datei } = await params;
  const name = datei.replace(/\.png$/i, "");
  if (!DEBUG_NAME.test(name)) return new Response("Nicht gefunden", { status: 404 });
  const bild = await debugBild(session.tenantId, name);
  if (!bild) return new Response("Bildschirmfoto nicht (mehr) vorhanden – nach 7 Tagen gelöscht.", { status: 404 });
  return new Response(new Uint8Array(bild), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
