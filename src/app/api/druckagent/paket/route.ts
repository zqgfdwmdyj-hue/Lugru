import { requireSession } from "@/lib/auth/session";
import { agentPaket } from "@/lib/druck/dateien";

// Installationspaket (ZIP) für Windows/Linux – nur Inhaber; enthält keinen Token (der wird bei der Installation abgefragt).

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireSession();
  if (s.role !== "owner" || s.readOnly) return new Response("Nur Inhaber", { status: 403 });
  const zip = await agentPaket();
  return new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="lugru-druckagent.zip"', "cache-control": "no-store" } });
}
