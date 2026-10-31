import { claudeBaseUrl } from "@/lib/oauth/state";
import { protectedResourceMetadata } from "@/lib/assistant/oauth-logic";
import { jsonResponse, preflight } from "@/lib/assistant/http";

// RFC 9728: Wo sich Claude für /api/mcp anmeldet (auch unter …/oauth-protected-resource/api/mcp).
export async function GET(req: Request) {
  return jsonResponse(protectedResourceMetadata(claudeBaseUrl(req)), 200, { "Cache-Control": "public, max-age=3600" });
}
export async function OPTIONS() {
  return preflight();
}
