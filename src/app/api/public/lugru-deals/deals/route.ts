import { tenantFuerDealsSchluessel } from "@/lib/lugru-deals/ebay-token";
import { schluesselAusHeader } from "@/lib/lugru-deals/schluessel";

// Lugru Deals (Shop-Monitor) schickt hier seine geposteten Deals samt Reaktionen als Anzahl (✅ gekauft,
// ❌ nicht verfügbar) – einmal rückwirkend die ganze History, danach laufend die letzten 30 Tage. Keine Namen,
// keine Mitgliederprofile. Anmeldung wie beim eBay-Token über „Bearer <Verbindungsschlüssel>“.

export const dynamic = "force-dynamic";

const MAX_BYTES = 2_000_000;
const fehler = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  return Response.json({ ok: false, error: "Nur POST." }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: Request) {
  const tenantId = await tenantFuerDealsSchluessel(schluesselAusHeader(request.headers.get("authorization")));
  if (!tenantId) return fehler(401, "Verbindungsschlüssel fehlt oder ist falsch.");
  const laenge = Number(request.headers.get("content-length") ?? 0);
  if (laenge > MAX_BYTES) return fehler(413, "Zu groß – höchstens 1000 Deals je Aufruf.");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return fehler(413, "Zu groß – höchstens 1000 Deals je Aufruf.");
    body = JSON.parse(text);
  } catch {
    return fehler(400, "Kein gültiges JSON.");
  }
  const deals = (body as { deals?: unknown })?.deals;
  if (!Array.isArray(deals)) return fehler(400, "Feld „deals“ (Liste) fehlt.");
  if (deals.length > 1000) return fehler(413, "Höchstens 1000 Deals je Aufruf.");
  try {
    const { lugruImport } = await import("@/lib/deal-eingang/wert");
    const r = await lugruImport(tenantId, deals as Parameters<typeof lugruImport>[1]);
    return Response.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fehler(500, "Import fehlgeschlagen – bitte später erneut senden.");
  }
}
