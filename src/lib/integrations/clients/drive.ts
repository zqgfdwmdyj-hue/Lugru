import "server-only";
import { createSign } from "node:crypto";
import { registerTester } from "../test";

// Google Drive mit Dienstkonto (Service Account): liest PDFs aus einem freigegebenen Ordner.

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

function parseKey(json: string): ServiceAccount {
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(json) as ServiceAccount;
  } catch {
    throw new Error("Der Dienstkonto-Schlüssel ist kein gültiges JSON.");
  }
  if (!sa.client_email || !sa.private_key) throw new Error("Im Schlüssel fehlen client_email oder private_key.");
  return sa;
}

export async function driveToken(serviceAccountJson: string): Promise<string> {
  const sa = parseKey(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const j = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!j.access_token) throw new Error(`Google-Anmeldung fehlgeschlagen: ${j.error_description ?? j.error ?? res.status}`);
  return j.access_token;
}

export type DriveFile = { id: string; name: string; createdTime: string; mimeType: string; size?: string };

export async function listPdfs(token: string, folderId: string, modifiedAfter?: Date): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  const q = [`'${folderId.replace(/'/g, "")}' in parents`, "trashed = false", "mimeType = 'application/pdf'"];
  if (modifiedAfter) q.push(`modifiedTime > '${modifiedAfter.toISOString()}'`);
  do {
    const u = new URL("https://www.googleapis.com/drive/v3/files");
    u.searchParams.set("q", q.join(" and "));
    u.searchParams.set("fields", "nextPageToken, files(id, name, createdTime, mimeType, size)");
    u.searchParams.set("pageSize", "1000");
    u.searchParams.set("orderBy", "createdTime desc");
    u.searchParams.set("supportsAllDrives", "true");
    u.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive-Ordner nicht lesbar (${res.status}) – ist er für das Dienstkonto freigegeben?`);
    const j = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
    out.push(...j.files);
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

export async function downloadFile(token: string, fileId: string): Promise<Buffer> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Datei nicht ladbar (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

registerTester("google_drive", async (v) => {
  if (!v.folderId) throw new Error("Ordner-ID fehlt.");
  const token = await driveToken(v.serviceAccountJson);
  const files = await listPdfs(token, v.folderId);
  return `Verbunden – ${files.length} PDFs im Ordner gefunden.`;
});
