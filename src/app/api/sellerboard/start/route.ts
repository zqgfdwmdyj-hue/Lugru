import { getSession } from "@/lib/auth/session";
import { requestOrigin, signState } from "@/lib/oauth/state";
import { startAuth } from "@/lib/sellerboard/connection";

// Anmeldung bei sellerboard starten (nur Inhaber). Der PKCE-Prüfwert bleibt verschlüsselt auf dem Server –
// er geht nie über die Adresszeile und hängt nicht am Browser-Fenster.
// Rücksprung-Adresse = die Adresse, unter der der Browser das System gerade aufruft (z. B. die Domain),
// nicht APP_URL – sonst landet man nach „Erlauben“ auf einer internen Adresse, die von außen nicht erreichbar ist.

const go = (location: string) => new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return go("/login");
  if (session.readOnly || session.role !== "owner") return go("/?gesperrt=inhaber");
  const state = signState(session.tenantId, session.userId, "sellerboard");
  try {
    const { url } = await startAuth(session.tenantId, `${requestOrigin(request)}/api/sellerboard/callback`, state);
    return go(url);
  } catch (e) {
    return go(`/anbindungen?sellerboard=${encodeURIComponent(e instanceof Error ? e.message : String(e))}#sellerboard`);
  }
}
