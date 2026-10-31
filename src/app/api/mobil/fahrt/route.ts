import { mobilFehler } from "@/lib/mobil/antwort";
import { mobilPruefen } from "@/lib/mobil/token";
import { fahrtBriefing } from "@/lib/mobil/service";

// Kurzbefehl „Tesla verbunden“ (B13): vorlesbares Briefing (≤ 60 Sekunden) passend zum Ziel + Anrufe für die Fahrt.
// ?ziel=… (optional; sonst Navi-Ziel des Autos bzw. nächster Termin mit Ort), ?minuten=… (optional).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const p = await mobilPruefen(request, "fahrt");
  if (!p.ok) return mobilFehler(p.status, p.fehler);
  const u = new URL(request.url);
  const min = Number(u.searchParams.get("minuten"));
  const r = await fahrtBriefing(p.session, { ziel: u.searchParams.get("ziel"), minuten: Number.isFinite(min) && min > 0 ? Math.min(240, Math.round(min)) : null });
  return Response.json(r, { headers: { "Cache-Control": "no-store" } });
}
