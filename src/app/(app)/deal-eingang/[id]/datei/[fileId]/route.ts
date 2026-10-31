import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { eingangDatei } from "@/lib/deal-eingang/service";

// Originaldatei eines Deal-Eingangs (Screenshot, PDF, Tabelle) ansehen – nur mit Freigabe „Deal-Eingang“ und nur,
// wenn die Datei zu diesem Eingang gehört.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const s = await requireArea("dealeingang");
  const { id, fileId } = await params;
  const ok = z.object({ id: z.string().uuid(), fileId: z.string().uuid() }).safeParse({ id, fileId });
  if (!ok.success) return new Response("Nicht gefunden", { status: 404 });
  const f = await eingangDatei(s.tenantId, ok.data.id, ok.data.fileId);
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  const name = encodeURIComponent(f.name);
  // Nur PDF und Bilder im Browser anzeigen; alles andere (z. B. HTML) nur herunterladen.
  const inline = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/i.test(f.mimeType);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": inline ? f.mimeType : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(inline ? {} : { "Content-Security-Policy": "sandbox" }),
    },
  });
}
