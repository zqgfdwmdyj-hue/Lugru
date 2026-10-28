import { isBlockedError, isTestEnv } from "@/lib/testenv";

// Kurzprüfung der Testumgebung (deploy/testumgebung.sh pruefen): ist die Verbindung nach außen gesperrt?
// Im echten System gibt es diese Adresse nicht (404).
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isTestEnv()) return new Response("Nicht gefunden", { status: 404 });
  try {
    await fetch("https://example.com/", { signal: AbortSignal.timeout(5000) });
    return new Response("offen", { headers: { "Content-Type": "text/plain" } });
  } catch (e) {
    return new Response(isBlockedError(e) ? "gesperrt" : "fehler", { headers: { "Content-Type": "text/plain" } });
  }
}
