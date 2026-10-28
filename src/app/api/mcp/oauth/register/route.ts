import { registerClient } from "@/lib/assistant/oauth-service";
import { jsonResponse, preflight } from "@/lib/assistant/http";

// Dynamische Registrierung (RFC 7591) – Claude meldet sich als Programm an. Nur erlaubte Rücksprung-Adressen.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "invalid_client_metadata", error_description: "Kein gültiges JSON." }, 400);
  }
  const r = await registerClient(body ?? {});
  if ("error" in r) return jsonResponse({ error: r.error, error_description: r.error_description }, r.status ?? 400);
  return jsonResponse(r, 201);
}
export async function OPTIONS() {
  return preflight();
}
