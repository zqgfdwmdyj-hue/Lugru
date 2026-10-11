// Reiseplaner – eigenständiger kleiner Server ohne Abhängigkeiten (Node 20+).
// Liefert die Oberfläche aus public/, speichert Reisen als JSON-Dateien und reicht
// Ortssuche (OpenStreetMap/Nominatim), Fahrwege (OSRM) und – mit Partner-Schlüssel –
// GetYourGuide-Abfragen durch.
//
// Umgebungsvariablen:
//   PORT              Standard 3030
//   DATA_DIR          Ablage der Reisen, Standard ./daten
//   REISE_PASSWORT    Passwort für den Zugang (Benutzername egal). Ohne: offen – nur lokal nutzen!
//   GYG_API_KEY       GetYourGuide-Partner-API-Schlüssel (optional, sonst nur Such-Links)
//   GYG_PARTNER_ID    GetYourGuide-Partner-ID für Such-Links (optional)
//   GYG_API_URL       Standard https://api.getyourguide.com (Test: https://api.gygtest.net)

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HIER, "public");
const PORT = Number(process.env.PORT ?? 3030);
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(HIER, "daten"));
const REISEN_DIR = path.join(DATA_DIR, "reisen");
const PASSWORT = process.env.REISE_PASSWORT ?? "";
const GYG_KEY = process.env.GYG_API_KEY ?? "";
const GYG_URL = (process.env.GYG_API_URL ?? "https://api.getyourguide.com").replace(/\/$/, "");
const USER_AGENT = "Lugru-Reiseplaner/1.0 (privater Reiseplaner)";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

await mkdir(REISEN_DIR, { recursive: true });

// ---------- Hilfen ----------

