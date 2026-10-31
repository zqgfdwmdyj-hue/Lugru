import { lesen } from "@/lib/medien/ablage";
import { loadEntry, requirePrivate } from "@/lib/private/service";
import type { Schulbrief } from "../../actions";

// Original eines Schul-/Kita-Briefs – nur mit vollem Privat-Zugang (entschlüsselt aus der Medienablage).

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePrivate();
  const { id } = await params;
  const e = /^[0-9a-f-]{36}$/.test(id) ? await loadEntry<Schulbrief>(session, id) : null;
  if (!e || e.kind !== "schulbrief") return new Response("Nicht gefunden.", { status: 404 });
  const daten = await lesen(e.data.key).catch(() => null);
  if (!daten) return new Response("Datei fehlt.", { status: 404 });
  return new Response(new Uint8Array(daten), { headers: { "Content-Type": e.data.mime, "Content-Disposition": `inline; filename="brief${e.data.mime === "application/pdf" ? ".pdf" : ""}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
