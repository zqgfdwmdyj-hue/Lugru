import { getSession } from "@/lib/auth/session";
import { appUrl, verifyState } from "@/lib/oauth/state";
import { finishAuth, takePkce } from "@/lib/sellerboard/connection";
import { startSellerboardSync } from "@/lib/sellerboard/sync";

// Rücksprung von sellerboard. Antwortet sofort (Konto und Abgleich laufen im Hintergrund), damit die
// sellerboard-Seite nicht auf „Loading…“ stehen bleibt.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Zurück zu Anbindungen – oder, wenn dieses Fenster nicht angemeldet ist (Handy), eine kurze Abschluss-Seite. */
async function back(base: string, msg: string) {
  const session = await getSession().catch(() => null);
  if (session) return new Response(null, { status: 302, headers: { Location: `${base}/anbindungen?sellerboard=${encodeURIComponent(msg)}#sellerboard`, "Cache-Control": "no-store" } });
  const ok = msg === "ok";
  const text = ok ? "sellerboard ist verbunden. Der erste Abgleich läuft im Hintergrund." : `sellerboard wurde nicht verbunden: ${msg}`;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>sellerboard</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.25rem">${ok ? "✓ Verbunden" : "Nicht verbunden"}</h1>
<p data-testid="sb-done">${esc(text)}</p>
<p>Dieses Fenster kannst du schließen und zum Seller-System zurückkehren.</p>
<p><a href="${esc(base)}/anbindungen#sellerboard">Zum Seller-System</a></p>
</body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const base = appUrl(request);
  const u = new URL(request.url);
  const stateRaw = u.searchParams.get("state");
  const state = verifyState(stateRaw);
  const code = u.searchParams.get("code");
  if (!state || !stateRaw || state.p !== "sellerboard" || !code) return back(base, u.searchParams.get("error_description") ?? u.searchParams.get("error") ?? "Anmeldung abgebrochen.");
  const verifier = await takePkce(state.t, stateRaw.slice(-24));
  if (!verifier) return back(base, "Anmeldung abgelaufen – bitte erneut „Mit sellerboard verbinden“.");
  try {
    await finishAuth(state.t, code, verifier);
    // Konto ermittelt der Abgleich selbst (erster Schritt) – hier nicht darauf warten.
    startSellerboardSync(state.t, "alles");
    return back(base, "ok");
  } catch (e) {
    return back(base, e instanceof Error ? e.message : String(e));
  }
}
