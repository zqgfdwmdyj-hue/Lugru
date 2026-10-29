import { z } from "zod";
import { fallPaket } from "@/lib/retouren-station/fall";
import { lesen } from "@/lib/medien/ablage";
import { stationZugang } from "@/lib/retouren-station/zugang";
import { zipErstellen, type ZipEintrag } from "@/lib/zip";

// Fall-Paket als ZIP: Fotos in der von Amazon verlangten Reihenfolge (1_Versandetikett.jpg …) plus Falltext DE/EN.

export async function GET(_req: Request, { params }: { params: Promise<{ positionId: string }> }) {
  const z0 = await stationZugang(false);
  if ("antwort" in z0) return z0.antwort;
  const id = z.string().uuid().safeParse((await params).positionId);
  if (!id.success) return new Response("Nicht gefunden", { status: 404 });
  const f = await fallPaket(z0.session.tenantId, id.data);
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  const eintraege: ZipEintrag[] = [];
  for (const d of f.dateien) {
    const b = await lesen(d.medium.pfad).catch(() => null);
    if (b) eintraege.push({ name: d.name, daten: new Uint8Array(b), datum: d.medium.aufgenommenAm });
  }
  const x = f.position;
  if (x.fallTextDe) eintraege.push({ name: "Falltext_DE.txt", daten: new TextEncoder().encode(`${x.fallBetreff ?? ""}\n\n${x.fallTextDe}\n`) });
  if (x.fallTextEn) eintraege.push({ name: "Falltext_EN.txt", daten: new TextEncoder().encode(`${x.fallBetreff ?? ""}\n\n${x.fallTextEn}\n`) });
  const name = `Fall_${(x.bestellnummer ?? x.lpn ?? x.id).replace(/[^A-Za-z0-9-]/g, "")}.zip`;
  return new Response(new Blob([new Uint8Array(zipErstellen(eintraege))]), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
