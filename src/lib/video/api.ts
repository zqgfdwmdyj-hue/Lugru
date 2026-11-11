import "server-only";
import { VideoFehler, workerPerToken, type Worker } from "./service";

// Gemeinsame Prüfung der Worker-Schnittstellen (B36): Token vw_… als Bearer (oder x-api-key über die Anbieter-Brücke).

export async function workerPruefen(request: Request): Promise<{ ok: true; worker: Worker } | { ok: false; antwort: Response }> {
  const w = await workerPerToken(request);
  if (w) return { ok: true, worker: w };
  return { ok: false, antwort: Response.json({ ok: false, fehler: "Worker-Token fehlt, ist ungültig oder wurde deaktiviert" }, { status: 401 }) };
}

/** Fachliche Fehler als 400/409 mit Text, alles andere als 500. */
export function fehlerAntwort(e: unknown): Response {
  if (e instanceof VideoFehler) return Response.json({ ok: false, fehler: e.message }, { status: 409 });
  console.error("[video-worker]", e);
  return Response.json({ ok: false, fehler: e instanceof Error ? e.message : "Fehler" }, { status: 500 });
}
