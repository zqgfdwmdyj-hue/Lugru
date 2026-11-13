import "server-only";

// B37.6 Instagram-API mit Instagram-Login (Business-Konto, keine Facebook-Seite nötig): Anmeldung (OAuth),
// Langzeit-Token (~60 Tage) und dessen Erneuerung, Story posten (Container mit media_type=STORIES → media_publish).
// Die Mediendatei muss unter einer öffentlichen Adresse liegen (befristeter, signierter Link des Seller-Systems).
// Schlüssel (App-ID/App-Secret) nur aus Anbindungen; Zugangs-Token je Kanal verschlüsselt in der Datenbank.

const graph = () => (process.env.INSTAGRAM_GRAPH_BASE_URL || "https://graph.instagram.com").replace(/\/$/, "");
const api = () => (process.env.INSTAGRAM_API_BASE_URL || "https://api.instagram.com").replace(/\/$/, "");
const auth = () => (process.env.INSTAGRAM_AUTH_URL || "https://www.instagram.com/oauth/authorize").replace(/\/$/, "");
const version = () => (process.env.INSTAGRAM_API_VERSION ? `/${process.env.INSTAGRAM_API_VERSION.replace(/^\/|\/$/g, "")}` : "");

export const IG_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export type IgApp = { appId: string; appSecret: string };

export class IgFehler extends Error {
  constructor(message: string, readonly abgelaufen = false, readonly status = 0) {
    super(message);
  }
}

async function antwort<T>(res: Response, was: string): Promise<T> {
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try {
    j = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* kein JSON */
  }
  if (!res.ok || j.error) {
    const e = (j.error ?? {}) as { message?: string; code?: number; type?: string; error_subcode?: number };
    const abgelaufen = e.code === 190 || /expired|session has been invalidated|invalid oauth/i.test(e.message ?? "");
    // Meldung ohne Token-Teile (Instagram nennt keine Schlüssel, trotzdem kürzen)
    throw new IgFehler(abgelaufen ? "Instagram-Zugang abgelaufen oder widerrufen – Kanal neu verbinden." : `${was}: ${(e.message ?? `HTTP ${res.status}`).slice(0, 200)}`, abgelaufen, res.status);
  }
  return j as T;
}

export function igAnmeldeUrl(app: IgApp, redirectUri: string, state: string): string {
  const u = new URL(auth());
  u.searchParams.set("client_id", app.appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

/** Code → kurzlebiges Token → Langzeit-Token (60 Tage) + Konto (Benutzername, Business-Konto-ID). */
export async function igCodeTauschen(app: IgApp, code: string, redirectUri: string): Promise<{ token: string; bis: Date; userId: string; konto: string | null }> {
  const kurz = await antwort<{ access_token: string; user_id: string | number }>(
    await fetch(`${api()}/oauth/access_token`, { method: "POST", body: new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code }), signal: AbortSignal.timeout(20_000) }),
    "Anmeldung",
  );
  const lang = await antwort<{ access_token: string; expires_in?: number }>(
    await fetch(`${graph()}/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: app.appSecret, access_token: kurz.access_token })}`, { signal: AbortSignal.timeout(20_000) }),
    "Langzeit-Token",
  );
  const ich = await antwort<{ user_id?: string; id?: string; username?: string }>(await fetch(`${graph()}${version()}/me?${new URLSearchParams({ fields: "user_id,username", access_token: lang.access_token })}`, { signal: AbortSignal.timeout(20_000) }), "Konto lesen");
  return { token: lang.access_token, bis: new Date(Date.now() + (lang.expires_in ?? 60 * 86_400) * 1000), userId: String(ich.user_id ?? ich.id ?? kurz.user_id), konto: ich.username ?? null };
}

/** Langzeit-Token verlängern (geht ab 24 h Alter und solange es noch gilt) – wieder 60 Tage. */
export async function igTokenErneuern(token: string): Promise<{ token: string; bis: Date }> {
  const r = await antwort<{ access_token: string; expires_in?: number }>(await fetch(`${graph()}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`, { signal: AbortSignal.timeout(20_000) }), "Zugang erneuern");
  return { token: r.access_token, bis: new Date(Date.now() + (r.expires_in ?? 60 * 86_400) * 1000) };
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Story veröffentlichen: Container (media_type=STORIES, image_url bzw. video_url) anlegen, bei Video warten bis
 * „FINISHED“, dann media_publish. Liefert die Medien-ID. Fehler als IgFehler (abgelaufen = neu verbinden).
 */
export async function igStoryPosten(token: string, userId: string, mediaUrl: string, video: boolean, o: { wartenMs?: number; maxWarten?: number } = {}): Promise<string> {
  const body = new URLSearchParams({ media_type: "STORIES", [video ? "video_url" : "image_url"]: mediaUrl, access_token: token });
  const c = await antwort<{ id: string }>(await fetch(`${graph()}${version()}/${encodeURIComponent(userId)}/media`, { method: "POST", body, signal: AbortSignal.timeout(60_000) }), "Story anlegen");
  if (video) {
    const ende = Date.now() + (o.maxWarten ?? 180_000);
    for (;;) {
      const st = await antwort<{ status_code?: string; status?: string }>(await fetch(`${graph()}${version()}/${encodeURIComponent(c.id)}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`, { signal: AbortSignal.timeout(20_000) }), "Story-Status");
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new IgFehler(`Instagram konnte das Video nicht verarbeiten (${st.status ?? st.status_code}).`);
      if (Date.now() > ende) throw new IgFehler("Instagram verarbeitet das Video noch – später erneut versuchen.");
      await warte(o.wartenMs ?? 3000);
    }
  }
  const p = await antwort<{ id: string }>(await fetch(`${graph()}${version()}/${encodeURIComponent(userId)}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: c.id, access_token: token }), signal: AbortSignal.timeout(60_000) }), "Story veröffentlichen");
  return p.id;
}
