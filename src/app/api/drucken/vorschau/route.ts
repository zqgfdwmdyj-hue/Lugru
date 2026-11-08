import { requireSession } from "@/lib/auth/session";
import { VORLAGEN, type VorlageId } from "@/lib/druck/logic";
import { auftragVorschau, vorschauPng } from "@/lib/druck/service";

// Vorschau vor dem Druck: PNG der Vorlage (Felder e_…) oder eines Auftrags (?auftrag=id) – mit Anmeldung.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const s = await requireSession();
  const u = new URL(request.url);
  const auftrag = u.searchParams.get("auftrag");
  let png: Buffer | null = null;
  if (auftrag && /^[0-9a-f-]{36}$/i.test(auftrag)) png = await auftragVorschau(s.tenantId, auftrag);
  else {
    const vorlage = u.searchParams.get("vorlage") as VorlageId | null;
    if (!vorlage || !VORLAGEN[vorlage]) return new Response("Vorlage unbekannt", { status: 400 });
    const eingabe: Record<string, string> = {};
    for (const [k, v] of u.searchParams.entries()) if (k.startsWith("e_")) eingabe[k.slice(2)] = v.slice(0, 200);
    png = await vorschauPng(vorlage, eingabe).catch(() => null);
  }
  if (!png) return new Response("Keine Vorschau", { status: 404 });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=60" } });
}
