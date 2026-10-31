import { basicAuth } from "@/lib/assistant/oauth-logic";
import { exchangeCode, refreshGrant } from "@/lib/assistant/oauth-service";
import { jsonResponse, preflight, readParams } from "@/lib/assistant/http";

// Token-Endpunkt: Code (mit PKCE) gegen Zugangs- und Erneuerungs-Token tauschen bzw. erneuern.
export async function POST(req: Request) {
  const p = await readParams(req);
  const basic = basicAuth(req.headers.get("authorization"));
  const clientId = basic?.id ?? p.client_id ?? null;
  const clientSecret = basic?.secret ?? p.client_secret ?? null;
  let r;
  if (p.grant_type === "authorization_code") r = await exchangeCode({ code: p.code ?? null, clientId, redirectUri: p.redirect_uri ?? null, codeVerifier: p.code_verifier ?? null, clientSecret });
  else if (p.grant_type === "refresh_token") r = await refreshGrant({ refreshToken: p.refresh_token ?? null, clientId, clientSecret });
  else return jsonResponse({ error: "unsupported_grant_type", error_description: "Nur authorization_code und refresh_token." }, 400);
  if ("error" in r) return jsonResponse({ error: r.error, error_description: r.error_description }, r.status ?? 400);
  return jsonResponse(r, 200, { Pragma: "no-cache" });
}
export async function OPTIONS() {
  return preflight();
}
