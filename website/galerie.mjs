// Unboxing-Galerie: Einsendungen landen zuerst in „pending“ und erscheinen erst nach Freigabe
// über /admin (Passwort aus ADMIN_PASSWORD).
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { join } from "node:path";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PENDING = 200;

export function createGallery(dataDir) {
  const root = join(dataDir, "galerie");
  const dirs = { pending: join(root, "pending"), approved: join(root, "approved") };
  const ready = Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));
  const ID = /^[a-f0-9]{16}$/;

  async function list(kind) {
    await ready;
    const files = (await readdir(dirs[kind])).filter((f) => f.endsWith(".json"));
    const items = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dirs[kind], f), "utf8"))));
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }

  async function count(kind) { await ready; return (await readdir(dirs[kind])).filter((f) => f.endsWith(".json")).length; }

  /** Speichert eine Einsendung (nur JPEG, Metadaten werden entfernt). */
  async function submit(buf, { name, caption }) {
    if (buf.length > MAX_BYTES) throw httpError(413, "Das Foto ist zu groß (max. 4 MB).");
    const clean = stripJpegMetadata(buf);
    if (!clean) throw httpError(400, "Bitte ein Foto im JPG-Format senden.");
    if ((await count("pending")) >= MAX_PENDING) throw httpError(503, "Gerade sind sehr viele Fotos in Prüfung. Bitte später noch einmal versuchen.");
    const id = randomBytes(8).toString("hex");
    const meta = { id, name: tidy(name, 30), caption: tidy(caption, 120), at: new Date().toISOString() };
    await writeFile(join(dirs.pending, id + ".jpg"), clean);
    await writeFile(join(dirs.pending, id + ".json"), JSON.stringify(meta));
    return meta;
  }

  async function image(kind, id) {
    if (!ID.test(id)) return null;
    return readFile(join(dirs[kind], id + ".jpg")).catch(() => null);
  }

  async function approve(id) {
    if (!ID.test(id)) return;
    for (const ext of [".jpg", ".json"]) await rename(join(dirs.pending, id + ext), join(dirs.approved, id + ext));
  }

  async function remove(id) {
    if (!ID.test(id)) return;
    for (const kind of ["pending", "approved"]) for (const ext of [".jpg", ".json"]) await rm(join(dirs[kind], id + ext), { force: true });
  }

  return { list, submit, image, approve, remove };
}

function tidy(s, max) {
  return String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

/**
 * Prüft, ob es ein JPEG ist, und entfernt APP1–APP15 (EXIF/GPS, XMP …) und Kommentare.
 * Gibt null zurück, wenn die Datei kein gültiges JPEG ist.
 */
export function stripJpegMetadata(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd9) { out.push(buf.subarray(i, i + 2)); return Buffer.concat(out); }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (marker === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out); } // Bilddaten: Rest übernehmen
    if (!drop) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

/* ---------- Verwaltung ---------- */

export function checkAdmin(req, password) {
  if (!password) return false;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || "");
  if (!m) return false;
  const [, pass = ""] = Buffer.from(m[1], "base64").toString().split(":");
  const a = createHash("sha256").update(pass).digest(), b = createHash("sha256").update(password).digest();
  return timingSafeEqual(a, b);
}

/** Schutz gegen fremde Seiten, die Formulare an /admin schicken (Browser senden das Passwort automatisch mit). */
export function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer || "";
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function adminPage(pending, approved) {
  const row = (it, kind) => `<li>
    <img src="${kind === "pending" ? "/admin/bild/" : "/uploads/"}${it.id}.jpg" alt="">
    <div><strong>${esc(it.caption || "(ohne Text)")}</strong><br><small>${esc(it.name || "anonym")} · ${new Date(it.at).toLocaleString("de-DE")}</small></div>
    <form method="post" action="/admin">
      <input type="hidden" name="id" value="${it.id}">
      ${kind === "pending" ? '<button name="action" value="approve">✅ Freigeben</button>' : ""}
      <button name="action" value="delete" class="del">🗑 Löschen</button>
    </form></li>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GRULU-Galerie verwalten</title><meta name="robots" content="noindex">
  <style>
    body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:16px;background:#f8f4ff;color:#241a3a}
    h1{color:#2a1460}ul{list-style:none;padding:0;display:grid;gap:12px}
    li{display:grid;grid-template-columns:120px 1fr auto;gap:12px;align-items:center;background:#fff;padding:10px;border-radius:14px}
    img{width:120px;height:120px;object-fit:cover;border-radius:10px}
    button{font:inherit;padding:8px 12px;border-radius:10px;border:0;background:#2ecc71;color:#fff;cursor:pointer;margin:2px}
    .del{background:#ff2a6d}@media(max-width:560px){li{grid-template-columns:90px 1fr}img{width:90px;height:90px}form{grid-column:1/-1}}
  </style></head><body>
  <h1>📸 GRULU-Galerie</h1>
  <p>Bitte vor dem Freigeben prüfen: keine erkennbaren Kindergesichter, keine Namen, Adressen oder Fremdmarken im Mittelpunkt.</p>
  <h2>Zu prüfen (${pending.length})</h2><ul>${pending.map((i) => row(i, "pending")).join("") || "<li>Keine neuen Fotos.</li>"}</ul>
  <h2>Online (${approved.length})</h2><ul>${approved.map((i) => row(i, "approved")).join("") || "<li>Noch keine.</li>"}</ul>
  </body></html>`;
}
