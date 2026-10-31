import { claudeBaseUrl } from "@/lib/oauth/state";
import { authServerMetadata } from "@/lib/assistant/oauth-logic";
import { jsonResponse, preflight } from "@/lib/assistant/http";

// RFC 8414: Endpunkte der Anmeldung für den Claude-Konnektor.
export async function GET(req: Request) {
  return jsonResponse(authServerMetadata(claudeBaseUrl(req)), 200, { "Cache-Control": "public, max-age=3600" });
}
export async function OPTIONS() {
  return preflight();
}
