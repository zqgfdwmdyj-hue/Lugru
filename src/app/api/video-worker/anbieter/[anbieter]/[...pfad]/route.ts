import { workerPruefen } from "@/lib/video/api";
import { weiterleiten } from "@/lib/video/anbieter";

// Anbieter-Brücke: Claude (/v1/messages), ElevenLabs (/v1/text-to-speech/{stimme}), OpenAI (/v1/images/generations).
// Schlüssel bleiben im Seller-System, Kosten werden dem Auftrag (Kopf x-auftrag) zugeordnet.

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ anbieter: string; pfad: string[] }> }) {
  const p = await workerPruefen(request);
  if (!p.ok) return p.antwort;
  const { anbieter, pfad } = await params;
  return weiterleiten(p.worker, anbieter, pfad, request);
}
