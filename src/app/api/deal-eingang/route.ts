import { after } from "next/server";
import { canAccess } from "@/lib/auth/areas";
import { getSession } from "@/lib/auth/session";
import { DealEingangFehler, eingangAnlegen, eingangPruefen, tokenPruefen, type EingangDatei } from "@/lib/deal-eingang/service";

// Deal-Eingang von außen: iPhone-Kurzbefehl („Authorization: Bearer dk_…“) oder angemeldet (PWA-Teilen-Ziel, Seite).
// Nimmt multipart/form-data (text, quelle, datei…) oder JSON ({ text, quelle }). Antwortet sofort; geprüft wird im
// Hintergrund. Eigene Anmeldung – nicht über proxy.ts (große Dateien, Schlüssel statt Cookie).

export const dynamic = "force-dynamic";
const MAX = 40 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  let wer: { tenantId: string; userId: string; tokenId: string | null; weg: "kurzbefehl" | "teilen" };
  if (auth.startsWith("Bearer ")) {
    const t = await tokenPruefen(auth.slice(7).trim());
    if (!t.ok) return Response.json({ error: t.fehler }, { status: t.status });
    wer = { tenantId: t.tenantId, userId: t.userId, tokenId: t.tokenId, weg: "kurzbefehl" };
  } else {
    const s = await getSession();
    if (!s) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (!canAccess(s, "dealeingang") || s.readOnly) return Response.json({ error: "Kein Zugriff auf den Deal-Eingang." }, { status: 403 });
    wer = { tenantId: s.tenantId, userId: s.userId, tokenId: null, weg: "teilen" };
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX) return Response.json({ error: "Zu groß (höchstens 40 MB)." }, { status: 413 });
  let text = "";
  let quelle: string | null = null;
  const dateien: EingangDatei[] = [];
  const typ = request.headers.get("content-type") ?? "";
  if (typ.includes("multipart/form-data") || typ.includes("application/x-www-form-urlencoded")) {
    const fd = await request.formData();
    text = [fd.get("text"), fd.get("title"), fd.get("url")].filter((x): x is string => typeof x === "string" && !!x.trim()).join("\n");
    quelle = typeof fd.get("quelle") === "string" ? (fd.get("quelle") as string) : null;
    for (const [, v] of fd.entries()) if (v instanceof File && v.size) dateien.push({ name: v.name || "datei", mime: v.type || "application/octet-stream", bytes: new Uint8Array(await v.arrayBuffer()) });
  } else if (typ.includes("application/json")) {
    const b = (await request.json().catch(() => ({}))) as { text?: unknown; quelle?: unknown };
    text = typeof b.text === "string" ? b.text : "";
    quelle = typeof b.quelle === "string" ? b.quelle : null;
  } else if (typ.startsWith("image/") || typ === "application/pdf") {
    dateien.push({ name: typ === "application/pdf" ? "geteilt.pdf" : `geteilt.${typ.split("/")[1]}`, mime: typ, bytes: new Uint8Array(await request.arrayBuffer()) });
  } else {
    text = await request.text();
  }
  try {
    const r = await eingangAnlegen(wer.tenantId, wer.userId, { weg: wer.weg, text, dateien, quelle, tokenId: wer.tokenId });
    if (r.neu) after(() => eingangPruefen(wer.tenantId, r.id));
    const link = `${new URL(request.url).origin}/deal-eingang/${r.id}`;
    // Kurzbefehl zeigt die Antwort als Text an; Teilen-Ziel (Formular) springt zur Detailseite.
    if (wer.weg === "teilen" && !typ.includes("application/json")) return Response.redirect(link, 303);
    return Response.json({ ok: true, id: r.id, neu: r.neu, text: r.neu ? "Wird geprüft – Ergebnis gleich als Mitteilung bzw. im Deal-Eingang." : "Schon da – wird nicht doppelt geprüft.", link });
  } catch (e) {
    return Response.json({ error: e instanceof DealEingangFehler ? e.message : "Konnte nicht gespeichert werden." }, { status: e instanceof DealEingangFehler ? 400 : 500 });
  }
}
