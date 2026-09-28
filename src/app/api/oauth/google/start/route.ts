import { getSession } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { authUrl, canRedirectTo, PASTE_REDIRECT } from "@/lib/oauth/mail-flow";
import { appUrl, signState } from "@/lib/oauth/state";

// Anmeldung bei Google starten. Mit ?modus=einfuegen (oder ohne https-Adresse) geht es danach
// nach http://localhost – die Adresse wird dann unter Posteingang → Postfach verbinden eingefügt.
export async function GET(request: Request) {
  const base = appUrl(request);
  const session = await getSession();
  if (!session) return Response.redirect(`${base}/login`);
  const app = await getIntegration(session.tenantId, "google");
  if (!app?.clientId) return Response.redirect(`${base}/anbindungen?p=google#google`);
  const paste = new URL(request.url).searchParams.get("modus") === "einfuegen" || !canRedirectTo(base);
  const redirectUri = paste ? PASTE_REDIRECT : `${base}/api/oauth/google/callback`;
  return Response.redirect(authUrl("google", app.clientId, redirectUri, signState(session.tenantId, session.userId, paste ? "google-paste" : "google")));
}
