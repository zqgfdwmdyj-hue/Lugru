import { claudeBaseUrl } from "@/lib/oauth/state";
import { authServerMetadata } from "@/lib/assistant/oauth-logic";
import { jsonResponse, preflight } from "@/lib/assistant/http";

// Manche Programme suchen die Endpunkte hier – gleiche Angaben wie oauth-authorization-server.
export async function GET(req: Request) {
  return jsonResponse(authServerMetadata(claudeBaseUrl(req)), 200, { "Cache-Control": "public, max-age=3600" });
}
export async function OPTIONS() {
  return preflight();
}
