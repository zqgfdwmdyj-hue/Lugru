import { uploadAnnehmen } from "@/lib/datei-import/service";
import { MAX_MB } from "@/lib/datei-import/logic";

// Datei-Import über den Claude-Konnektor: Einmal-Adresse aus „import_link“. PUT mit der Datei als Inhalt (z. B.
// `curl -T datei.csv <upload_url>`). Ohne Anmeldung, ohne Cookies – der Token (15 Min., einmal) ist der Schlüssel.
// Kein Verzeichnis-Listing, kein Download über diese Adresse; erwartbare Fehler als JSON mit klarem Text, nie 500.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KOPF = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const antwort = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: KOPF });

async function annehmen(req: Request, token: string) {
  const laenge = Number(req.headers.get("content-length") ?? "");
  const angabe = Number.isFinite(laenge) && laenge >= 0 && req.headers.has("content-length") ? laenge : null;
  // Zu große Dateien gar nicht erst lesen (Prüfung der Adresse zuerst, damit „abgelaufen“ Vorrang hat).
  const vorab = await uploadAnnehmen(token, null, angabe);
  if (vorab.status !== 400 || angabe === 0) return antwort(vorab.status, vorab.body);
  let bytes: Uint8Array;
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_MB * 1024 * 1024) return antwort(413, { fehler: `Datei zu groß (höchstens ${MAX_MB} MB).`, code: "zu_gross" });
    bytes = new Uint8Array(buf);
  } catch {
    return antwort(400, { fehler: "Datei konnte nicht gelesen werden (Übertragung abgebrochen?).", code: "leer" });
  }
  try {
    const r = await uploadAnnehmen(token, bytes, bytes.length);
    return antwort(r.status, r.body);
  } catch (e) {
    console.error("Datei-Import Upload", e instanceof Error ? e.message : e);
    return antwort(503, { fehler: "Upload gerade nicht möglich – bitte gleich noch einmal mit einer neuen Adresse (import_link)." });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return annehmen(req, (await params).token);
}

/** POST wie PUT (manche Programme können nur POST). */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return annehmen(req, (await params).token);
}

export async function GET() {
  return antwort(405, { fehler: "Nur Hochladen (PUT) – kein Download über diese Adresse." });
}
