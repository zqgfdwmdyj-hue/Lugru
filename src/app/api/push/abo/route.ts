import { getSession } from "@/lib/auth/session";
import { aboLoeschen, aboSpeichern, aboStand, vapid } from "@/lib/push/service";

// Push-Abo der installierten App: GET = öffentlicher VAPID-Schlüssel (mit ?endpoint= auch der Stand des Abos:
// ok / abgelaufen / unbekannt → beim Öffnen neu anfordern), POST = Abo speichern, DELETE = abmelden.
// Nur angemeldet (Sitzung); gespeichert wird nur die Adresse des Push-Dienstes – Meldungen gehen ohne Inhalt raus.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  const stand = endpoint && endpoint.length <= 2000 ? (await aboStand(s.tenantId, s.userId, endpoint)).stand : null;
  return Response.json({ publicKey: (await vapid()).publicKey, stand }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const s = await getSession();
  if (!s || s.readOnly) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { endpoint?: string; geraet?: string };
  if (!b.endpoint || b.endpoint.length > 2000) return Response.json({ error: "Push-Adresse fehlt." }, { status: 400 });
  try {
    await aboSpeichern(s.tenantId, s.userId, b.endpoint, b.geraet ?? null);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Fehler" }, { status: 400 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (b.endpoint) await aboLoeschen(s.tenantId, s.userId, b.endpoint);
  return Response.json({ ok: true });
}
