import { getSession } from "@/lib/auth/session";
import { meldungStand, testPush } from "@/lib/push/service";

// Prüfseite (Einstellungen → Benachrichtigungen): POST = Test-Push an genau dieses Gerät, GET ?id= = Zustellzeit.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const s = await getSession();
  if (!s || s.readOnly) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (!b.endpoint || b.endpoint.length > 2000) return Response.json({ error: "Push-Adresse fehlt." }, { status: 400 });
  return Response.json(await testPush(s.tenantId, s.userId, b.endpoint));
}

export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "ID fehlt." }, { status: 400 });
  const m = await meldungStand(s.tenantId, s.userId, id);
  if (!m) return Response.json({ error: "Nicht gefunden." }, { status: 404 });
  return Response.json(m, { headers: { "Cache-Control": "no-store" } });
}
