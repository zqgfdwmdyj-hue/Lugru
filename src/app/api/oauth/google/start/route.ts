import { getSession } from "@/lib/auth/session";
import { googleAuthUrl } from "@/lib/integrations/clients/mail";
import { getIntegration } from "@/lib/integrations/store";
import { appUrl, signState } from "@/lib/oauth/state";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return Response.redirect(`${appUrl(request)}/login`);
  const app = await getIntegration(session.tenantId, "google");
  if (!app?.clientId) return Response.redirect(`${appUrl(request)}/anbindungen?p=google`);
  const url = googleAuthUrl(app.clientId, `${appUrl(request)}/api/oauth/google/callback`, signState(session.tenantId, session.userId, "google"));
  return Response.redirect(url);
}
