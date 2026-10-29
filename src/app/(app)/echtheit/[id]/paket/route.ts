import { z } from "zod";
import { canAccess } from "@/lib/auth/areas";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { auditPaket } from "@/lib/echtheit/service";

// Audit-Paket einer Marke (ZIP: Übersicht.pdf, Abdeckung.csv, Rechnungen). Enthält Rechnungsdateien → zusätzlich
// Zugriff auf Buchhaltung nötig.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireArea("amazon");
  if (!canAccess(s, "buchhaltung")) return new Response("Für das Audit-Paket ist der Bereich Buchhaltung (Rechnungen) nötig.", { status: 403 });
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return new Response("Nicht gefunden", { status: 404 });
  const p = await auditPaket(s.tenantId, parsed.data, todayIso());
  if (!p) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(p.daten), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(p.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
