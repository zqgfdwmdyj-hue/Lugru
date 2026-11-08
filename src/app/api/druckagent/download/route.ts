import { agentPruefen } from "@/lib/druck/api";
import { agentDatei } from "@/lib/druck/dateien";

// Programmdatei für das Selbst-Update des Agenten (nur mit gültigem Gerätetoken).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  if (new URL(request.url).searchParams.get("datei") !== "lugru-druckagent.mjs") return new Response(null, { status: 404 });
  const d = await agentDatei("lugru-druckagent.mjs").catch(() => null);
  if (!d) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(d), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
}
