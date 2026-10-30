import { mobilPruefen } from "@/lib/mobil/token";
import { erfassen } from "@/lib/schnell/service";

// Schnellerfassung per Sprache (iPhone-Kurzbefehl „Hey Siri, Seller-System …“ bzw. Android-Pendant):
// „Authorization: Bearer mk_…“, Text als JSON { text }, Formular (text) oder reiner Text. Antwortet mit einem
// kurzen Satz zum Vorlesen. Eigene Anmeldung über den Geräte-Schlüssel – nicht über proxy.ts.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await mobilPruefen(request, "erfassen", { schreibend: true });
  if (!p.ok) return Response.json({ error: p.fehler }, { status: p.status });
  const typ = request.headers.get("content-type") ?? "";
  let text = "";
  if (typ.includes("application/json")) {
    const b = (await request.json().catch(() => ({}))) as { text?: unknown };
    text = typeof b.text === "string" ? b.text : "";
  } else if (typ.includes("form")) {
    const v = (await request.formData()).get("text");
    text = typeof v === "string" ? v : "";
  } else {
    text = (await request.text()).slice(0, 4000);
  }
  if (text.trim().length < 3) return Response.json({ error: "Bitte etwas diktieren." }, { status: 400 });
  try {
    const r = await erfassen(p.session, text, { tokenId: p.tokenId });
    return Response.json({ ok: true, angelegt: r.angelegt, art: r.art, antwort: r.antwort, link: `${new URL(request.url).origin}/schnell` });
  } catch (e) {
    console.error("[Schnellerfassung]", e instanceof Error ? e.message : e);
    return Response.json({ error: "Konnte nicht gespeichert werden." }, { status: 500 });
  }
}
