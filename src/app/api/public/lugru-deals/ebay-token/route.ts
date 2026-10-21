import { ebayAppTokenFuer, tenantFuerDealsSchluessel } from "@/lib/lugru-deals/ebay-token";
import { schluesselAusHeader } from "@/lib/lugru-deals/schluessel";

// Lugru Deals (Shop-Monitor) holt hier das eBay-App-Token für die Art „eBay“.
// Anmeldung über den Auth-Header „Bearer <Verbindungsschlüssel>“ (unter
// Anbindungen → Lugru Deals), keine Sitzung. Die eBay-Schlüssel selbst
// verlassen das Seller-System nie — nur das Token, das ohnehin nach zwei
// Stunden abläuft und nur Angebote lesen darf.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const tenantId = await tenantFuerDealsSchluessel(schluesselAusHeader(request.headers.get("authorization")));
  if (!tenantId) {
    return Response.json({ ok: false, error: "Verbindungsschlüssel fehlt oder ist falsch." }, { status: 401 });
  }
  try {
    const { accessToken, env } = await ebayAppTokenFuer(tenantId);
    // expires_in bewusst knapp: das Seller-System hält das Token selbst nur
    // bis kurz vor Ablauf, Lugru Deals fragt danach einfach erneut.
    return Response.json({ ok: true, access_token: accessToken, expires_in: 1800, env }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const meldung = e instanceof Error ? e.message : "unbekannter Fehler";
    return Response.json({ ok: false, error: `eBay-Token nicht verfügbar: ${meldung}` }, { status: 502 });
  }
}
