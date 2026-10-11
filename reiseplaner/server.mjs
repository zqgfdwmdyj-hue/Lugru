// Reiseplaner – eigenständiger Server (Node 20+).
// Oberfläche aus public/, Reisen/Beiträge/Fotos als Dateien in DATA_DIR, Konten mit Einladungen,
// öffentliche Freigabe-Links, Ortssuche (Nominatim), Fahrwege (OSRM), GetYourGuide, KI (Claude).
//
// Umgebungsvariablen:
//   PORT               Standard 3030
//   DATA_DIR           Ablage, Standard ./daten
//   OEFFENTLICHE_URL   z. B. https://reise.example.de – für Freigabe-Links und sichere Cookies
//   ANTHROPIC_API_KEY  Claude-Schlüssel für KI-Import, Assistent und Beitragstexte (optional)
//   KI_MODELL          Standard claude-opus-5-5
//   GYG_API_KEY / GYG_PARTNER_ID / GYG_API_URL  GetYourGuide-Partner-Zugang (optional)

import { createServer } from "node:http";
import { writeFile, readdir } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, REISEN_DIR, ID_RE, lesen, schreiben, aendern, exklusiv, loeschen, reiseDatei, beitraegeDatei, LEERE_BEITRAEGE, fotoDatei } from "./lib/speicher.mjs";
import * as konten from "./lib/konten.mjs";
import { fehler } from "./lib/konten.mjs";
import * as teilen from "./lib/teilen.mjs";
import * as ki from "./lib/ki.mjs";
import * as tagebuch from "./lib/tagebuch.mjs";
import * as extras from "./lib/extras.mjs";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HIER, "public");
const PORT = Number(process.env.PORT ?? 3030);
const GYG_KEY = process.env.GYG_API_KEY ?? "";
const GYG_URL = (process.env.GYG_API_URL ?? "https://api.getyourguide.com").replace(/\/$/, "");
const USER_AGENT = "Lugru-Reiseplaner/2.0 (privater Reiseplaner)";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
};

// ---------- Hilfen ----------

function json(res, status, daten) {
  res.writeHead(status, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(daten));
}

async function koerper(req, max = 5_000_000) {
  const teile = [];
  let laenge = 0;
  for await (const teil of req) {
    laenge += teil.length;
    if (laenge > max) throw fehler(413, `Anfrage zu groß (max. ${Math.round(max / 1e6)} MB).`);
    teile.push(teil);
  }
  try {
    return JSON.parse(Buffer.concat(teile).toString("utf8") || "{}");
  } catch {
    throw fehler(400, "Ungültiges JSON.");
  }
}

