import "server-only";

// B36 YouTube je Kanal: Anmeldung mit der Google-App aus den Anbindungen (Client-ID/Secret), Refresh-Token bleibt
// verschlüsselt im Seller-System. Der Worker bekommt nur ein kurzlebiges Zugangs-Token zum Hochladen (Scope
// youtube.upload) – Sichtbarkeit immer „privat“; danach prüft das Seller-System die Sichtbarkeit (youtube.readonly).
// Im Testbetrieb gegen den Nachbau (YOUTUBE_*_URL).

/** youtube.force-ssl: nur für die Untertitel (captions.insert, Whiteboard-Stil B36.9.4) – Upload bleibt immer privat. */
export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.force-ssl"];
/** Google Drive als Video-Ablage: nur Dateien, die das Seller-System selbst anlegt (drive.file). */
export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const AUTH = () => process.env.YOUTUBE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = () => process.env.YOUTUBE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const API = () => (process.env.YOUTUBE_API_BASE_URL || "https://www.googleapis.com").replace(/\/$/, "");
/** Basis für den resumable Upload – der Worker hängt /youtube/v3/videos an. */
export const ytUploadBasis = () => (process.env.YOUTUBE_UPLOAD_BASE_URL || "https://www.googleapis.com/upload").replace(/\/$/, "");

export function ytAuthUrl(clientId: string, redirectUri: string, state: string, scopes: string[] = YT_SCOPES): string {
  const u = new URL(AUTH());
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "false");
  u.searchParams.set("state", state);
  return u.toString();
}

async function token(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const res = await fetch(TOKEN(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000) });
  const d = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !d.access_token) throw new Error(`Google-Anmeldung: ${d.error_description ?? d.error ?? `HTTP ${res.status}`}`);
  return d as { access_token: string; refresh_token?: string; expires_in?: number };
}

export const ytCodeTauschen = (app: { clientId: string; clientSecret: string }, code: string, redirectUri: string) => token({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
export const ytZugang = (app: { clientId: string; clientSecret: string }, refreshToken: string) => token({ refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token" });

/** Name des verbundenen Kanals (zur Anzeige). */
export async function ytKanalName(accessToken: string): Promise<string | null> {
  const res = await fetch(`${API()}/youtube/v3/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const d = (await res.json()) as { items?: { snippet?: { title?: string } }[] };
  return d.items?.[0]?.snippet?.title ?? null;
}

/** Sichtbarkeit eines Videos (private/unlisted/public) – null, wenn nicht gefunden. */
export async function ytSichtbarkeit(accessToken: string, videoId: string): Promise<string | null> {
  const res = await fetch(`${API()}/youtube/v3/videos?part=status&id=${encodeURIComponent(videoId)}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`YouTube: Status nicht lesbar (HTTP ${res.status})`);
  const d = (await res.json()) as { items?: { status?: { privacyStatus?: string } }[] };
  return d.items?.[0]?.status?.privacyStatus ?? null;
}
