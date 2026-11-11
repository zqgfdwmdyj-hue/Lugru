import { appUrl, verifyState } from "@/lib/oauth/state";
import { youtubeVerbinden } from "@/lib/video/youtube-verbinden";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = appUrl(request);
  const u = new URL(request.url);
  const state = verifyState(u.searchParams.get("state"));
  const code = u.searchParams.get("code");
  const kanalId = state?.p.startsWith("youtube:") ? state.p.slice(8) : null;
  if (!state || !kanalId || !code) return Response.redirect(`${base}/marken/video?meldung=${encodeURIComponent(`YouTube: ${u.searchParams.get("error_description") ?? u.searchParams.get("error") ?? "Anmeldung abgebrochen"}`)}`);
  try {
    const name = await youtubeVerbinden(state.t, kanalId, code, `${base}/api/oauth/youtube/callback`);
    return Response.redirect(`${base}/marken/video?kanal=${kanalId}&meldung=${encodeURIComponent(`YouTube verbunden${name ? ` (${name})` : ""} – Uploads immer privat.`)}`);
  } catch (e) {
    return Response.redirect(`${base}/marken/video?kanal=${kanalId}&meldung=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
