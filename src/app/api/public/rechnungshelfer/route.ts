import { receiveRechnungshelfer, RhInputError, tenantForRhToken, tokenFromHeader } from "@/lib/invoices/rechnungshelfer-service";

// Webhook für den JSON-Export des Rechnungshelfers (Discord). Anmeldung über den Auth-Header
// „Bearer rh_…“ (unter Ausgangsrechnungen → Rechnungshelfer erzeugt), keine Sitzung.

export const dynamic = "force-dynamic";
const MAX_BYTES = 512 * 1024;

export async function GET() {
  return Response.json({ ok: true, info: "Rechnungshelfer-Webhook des Seller-Systems – Entwürfe per POST (JSON) mit Auth-Header „Bearer …“." });
}

export async function POST(request: Request) {
  const tenantId = await tenantForRhToken(tokenFromHeader(request.headers.get("authorization")));
  if (!tenantId) return Response.json({ ok: false, error: "Schlüssel fehlt oder ist falsch (Auth-Header „Bearer rh_…“)." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ ok: false, error: "Zu groß." }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return Response.json({ ok: false, error: "Zu groß." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: "Kein gültiges JSON." }, { status: 400 });
  }
  try {
    const r = await receiveRechnungshelfer(tenantId, body);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof RhInputError) return Response.json({ ok: false, error: e.message }, { status: 422 });
    console.error("Rechnungshelfer-Webhook", e);
    return Response.json({ ok: false, error: "Interner Fehler – bitte später erneut senden." }, { status: 500 });
  }
}
