import { graphMe, microsoftToken } from "@/lib/integrations/clients/mail";
import { getIntegration } from "@/lib/integrations/store";
import { saveMailbox } from "@/lib/oauth/mailbox";
import { appUrl, verifyState } from "@/lib/oauth/state";
import { syncMailbox } from "@/lib/inbox/service";

export async function GET(request: Request) {
  const base = appUrl(request);
  const u = new URL(request.url);
  const state = verifyState(u.searchParams.get("state"));
  const code = u.searchParams.get("code");
  if (!state || state.p !== "microsoft" || !code) return Response.redirect(`${base}/posteingang?fehler=${encodeURIComponent(u.searchParams.get("error_description") ?? "Anmeldung abgebrochen")}`);
  try {
    const app = await getIntegration(state.t, "microsoft");
    if (!app?.clientId || !app.clientSecret) throw new Error("Microsoft-App fehlt");
    const tok = await microsoftToken({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: `${base}/api/oauth/microsoft/callback`, grant_type: "authorization_code", scope: "offline_access Mail.Read User.Read" });
    if (!tok.refresh_token) throw new Error("Microsoft hat kein Refresh-Token geliefert (offline_access fehlt?).");
    const address = await graphMe(tok.access_token);
    const id = await saveMailbox(state.t, "outlook", address, tok.refresh_token);
    await syncMailbox(state.t, id).catch(() => undefined);
    return Response.redirect(`${base}/posteingang?verbunden=${encodeURIComponent(address)}`);
  } catch (e) {
    return Response.redirect(`${base}/posteingang?fehler=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
