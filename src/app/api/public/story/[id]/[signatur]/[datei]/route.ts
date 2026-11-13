import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { dateiOeffnen, dateiStrom } from "@/lib/video/service";
import { storyLinkGueltig } from "@/lib/video/story";

// B37 Öffentlicher, befristeter Link (24 h, signiert) auf eine freigegebene Story-Datei – Instagram holt sie beim Posten
// selbst ab. Nur story.mp4/story.png, nur freigegebene Stories, sonst 404.

export const dynamic = "force-dynamic";

const ART: Record<string, string> = { "story.mp4": "story_mp4", "story.png": "story_png" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; signatur: string; datei: string }> }) {
  const { id, signatur, datei } = await params;
  const art = ART[datei];
  if (!art || !/^[0-9a-f-]{36}$/.test(id) || !storyLinkGueltig(id, datei, signatur)) return new Response("Nicht gefunden", { status: 404 });
  const [a] = await db.select({ tenantId: schema.videoAuftraege.tenantId, art: schema.videoAuftraege.art, status: schema.videoAuftraege.status }).from(schema.videoAuftraege).where(eq(schema.videoAuftraege.id, id));
  if (!a || a.art !== "story" || a.status !== "fertig") return new Response("Nicht gefunden", { status: 404 });
  const d = await dateiOeffnen(a.tenantId, id, art);
  if (!d || "drive" in d) return new Response("Nicht gefunden", { status: 404 });
  return new Response(dateiStrom(d.pfad), { headers: { "content-type": d.typ, "content-length": String(d.groesse), "cache-control": "no-store" } });
}
