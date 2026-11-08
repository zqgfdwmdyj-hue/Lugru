import { agentPruefen } from "@/lib/druck/api";
import { ordnerUpload } from "@/lib/druck/dateien";

// Überwachter Ordner am PC (z. B. Scans/Rechnungen): neue PDFs kommen hierher und laufen durch die zentrale Upload-
// Erkennung (Rechnungen, Belege …) – im Namen der Person, die den Agenten angelegt hat.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  const name = decodeURIComponent(request.headers.get("x-dateiname") ?? "scan.pdf").replace(/[\\/]/g, "_").slice(0, 200);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) return Response.json({ ok: false, fehler: "leer oder größer als 25 MB" }, { status: 400 });
  const r = await ordnerUpload(p.agent, name, bytes);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}
