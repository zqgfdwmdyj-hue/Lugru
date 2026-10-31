import { linkBasis } from "@/lib/public-url";
import { mobilFehler, mobilNurPost, mobilOk } from "@/lib/mobil/antwort";
import { mobilPruefen } from "@/lib/mobil/token";
import { erfassen } from "@/lib/schnell/service";

// Schnellerfassung per Sprache (iPhone-Kurzbefehl „Hey Siri, Seller-System …“ bzw. Android-Pendant):
// „Authorization: Bearer mk_…“, Text als JSON { text }, Formular (text) oder reiner Text. Antwortet immer mit JSON:
// Erfolg { ok: true, antwort, … }, Fehler { ok: false, error, antwort } mit passendem Status. Eigene Anmeldung über
// den Geräte-Schlüssel – nicht über proxy.ts. Öffentlich erreichbar nur, wenn die Freigabe (deploy/claude-oeffentlich.sh)
// /api/mobil/* durchlässt.

export const dynamic = "force-dynamic";

export const GET = mobilNurPost;

/** Diktierten Text aus JSON, Formular oder reinem Text lesen; null = Inhalt nicht lesbar. */
async function textAus(request: Request): Promise<{ text: string } | { fehler: string }> {
  const typ = request.headers.get("content-type") ?? "";
  if (typ.includes("application/json")) {
    let b: unknown;
    try {
      b = await request.json();
    } catch {
      return { fehler: "Ungültiges JSON – erwartet wird { \"text\": \"…\" }." };
    }
    const t = b && typeof b === "object" ? (b as { text?: unknown }).text : undefined;
    return { text: typeof t === "string" ? t : "" };
  }
  if (typ.includes("form")) {
    const v = (await request.formData().catch(() => null))?.get("text");
    return { text: typeof v === "string" ? v : "" };
  }
  return { text: (await request.text()).slice(0, 4000) };
}

export async function POST(request: Request) {
  let p: Awaited<ReturnType<typeof mobilPruefen>>;
  try {
    p = await mobilPruefen(request, "erfassen", { schreibend: true });
  } catch (e) {
    console.error("[Schnellerfassung] Prüfung:", e instanceof Error ? e.message : e);
    return mobilFehler(503, "Seller-System gerade nicht erreichbar – bitte gleich noch einmal.");
  }
  if (!p.ok) return mobilFehler(p.status, p.fehler);
  const t = await textAus(request);
  if ("fehler" in t) return mobilFehler(400, t.fehler);
  if (t.text.trim().length < 3) return mobilFehler(400, "Bitte etwas diktieren.");
  try {
    const r = await erfassen(p.session, t.text, { tokenId: p.tokenId });
    return mobilOk({ angelegt: r.angelegt, art: r.art, antwort: r.antwort, link: `${linkBasis(request)}/schnell` });
  } catch (e) {
    console.error("[Schnellerfassung]", e instanceof Error ? e.message : e);
    return mobilFehler(500, "Konnte nicht gespeichert werden.");
  }
}
