import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { appUrl, signState } from "@/lib/oauth/state";
import { instagramAnmeldeUrl } from "@/lib/video/story";

// B37.6: Instagram-Zugang je Kanal (Instagram-Login, Business-Konto) – nur Inhaber. Meta-App aus Anbindungen → Instagram;
// die Rücksprung-Adresse /api/oauth/instagram/callback muss in der Meta-App eingetragen sein (https).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = appUrl(request);
  const s = await getSession();
  if (!s) return Response.redirect(`${base}/login`);
  if (s.readOnly || s.role !== "owner") return Response.redirect(`${base}/marken/video?meldung=${encodeURIComponent("Nur der Inhaber verbindet Instagram.")}`);
  const kanalId = new URL(request.url).searchParams.get("kanal") ?? "";
  const [k] = /^[0-9a-f-]{36}$/.test(kanalId) ? await db.select({ id: schema.videoKanaele.id }).from(schema.videoKanaele).where(and(eq(schema.videoKanaele.tenantId, s.tenantId), eq(schema.videoKanaele.id, kanalId), eq(schema.videoKanaele.plattform, "instagram"))) : [];
  if (!k) return Response.redirect(`${base}/marken/video?meldung=${encodeURIComponent("Instagram-Kanal nicht gefunden.")}`);
  try {
    return Response.redirect(await instagramAnmeldeUrl(s.tenantId, `${base}/api/oauth/instagram/callback`, signState(s.tenantId, s.userId, `instagram:${k.id}`)));
  } catch (e) {
    return Response.redirect(`${base}/marken/video?kanal=${k.id}&meldung=${encodeURIComponent(e instanceof Error ? e.message : String(e))}#kanal`);
  }
}
