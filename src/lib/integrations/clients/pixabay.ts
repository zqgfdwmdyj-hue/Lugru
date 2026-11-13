import "server-only";
import { pixabaySchluesselAbgelehnt } from "@/lib/video/logic";
import { registerTester } from "../test";

// B36.11 Pixabay (kostenlose Stock-Videos für Videos im Stil „Vollbild“) – Ersatz für Pexels, solange Pexels keine neuen
// Schlüssel ausgibt. „Verbindung testen“ = eine Suche. Pixabay erwartet den Schlüssel als URL-Parameter: die Adresse wird
// darum nie in eine Meldung oder ein Protokoll geschrieben; der Worker sucht über die Brücke, der Schlüssel bleibt hier.

export const pixabayBasis = () => (process.env.PIXABAY_BASE_URL || "https://pixabay.com").replace(/\/$/, "");

registerTester("pixabay", async (v) => {
  if (!v.apiKey) throw new Error("API-Key fehlt.");
  const q = new URLSearchParams({ key: v.apiKey, q: "watch", per_page: "3", safesearch: "true", video_type: "film" });
  let res: Response;
  try {
    res = await fetch(`${pixabayBasis()}/api/videos/?${q}`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("Pixabay nicht erreichbar – später erneut testen.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (pixabaySchluesselAbgelehnt(res.status, text)) throw new Error("Schlüssel abgelehnt – auf pixabay.com/api/docs/ (angemeldet) den Schlüssel neu kopieren und nur den Schlüssel hier einfügen.");
    if (res.status === 429) throw new Error("Pixabay-Limit erreicht (100 Anfragen pro Minute) – gleich erneut testen.");
    throw new Error(`Pixabay antwortet mit HTTP ${res.status} – später erneut testen.`);
  }
  const d = (await res.json().catch(() => ({}))) as { totalHits?: number };
  return `Schlüssel gültig. Videosuche funktioniert (${(d.totalHits ?? 0).toLocaleString("de-DE")} Treffer für „watch“).`;
});