const zahlOk = (x) => x !== "" && x != null && Number.isFinite(Number(x));
const text = (v, max = 2000) => String(v ?? "").slice(0, max);
const zahlOderNull = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function basisUrl(req) {
  if (process.env.OEFFENTLICHE_URL) return process.env.OEFFENTLICHE_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return `${proto}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;
}

// ---------- Reisen & Rechte ----------

async function reiseLesen(id) {
  if (!ID_RE.test(String(id))) return null;
  return lesen(reiseDatei(id), null);
}

const rolleAus = (r) => (["planer", "familienplaner"].includes(r) ? r : "mitreisend");

/** Familie der Person, die mit diesem Konto verknüpft ist (für Familien-Planer/innen). */
const familieVonKonto = (reise, userId) => reise.personen?.find((p) => p.userId === userId)?.familie ?? null;

/** "planer" | "familienplaner" | "mitreisend" | null. Verwaltungs-Konten dürfen alles. */
function rolleIn(reise, benutzer) {
  if (!reise || !benutzer) return null;
  if (benutzer.admin) return "planer";
  return reise.mitglieder?.find((m) => m.userId === benutzer.id)?.rolle ?? null;
}

async function reiseMitRecht(id, benutzer, mindestens = "mitreisend") {
  const reise = await reiseLesen(id);
  const rolle = rolleIn(reise, benutzer);
  if (!reise || !rolle) throw fehler(404, "Reise nicht gefunden.");
  if (mindestens === "planer" && rolle !== "planer") throw fehler(403, "Das dürfen nur Planer/innen dieser Reise.");
  return { reise, rolle };
}

const beitraegeLesen = (id) => lesen(beitraegeDatei(id), LEERE_BEITRAEGE);

async function alleReisen() {
  const liste = [];
  for (const d of (await readdir(REISEN_DIR)).filter((x) => /^[a-z0-9-]+\.json$/.test(x))) {
    const r = await reiseLesen(d.slice(0, -5));
    if (r) liste.push(r);
  }
  return liste;
}
const heuteIso = () => new Date().toISOString().slice(0, 10);
const beitraegeAendern = (id, fn) => aendern(beitraegeDatei(id), LEERE_BEITRAEGE, fn);

function darfBearbeiten(eintrag, benutzer, rolle, feld = "autorId") {
  return rolle === "planer" || eintrag[feld] === benutzer.id || eintrag.autorId === benutzer.id;
}

// Erlaubte Felder für Bewertungen und Tauchgänge (alles andere wird verworfen).
function bewertungAus(d) {
  const sterne = Math.round(Number(d.sterne));
  if (!(sterne >= 1 && sterne <= 5)) throw fehler(400, "Bitte 1 bis 5 Sterne vergeben.");
  if (!["ausflug", "hotel"].includes(d.zielArt)) throw fehler(400, "Unbekanntes Ziel.");
  const fotos = (Array.isArray(d.fotos) ? d.fotos : []).filter((f) => ID_RE.test(f)).slice(0, 40);
  return {
    zielArt: d.zielArt, zielId: text(d.zielId, 80), privat: d.privat === true, sterne, titel: text(d.titel, 200),
    text: text(d.text, 10_000), // öffentlicher Kommentar
    textPrivat: text(d.textPrivat, 10_000), // nur für Mitreisende
    fotos,
    fotosPrivat: (Array.isArray(d.fotosPrivat) ? d.fotosPrivat : []).filter((f) => fotos.includes(f)),
  };
}

const TAUCH_TEXT = ["datum", "tauchplatz", "ort", "basis", "einstieg", "beginn", "stroemung", "anzug", "flascheMaterial", "gas", "buddy", "guide", "sichtungen", "text", "textPrivat", "ausflugId", "taucherId"];
const TAUCH_ZAHL = ["lat", "lng", "tauchzeitMin", "maxTiefe", "mittelTiefe", "wasserTemp", "luftTemp", "sicht", "blei", "flascheL", "nitroxProzent", "druckStart", "druckEnde", "sterne"];
function tauchgangAus(d) {
  const t = {};
  for (const k of TAUCH_TEXT) t[k] = text(d[k], ["text", "textPrivat", "sichtungen"].includes(k) ? 10_000 : 300);
  for (const k of TAUCH_ZAHL) t[k] = zahlOderNull(d[k]);
  if (t.sterne != null) t.sterne = Math.min(5, Math.max(1, Math.round(t.sterne)));
  t.fotos = (Array.isArray(d.fotos) ? d.fotos : []).filter((f) => ID_RE.test(f)).slice(0, 40);
  // Tiefenprofil vom Tauchcomputer: [Minute, Meter]-Paare
  t.profil = (Array.isArray(d.profil) ? d.profil : [])
    .filter((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "number" && Number.isFinite(x)) && p[0] >= 0 && p[0] <= 1000 && p[1] >= 0 && p[1] <= 400)
    .slice(0, 200)
    .map(([min, m]) => [Math.round(min * 10) / 10, Math.round(m * 10) / 10]);
  t.privat = d.privat === true;
  t.fotosPrivat = (Array.isArray(d.fotosPrivat) ? d.fotosPrivat : []).filter((f) => t.fotos.includes(f));
  return t;
}

const JPEG = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const DATEI_TYPEN = {
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/jpeg": JPEG,
  "image/png": (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47,
};

/** Album-Angaben eines Fotos: Aufnahmezeit/-ort (aus EXIF), zugeordneter Tag/Ausflug, „geteilt“. */
function fotoInfoAus(d, reise, mitAufnahme = true) {
  const info = {};
  if (mitAufnahme && d.aufnahme && typeof d.aufnahme === "object") {
    const a = d.aufnahme;
    info.aufnahme = {
      datum: /^\d{4}-\d{2}-\d{2}$/.test(a.datum ?? "") ? a.datum : "",
      zeit: /^\d{2}:\d{2}$/.test(a.zeit ?? "") ? a.zeit : "",
      lat: Number.isFinite(a.lat) && Math.abs(a.lat) <= 90 ? a.lat : null,
      lng: Number.isFinite(a.lng) && Math.abs(a.lng) <= 180 ? a.lng : null,
    };
  }
  if ("hafenId" in d) info.hafenId = (reise.haefen ?? []).some((h) => h.id === d.hafenId) ? d.hafenId : "";
  if ("ausflugId" in d) info.ausflugId = (reise.ausfluege ?? []).some((a) => a.id === d.ausflugId) ? d.ausflugId : "";
  if ("geteilt" in d) info.geteilt = d.geteilt === true;
  if (d.art === "kinder") info.art = "kinder"; // Kinder-Bilder (Tagebuch, Bingo, Schatzsuche) – nicht im Fotoalbum
  return info;
}
function dataUrlZuJpeg(url, max) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(url ?? ""));
  if (!m) throw fehler(400, "Foto muss als JPEG kommen.");
  const b = Buffer.from(m[1], "base64");
  if (!JPEG(b) || b.length > max) throw fehler(400, "Foto ungültig oder zu groß.");
  return b;
}

// ---------- Externe Dienste (Zwischenspeicher) ----------

const CACHE_DATEI = path.join(DATA_DIR, "cache.json");
let cache = await lesen(CACHE_DATEI, {});
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
  if (!res.ok) throw fehler(502, `Dienst antwortet mit ${res.status}`);
  return res.json();
}

// ---------- API ohne Anmeldung ----------

async function apiOffen(req, res, url, benutzer) {
  const p = url.pathname;
  if (p === "/api/ich" && req.method === "GET") {
    return json(res, 200, {
      benutzer: konten.oeffentlich(benutzer),
      einrichtung: await konten.einrichtungNoetig(),
      ki: ki.kiAktiv(),
      gyg: Boolean(GYG_KEY),
      gygPartnerId: process.env.GYG_PARTNER_ID ?? "",
      kacheln: process.env.KARTEN_KACHELN || "",
      kachelnHinweis: process.env.KARTEN_HINWEIS || "",
    });
  }
  if (p === "/api/einrichtung" && req.method === "POST") {
    const d = await koerper(req);
    if (!(await konten.einrichtungNoetig())) throw fehler(409, "Die Einrichtung ist schon erledigt.");
    if (!konten.einrichtungsCodeOk(d.code)) throw fehler(403, "Der Einrichtungscode stimmt nicht (steht im Server-Log).");
    const b = await konten.benutzerAnlegen({ ...d, admin: true });
    await alteReisenUebernehmen(b.id);
    konten.cookieSetzen(res, req, await konten.sitzungStarten(b.id));
    return json(res, 201, { benutzer: konten.oeffentlich(b) });
  }
  if (p === "/api/anmelden" && req.method === "POST") {
    const d = await koerper(req, 10_000);
    const b = await konten.anmelden(d.email, d.passwort);
    konten.cookieSetzen(res, req, await konten.sitzungStarten(b.id));
    return json(res, 200, { benutzer: konten.oeffentlich(b) });
  }
  if (p === "/api/abmelden" && req.method === "POST") {
    await konten.sitzungBeenden(konten.cookieLesen(req));
    konten.cacheLeeren();
    konten.cookieSetzen(res, req, "", 0);
    return json(res, 200, { ok: true });
  }
  const einl = /^\/api\/einladung\/([A-Za-z0-9_-]{20,64})$/.exec(p);
  if (einl) {
    const e = await konten.einladungLesen(einl[1]);
    if (!e) throw fehler(404, "Diese Einladung ist abgelaufen oder ungültig.");
    const reise = await reiseLesen(e.reiseId);
    if (!reise) throw fehler(404, "Die Reise gibt es nicht mehr.");
    if (req.method === "GET") {
      const person = reise.personen?.find((x) => x.id === e.personId);
      const von = (await konten.alleBenutzer()).find((b) => b.id === e.vonId);
      return json(res, 200, { reise: reise.name, person: person?.name ?? "", von: von?.name ?? "", angemeldet: konten.oeffentlich(benutzer) });
    }
    if (req.method === "POST") {
      const d = await koerper(req, 10_000);
      let b = benutzer;
      if (!b) {
        b = await konten.benutzerAnlegen({ name: d.name, email: d.email, passwort: d.passwort });
        konten.cookieSetzen(res, req, await konten.sitzungStarten(b.id));
      }
      await exklusiv(reiseDatei(reise.id), async () => {
        const r = await reiseLesen(reise.id);
        r.mitglieder ??= [];
        if (!r.mitglieder.some((m) => m.userId === b.id)) r.mitglieder.push({ userId: b.id, rolle: rolleAus(e.rolle) });
        const person = r.personen?.find((x) => x.id === e.personId);
        if (person && !person.userId) person.userId = b.id;
        await schreiben(reiseDatei(r.id), r);
      });
      await konten.einladungVerbrauchen(einl[1]);
      return json(res, 200, { reiseId: reise.id, benutzer: konten.oeffentlich(b) });
    }
  }
  return false;
}

/** Reisen aus Version 1 (ohne Mitglieder) gehören dem ersten Konto. */
async function alteReisenUebernehmen(userId) {
  for (const d of (await readdir(REISEN_DIR)).filter((x) => /^[a-z0-9-]+\.json$/.test(x))) {
    await aendern(path.join(REISEN_DIR, d), null, (r) => {
      if (r && !r.mitglieder) r.mitglieder = [{ userId, rolle: "planer" }];
    });
  }
}

// ---------- API mit Anmeldung ----------

async function api(req, res, url, ich) {
  const p = url.pathname;
  const t = p.split("/").filter(Boolean); // ["api", ...]
  const m = req.method;

  if (p === "/api/ich" && m === "PUT") {
    const d = await koerper(req, 10_000);
    if (d.passwort) await konten.anmelden(ich.email, d.altesPasswort).catch(() => {
      throw fehler(403, "Das bisherige Passwort stimmt nicht.");
    });
    const b = await konten.benutzerAendern(ich.id, d);
    if (d.passwort) {
      await konten.alleSitzungenBeenden(ich.id);
      konten.cookieSetzen(res, req, await konten.sitzungStarten(ich.id));
    }
    konten.cacheLeeren();
    return json(res, 200, { benutzer: konten.oeffentlich(b) });
  }

  if (p === "/api/benutzer" && m === "GET") {
    if (!ich.admin) throw fehler(403, "Nur für die Verwaltung.");
    return json(res, 200, (await konten.alleBenutzer()).map(konten.oeffentlich));
  }
  if (t[1] === "benutzer" && t[2] && m === "DELETE") {
    if (!ich.admin) throw fehler(403, "Nur für die Verwaltung.");
    if (t[2] === ich.id) throw fehler(400, "Das eigene Konto kann hier nicht gelöscht werden.");
    await konten.benutzerLoeschen(t[2]);
    konten.cacheLeeren();
    return json(res, 200, { ok: true });
  }

  // Reisen
  if (p === "/api/reisen" && m === "GET") {
    const liste = [];
    for (const d of (await readdir(REISEN_DIR)).filter((x) => /^[a-z0-9-]+\.json$/.test(x))) {
      const r = await reiseLesen(d.slice(0, -5));
      if (r && rolleIn(r, ich)) liste.push({ id: r.id, name: r.name, art: r.art ?? "kreuzfahrt", beginn: [...(r.haefen ?? [])].map((h) => h.datum).filter(Boolean).sort()[0] ?? r.hotels?.[0]?.anreise ?? "", geaendert: r.geaendert });
    }
    liste.sort((a, b) => String(b.beginn).localeCompare(String(a.beginn)));
    return json(res, 200, liste);
  }
  if (p === "/api/reisen" && m === "POST") {
    const d = await koerper(req);
    const reise = { ...d, id: randomUUID(), name: text(d.name || "Neue Reise", 200), mitglieder: [{ userId: ich.id, rolle: "planer" }], version: 1, geaendert: new Date().toISOString() };
    await schreiben(reiseDatei(reise.id), reise);
    return json(res, 201, reise);
  }

  if (t[1] === "reisen" && t[2]) {
    const id = t[2];
    const unter = t[3];

    if (!unter) {
      const { reise, rolle } = await reiseMitRecht(id, ich);
      if (m === "GET") return json(res, 200, { ...reise, meineRolle: rolle });
      if (m === "PUT") {
        const neu = await koerper(req);
        const ergebnis = await exklusiv(reiseDatei(id), async () => {
          const alt = await reiseLesen(id);
          if (Number(neu.version) !== Number(alt.version)) return { konflikt: alt };
          const { meineRolle, mitglieder, ...rest } = neu;
          rest.oeffentlich = alt.oeffentlich ?? false; // nur über /oeffentlich änderbar (Planer/innen)
          const r = { ...rest, id, mitglieder: alt.mitglieder, version: Number(alt.version) + 1, geaendert: new Date().toISOString(), geaendertVon: ich.id };
          await schreiben(reiseDatei(id), r);
          return { version: r.version, geaendert: r.geaendert };
        });
        if (ergebnis.konflikt) return json(res, 409, { error: "Die Reise wurde inzwischen von jemand anderem geändert.", aktuell: { ...ergebnis.konflikt, meineRolle: rolle } });
        return json(res, 200, ergebnis);
      }
      if (m === "DELETE") {
        if (rolle !== "planer") throw fehler(403, "Nur Planer/innen können die Reise löschen.");
        const b = await beitraegeLesen(id);
        for (const f of b.fotos) {
          await loeschen(fotoDatei(f.id));
          await loeschen(fotoDatei(f.id, true));
        }
        for (const d of (await extras.extrasLesen(id)).dateien) await loeschen(extras.dateiPfad(d.id, d.typ));
        await loeschen(extras.extrasDatei(id));
        await loeschen(beitraegeDatei(id));
        await loeschen(reiseDatei(id));
        return json(res, 200, { ok: true });
      }
    }

    // Reise im öffentlichen Reisetagebuch zeigen (nur Planer/innen)
    if (unter === "oeffentlich" && m === "PUT") {
      await reiseMitRecht(id, ich, "planer");
      const d = await koerper(req, 1_000);
      await aendern(reiseDatei(id), null, (r) => {
        r.oeffentlich = d.oeffentlich === true;
      });
      return json(res, 200, { oeffentlich: d.oeffentlich === true });
    }

    // Mitglieder & Einladungen
    if (unter === "mitglieder") {
      const { reise, rolle } = await reiseMitRecht(id, ich);
      const alle = await konten.alleBenutzer();
      if (m === "GET" && !t[4]) {
        return json(res, 200, (reise.mitglieder ?? []).map((mm) => ({ userId: mm.userId, rolle: mm.rolle, name: alle.find((b) => b.id === mm.userId)?.name ?? "(gelöscht)", email: rolle === "planer" ? alle.find((b) => b.id === mm.userId)?.email ?? "" : "" })));
      }
      if (rolle !== "planer") throw fehler(403, "Nur Planer/innen verwalten die Mitreisenden.");
      if (m === "POST" && !t[4]) {
        // Vorhandenes Konto direkt hinzufügen (per E-Mail)
        const d = await koerper(req, 10_000);
        const b = alle.find((x) => x.email === String(d.email ?? "").trim().toLowerCase());
        if (!b) throw fehler(404, "Kein Konto mit dieser E-Mail – bitte eine Einladung schicken.");
        await aendern(reiseDatei(id), null, (r) => {
          r.mitglieder ??= [];
          if (!r.mitglieder.some((x) => x.userId === b.id)) r.mitglieder.push({ userId: b.id, rolle: rolleAus(d.rolle) });
        });
        return json(res, 200, { ok: true });
      }
      if (t[4] && (m === "PUT" || m === "DELETE")) {
        const d = m === "PUT" ? await koerper(req, 10_000) : {};
        await aendern(reiseDatei(id), null, (r) => {
          const i = (r.mitglieder ?? []).findIndex((x) => x.userId === t[4]);
          if (i < 0) return;
          if (m === "DELETE") r.mitglieder.splice(i, 1);
          else r.mitglieder[i].rolle = rolleAus(d.rolle);
          if (!r.mitglieder.some((x) => x.rolle === "planer")) throw fehler(400, "Mindestens eine Person muss Planer/in bleiben.");
          for (const pp of r.personen ?? []) if (m === "DELETE" && pp.userId === t[4]) delete pp.userId;
        });
        return json(res, 200, { ok: true });
      }
    }
    if (unter === "einladungen" && m === "POST") {
      const { reise, rolle } = await reiseMitRecht(id, ich);
      const d = await koerper(req, 10_000);
      let neueRolle = d.rolle;
      if (rolle !== "planer") {
        // Familien-Planer/innen laden nur Personen der eigenen Familie ein – als Mitreisende
        const person = reise.personen?.find((p) => p.id === d.personId);
        const eigene = familieVonKonto(reise, ich.id);
        if (rolle !== "familienplaner" || !person || person.userId || !eigene || person.familie !== eigene) throw fehler(403, "Einladen dürfen Planer/innen – Familien-Planer/innen nur für die eigene Familie.");
        neueRolle = "mitreisend";
      }
      const tok = await konten.einladungErstellen({ reiseId: id, personId: d.personId ? text(d.personId, 80) : null, rolle: neueRolle, vonId: ich.id });
      return json(res, 201, { link: `${basisUrl(req)}/einladung/${tok}` });
    }

    // Bewertungen, Tauchgänge, Fotos
    if (unter === "beitraege" && m === "GET") {
      const { reise } = await reiseMitRecht(id, ich);
      const b = await beitraegeLesen(id);
      const sichtbar = new Set([...(reise.mitglieder ?? []).map((x) => x.userId), ...b.bewertungen.map((x) => x.autorId), ...b.tauchgaenge.map((x) => x.taucherId)]);
      const namen = Object.fromEntries((await konten.alleBenutzer()).filter((x) => sichtbar.has(x.id)).map((x) => [x.id, x.name]));
      return json(res, 200, { ...b, namen });
    }
    if (unter === "bewertungen") {
      const { rolle } = await reiseMitRecht(id, ich);
      if (m === "POST" && !t[4]) {
        const d = bewertungAus(await koerper(req));
        const neu = await beitraegeAendern(id, (b) => {
          const vorhanden = b.bewertungen.find((x) => x.autorId === ich.id && x.zielArt === d.zielArt && x.zielId === d.zielId);
          if (vorhanden) return Object.assign(vorhanden, d, { geaendert: new Date().toISOString() });
          const x = { id: randomUUID(), autorId: ich.id, ...d, erstellt: new Date().toISOString() };
          b.bewertungen.push(x);
          return x;
        });
        return json(res, 201, neu);
      }
      if (t[4] && (m === "PUT" || m === "DELETE")) {
        const d = m === "PUT" ? bewertungAus(await koerper(req)) : null;
        const x = await beitraegeAendern(id, (b) => {
          const i = b.bewertungen.findIndex((y) => y.id === t[4]);
          if (i < 0) throw fehler(404, "Bewertung nicht gefunden.");
          if (!darfBearbeiten(b.bewertungen[i], ich, rolle)) throw fehler(403, "Nur die eigene Bewertung kann geändert werden.");
          if (m === "DELETE") return b.bewertungen.splice(i, 1)[0];
          return Object.assign(b.bewertungen[i], d, { geaendert: new Date().toISOString() });
        });
        return json(res, 200, x);
      }
    }
    if (unter === "tauchgaenge") {
      const { reise, rolle } = await reiseMitRecht(id, ich);
      const mitgliedIds = new Set([...(reise.mitglieder ?? []).map((x) => x.userId), ich.id]);
      if (m === "POST" && !t[4]) {
        const d = tauchgangAus(await koerper(req));
        if (!mitgliedIds.has(d.taucherId)) d.taucherId = ich.id;
        if (d.taucherId !== ich.id && rolle !== "planer") d.taucherId = ich.id;
        const x = await beitraegeAendern(id, (b) => {
          const neu = { id: randomUUID(), autorId: ich.id, ...d, erstellt: new Date().toISOString() };
          b.tauchgaenge.push(neu);
          return neu;
        });
        return json(res, 201, x);
      }
      if (t[4] && (m === "PUT" || m === "DELETE")) {
        const roh = m === "PUT" ? await koerper(req) : null;
        const d = roh ? tauchgangAus(roh) : null;
        // Das Formular schickt kein Profil mit – vorhandenes Tiefenprofil dann behalten
        if (d && !Array.isArray(roh.profil)) delete d.profil;
        const x = await beitraegeAendern(id, (b) => {
          const i = b.tauchgaenge.findIndex((y) => y.id === t[4]);
          if (i < 0) throw fehler(404, "Tauchgang nicht gefunden.");
          if (!darfBearbeiten(b.tauchgaenge[i], ich, rolle, "taucherId")) throw fehler(403, "Nur eigene Tauchgänge können geändert werden.");
          if (m === "DELETE") return b.tauchgaenge.splice(i, 1)[0];
          if (!mitgliedIds.has(d.taucherId) || (rolle !== "planer" && d.taucherId !== b.tauchgaenge[i].taucherId)) d.taucherId = b.tauchgaenge[i].taucherId;
          return Object.assign(b.tauchgaenge[i], d, { geaendert: new Date().toISOString() });
        });
        return json(res, 200, x);
      }
    }
    if (unter === "fotos") {
      const { rolle } = await reiseMitRecht(id, ich);
      if (m === "POST" && !t[4]) {
        const d = await koerper(req, 25_000_000);
        const gross = dataUrlZuJpeg(d.gross, 12_000_000);
        const klein = dataUrlZuJpeg(d.klein, 2_000_000);
        const fid = randomUUID();
        await writeFile(fotoDatei(fid), gross);
        await writeFile(fotoDatei(fid, true), klein);
        const { reise } = await reiseMitRecht(id, ich);
        const info = { id: fid, autorId: ich.id, erstellt: new Date().toISOString(), breite: zahlOderNull(d.breite), hoehe: zahlOderNull(d.hoehe), ...fotoInfoAus(d, reise) };
        await beitraegeAendern(id, (b) => {
          b.fotos.push(info);
        });
        return json(res, 201, info);
      }
      // Album: Tag/Ausflug zuordnen, für das Reisetagebuch freigeben
      if (t[4] && m === "PUT") {
        const { reise } = await reiseMitRecht(id, ich);
        const d = fotoInfoAus(await koerper(req, 10_000), reise, false);
        const x = await beitraegeAendern(id, (b) => {
          const f = b.fotos.find((y) => y.id === t[4]);
          if (!f) throw fehler(404, "Foto nicht gefunden.");
          if (!darfBearbeiten(f, ich, rolle)) throw fehler(403, "Nur eigene Fotos können geändert werden.");
          return Object.assign(f, d);
        });
        return json(res, 200, x);
      }
      if (t[4] && m === "GET") {
        const b = await beitraegeLesen(id);
        if (!b.fotos.some((f) => f.id === t[4])) throw fehler(404, "Foto nicht gefunden.");
        return fotoSenden(res, t[4], url.searchParams.has("klein"));
      }
      if (t[4] && m === "DELETE") {
        await beitraegeAendern(id, (b) => {
          const i = b.fotos.findIndex((f) => f.id === t[4]);
          if (i < 0) throw fehler(404, "Foto nicht gefunden.");
          if (!darfBearbeiten(b.fotos[i], ich, rolle)) throw fehler(403, "Nur eigene Fotos können gelöscht werden.");
          b.fotos.splice(i, 1);
          for (const x of [...b.bewertungen, ...b.tauchgaenge]) x.fotos = (x.fotos ?? []).filter((f) => f !== t[4]);
        });
        await loeschen(fotoDatei(t[4]));
        await loeschen(fotoDatei(t[4], true));
        return json(res, 200, { ok: true });
      }
    }

    // Gemeinsame Listen: Packliste, Dokumente & Fristen, Ausgaben
    if (unter === "extras") {
      const { reise } = await reiseMitRecht(id, ich);
      const liste = t[4];
      if (m === "GET" && !liste) return json(res, 200, await extras.extrasLesen(id));
      if (!extras.LISTEN.includes(liste)) throw fehler(404, "Unbekannte Liste.");
      const kontext = { personen: (reise.personen ?? []).map((p) => p.id), familien: (reise.familien ?? []).map((f) => f.id), dateien: (await extras.extrasLesen(id)).dateien };
      if (m === "POST" && !t[5]) return json(res, 201, await extras.eintragHinzufuegen(id, liste, extras.eintragAus(liste, await koerper(req, 50_000), kontext), ich.id));
      if (t[5] && m === "PUT") return json(res, 200, await extras.eintragAendern(id, liste, t[5], extras.eintragAus(liste, await koerper(req, 50_000), kontext)));
      if (t[5] && m === "DELETE") {
        await extras.eintragLoeschen(id, liste, t[5]);
        return json(res, 200, { ok: true });
      }
    }
    if (unter === "stimmen" && m === "PUT") {
      const { reise } = await reiseMitRecht(id, ich);
      const d = await koerper(req, 2_000);
      if (!(reise.ausfluege ?? []).some((a) => a.id === d.ausflugId)) throw fehler(404, "Ausflug nicht gefunden.");
      if (!(reise.personen ?? []).some((p) => p.id === d.personId)) throw fehler(404, "Person nicht gefunden.");
      return json(res, 200, await extras.stimmeSetzen(id, d.ausflugId, d.personId, Number(d.wert)));
    }
    if (unter === "tiere" && m === "PUT") {
      await reiseMitRecht(id, ich);
      const d = await koerper(req, 2_000);
      const fotoId = d.fotoId === undefined ? undefined : (await beitraegeLesen(id)).fotos.some((f) => f.id === d.fotoId) ? d.fotoId : "";
      return json(res, 200, await extras.tierSetzen(id, d.tier, d.gesehen === true, fotoId));
    }
    if (unter === "schatz" && m === "PUT") {
      await reiseMitRecht(id, ich);
      const d = await koerper(req, 2_000);
      const fotoId = (await beitraegeLesen(id)).fotos.some((f) => f.id === d.fotoId) ? d.fotoId : "";
      return json(res, 200, await extras.schatzSetzen(id, text(d.schluessel, 100), d.erledigt === true, fotoId));
    }
    // Kinder-Bereich je Kind (Abzeichen, Quiz, Tagebuch, Sparschwein, Kids-Club)
    if (unter === "kinder" && t[4] && m === "PUT") {
      const { reise } = await reiseMitRecht(id, ich);
      if (!(reise.personen ?? []).some((p) => p.id === t[4])) throw fehler(404, "Person nicht gefunden.");
      const fotoIds = new Set((await beitraegeLesen(id)).fotos.map((f) => f.id));
      return json(res, 200, await extras.kinderAendern(id, t[4], await koerper(req, 20_000), fotoIds));
    }

    // Dateien zu Dokumenten (PDF, Fotos von Bestätigungen) – nur für Mitreisende
    if (unter === "dateien") {
      const { rolle } = await reiseMitRecht(id, ich);
      if (m === "POST" && !t[4]) {
        const d = await koerper(req, 22_000_000);
        const typ = String(d.typ ?? "");
        if (!DATEI_TYPEN[typ]) throw fehler(400, "Erlaubt sind PDF, JPEG und PNG.");
        const roh = Buffer.from(String(d.daten ?? ""), "base64");
        if (!roh.length || roh.length > 15_000_000) throw fehler(400, "Datei leer oder größer als 15 MB.");
        if (!DATEI_TYPEN[typ](roh)) throw fehler(400, "Der Dateiinhalt passt nicht zum Dateityp.");
        const fid = randomUUID();
        await writeFile(extras.dateiPfad(fid, typ), roh);
        const info = { id: fid, name: text(d.name, 200).replace(/[\\/\r\n"]/g, "_") || "Datei", typ, groesse: roh.length, autorId: ich.id, erstellt: new Date().toISOString() };
        await extras.extrasAendern(id, (e) => {
          e.dateien.push(info);
        });
        return json(res, 201, info);
      }
      if (t[4] && m === "GET") {
        const info = (await extras.extrasLesen(id)).dateien.find((x) => x.id === t[4]);
        if (!info || !existsSync(extras.dateiPfad(info.id, info.typ))) throw fehler(404, "Datei nicht gefunden.");
        res.writeHead(200, {
          "content-type": info.typ,
          "content-disposition": `${url.searchParams.has("laden") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(info.name)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        });
        return createReadStream(extras.dateiPfad(info.id, info.typ)).pipe(res);
      }
      if (t[4] && m === "DELETE") {
        const info = await extras.extrasAendern(id, (e) => {
          const i = e.dateien.findIndex((x) => x.id === t[4]);
          if (i < 0) throw fehler(404, "Datei nicht gefunden.");
          if (!darfBearbeiten(e.dateien[i], ich, rolle)) throw fehler(403, "Nur eigene Dateien können gelöscht werden.");
          for (const dok of e.dokumente) if (dok.dateiId === t[4]) dok.dateiId = "";
          return e.dateien.splice(i, 1)[0];
        });
        await loeschen(extras.dateiPfad(info.id, info.typ));
        return json(res, 200, { ok: true });
      }
    }

    // KI: Tagesbriefing (für alle Mitreisenden gespeichert) und Ausflug-Check
    if (unter === "briefing" && m === "POST") {
      const { reise } = await reiseMitRecht(id, ich);
      const d = await koerper(req, 10_000);
      const hafenId = text(d.hafenId, 80);
      if (!d.neu) {
        const vorhanden = (await extras.extrasLesen(id)).briefings[hafenId];
        if (vorhanden) return json(res, 200, vorhanden);
      }
      const stand = ki.reiseStand(reise, await beitraegeLesen(id), await konten.alleBenutzer());
      const briefing = { text: await ki.tagesbriefing({ stand, hafenId, wetter: text(d.wetter, 300), heute: heuteIso() }), zeit: new Date().toISOString() };
      await extras.extrasAendern(id, (e) => {
        e.briefings[hafenId] = briefing;
      });
      return json(res, 200, briefing);
    }
    if (unter === "ausflug-check" && m === "POST") {
      const { reise } = await reiseMitRecht(id, ich);
      const d = await koerper(req, 10_000);
      const ausflugId = text(d.ausflugId, 80);
      const stand = ki.reiseStand(reise, await beitraegeLesen(id), await konten.alleBenutzer());
      const check = { ...(await ki.ausflugPruefen({ stand, ausflugId })), zeit: new Date().toISOString() };
      await extras.extrasAendern(id, (e) => {
        e.checks[ausflugId] = check;
      });
      return json(res, 200, check);
    }

    // Freigaben
    if (unter === "freigaben") {
      const { reise, rolle } = await reiseMitRecht(id, ich);
      if (m === "GET") {
        const liste = (await teilen.alleFreigaben()).filter((f) => f.reiseId === id && f.aktiv);
        return json(res, 200, liste.map((f) => ({ ...f, url: `${basisUrl(req)}/teilen/${f.token}` })));
      }
      if (m === "POST") {
        const d = await koerper(req, 10_000);
        if (!teilen.ARTEN.includes(d.art)) throw fehler(400, "Unbekannte Art der Freigabe.");
        const zielId = d.art === "bericht" ? id : text(d.zielId, 80);
        const beitraege = await beitraegeLesen(id);
        if (d.art === "tauchgang") {
          const tg = beitraege.tauchgaenge.find((x) => x.id === zielId);
          if (tg && rolle !== "planer" && tg.taucherId !== ich.id && tg.autorId !== ich.id) throw fehler(403, "Einen Tauchgang teilen nur der/die Taucher/in oder Planer/innen.");
        }
        const probe = teilen.inhaltFuer(reise, beitraege, [], { art: d.art, zielId });
        if (!probe) throw fehler(404, "Nichts zum Teilen gefunden (gibt es den Eintrag noch, ist er privat?).");
        const f = await teilen.freigabeErstellen({ reiseId: id, art: d.art, zielId, vonId: ich.id, mitPreis: d.mitPreis });
        return json(res, 201, { ...f, url: `${basisUrl(req)}/teilen/${f.token}` });
      }
    }

    // KI
    if (unter === "chat") {
      const { reise } = await reiseMitRecht(id, ich);
      if (m === "GET") return json(res, 200, await ki.chatLesen(ich.id, id));
      if (m === "DELETE") {
        await ki.chatLoeschen(ich.id, id);
        return json(res, 200, { ok: true });
      }
      if (m === "POST") {
        const d = await koerper(req, 50_000);
        const stand = ki.reiseStand(reise, await beitraegeLesen(id), await konten.alleBenutzer());
        return json(res, 200, await ki.chatFragen({ userId: ich.id, reiseId: id, frage: d.frage, stand }));
      }
    }
    if (unter === "beitragstext" && m === "POST") {
      const { reise } = await reiseMitRecht(id, ich);
      const d = await koerper(req, 10_000);
      const zielId = d.art === "bericht" ? id : text(d.zielId, 80);
      const inhalt = teilen.inhaltFuer(reise, await beitraegeLesen(id), await konten.alleBenutzer(), { art: d.art, zielId, mitPreis: false });
      if (!inhalt) throw fehler(404, "Beitrag nicht gefunden.");
      return json(res, 200, { text: await ki.beitragstext({ inhalt, plattform: d.plattform, sprache: d.sprache, creatorName: ich.creatorName }) });
    }
  }

  if (t[1] === "freigaben" && t[2] && m === "DELETE") {
    const f = (await teilen.alleFreigaben()).find((x) => x.token === t[2]);
    if (!f) throw fehler(404, "Freigabe nicht gefunden.");
    const { rolle } = await reiseMitRecht(f.reiseId, ich);
    if (rolle !== "planer" && f.vonId !== ich.id) throw fehler(403, "Nur wer geteilt hat (oder Planer/innen) kann die Freigabe beenden.");
    await teilen.freigabeBeenden(t[2]);
    return json(res, 200, { ok: true });
  }

  // „Heute vor … Jahren“: Tage früherer Reisen mit demselben Datum
  if (p === "/api/erinnerungen" && m === "GET") {
    const heute = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("datum") ?? "") ? url.searchParams.get("datum") : heuteIso();
    const liste = [];
    for (const r of (await alleReisen()).filter((x) => rolleIn(x, ich))) {
      const tage = (r.haefen ?? []).filter((h) => h.datum && h.datum.slice(5) === heute.slice(5) && h.datum < heute);
      if (!tage.length) continue;
      const b = await beitraegeLesen(r.id);
      for (const h of tage) {
        const ausfluege = (r.ausfluege ?? []).filter((a) => a.hafenId === h.id && a.status === "gebucht");
        const ids = new Set(ausfluege.map((a) => a.id));
        const fotos = [
          ...b.fotos.filter((f) => f.hafenId === h.id).map((f) => f.id),
          ...b.bewertungen.filter((x) => x.zielArt === "ausflug" && ids.has(x.zielId)).flatMap((x) => x.fotos ?? []),
          ...b.tauchgaenge.filter((x) => x.datum === h.datum).flatMap((x) => x.fotos ?? []),
        ];
        liste.push({ reiseId: r.id, reise: r.name, datum: h.datum, jahre: Number(heute.slice(0, 4)) - Number(h.datum.slice(0, 4)), art: h.art ?? (h.seetag ? "seetag" : "hafen"), name: h.name, land: h.land ?? "", ausfluege: ausfluege.map((a) => a.titel), fotos: [...new Set(fotos)].slice(0, 6) });
      }
    }
    return json(res, 200, liste.sort((a, b) => a.jahre - b.jahre));
  }

  // Jahresrückblick: alle eigenen Reisen eines Jahres mit Beiträgen (für das Reisebuch)
  if (p === "/api/rueckblick" && m === "GET") {
    const jahr = /^\d{4}$/.test(url.searchParams.get("jahr") ?? "") ? url.searchParams.get("jahr") : heuteIso().slice(0, 4);
    const reisen = [];
    for (const r of (await alleReisen()).filter((x) => rolleIn(x, ich))) {
      const tage = [...(r.haefen ?? []).map((h) => h.datum), ...(r.hotels ?? []).filter((h) => h.status === "gebucht").map((h) => h.anreise)].filter(Boolean);
      if (!tage.some((d) => d.startsWith(jahr))) continue;
      const { mitglieder, ...reise } = r;
      reisen.push({ reise, beitraege: await beitraegeLesen(r.id) });
    }
    const sichtbar = new Set(reisen.flatMap(({ reise, beitraege }) => [...(reise.personen ?? []).map((x) => x.userId), ...beitraege.bewertungen.map((x) => x.autorId), ...beitraege.tauchgaenge.map((x) => x.taucherId)]));
    const namen = Object.fromEntries((await konten.alleBenutzer()).filter((x) => sichtbar.has(x.id)).map((x) => [x.id, x.name]));
    reisen.sort((a, b) => String(a.reise.haefen?.map((h) => h.datum).sort()[0] ?? "").localeCompare(String(b.reise.haefen?.map((h) => h.datum).sort()[0] ?? "")));
    return json(res, 200, { jahr, reisen, namen });
  }

  // Weltkarte: besuchte Orte aller eigenen Reisen + von Hand eingetragene Orte
  if (p === "/api/weltkarte" && m === "GET") {
    const einst = await tagebuch.einstellungenLesen();
    const reisen = (await alleReisen()).filter((r) => rolleIn(r, ich));
    return json(res, 200, {
      titel: einst.titel,
      text: einst.text,
      orte: einst.orte,
      besucht: reisen.flatMap((r) => tagebuch.besuchteOrte(r, heuteIso())),
      reisen: reisen.map((r) => ({ id: r.id, name: r.name, oeffentlich: Boolean(r.oeffentlich), planer: rolleIn(r, ich) === "planer" })),
      url: `${basisUrl(req)}/tagebuch`,
    });
  }
  if (p === "/api/weltkarte" && m === "PUT") {
    if (!ich.admin) throw fehler(403, "Nur für die Verwaltung.");
    return json(res, 200, await tagebuch.einstellungenAendern(await koerper(req, 20_000)));
  }
  if (p === "/api/weltkarte/orte" && m === "POST") {
    if (!ich.admin) throw fehler(403, "Nur für die Verwaltung.");
    return json(res, 201, await tagebuch.ortHinzufuegen(await koerper(req, 20_000)));
  }
  if (t[1] === "weltkarte" && t[2] === "orte" && t[3] && m === "DELETE") {
    if (!ich.admin) throw fehler(403, "Nur für die Verwaltung.");
    await tagebuch.ortLoeschen(t[3]);
    return json(res, 200, { ok: true });
  }

  // Mein Tauchlogbuch über alle Reisen
  if (p === "/api/tauchlog" && m === "GET") {
    const liste = [];
    for (const d of (await readdir(REISEN_DIR)).filter((x) => /^[a-z0-9-]+\.json$/.test(x))) {
      const r = await reiseLesen(d.slice(0, -5));
      if (!r || !rolleIn(r, ich)) continue;
      for (const tg of (await beitraegeLesen(r.id)).tauchgaenge) if (tg.taucherId === ich.id) liste.push({ ...tg, reiseId: r.id, reiseName: r.name });
    }
    liste.sort((a, b) => `${a.datum} ${a.beginn}`.localeCompare(`${b.datum} ${b.beginn}`));
    liste.forEach((tg, i) => (tg.nr = (ich.tauchVorher ?? 0) + i + 1));
    return json(res, 200, liste);
  }

  if (p === "/api/ki/import" && m === "POST") {
    const d = await koerper(req, 40_000_000);
    const dateien = (Array.isArray(d.dateien) ? d.dateien : []).map((x) => ({ name: text(x.name, 200), typ: text(x.typ, 120), daten: String(x.daten ?? "") }));
    return json(res, 200, await ki.reiseplanLesen({ text: text(d.text, 400_000), dateien, heute: new Date().toISOString().slice(0, 10) }));
  }

  // Ortssuche
  if (p === "/api/geo" && m === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    if (q.length < 2) throw fehler(400, "Suchbegriff fehlt.");
    const schluessel = `geo:${q.toLowerCase()}`;
    let treffer = gemerkt(schluessel, 90 * 86400_000);
    if (treffer === undefined) {
      await nominatimWarten();
      const roh = await holen(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`);
      treffer = roh.map((x) => ({ name: x.display_name, lat: Number(x.lat), lng: Number(x.lon), art: x.type }));
      merken(schluessel, treffer);
    }
    return json(res, 200, treffer);
  }

  // Fahrweg
  if (p === "/api/route" && m === "GET") {
    const von = (url.searchParams.get("von") ?? "").split(",");
    const nach = (url.searchParams.get("nach") ?? "").split(",");
    const modus = url.searchParams.get("modus") === "fuss" ? "foot" : "car";
    if (![...von, ...nach].every(zahlOk) || von.length !== 2 || nach.length !== 2) throw fehler(400, "Koordinaten fehlen.");
    const r5 = (x) => Number(x).toFixed(5);
    const koord = `${r5(von[1])},${r5(von[0])};${r5(nach[1])},${r5(nach[0])}`;
    const schluessel = `route:${modus}:${koord}`;
    let weg = gemerkt(schluessel, 30 * 86400_000);
    if (weg === undefined) {
      const roh = await holen(`https://routing.openstreetmap.de/routed-${modus}/route/v1/driving/${koord}?overview=simplified&geometries=geojson`);
      const r = roh.routes?.[0];
      weg = r ? { km: r.distance / 1000, min: r.duration / 60, linie: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]) } : null;
      merken(schluessel, weg);
    }
    if (!weg) throw fehler(404, "Kein Weg gefunden (z. B. über Wasser).");
    return json(res, 200, weg);
  }

  // GetYourGuide (nur mit Partner-Schlüssel)
  if (p === "/api/gyg" && m === "GET") {
    if (!GYG_KEY) throw fehler(501, "Kein GetYourGuide-Partner-Schlüssel hinterlegt (GYG_API_KEY).");
    const lat = url.searchParams.get("lat");
    const lng = url.searchParams.get("lng");
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 150);
    const datum = url.searchParams.get("datum") ?? "";
    const radius = Math.min(Math.max(Number(url.searchParams.get("radius") ?? 30), 1), 100);
    const sp = new URLSearchParams({ cnt_language: "de", currency: "EUR", limit: "30", sortfield: "popularity", sortdirection: "DESC" });
    if (zahlOk(lat) && zahlOk(lng)) {
      sp.append("coordinates[]", lat);
      sp.append("coordinates[]", lng);
      sp.append("coordinates[]", String(radius));
    } else if (q) sp.set("q", q);
    else throw fehler(400, "Ort ohne Koordinaten und ohne Suchbegriff.");
    if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      sp.append("date[]", `${datum}T00:00:00`);
      sp.append("date[]", `${datum}T23:59:59`);
    }
    const schluessel = `gyg:${sp}`;
    let touren = gemerkt(schluessel, 6 * 3600_000);
    if (touren === undefined) {
      const roh = await holen(`${GYG_URL}/1/tours?${sp}`, { headers: { "x-access-token": GYG_KEY, accept: "application/json" } });
      touren = (roh?.data?.tours ?? []).map((x) => {
        const du = x.durations?.[0];
        const faktor = du?.unit === "day" ? 1440 : du?.unit === "hour" ? 60 : 1;
        return {
          id: x.tour_id, titel: x.title, kurz: x.abstract ?? "", preis: x.price?.values?.amount ?? null, preisHinweis: x.price?.description ?? "",
          dauerMin: du ? Math.round(du.duration * faktor) : null, sterne: x.overall_rating ?? null, bewertungen: x.number_of_ratings ?? null,
          lat: x.coordinates?.lat ?? null, lng: x.coordinates?.long ?? null, abholung: Boolean(x.has_pick_up), link: x.url ?? "",
        };
      });
      merken(schluessel, touren);
    }
    return json(res, 200, touren);
  }

  throw fehler(404, "Unbekannte Adresse.");
}

