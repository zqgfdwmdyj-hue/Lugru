import { getSession } from "@/lib/auth/session";
import { microsoftAuthUrl } from "@/lib/integrations/clients/mail";
import { getIntegration } from "@/lib/integrations/store";
import { appUrl, signState } from "@/lib/oauth/state";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return Response.redirect(`${appUrl(request)}/login`);
  const app = await getIntegration(session.tenantId, "microsoft");
  if (!app?.clientId) return Response.redirect(`${appUrl(request)}/anbindungen?p=microsoft`);
  const url = microsoftAuthUrl(app.clientId, `${appUrl(request)}/api/oauth/microsoft/callback`, signState(session.tenantId, session.userId, "microsoft"));
  return Response.redirect(url);
}
