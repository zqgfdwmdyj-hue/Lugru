import "server-only";
import { getIntegration } from "@/lib/integrations/store";
import { PASTE_REDIRECT } from "@/lib/oauth/mail-flow";
import { verifyState } from "@/lib/oauth/state";
import { kanalYoutubeSetzen, VideoFehler, videoDriveSetzen } from "./service";
import { ytCodeTauschen, ytKanalName } from "./youtube";

/** Code gegen Refresh-Token tauschen und verschlüsselt am Kanal speichern. Liefert den YouTube-Kanalnamen. */
export async function youtubeVerbinden(tenantId: string, kanalId: string, code: string, redirectUri: string): Promise<string | null> {
  const app = await getIntegration(tenantId, "google");
  if (!app?.clientId || !app.clientSecret) throw new VideoFehler("Google-App (Client-ID/Secret) fehlt unter Anbindungen → Google.");
  const t = await ytCodeTauschen({ clientId: app.clientId, clientSecret: app.clientSecret }, code, redirectUri);
  if (!t.refresh_token) throw new VideoFehler("Google hat kein Refresh-Token geliefert – bitte unter myaccount.google.com → Sicherheit den Zugriff der App entfernen und erneut verbinden.");
  const name = await ytKanalName(t.access_token).catch(() => null);
  await kanalYoutubeSetzen(tenantId, kanalId, t.refresh_token, name);
  return name;
}

/** Einfüge-Weg (ohne https): die Adresse aus der Browserzeile nach der Google-Anmeldung (http://localhost/?code=…&state=…). */
export async function youtubeEinfuegen(tenantId: string, kanalId: string, adresse: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(adresse.trim());
  } catch {
    throw new VideoFehler("Bitte die ganze Adresse aus der Browserzeile einfügen (beginnt mit http://localhost).");
  }
  const st = verifyState(u.searchParams.get("state"));
  const code = u.searchParams.get("code");
  if (!st || st.t !== tenantId || st.p !== `youtube-paste:${kanalId}` || !code) throw new VideoFehler("Adresse ungültig oder abgelaufen (15 Min.) – bitte erneut „Mit YouTube verbinden“.");
  return youtubeVerbinden(tenantId, kanalId, code, PASTE_REDIRECT);
}

/** Google Drive als Video-Ablage verbinden (Bereich drive.file). */
export async function videoDriveVerbinden(tenantId: string, code: string, redirectUri: string): Promise<void> {
  const app = await getIntegration(tenantId, "google");
  if (!app?.clientId || !app.clientSecret) throw new VideoFehler("Google-App (Client-ID/Secret) fehlt unter Anbindungen → Google.");
  const t = await ytCodeTauschen({ clientId: app.clientId, clientSecret: app.clientSecret }, code, redirectUri);
  if (!t.refresh_token) throw new VideoFehler("Google hat kein Refresh-Token geliefert – bitte unter myaccount.google.com → Sicherheit den Zugriff der App entfernen und erneut verbinden.");
  await videoDriveSetzen(tenantId, t.refresh_token);
}

export async function videoDriveEinfuegen(tenantId: string, adresse: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(adresse.trim());
  } catch {
    throw new VideoFehler("Bitte die ganze Adresse aus der Browserzeile einfügen (beginnt mit http://localhost).");
  }
  const st = verifyState(u.searchParams.get("state"));
  const code = u.searchParams.get("code");
  if (!st || st.t !== tenantId || st.p !== "video-drive-paste" || !code) throw new VideoFehler("Adresse ungültig oder abgelaufen (15 Min.) – bitte erneut „Google Drive verbinden“.");
  await videoDriveVerbinden(tenantId, code, PASTE_REDIRECT);
}
