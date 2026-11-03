import { canAccess } from "@/lib/auth/areas";
import { mobilFehler, mobilNurPost, mobilOk } from "@/lib/mobil/antwort";
import { mobilPruefen } from "@/lib/mobil/token";
import { adresseErkennen, entwurfAnlegen } from "@/lib/versand-label/service";

// iPhone-Teilen-Menü (Kurzbefehl „Label erstellen“): Screenshot (Feld „bild“) oder Text (Feld „text“) senden → Adresse
// wird erkannt und als Entwurf gespeichert; „url“ öffnet „Versand → Label erstellen“ vorausgefüllt. Es entsteht noch
// kein Label. Bild und Text werden nicht gespeichert, nur die erkannte Adresse.

export const dynamic = "force-dynamic";

export const GET = mobilNurPost;

export async function POST(request: Request) {
  const p = await mobilPruefen(request, "label", { schreibend: true });
  if (!p.ok) return mobilFehler(p.status, p.fehler);
  if (!canAccess(p.session, "service")) return mobilFehler(403, "Kein Zugang zu „Label erstellen“.");
  let text = "";
  let bild: { bytes: Uint8Array; mime: string } | null = null;
  const typ = request.headers.get("content-type") ?? "";
  if (typ.includes("multipart/form-data")) {
    const fd = await request.formData().catch(() => null);
    text = String(fd?.get("text") ?? "");
    const f = fd?.get("bild");
    if (f instanceof File && f.size > 0) {
      if (f.size > 8 * 1024 * 1024) return mobilFehler(413, "Bild zu groß (höchstens 8 MB).");
      bild = { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type || "image/jpeg" };
    }
  } else if (typ.startsWith("image/")) {
    const b = new Uint8Array(await request.arrayBuffer());
    if (b.length > 8 * 1024 * 1024) return mobilFehler(413, "Bild zu groß (höchstens 8 MB).");
    bild = { bytes: b, mime: typ.split(";")[0] };
  } else {
    const b = (await request.json().catch(() => ({}))) as { text?: unknown };
    text = typeof b.text === "string" ? b.text : "";
  }
  if (!text.trim() && !bild) return mobilFehler(400, "Kein Bild und kein Text erhalten.");
  const r = await adresseErkennen(p.session.tenantId, { text, bild });
  if ("fehler" in r) return mobilFehler(422, r.fehler);
  const id = await entwurfAnlegen(p.session.tenantId, p.session.userId, r);
  const a = r.adresse;
  return mobilOk({ antwort: `${a.name || "Adresse"}, ${a.plz} ${a.ort}${r.unsicher.length ? ` – ${r.unsicher.length} Feld(er) prüfen` : ""}`, url: `/versand/label?vorlage=${id}`, id, unsicher: r.unsicher });
}
