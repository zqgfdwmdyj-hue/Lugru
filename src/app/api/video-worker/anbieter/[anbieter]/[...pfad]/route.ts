import { workerPruefen } from "@/lib/video/api";
import { pexelsSuche, weiterleiten } from "@/lib/video/anbieter";

// Anbieter-Brücke: Claude (/v1/messages), ElevenLabs (/v1/text-to-speech/{stimme}), OpenAI (/v1/images/generations),
// lesend (GET) die Pexels-Videosuche (/pexels/videos/search, B36.11).
// Schlüssel bleiben im Seller-System, Kosten werden dem Auftrag (Kopf x-auftrag) zugeordnet.

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ anbieter: string; pfad: string[] }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { anbieter, pfad } = await params;
  return weiterleiten(p.worker, anbieter, pfad, request);
}

export async function GET(request: Request, { params }: { params: Promise<{ anbieter: string; pfad: string[] }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { anbieter, pfad } = await params;
  if (anbieter !== "pexels") return Response.json({ type: "error", error: { type: "seller_bruecke", message: "Nur POST" } }, { status: 405 });
  return pexelsSuche(p.worker, pfad, request);
}