// ---------- Fotos & öffentliche Freigaben ----------

function fotoSenden(res, id, klein) {
  const datei = fotoDatei(id, klein);
  if (!existsSync(datei)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
  createReadStream(datei).pipe(res);
}

async function freigabeSeite(req, res, url) {
  const [, , tok, art, fid] = url.pathname.split("/");
  const html = (status, body) => {
    res.writeHead(status, { "content-type": MIME[".html"], "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    res.end(body);
  };
  const f = await teilen.freigabeLesen(tok, !art);
  const reise = f ? await reiseLesen(f.reiseId) : null;
  const inhalt = reise ? teilen.inhaltFuer(reise, await beitraegeLesen(reise.id), await konten.alleBenutzer(), f) : null;
  if (!inhalt) return html(404, teilen.nichtGefundenSeite());
  if (art === "foto") {
    if (!ID_RE.test(fid ?? "") || !teilen.erlaubteFotos(inhalt).has(fid)) {
      res.writeHead(404);
      return res.end();
    }
    return fotoSenden(res, fid, url.searchParams.has("klein"));
  }
  if (art) return html(404, teilen.nichtGefundenSeite());
  return html(200, teilen.seiteRendern(inhalt, f, basisUrl(req)));
}

async function tagebuchSeite(req, res, url) {
  const inhalt = tagebuch.tagebuchInhalt(
    await Promise.all((await alleReisen()).filter((r) => r.oeffentlich).map(async (reise) => ({ reise, beitraege: await beitraegeLesen(reise.id) }))),
    await konten.alleBenutzer(),
    await tagebuch.einstellungenLesen(),
    heuteIso(),
  );
  const teile = url.pathname.split("/").filter(Boolean); // ["tagebuch", "foto", id]
  if (teile[1] === "foto") {
    if (!ID_RE.test(teile[2] ?? "") || !inhalt.fotos.has(teile[2])) {
      res.writeHead(404);
      return res.end();
    }
    return fotoSenden(res, teile[2], url.searchParams.has("klein"));
  }
  if (teile.length > 1) {
    res.writeHead(404, { "content-type": MIME[".html"] });
    return res.end(teilen.nichtGefundenSeite());
  }
  const kacheln = process.env.KARTEN_KACHELN || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  let kachelHost = "https://tile.openstreetmap.org";
  try {
    kachelHost = new URL(kacheln.replace(/\{[a-z]\}/g, "a")).origin;
  } catch {}
  res.writeHead(200, {
    "content-type": MIME[".html"],
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": `default-src 'none'; img-src 'self' data: https://unpkg.com ${kachelHost} https://*.tile.openstreetmap.org; style-src 'unsafe-inline' https://unpkg.com; script-src 'unsafe-inline' https://unpkg.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });
  res.end(tagebuch.seiteRendern(inhalt, basisUrl(req), kacheln, process.env.KARTEN_HINWEIS || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'));
}

async function statisch(req, res, url) {
  let datei;
  try {
    datei = decodeURIComponent(url.pathname);
  } catch {
    throw fehler(400, "Ungültige Adresse.");
  }
  // Alle App-Pfade (z. B. /einladung/…) zeigen die Oberfläche
  if (datei === "/" || !path.extname(datei)) datei = "/index.html";
  const voll = path.join(PUBLIC, path.normalize(datei));
  if (!voll.startsWith(PUBLIC + path.sep) || !existsSync(voll)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return res.end("Nicht gefunden");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(voll)] ?? "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" });
  createReadStream(voll).pipe(res);
}

// ---------- Server ----------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/gesund") return json(res, 200, { ok: true });
    if (url.pathname.startsWith("/teilen/")) return await freigabeSeite(req, res, url);
    if (url.pathname === "/tagebuch" || url.pathname.startsWith("/tagebuch/")) return await tagebuchSeite(req, res, url);
    if (!url.pathname.startsWith("/api/")) return await statisch(req, res, url);

    // Schutz vor fremden Seiten (CSRF): Änderungen nur mit dem App-eigenen Kopf.
    if (req.method !== "GET" && req.headers["x-reiseplaner"] !== "1") throw fehler(403, "Anfrage ohne App-Kennung abgelehnt.");
    const ich = await konten.benutzerZuSitzung(konten.cookieLesen(req));
    if ((await apiOffen(req, res, url, ich)) !== false) return;
    if (!ich) throw fehler(401, "Bitte anmelden.");
    return await api(req, res, url, ich);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) json(res, e.status ?? 500, { error: e.status ? e.message : "Interner Fehler." });
    else res.end();
  }
});

server.listen(PORT, async () => {
  console.log(`Reiseplaner läuft auf http://localhost:${PORT} (Daten: ${DATA_DIR})`);
  const code = await konten.einrichtungsCodeErzeugen();
  if (code) console.log(`Noch kein Konto vorhanden. Einrichtungscode für das erste Konto: ${code}`);
  if (!process.env.OEFFENTLICHE_URL) console.log("Hinweis: OEFFENTLICHE_URL ist nicht gesetzt – Einladungs- und Freigabe-Links nutzen die Adresse aus der Anfrage.");
  if (!ki.kiAktiv()) console.log("KI: kein ANTHROPIC_API_KEY – KI-Import, Assistent und Beitragstexte sind aus.");
  if (!GYG_KEY) console.log("GetYourGuide: kein Partner-Schlüssel – es gibt Such-Links statt eingebetteter Ergebnisse.");
});
