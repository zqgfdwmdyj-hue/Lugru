import "server-only";
import { BILD_MODELLE, bildModellReihenfolge } from "@/lib/video/logic";
import { registerTester } from "../test";

// „Verbindung testen“ für OpenAI (Bilder der Video-Pipeline): Schlüssel prüfen (Modellliste, kostet nichts) und zeigen,
// welches Bildmodell tatsächlich benutzt wird. Der Schlüssel erscheint nie in der Meldung.

const basis = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, "");

registerTester("openai", async (v, tenantId) => {
  if (!v.apiKey) throw new Error("API-Key fehlt.");
  let res: Response;
  try {
    res = await fetch(`${basis()}/v1/models`, { headers: { authorization: `Bearer ${v.apiKey}` }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new Error(`OpenAI nicht erreichbar: ${e instanceof Error ? e.message : "Fehler"}`);
  }
  if (res.status === 401) throw new Error("Schlüssel abgelehnt (HTTP 401) – bitte den API-Key neu eintragen: platform.openai.com → API keys → neuen Schlüssel anlegen (beginnt mit „sk-“) und nur den Schlüssel hier einfügen.");
  if (!res.ok) throw new Error(`OpenAI antwortet mit HTTP ${res.status} – später erneut testen.`);
  const ids = (((await res.json().catch(() => ({}))) as { data?: { id?: unknown }[] }).data ?? []).map((m) => String(m.id ?? ""));
  const vorhanden = ids.filter((id) => /^gpt-image/.test(id)).sort();
  const { videoEinstellungen } = await import("@/lib/video/service");
  const gewaehlt = (await videoEinstellungen(tenantId)).bildModell;
  const nutzbar = bildModellReihenfolge(gewaehlt).filter((m) => vorhanden.includes(m));
  if (!nutzbar.length) {
    throw new Error(`Schlüssel gültig, aber keines der Bildmodelle (${Object.keys(BILD_MODELLE).join(", ")}) ist im Konto freigeschaltet${vorhanden.length ? ` (vorhanden: ${vorhanden.join(", ")})` : ""}. Im OpenAI-Konto prüfen: Projekt → erlaubte Modelle, ggf. Settings → Organization → „Verify Organization“.`);
  }
  const hinweis = nutzbar[0] === gewaehlt ? "" : ` (gewählt ist ${gewaehlt} – im Konto nicht vorhanden, das System weicht automatisch aus)`;
  return `Schlüssel gültig. Bildmodell für Videos: ${nutzbar[0]}${hinweis}. Bildmodelle im Konto: ${vorhanden.join(", ")}.`;
});
