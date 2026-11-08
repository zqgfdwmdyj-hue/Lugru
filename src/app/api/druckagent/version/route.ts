import { agentPruefen } from "@/lib/druck/api";
import { agentDatei } from "@/lib/druck/dateien";
import { AGENT_VERSION_AKTUELL } from "@/lib/druck/logic";
import { createHash } from "node:crypto";

// Tägliche Update-Prüfung des Agenten: aktuelle Version + Prüfsumme der Programmdatei.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = await agentPruefen(request);
  if (!p.ok) return p.antwort;
  const datei = await agentDatei("lugru-druckagent.mjs").catch(() => null);
  return Response.json({ version: AGENT_VERSION_AKTUELL, sha256: datei ? createHash("sha256").update(datei).digest("hex") : null });
}
