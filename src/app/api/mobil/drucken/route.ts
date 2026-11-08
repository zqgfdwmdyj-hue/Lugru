import { mobilFehler } from "@/lib/mobil/antwort";
import { mobilPruefen } from "@/lib/mobil/token";

// Drucken vom Handy (Kurzbefehl/Teilen-Menü, Gerätetoken mk_…):
//  • JSON { sku | fnsku | ean, anzahl } → FNSKU-Etikett(en) an den QL-800 im Lager
//  • PDF (Body application/pdf oder Formularfeld „datei“) → Kartonlabels/FNSKU-Bogen erkennen, zuordnen, drucken

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await mobilPruefen(request, "drucken", { schreibend: true });
  if (!p.ok) return mobilFehler(p.status, p.fehler);
  const typ = request.headers.get("content-type") ?? "";
  try {
    if (typ.includes("application/json")) {
      const b = (await request.json().catch(() => ({}))) as { sku?: unknown; fnsku?: unknown; ean?: unknown; code?: unknown; anzahl?: unknown };
      const code = [b.sku, b.fnsku, b.ean, b.code].find((x) => typeof x === "string" && x.trim()) as string | undefined;
      if (!code) return Response.json({ ok: false, text: "sku, fnsku oder ean fehlt" }, { status: 400 });
      const { fnskuDrucken } = await import("@/lib/druck/sku");
      const r = await fnskuDrucken(p.session, code, Math.min(100, Math.max(1, Number(b.anzahl) || 1)), "/api/mobil/drucken");
      return Response.json(r, { status: r.ok ? 200 : 404 });
    }
    let name = decodeURIComponent(request.headers.get("x-dateiname") ?? "teilen.pdf");
    let bytes: Uint8Array;
    if (typ.includes("multipart/form-data")) {
      const f = (await request.formData()).get("datei");
      if (!(f instanceof File)) return Response.json({ ok: false, text: "Datei fehlt" }, { status: 400 });
      name = f.name || name;
      bytes = new Uint8Array(await f.arrayBuffer());
    } else bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) return Response.json({ ok: false, text: "leer oder größer als 25 MB" }, { status: 400 });
    const { pdfHochladen } = await import("@/lib/druck/dateien");
    const r = await pdfHochladen(p.session, name.slice(0, 200), bytes, { drucken: true, seite: "/api/mobil/drucken" });
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, text: e instanceof Error ? e.message : "Fehler" }, { status: 422 });
  }
}
