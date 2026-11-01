import { getSession } from "@/lib/auth/session";
import { updatePrefs } from "@/lib/auth/prefs";

// Glocke oben geöffnet: Push-Meldungen bis jetzt als gesehen merken (nur für mich).

export const dynamic = "force-dynamic";

export async function POST() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  await updatePrefs(s, (p) => ({ ...p, meldungenSeenAt: new Date().toISOString() }));
  return Response.json({ ok: true });
}
