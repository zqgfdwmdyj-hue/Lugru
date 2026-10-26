import { getSession } from "@/lib/auth/session";
import { appUrl, signState } from "@/lib/oauth/state";
import { startAuth } from "@/lib/sellerboard/connection";

// Anmeldung bei sellerboard starten (nur Inhaber). Der PKCE-Prüfwert bleibt verschlüsselt auf dem Server –
// er geht nie über die Adresszeile und hängt nicht am Browser-Fenster.
export async function GET(request: Request) {
  const base = appUrl(request);
  const session = await getSession();
  if (!session) return Response.redirect(`${base}/login`);
  if (session.readOnly || session.role !== "owner") return Response.redirect(`${base}/anbindungen`);
  const state = signState(session.tenantId, session.userId, "sellerboard");
  try {
    const { url } = await startAuth(session.tenantId, `${base}/api/sellerboard/callback`, state);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.redirect(`${base}/anbindungen?sellerboard=${encodeURIComponent(e instanceof Error ? e.message : String(e))}#sellerboard`);
  }
}
