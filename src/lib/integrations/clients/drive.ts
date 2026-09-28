import "server-only";
import { createSign } from "node:crypto";
import { registerTester } from "../test";
import { folderIdFromLink, parseEmbeddedFolder, type PublicEntry } from "../drive-link";

export { folderIdFromLink, parseEmbeddedFolder };

// Google Drive: liest Rechnungs-PDFs aus einem Ordner – entweder über den Freigabelink
// („Jeder, der über den Link verfügt"), ganz ohne Google-Konto, oder mit Dienstkonto.

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

// ---- Öffentlicher Ordner-Link -------------------------------------------------------------

async function listPublicFolder(folderId: string, apiKey?: string): Promise<PublicEntry[]> {
  if (apiKey) {
    // Mit API-Schlüssel über die Drive-API – ohne Begrenzung der Eintragszahl.
    const out: PublicEntry[] = [];
    let pageToken: string | undefined;
    do {
      const u = new URL("https://www.googleapis.com/drive/v3/files");
      u.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
      u.searchParams.set("fields", "nextPageToken, files(id, name, mimeType, modifiedTime)");
      u.searchParams.set("pageSize", "1000");
      u.searchParams.set("key", apiKey);
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Drive-Ordner nicht lesbar (${res.status}) – ist der Link für „Jeder, der über den Link verfügt" freigegeben und der API-Schlüssel richtig?`);
      const j = (await res.json()) as { files: { id: string; name: string; mimeType: string; modifiedTime?: string }[]; nextPageToken?: string };
      out.push(...j.files.map((f) => ({ id: f.id, name: f.name, folder: f.mimeType === "application/vnd.google-apps.folder", modified: f.modifiedTime ?? null })));
      pageToken = j.nextPageToken;
    } while (pageToken);
    return out;
  }
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Seller-System)", "Accept-Language": "de-DE" },
    signal: AbortSignal.timeout(30_000),
  });
  const html = res.ok ? await res.text() : "";
  if (!html.includes("flip-entries")) {
    throw new Error(`Ordner nicht lesbar${res.ok ? "" : ` (${res.status})`} – ist er für „Jeder, der über den Link verfügt" freigegeben?`);
  }
  return parseEmbeddedFolder(html);
}

/** Alle PDFs im öffentlichen Ordner, Unterordner eingeschlossen (z. B. je Monat einer). */
export async function listPublicPdfs(folderId: string, apiKey?: string, depth = 4): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  const seen = new Set<string>();
  const walk = async (id: string, path: string, level: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const e of await listPublicFolder(id, apiKey)) {
      if (e.folder) {
        if (level < depth) await walk(e.id, `${path}${e.name}/`, level + 1);
      } else if (/\.pdf$/i.test(e.name)) {
        out.push({ id: e.id, name: e.name, createdTime: e.modified ?? "", mimeType: "application/pdf" });
      }
    }
  };
  await walk(folderId, "", 0);
  return out;
}

/** Öffentlich freigegebene Datei laden (ohne Anmeldung). */
export async function downloadPublicFile(fileId: string): Promise<Buffer> {
  const res = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`, {
    headers: { "User-Agent": "Mozilla/5.0 (Seller-System)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Datei nicht ladbar (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Datei ist nicht öffentlich lesbar oder kein PDF.");
  return buf;
}

// ---- Gemeinsamer Zugang für Abruf und PDF-Ansicht ------------------------------------------

export type DriveAccess = { list: () => Promise<DriveFile[]>; download: (id: string) => Promise<Buffer>; mode: "link" | "service" };

export async function driveAccess(cfg: Record<string, string> | null): Promise<DriveAccess | null> {
  if (!cfg) return null;
  if (cfg.serviceAccountJson && cfg.folderId) {
    const token = await driveToken(cfg.serviceAccountJson);
    const folderId = folderIdFromLink(cfg.folderId) ?? cfg.folderId;
    return { mode: "service", list: () => listPdfs(token, folderId), download: (id) => downloadFile(token, id) };
  }
  const link = cfg.folderLink || cfg.folderId;
  const folderId = link ? folderIdFromLink(link) : null;
  if (!folderId) return null;
  return { mode: "link", list: () => listPublicPdfs(folderId, cfg.apiKey || undefined), download: downloadPublicFile };
}

registerTester("google_drive", async (v) => {
  const access = await driveAccess(v);
  if (!access) throw new Error("Ordner-Link fehlt (oder die Ordner-ID beim Dienstkonto).");
  const files = await access.list();
  const note = access.mode === "link" ? ` Tipp: In Drive „Jeder, der über den Link verfügt" auf „Betrachter" stellen – Mitbearbeiter ist nicht nötig.` : "";
  return `Verbunden – ${files.length} PDFs im Ordner${access.mode === "link" ? " (inkl. Unterordner)" : ""} gefunden.${note}`;
});
