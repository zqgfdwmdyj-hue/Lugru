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

export async function driveToken(serviceAccountJson: string, scope = "https://www.googleapis.com/auth/drive.readonly"): Promise<string> {
  const sa = parseKey(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: sa.client_email, scope, aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
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

export type DriveFile = { id: string; name: string; createdTime: string; mimeType: string; size?: string; /** Unterordner relativ zum Rechnungsordner („“ = direkt darin) */ pfad?: string };

/** Drive-API (Testbetrieb: DRIVE_API_BASE_URL auf den Nachbau). */
const API = () => (process.env.DRIVE_API_BASE_URL || "https://www.googleapis.com/drive/v3").replace(/\/$/, "");
/** B34.2: Umbenennen/Verschieben fremder Dateien braucht den vollen Drive-Scope (drive.file sieht nur eigene). */
export const DRIVE_SCHREIBEN = "https://www.googleapis.com/auth/drive";

export async function listPdfs(token: string, folderId: string, modifiedAfter?: Date): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  const q = [`'${folderId.replace(/'/g, "")}' in parents`, "trashed = false", "mimeType = 'application/pdf'"];
  if (modifiedAfter) q.push(`modifiedTime > '${modifiedAfter.toISOString()}'`);
  do {
    const u = new URL(`${API()}/files`);
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
    out.push(...j.files.map((f) => ({ ...f, pfad: "" })));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}

export async function downloadFile(token: string, fileId: string): Promise<Buffer> {
  const res = await fetch(`${API()}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
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
      const u = new URL(`${API()}/files`);
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
        out.push({ id: e.id, name: e.name, createdTime: e.modified ?? "", mimeType: "application/pdf", pfad: path });
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

export type DriveAccess = {
  list: () => Promise<DriveFile[]>;
  download: (id: string) => Promise<Buffer>;
  mode: "link" | "service";
  /** Nur mit Dienstkonto: Token mit Schreib-Scope + Rechnungsordner (B34.2 Ablage nach Freigabe). */
  schreiben?: () => Promise<{ token: string; wurzel: string }>;
};

export async function driveAccess(cfg: Record<string, string> | null): Promise<DriveAccess | null> {
  if (!cfg) return null;
  if (cfg.serviceAccountJson && cfg.folderId) {
    const token = await driveToken(cfg.serviceAccountJson);
    const folderId = folderIdFromLink(cfg.folderId) ?? cfg.folderId;
    const sa = cfg.serviceAccountJson;
    return { mode: "service", list: () => listPdfs(token, folderId), download: (id) => downloadFile(token, id), schreiben: async () => ({ token: await driveToken(sa, DRIVE_SCHREIBEN), wurzel: folderId }) };
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

/**
 * Rechnungsstation: Beleg-PDF in den Drive-Belegordner legen (Dienstkonto mit Schreibrecht auf den Ordner, Scope
 * drive.file – das Konto sieht nur selbst angelegte Dateien). Gibt die Datei-ID zurück.
 */
export async function driveHochladen(serviceAccountJson: string, ordnerId: string, name: string, daten: Buffer, mimeType = "application/pdf"): Promise<string> {
  const token = await driveToken(serviceAccountJson, "https://www.googleapis.com/auth/drive.file");
  const grenze = `grenze${Date.now().toString(36)}`;
  const meta = JSON.stringify({ name, parents: [ordnerId], appProperties: { quelle: "seller-system-rechnungsstation" } });
  const body = Buffer.concat([
    Buffer.from(`--${grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${grenze}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    daten,
    Buffer.from(`\r\n--${grenze}--`),
  ]);
  const res = await fetch(`${process.env.DRIVE_UPLOAD_BASE_URL || "https://www.googleapis.com/upload/drive/v3"}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${grenze}` },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !j.id) throw new Error(`Drive-Ablage fehlgeschlagen (${res.status}${j.error?.message ? `: ${j.error.message}` : ""}) – hat das Dienstkonto Schreibrecht auf den Ordner?`);
  return j.id;
}

// ---- B34.2 Ablage im Drive-Ordner (nur nach Freigabe, nie löschen – Dubletten höchstens in den Papierkorb) ----------

async function driveAufruf<T>(token: string, pfad: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API()}${pfad}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    const m = j.error?.message ?? "";
    throw new Error(res.status === 403 || res.status === 404 ? `Drive verweigert (${res.status}${m ? `: ${m}` : ""}) – hat das Dienstkonto Bearbeiter-Recht auf den Ordner?` : `Drive-Fehler ${res.status}${m ? `: ${m}` : ""}`);
  }
  return j;
}

const ORDNER = "application/vnd.google-apps.folder";
const zitat = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Unterordner „2026-11/Testlieferant-GmbH“ unter dem Rechnungsordner finden bzw. anlegen; gibt die Ordner-ID zurück. */
export async function ordnerSichern(token: string, wurzel: string, pfad: string, cache = new Map<string, string>()): Promise<string> {
  let eltern = wurzel;
  let bisher = "";
  for (const teil of pfad.split("/").map((x) => x.trim()).filter(Boolean)) {
    bisher = bisher ? `${bisher}/${teil}` : teil;
    const gemerkt = cache.get(bisher);
    if (gemerkt) {
      eltern = gemerkt;
      continue;
    }
    const such = new URLSearchParams({ q: `name = '${zitat(teil)}' and '${zitat(eltern)}' in parents and mimeType = '${ORDNER}' and trashed = false`, fields: "files(id, name)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    const vorhanden = (await driveAufruf<{ files: { id: string }[] }>(token, `/files?${such}`)).files?.[0]?.id;
    eltern = vorhanden ?? (await driveAufruf<{ id: string }>(token, "/files?supportsAllDrives=true&fields=id", { method: "POST", body: JSON.stringify({ name: teil, mimeType: ORDNER, parents: [eltern] }) })).id;
    cache.set(bisher, eltern);
  }
  return eltern;
}

/** Datei in den Zielordner verschieben und (optional) umbenennen – alle bisherigen Elternordner werden ersetzt. */
export async function dateiVerschieben(token: string, dateiId: string, zielOrdnerId: string, neuerName?: string | null): Promise<{ name: string; parents: string[] }> {
  const id = encodeURIComponent(dateiId);
  const alt = await driveAufruf<{ parents?: string[] }>(token, `/files/${id}?fields=parents&supportsAllDrives=true`);
  const p = new URLSearchParams({ addParents: zielOrdnerId, fields: "id, name, parents", supportsAllDrives: "true" });
  const weg = (alt.parents ?? []).filter((x) => x !== zielOrdnerId);
  if (weg.length) p.set("removeParents", weg.join(","));
  return driveAufruf(token, `/files/${id}?${p}`, { method: "PATCH", body: JSON.stringify(neuerName ? { name: neuerName } : {}) });
}

/** In den Papierkorb (30 Tage wiederherstellbar) – nur für freigegebene Dubletten. */
export async function inPapierkorb(token: string, dateiId: string): Promise<void> {
  await driveAufruf(token, `/files/${encodeURIComponent(dateiId)}?supportsAllDrives=true&fields=id,trashed`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
}
