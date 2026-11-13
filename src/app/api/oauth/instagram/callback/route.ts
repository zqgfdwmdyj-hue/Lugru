import { appUrl, verifyState } from "@/lib/oauth/state";
import { instagramVerbinden } from "@/lib/video/story";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = appUrl(request);
  const u = new URL(request.url);
  const state = verifyState(u.searchParams.get("state"));
  const code = u.searchParams.get("code");
  const kanalId = state?.p.startsWith("instagram:") ? state.p.slice(10) : null;
  if (!state || !kanalId || !code) return Response.redirect(`${base}/marken/video?meldung=${encodeURIComponent(`Instagram: ${u.searchParams.get("error_description") ?? u.searchParams.get("error") ?? "Anmeldung abgebrochen"}`)}`);
  try {
    const konto = await instagramVerbinden(state.t, kanalId, code.replace(/#_$/, ""), `${base}/api/oauth/instagram/callback`);
    return Response.redirect(`${base}/marken/video?kanal=${kanalId}&meldung=${encodeURIComponent(`Instagram verbunden${konto ? ` (${konto})` : ""} – freigegebene Stories werden zur Planzeit gepostet.`)}#kanal`);
  } catch (e) {
    return Response.redirect(`${base}/marken/video?kanal=${kanalId}&meldung=${encodeURIComponent(e instanceof Error ? e.message : String(e))}#kanal`);
  }
}
