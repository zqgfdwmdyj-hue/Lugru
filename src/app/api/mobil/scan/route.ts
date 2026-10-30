import { mobilFehler } from "@/lib/mobil/antwort";
import { mobilPruefen } from "@/lib/mobil/token";
import { scanPruefen } from "@/lib/mobil/service";

// Kurzbefehl „Scan“ (B13): { ean, preis, menge?, netto? } → Deal-Ampel mit Satz zum Vorlesen.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await mobilPruefen(request, "scan");
  if (!p.ok) return mobilFehler(p.status, p.fehler);
  const b = (await request.json().catch(() => ({}))) as { ean?: unknown; preis?: unknown; menge?: unknown; netto?: unknown };
  const ean = typeof b.ean === "string" || typeof b.ean === "number" ? String(b.ean).trim() : "";
  const preis = Number(String(b.preis ?? "").replace(",", "."));
  if (!ean || !(preis > 0)) return Response.json({ error: "Bitte EAN/ASIN und Preis angeben." }, { status: 400 });
  try {
    return Response.json(await scanPruefen(p.session.tenantId, { ean, preis, menge: Number(b.menge) > 0 ? Math.round(Number(b.menge)) : null, netto: b.netto === true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Prüfung fehlgeschlagen.", vorlesen: "Das konnte ich nicht prüfen." }, { status: 422 });
  }
}
