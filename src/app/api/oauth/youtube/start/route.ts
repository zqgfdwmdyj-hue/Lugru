import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { canRedirectTo, PASTE_REDIRECT } from "@/lib/oauth/mail-flow";
import { appUrl, signState } from "@/lib/oauth/state";
import { ytAuthUrl } from "@/lib/video/youtube";

// B36: YouTube-Zugang je Kanal (nur Inhaber). Google-App aus Anbindungen → Google. Ohne https-Adresse geht es nach
// http://localhost – die Adresse wird dann auf der Seite Video beim Kanal eingefügt.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = appUrl(request);
  const s = await getSession();
  if (!s) return Response.redirect(`${base}/login`);
  if (s.readOnly || s.role !== "owner") return Response.redirect(`${base}/marken/video?meldung=${encodeURIComponent("Nur der Inhaber verbindet YouTube.")}`);
  const kanalId = new URL(request.url).searchParams.get("kanal") ?? "";
  const [k] = /^[0-9a-f-]{36}$/.test(kanalId) ? await db.select({ id: schema.videoKanaele.id }).from(schema.videoKanaele).where(and(eq(schema.videoKanaele.tenantId, s.tenantId), eq(schema.videoKanaele.id, kanalId))) : [];
  if (!k) return Response.redirect(`${base}/marken/video?meldung=${encodeURIComponent("Kanal nicht gefunden.")}`);
  const app = await getIntegration(s.tenantId, "google");
  if (!app?.clientId) return Response.redirect(`${base}/anbindungen?p=google#google`);
  const paste = new URL(request.url).searchParams.get("modus") === "einfuegen" || !canRedirectTo(base);
  const redirectUri = paste ? PASTE_REDIRECT : `${base}/api/oauth/youtube/callback`;
  return Response.redirect(ytAuthUrl(app.clientId, redirectUri, signState(s.tenantId, s.userId, `${paste ? "youtube-paste" : "youtube"}:${k.id}`)));
}
