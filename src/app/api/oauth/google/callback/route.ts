import { googleToken, gmailProfile } from "@/lib/integrations/clients/mail";
import { getIntegration } from "@/lib/integrations/store";
import { saveMailbox } from "@/lib/oauth/mailbox";
import { appUrl, verifyState } from "@/lib/oauth/state";
import { syncMailbox } from "@/lib/inbox/service";

export async function GET(request: Request) {
  const base = appUrl(request);
  const u = new URL(request.url);
  const state = verifyState(u.searchParams.get("state"));
  const code = u.searchParams.get("code");
  if (!state || state.p !== "google" || !code) return Response.redirect(`${base}/posteingang?fehler=${encodeURIComponent(u.searchParams.get("error") ?? "Anmeldung abgebrochen")}`);
  try {
    const app = await getIntegration(state.t, "google");
    if (!app?.clientId || !app.clientSecret) throw new Error("Google-App fehlt");
    const tok = await googleToken({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: `${base}/api/oauth/google/callback`, grant_type: "authorization_code" });
    if (!tok.refresh_token) throw new Error("Google hat kein Refresh-Token geliefert – bitte Zugriff unter myaccount.google.com/permissions entfernen und neu verbinden.");
    const address = await gmailProfile(tok.access_token);
    const id = await saveMailbox(state.t, "gmail", address, tok.refresh_token);
    await syncMailbox(state.t, id).catch(() => undefined);
    return Response.redirect(`${base}/posteingang?verbunden=${encodeURIComponent(address)}`);
  } catch (e) {
    return Response.redirect(`${base}/posteingang?fehler=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
