import { mobilPruefen } from "@/lib/mobil/token";
import { kurzWerte } from "@/lib/mobil/service";

// Sperrbildschirm-Widget (B13): Umsatz heute/gestern, Nettogewinn gestern, FBM mit Frist heute, wichtige ToDos,
// nächster Termin (privat nur „Termin außer Haus“), neue grüne Deals. Nur mit Geräte-Schlüssel (mk_…).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = await mobilPruefen(request, "kurz");
  if (!p.ok) return Response.json({ error: p.fehler }, { status: p.status });
  return Response.json(await kurzWerte(p.session), { headers: { "Cache-Control": "no-store" } });
}
