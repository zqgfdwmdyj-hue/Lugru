import { requireArea } from "@/lib/auth/session";
import { openLabels, openLabelsPdf } from "@/lib/shipping/label-pdfs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Alle Labels der Aufträge mit Status „Label erstellt“ als ein PDF (optional ?ids=… für eine Auswahl).
export async function GET(req: Request) {
  const session = await requireArea("wawi");
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => UUID.test(s)).slice(0, 500);
  const { fileIds } = await openLabels(session.tenantId, ids.length ? ids : undefined);
  const pdf = await openLabelsPdf(session.tenantId, fileIds);
  if (!pdf) return new Response("Keine Label-PDFs offen – Warensendungen per CSV werden im Internetmarke-Shop gedruckt.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Labels_${day}.pdf"`, "Cache-Control": "no-store" },
  });
}
