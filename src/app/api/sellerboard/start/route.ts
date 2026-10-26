import { getSession } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/crypto";
import { appUrl, signState } from "@/lib/oauth/state";
import { startAuth } from "@/lib/sellerboard/connection";

// Anmeldung bei sellerboard starten (nur Inhaber). Der PKCE-Prüfwert bleibt verschlüsselt im Cookie –
// er geht nie über die Adresszeile.
export async function GET(request: Request) {
  const base = appUrl(request);
  const session = await getSession();
  if (!session) return Response.redirect(`${base}/login`);
  if (session.readOnly || session.role !== "owner") return Response.redirect(`${base}/anbindungen`);
  const state = signState(session.tenantId, session.userId, "sellerboard");
  try {
    const { url, verifier } = await startAuth(session.tenantId, `${base}/api/sellerboard/callback`, state);
    const secure = base.startsWith("https://") ? "; Secure" : "";
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Set-Cookie": `sb_pkce=${encodeURIComponent(encryptSecret(JSON.stringify({ v: verifier, s: state.slice(-24) })))}; Path=/api/sellerboard; HttpOnly; SameSite=Lax; Max-Age=900${secure}`,
      },
    });
  } catch (e) {
    return Response.redirect(`${base}/anbindungen?sellerboard=${encodeURIComponent(e instanceof Error ? e.message : String(e))}#sellerboard`);
  }
}
