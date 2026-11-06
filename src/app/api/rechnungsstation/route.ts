import { getSession } from "@/lib/auth/session";
import { canAccess } from "@/lib/auth/areas";
import { blattAufnehmen, kameraStapel, StationFehler, stapelBeenden, stapelStand } from "@/lib/rechnungsstation/service";

// Rechnungsstation (Kamera): Blatt hochladen, Stand des Stapels (Kacheln), Stapel starten/beenden.
// Erlaubt für Inhaber und alle mit Service (VA), Buchhaltung oder Geld – nur ansehen: nichts hochladen.

const darf = (s: NonNullable<Awaited<ReturnType<typeof getSession>>>) => canAccess(s, "service") || canAccess(s, "buchhaltung") || canAccess(s, "geld");
const json = (o: unknown, status = 200) => Response.json(o, { status, headers: { "Cache-Control": "no-store" } });
const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return json({ fehler: "Nicht angemeldet" }, 401);
  if (!darf(s)) return json({ fehler: "Kein Zugriff" }, 403);
  const id = uuid(new URL(req.url).searchParams.get("stapel"));
  if (!id) return json({ fehler: "Stapel fehlt" }, 400);
  const st = await stapelStand(s.tenantId, id);
  return st ? json(st) : json({ fehler: "Stapel nicht gefunden" }, 404);
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return json({ fehler: "Nicht angemeldet" }, 401);
  if (!darf(s)) return json({ fehler: "Kein Zugriff" }, 403);
  if (s.readOnly) return json({ fehler: "Nur ansehen – mit diesem Zugang wird nichts erfasst." }, 403);
  const wer = { userId: s.userId, name: s.name || s.email };
  const url = new URL(req.url);
  const aktion = url.searchParams.get("aktion") ?? "blatt";
  try {
    if (aktion === "start") {
      const id = await kameraStapel(s.tenantId, wer, url.searchParams.get("neu") === "1");
      return json(await stapelStand(s.tenantId, id));
    }
    if (aktion === "ende") {
      const id = uuid(url.searchParams.get("stapel"));
      if (!id) return json({ fehler: "Stapel fehlt" }, 400);
      return json(await stapelBeenden(s.tenantId, id, { warten: true }));
    }
    const fd = await req.formData();
    const stapelId = uuid(String(fd.get("stapel") ?? ""));
    const bild = fd.get("bild");
    if (!stapelId || !(bild instanceof Blob)) return json({ fehler: "Bild oder Stapel fehlt" }, 400);
    const original = fd.get("original");
    const am = Number(fd.get("aufgenommen"));
    const r = await blattAufnehmen(s.tenantId, wer, {
      stapelId,
      bild: Buffer.from(await bild.arrayBuffer()),
      bildTyp: bild.type,
      original: original instanceof Blob && original.size ? Buffer.from(await original.arrayBuffer()) : null,
      originalTyp: original instanceof Blob ? original.type : undefined,
      aufgenommenAm: Number.isFinite(am) && am > 0 ? new Date(am) : new Date(),
    });
    return json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof StationFehler) return json({ fehler: e.message }, 400);
    console.error("[Rechnungsstation]", e);
    return json({ fehler: "Fehler beim Speichern – bitte noch einmal auflegen." }, 500);
  }
}
