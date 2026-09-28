import { finishMailOAuth } from "@/lib/oauth/mail-flow";
import { appUrl, verifyState } from "@/lib/oauth/state";

export async function GET(request: Request) {
  const base = appUrl(request);
  const u = new URL(request.url);
  const state = verifyState(u.searchParams.get("state"));
  const code = u.searchParams.get("code");
  if (!state || state.p !== "microsoft" || !code) {
    return Response.redirect(`${base}/posteingang/verbinden?fehler=${encodeURIComponent(u.searchParams.get("error_description") ?? u.searchParams.get("error") ?? "Anmeldung abgebrochen")}`);
  }
  try {
    const address = await finishMailOAuth(state.t, "microsoft", code, `${base}/api/oauth/microsoft/callback`);
    return Response.redirect(`${base}/posteingang?verbunden=${encodeURIComponent(address)}`);
  } catch (e) {
    return Response.redirect(`${base}/posteingang/verbinden?fehler=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
