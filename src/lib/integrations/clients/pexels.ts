import "server-only";
import { registerTester } from "../test";

// B36.11 Pexels (kostenlose Stock-Videos für Videos im Stil „Vollbild“): „Verbindung testen“ = eine Suche mit einem
// Treffer. Der Schlüssel bleibt im Seller-System (der Worker sucht über die Brücke) und erscheint nie in einer Meldung.

export const pexelsBasis = () => (process.env.PEXELS_BASE_URL || "https://api.pexels.com").replace(/\/$/, "");

registerTester("pexels", async (v) => {
  if (!v.apiKey) throw new Error("API-Key fehlt.");
  let res: Response;
  try {
    res = await fetch(`${pexelsBasis()}/videos/search?query=watch&per_page=1`, { headers: { authorization: v.apiKey }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new Error(`Pexels nicht erreichbar: ${e instanceof Error ? e.message : "Fehler"}`);
  }
  if (res.status === 401 || res.status === 403) throw new Error("Schlüssel abgelehnt – bitte auf pexels.com/api den Schlüssel neu kopieren und nur den Schlüssel hier einfügen.");
  if (res.status === 429) throw new Error("Pexels-Limit erreicht (200 Anfragen/Stunde) – in einer Stunde erneut testen.");
  if (!res.ok) throw new Error(`Pexels antwortet mit HTTP ${res.status} – später erneut testen.`);
  const d = (await res.json().catch(() => ({}))) as { total_results?: number };
  const rest = res.headers.get("x-ratelimit-remaining");
  return `Schlüssel gültig. Videosuche funktioniert (${(d.total_results ?? 0).toLocaleString("de-DE")} Treffer für „watch“)${rest ? `, noch ${rest} Anfragen in diesem Monat` : ""}.`;
});