function json(res, status, daten) {
  const body = JSON.stringify(daten);
  res.writeHead(status, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(body);
}

async function koerper(req, max = 5_000_000) {
  const teile = [];
  let laenge = 0;
  for await (const teil of req) {
    laenge += teil.length;
    if (laenge > max) throw Object.assign(new Error("Anfrage zu groß."), { status: 413 });
    teile.push(teil);
  }
  try {
    return JSON.parse(Buffer.concat(teile).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Ungültiges JSON."), { status: 400 });
  }
}

function gleich(a, b) {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

function angemeldet(req) {
  if (!PASSWORT) return true;
  const kopf = req.headers.authorization ?? "";
  if (!kopf.startsWith("Basic ")) return false;
  const [, pw = ""] = Buffer.from(kopf.slice(6), "base64").toString("utf8").split(/:(.*)/s);
  return gleich(pw, PASSWORT);
}

const ID_RE = /^[a-z0-9-]{8,64}$/;
const reiseDatei = (id) => path.join(REISEN_DIR, `${id}.json`);

async function reiseLesen(id) {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await readFile(reiseDatei(id), "utf8"));
  } catch {
    return null;
  }
}

async function reiseSchreiben(reise) {
  const ziel = reiseDatei(reise.id);
  const tmp = `${ziel}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(reise, null, 1));
  await rename(tmp, ziel);
}

// Kleiner Zwischenspeicher für externe Abfragen (Orte und Wege ändern sich kaum).
const CACHE_DATEI = path.join(DATA_DIR, "cache.json");
let cache = {};
try {
  cache = JSON.parse(await readFile(CACHE_DATEI, "utf8"));
} catch {}
let cacheTimer = null;
function merken(schluessel, wert) {
  cache[schluessel] = { wert, zeit: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 3000) for (const k of keys.slice(0, 500)) delete cache[k];
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => writeFile(CACHE_DATEI, JSON.stringify(cache)).catch(() => {}), 2000);
}
function gemerkt(schluessel, maxAlterMs) {
  const e = cache[schluessel];
  return e && Date.now() - e.zeit < maxAlterMs ? e.wert : undefined;
}

// Nominatim erlaubt höchstens eine Anfrage pro Sekunde.
let letzteNominatim = 0;
async function nominatimWarten() {
  const warte = letzteNominatim + 1100 - Date.now();
  letzteNominatim = Math.max(Date.now(), letzteNominatim + 1100);
  if (warte > 0) await new Promise((r) => setTimeout(r, warte));
}

async function holen(url, optionen = {}) {
  const res = await fetch(url, {
    ...optionen,
    headers: { "user-agent": USER_AGENT, "accept-language": "de", ...(optionen.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw Object.assign(new Error(`Dienst antwortet mit ${res.status}`), { status: 502 });
  return res.json();
}

const zahlOk = (x) => x !== "" && x != null && Number.isFinite(Number(x));

// ---------- API ----------

async function api(req, res, url) {
  const teile = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (teile[1] === "info") {
    return json(res, 200, { gyg: Boolean(GYG_KEY), gygPartnerId: process.env.GYG_PARTNER_ID ?? "", passwort: Boolean(PASSWORT) });
  }

  // Reisen
  if (teile[1] === "reisen" && teile.length === 2) {
    if (req.method === "GET") {
      const dateien = (await readdir(REISEN_DIR)).filter((d) => d.endsWith(".json"));
      const liste = [];
      for (const d of dateien) {
        const r = await reiseLesen(d.slice(0, -5));
        if (r) liste.push({ id: r.id, name: r.name, schiff: r.schiff, beginn: r.haefen?.[0]?.datum ?? "", geaendert: r.geaendert });
      }
      liste.sort((a, b) => String(b.beginn).localeCompare(String(a.beginn)));
      return json(res, 200, liste);
    }
    if (req.method === "POST") {
      const daten = await koerper(req);
      const reise = {
        ...daten,
        id: randomUUID(),
        name: String(daten.name ?? "Neue Reise").slice(0, 200),
        version: 1,
        geaendert: new Date().toISOString(),
      };
      await reiseSchreiben(reise);
      return json(res, 201, reise);
    }
  }

  if (teile[1] === "reisen" && teile.length === 3) {
    const id = teile[2];
    const alt = await reiseLesen(id);
    if (!alt) return json(res, 404, { error: "Reise nicht gefunden." });
    if (req.method === "GET") return json(res, 200, alt);
    if (req.method === "PUT") {
      const neu = await koerper(req);
      if (Number(neu.version) !== Number(alt.version)) {
        return json(res, 409, { error: "Die Reise wurde inzwischen auf einem anderen Gerät geändert.", aktuell: alt });
      }
      const reise = { ...neu, id, version: Number(alt.version) + 1, geaendert: new Date().toISOString() };
      await reiseSchreiben(reise);
      return json(res, 200, { version: reise.version, geaendert: reise.geaendert });
    }
    if (req.method === "DELETE") {
      await unlink(reiseDatei(id));
      return json(res, 200, { ok: true });
    }
  }

  // Ortssuche: /api/geo?q=Palma de Mallorca Hafen
  if (teile[1] === "geo" && req.method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    if (q.length < 2) return json(res, 400, { error: "Suchbegriff fehlt." });
    const schluessel = `geo:${q.toLowerCase()}`;
    let treffer = gemerkt(schluessel, 90 * 86400_000);
    if (treffer === undefined) {
      await nominatimWarten();
      const roh = await holen(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`);
      treffer = roh.map((t) => ({ name: t.display_name, lat: Number(t.lat), lng: Number(t.lon), art: t.type }));
      merken(schluessel, treffer);
    }
    return json(res, 200, treffer);
  }

  // Fahrweg: /api/route?von=lat,lng&nach=lat,lng&modus=auto|fuss
  if (teile[1] === "route" && req.method === "GET") {
    const von = (url.searchParams.get("von") ?? "").split(",");
    const nach = (url.searchParams.get("nach") ?? "").split(",");
    const modus = url.searchParams.get("modus") === "fuss" ? "foot" : "car";
    if (![...von, ...nach].every(zahlOk) || von.length !== 2 || nach.length !== 2) {
      return json(res, 400, { error: "Koordinaten fehlen." });
    }
    const runden = (x) => Number(x).toFixed(5);
    const koord = `${runden(von[1])},${runden(von[0])};${runden(nach[1])},${runden(nach[0])}`;
    const schluessel = `route:${modus}:${koord}`;
    let weg = gemerkt(schluessel, 30 * 86400_000);
    if (weg === undefined) {
      const roh = await holen(`https://routing.openstreetmap.de/routed-${modus}/route/v1/driving/${koord}?overview=simplified&geometries=geojson`);
      const r = roh.routes?.[0];
      weg = r ? { km: r.distance / 1000, min: r.duration / 60, linie: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]) } : null;
      merken(schluessel, weg);
    }
    if (!weg) return json(res, 404, { error: "Kein Weg gefunden (z. B. über Wasser)." });
    return json(res, 200, weg);
  }

  // GetYourGuide-Ausflüge rund um einen Hafen (nur mit Partner-Schlüssel)
  if (teile[1] === "gyg" && req.method === "GET") {
    if (!GYG_KEY) return json(res, 501, { error: "Kein GetYourGuide-Partner-Schlüssel hinterlegt (GYG_API_KEY)." });
    const lat = url.searchParams.get("lat");
    const lng = url.searchParams.get("lng");
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 150);
    const datum = url.searchParams.get("datum") ?? "";
    const radius = Math.min(Math.max(Number(url.searchParams.get("radius") ?? 30), 1), 100);
    const p = new URLSearchParams({ cnt_language: "de", currency: "EUR", limit: "30", sortfield: "popularity", sortdirection: "DESC" });
    if (zahlOk(lat) && zahlOk(lng)) {
      p.append("coordinates[]", lat);
      p.append("coordinates[]", lng);
      p.append("coordinates[]", String(radius));
    } else if (q) p.set("q", q);
    else return json(res, 400, { error: "Hafen ohne Koordinaten und ohne Suchbegriff." });
    if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      p.append("date[]", `${datum}T00:00:00`);
      p.append("date[]", `${datum}T23:59:59`);
    }
    const schluessel = `gyg:${p}`;
    let touren = gemerkt(schluessel, 6 * 3600_000);
    if (touren === undefined) {
      const roh = await holen(`${GYG_URL}/1/tours?${p}`, { headers: { "x-access-token": GYG_KEY, accept: "application/json" } });
      touren = (roh?.data?.tours ?? []).map((t) => {
        const d = t.durations?.[0];
        const faktor = d?.unit === "day" ? 1440 : d?.unit === "hour" ? 60 : 1;
        return {
          id: t.tour_id,
          titel: t.title,
          kurz: t.abstract ?? "",
          preis: t.price?.values?.amount ?? null,
          preisHinweis: t.price?.description ?? "",
          dauerMin: d ? Math.round(d.duration * faktor) : null,
          sterne: t.overall_rating ?? null,
          bewertungen: t.number_of_ratings ?? null,
          lat: t.coordinates?.lat ?? null,
          lng: t.coordinates?.long ?? null,
          abholung: Boolean(t.has_pick_up),
          link: t.url ?? "",
        };
      });
      merken(schluessel, touren);
    }
    return json(res, 200, touren);
  }

  return json(res, 404, { error: "Unbekannte Adresse." });
}

// ---------- Statische Dateien ----------

async function statisch(req, res, url) {
  let datei = decodeURIComponent(url.pathname);
  if (datei === "/" || !path.extname(datei)) datei = "/index.html";
  const voll = path.join(PUBLIC, path.normalize(datei).replace(/^(\.\.[/\\])+/, ""));
  if (!voll.startsWith(PUBLIC + path.sep) || !existsSync(voll)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Nicht gefunden");
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(voll)] ?? "application/octet-stream",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  createReadStream(voll).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/gesund") return json(res, 200, { ok: true });
    if (!angemeldet(req)) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="Reiseplaner", charset="UTF-8"', "content-type": "text/plain; charset=utf-8" });
      return res.end("Bitte anmelden.");
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return await statisch(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.status ?? 500, { error: e.status ? e.message : "Interner Fehler." });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Reiseplaner läuft auf http://localhost:${PORT} (Daten: ${DATA_DIR})`);
  if (!PASSWORT) console.warn("Achtung: REISE_PASSWORT ist nicht gesetzt – jeder mit Zugriff auf den Port kann die Reisen sehen.");
  if (!GYG_KEY) console.log("GetYourGuide: kein Partner-Schlüssel – es gibt Such-Links statt eingebetteter Ergebnisse.");
});
