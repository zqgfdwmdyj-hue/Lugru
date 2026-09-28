import "server-only";
import { gmailProfile, googleAuthUrl, googleToken, graphMe, microsoftAuthUrl, microsoftToken, MS_SCOPES } from "@/lib/integrations/clients/mail";
import { getIntegration } from "@/lib/integrations/store";
import { saveOAuthMailbox } from "@/lib/mail/accounts";
import { syncMailbox } from "@/lib/inbox/service";

export { parsePastedRedirect } from "./paste";

// Postfach per Google-/Microsoft-Anmeldung verbinden. Zwei Wege:
// - Weiterleitung zurück an die App (braucht eine https-Adresse oder localhost),
// - „Link einfügen“ wie beim eBay-Tool: Rückkehr nach http://localhost, die Adresse aus der
//   Browserzeile wird in der App eingefügt – klappt auch über Tailscale ohne eigene Domain.

export const PASTE_REDIRECT = "http://localhost";
export type MailOAuthProvider = "google" | "microsoft";

/** Weiterleitung zurück an die App nur, wenn der Anbieter die Adresse akzeptiert. */
export function canRedirectTo(base: string): boolean {
  return /^https:\/\//.test(base) || /^http:\/\/localhost(:\d+)?$/.test(base);
}

export function authUrl(provider: MailOAuthProvider, clientId: string, redirectUri: string, state: string) {
  return provider === "google" ? googleAuthUrl(clientId, redirectUri, state) : microsoftAuthUrl(clientId, redirectUri, state);
}

/** Code gegen Zugang tauschen, Postfach anlegen und gleich abrufen. Gibt die Adresse zurück. */
export async function finishMailOAuth(tenantId: string, provider: MailOAuthProvider, code: string, redirectUri: string): Promise<string> {
  const app = await getIntegration(tenantId, provider);
  if (!app?.clientId || !app.clientSecret) throw new Error(`${provider === "google" ? "Google" : "Microsoft"}-App fehlt (Anbindungen).`);
  const base = { code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" };
  if (provider === "google") {
    const tok = await googleToken(base);
    if (!tok.refresh_token) throw new Error("Google hat kein Refresh-Token geliefert – bitte Zugriff unter myaccount.google.com/permissions entfernen und neu verbinden.");
    const address = await gmailProfile(tok.access_token);
    const id = await saveOAuthMailbox(tenantId, "gmail", address, tok.refresh_token, tok.scope);
    await syncMailbox(tenantId, id).catch(() => undefined);
    return address;
  }
  const tok = await microsoftToken({ ...base, scope: MS_SCOPES.join(" ") });
  if (!tok.refresh_token) throw new Error("Microsoft hat kein Refresh-Token geliefert (offline_access fehlt?).");
  const address = await graphMe(tok.access_token);
  const id = await saveOAuthMailbox(tenantId, "outlook", address, tok.refresh_token, tok.scope ?? MS_SCOPES.join(" "));
  await syncMailbox(tenantId, id).catch(() => undefined);
  return address;
}
