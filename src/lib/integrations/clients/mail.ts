import "server-only";

// Gmail API und Microsoft Graph: OAuth, Nachrichtenabruf und Versand.

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "openid", "email"];
export const MS_SCOPES = ["offline_access", "Mail.Read", "Mail.Send", "User.Read"];
/** Ältere Verbindungen wurden nur lesend angelegt. */
export const MS_SCOPES_READONLY = ["offline_access", "Mail.Read", "User.Read"];

export function googleAuthUrl(clientId: string, redirectUri: string, state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

export function microsoftAuthUrl(clientId: string, redirectUri: string, state: string) {
  const u = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MS_SCOPES.join(" "));
  u.searchParams.set("prompt", "select_account");
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope?: string; error?: string; error_description?: string };

async function tokenRequest(url: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) throw new Error(`Anmeldung fehlgeschlagen: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

export const googleToken = (params: Record<string, string>) => tokenRequest("https://oauth2.googleapis.com/token", params);
export const microsoftToken = (params: Record<string, string>) => tokenRequest("https://login.microsoftonline.com/common/oauth2/v2.0/token", params);

// --- Gmail ---------------------------------------------------------------------------

export async function gmailProfile(accessToken: string): Promise<string> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail-Profil nicht lesbar (${res.status})`);
  return ((await res.json()) as { emailAddress: string }).emailAddress;
}

/** Liefert die Rohdaten (RFC 822) neuer Nachrichten. */
export async function gmailFetchRaw(accessToken: string, sinceUnix: number, max = 150): Promise<{ id: string; raw: Buffer }[]> {
  const q = `after:${sinceUnix} -in:chats`;
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    u.searchParams.set("q", q);
    u.searchParams.set("maxResults", "100");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Gmail-Liste fehlgeschlagen (${res.status})`);
    const j = (await res.json()) as { messages?: { id: string }[]; nextPageToken?: string };
    ids.push(...(j.messages ?? []).map((m) => m.id));
    pageToken = j.nextPageToken;
  } while (pageToken && ids.length < max);
  const out: { id: string; raw: Buffer }[] = [];
  for (const id of ids.slice(0, max)) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=raw`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) continue;
    const j = (await res.json()) as { raw: string };
    out.push({ id, raw: Buffer.from(j.raw, "base64url") });
  }
  return out;
}

/** Sendet eine fertige Nachricht (RFC 822) über Gmail – landet automatisch unter „Gesendet“. */
export async function gmailSend(accessToken: string, raw: Buffer): Promise<void> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: raw.toString("base64url") }),
  });
  if (res.status === 403) throw new Error("Gmail erlaubt diesem Postfach das Senden noch nicht – bitte unter Posteingang neu mit Google anmelden (Senden-Berechtigung).");
  if (!res.ok) throw new Error(`Gmail-Versand fehlgeschlagen (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

// --- Microsoft Graph ------------------------------------------------------------------

export async function graphMe(accessToken: string): Promise<string> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Microsoft-Profil nicht lesbar (${res.status})`);
  const j = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return j.mail ?? j.userPrincipalName ?? "unbekannt";
}

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  receivedDateTime: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  body?: { contentType: string; content: string };
  bodyPreview?: string;
};

export async function graphFetch(accessToken: string, since: Date, max = 150): Promise<GraphMessage[]> {
  const out: GraphMessage[] = [];
  let url: string | null =
    `https://graph.microsoft.com/v1.0/me/messages?$filter=receivedDateTime ge ${since.toISOString()}&$orderby=receivedDateTime desc&$top=50&$select=id,internetMessageId,subject,receivedDateTime,from,body,bodyPreview`;
  while (url && out.length < max) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.body-content-type="text"' } });
    if (!res.ok) throw new Error(`Outlook-Abruf fehlgeschlagen (${res.status})`);
    const j = (await res.json()) as { value: GraphMessage[]; "@odata.nextLink"?: string };
    out.push(...j.value);
    url = j["@odata.nextLink"] ?? null;
  }
  return out.slice(0, max);
}

/** Sendet eine fertige Nachricht (MIME) über Microsoft Graph – wird unter „Gesendete Elemente“ gespeichert. */
export async function graphSend(accessToken: string, raw: Buffer): Promise<void> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "text/plain" },
    body: raw.toString("base64"),
  });
  if (res.status === 403) throw new Error("Outlook erlaubt diesem Postfach das Senden noch nicht – bitte unter Posteingang neu mit Microsoft anmelden (Mail.Send).");
  if (!res.ok) throw new Error(`Outlook-Versand fehlgeschlagen (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

// Verbindungstest: Ein Tausch mit ungültigem Code verrät, ob Client-ID/Secret stimmen.
import { registerTester } from "../test";

async function probe(url: string, params: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const j = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
  return j.error ?? "";
}

registerTester("google", async (v) => {
  const err = await probe("https://oauth2.googleapis.com/token", { code: "test", client_id: v.clientId, client_secret: v.clientSecret, redirect_uri: "http://localhost", grant_type: "authorization_code" });
  if (err === "invalid_client" || err === "unauthorized_client") throw new Error("Client-ID oder Secret stimmt nicht.");
  return "Google-App erkannt. Jetzt unter Posteingang → Postfach verbinden → „Mit Google anmelden“.";
});

registerTester("microsoft", async (v) => {
  const err = await probe("https://login.microsoftonline.com/common/oauth2/v2.0/token", { code: "test", client_id: v.clientId, client_secret: v.clientSecret, redirect_uri: "http://localhost", grant_type: "authorization_code", scope: "User.Read" });
  if (/invalid_client|unauthorized_client/.test(err)) throw new Error("Anwendungs-ID oder geheimer Schlüssel stimmt nicht.");
  return "Microsoft-App erkannt. Jetzt unter Posteingang → Postfach verbinden → „Mit Microsoft anmelden“.";
});
