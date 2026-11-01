import { getSession } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { kaufOeffnen } from "@/lib/deal-eingang/kauf";

// Kurzlink „Kaufen mit einem Tap“: /k/17 (Kauf-Nummer aus dem Push, 24 Std. gültig) bzw. /k/<Deal-ID> (Detailseite).
// Markiert den Deal als „Kauf vorbereitet (Menge)“ und leitet zum Amazon-Warenkorb bzw. zur Produktseite des Shops
// weiter. Mehr macht das System nicht: gekauft wird erst mit „Jetzt kaufen“ in der Amazon-App bzw. im Shop.
// ?produkt=1 → Produktseite (falls der Warenkorb-Link ohne Artikel öffnet); ?code=1 → Detailseite mit „Code kopieren“.

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ nr: string }> }) {
  const { nr: roh } = await params;
  const url = new URL(request.url);
  const hier = (pfad: string) => new URL(pfad, url.origin);
  const session = await getSession();
  if (!session) {
    const login = hier("/login");
    login.searchParams.set("weiter", `${url.pathname}${url.search}`);
    return Response.redirect(login, 302);
  }
  if (!canAccess(session, "dealeingang")) return Response.redirect(hier("/kein-zugriff?gesperrt=1"), 302);
  const ref = UUID.test(roh) ? { id: roh } : /^\d{1,5}$/.test(roh) ? { nr: Number(roh) } : null;
  if (!ref) return Response.redirect(hier("/deal-eingang?kauf=unbekannt"), 302);
  const r = await kaufOeffnen(session.tenantId, ref, { produktseite: url.searchParams.get("produkt") === "1" });
  if (!r.ok) return Response.redirect(hier(r.eingangId ? `/deal-eingang/${r.eingangId}?kauf=${r.grund}#gekauft` : `/deal-eingang?kauf=${r.grund}`), 302);
  if (url.searchParams.get("code") === "1") return Response.redirect(hier(`/deal-eingang/${r.eingangId}?code=1#gekauft`), 302);
  return new Response(null, { status: 302, headers: { Location: r.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
