import { decryptSecret } from "@/lib/crypto";
import { appUrl, verifyState } from "@/lib/oauth/state";
import { finishAuth } from "@/lib/sellerboard/connection";
import { startSellerboardSync, identifyAccount } from "@/lib/sellerboard/sync";

const back = (base: string, msg: string) =>
  new Response(null, { status: 302, headers: { Location: `${base}/anbindungen?sellerboard=${encodeURIComponent(msg)}#sellerboard`, "Set-Cookie": "sb_pkce=; Path=/api/sellerboard; HttpOnly; SameSite=Lax; Max-Age=0" } });

export async function GET(request: Request) {
  const base = appUrl(request);
  const u = new URL(request.url);
  const stateRaw = u.searchParams.get("state");
  const state = verifyState(stateRaw);
  const code = u.searchParams.get("code");
  if (!state || state.p !== "sellerboard" || !code) return back(base, u.searchParams.get("error_description") ?? u.searchParams.get("error") ?? "Anmeldung abgebrochen.");
  const cookie = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith("sb_pkce="))?.slice(8);
  let verifier: string | null = null;
  try {
    const j = cookie ? (JSON.parse(decryptSecret(decodeURIComponent(cookie))) as { v: string; s: string }) : null;
    if (j && stateRaw && stateRaw.slice(-24) === j.s) verifier = j.v;
  } catch {
    verifier = null;
  }
  if (!verifier) return back(base, "Anmeldung abgelaufen – bitte erneut „Mit sellerboard verbinden“.");
  try {
    await finishAuth(state.t, code, verifier);
    // Konto gleich ermitteln; klappt das nicht, holt der Abgleich es nach (Verbindung steht trotzdem).
    await identifyAccount(state.t).catch(() => undefined);
    startSellerboardSync(state.t, "alles");
    return back(base, "ok");
  } catch (e) {
    return back(base, e instanceof Error ? e.message : String(e));
  }
}
