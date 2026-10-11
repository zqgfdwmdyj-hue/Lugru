// Konten, Sitzungen und Einladungen.
// Jede/r Mitreisende bekommt ein eigenes Konto (E-Mail + Passwort). Neue Konten entstehen über
// Einladungslinks; das allererste Konto (Verwaltung) über den Einrichtungscode aus dem Server-Log.
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { DATA_DIR, lesen, aendern } from "./speicher.mjs";

const scryptAsync = promisify(scrypt);
const BENUTZER = path.join(DATA_DIR, "benutzer.json");
const SITZUNGEN = path.join(DATA_DIR, "sitzungen.json");
const EINLADUNGEN = path.join(DATA_DIR, "einladungen.json");
const SITZUNG_TAGE = 90;
export const COOKIE = "rp_sitzung";

const sha = (s) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(24).toString("base64url");

// ---------- Passwörter ----------

async function hashen(passwort, salz = randomBytes(16).toString("hex")) {
  const h = await scryptAsync(passwort, salz, 64, { N: 16384, r: 8, p: 1 });
  return { salz, hash: h.toString("hex") };
}

async function pruefen(passwort, benutzer) {
  const { hash } = await hashen(passwort, benutzer.salz);
  return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(benutzer.hash, "hex"));
}

export function passwortFehler(passwort) {
  if (typeof passwort !== "string" || passwort.length < 8) return "Das Passwort braucht mindestens 8 Zeichen.";
  if (passwort.length > 200) return "Das Passwort ist zu lang.";
  return null;
}

const emailOk = (e) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;

// ---------- Benutzer ----------

export async function alleBenutzer() {
  return lesen(BENUTZER, []);
}

/** Öffentliche Sicht auf ein Konto (ohne Passwort-Hash). */
export function oeffentlich(b) {
  if (!b) return null;
  return { id: b.id, name: b.name, email: b.email, admin: Boolean(b.admin), tauchVorher: b.tauchVorher ?? 0, creatorName: b.creatorName ?? "", erstellt: b.erstellt };
}

export async function benutzerAnlegen({ name, email, passwort, admin = false }) {
  email = String(email ?? "").trim().toLowerCase();
  name = String(name ?? "").trim().slice(0, 80);
  if (!name) throw fehler(400, "Bitte einen Namen angeben.");
  if (!emailOk(email)) throw fehler(400, "Bitte eine gültige E-Mail-Adresse angeben.");
  const pf = passwortFehler(passwort);
  if (pf) throw fehler(400, pf);
  const { salz, hash } = await hashen(passwort);
  return aendern(BENUTZER, [], (liste) => {
    if (liste.some((b) => b.email === email)) throw fehler(409, "Für diese E-Mail gibt es schon ein Konto – bitte anmelden.");
    const b = { id: randomUUID(), name, email, salz, hash, admin: admin || liste.length === 0, erstellt: new Date().toISOString(), tauchVorher: 0, creatorName: "" };
    liste.push(b);
    return b;
  });
}

export async function benutzerAendern(id, felder) {
  const neu = {};
  if (felder.name != null) neu.name = String(felder.name).trim().slice(0, 80) || undefined;
  if (felder.tauchVorher != null) neu.tauchVorher = Math.max(0, Math.min(100000, Math.round(Number(felder.tauchVorher) || 0)));
  if (felder.creatorName != null) neu.creatorName = String(felder.creatorName).trim().slice(0, 60);
  if (felder.passwort) {
    const pf = passwortFehler(felder.passwort);
    if (pf) throw fehler(400, pf);
    Object.assign(neu, await hashen(felder.passwort));
  }
  return aendern(BENUTZER, [], (liste) => {
    const b = liste.find((x) => x.id === id);
    if (!b) throw fehler(404, "Konto nicht gefunden.");
    for (const [k, v] of Object.entries(neu)) if (v !== undefined) b[k] = v;
    return b;
  });
}

export async function benutzerLoeschen(id) {
  await aendern(BENUTZER, [], (liste) => {
    const i = liste.findIndex((b) => b.id === id);
    if (i >= 0) liste.splice(i, 1);
  });
  await aendern(SITZUNGEN, {}, (s) => {
    for (const [k, v] of Object.entries(s)) if (v.userId === id) delete s[k];
  });
}

// ---------- Anmelden ----------

const fehlversuche = new Map(); // email → { anzahl, seit } (je Konto, damit wechselnde IPs nichts nützen)
export async function anmelden(email, passwort) {
  email = String(email ?? "").trim().toLowerCase();
  const schluessel = email;
  const f = fehlversuche.get(schluessel);
  if (f && f.anzahl >= 8 && Date.now() - f.seit < 15 * 60_000) throw fehler(429, "Zu viele Versuche. Bitte in 15 Minuten erneut probieren.");
  const b = (await alleBenutzer()).find((x) => x.email === email);
  if (!b || !(await pruefen(String(passwort ?? ""), b))) {
    const neu = f && Date.now() - f.seit < 15 * 60_000 ? { anzahl: f.anzahl + 1, seit: f.seit } : { anzahl: 1, seit: Date.now() };
    fehlversuche.set(schluessel, neu);
    if (fehlversuche.size > 10_000) fehlversuche.clear();
    throw fehler(401, "E-Mail oder Passwort stimmt nicht.");
  }
  fehlversuche.delete(schluessel);
  return b;
}

export async function sitzungStarten(userId) {
  const t = token();
  await aendern(SITZUNGEN, {}, (s) => {
    const jetzt = Date.now();
    for (const [k, v] of Object.entries(s)) if (v.ablauf < jetzt) delete s[k];
    s[sha(t)] = { userId, ablauf: jetzt + SITZUNG_TAGE * 86400_000 };
  });
  return t;
}

export async function sitzungBeenden(t) {
  if (!t) return;
  await aendern(SITZUNGEN, {}, (s) => {
    delete s[sha(t)];
  });
}

// Kleiner Zwischenspeicher, damit nicht jede Anfrage zwei Dateien liest.
const cache = new Map();
export function cacheLeeren() {
  cache.clear();
}

export async function benutzerZuSitzung(t) {
  if (!t) return null;
  const k = sha(t);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.zeit < 15_000) return hit.benutzer;
  const s = (await lesen(SITZUNGEN, {}))[k];
  const benutzer = s && s.ablauf > Date.now() ? (await alleBenutzer()).find((b) => b.id === s.userId) ?? null : null;
  if (cache.size > 2000) cache.clear();
  cache.set(k, { benutzer, zeit: Date.now() });
  return benutzer;
}

export function cookieLesen(req) {
  const kopf = req.headers.cookie ?? "";
  for (const teil of kopf.split(";")) {
    const [k, ...v] = teil.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function cookieSetzen(res, req, wert, maxAlter = SITZUNG_TAGE * 86400) {
  const sicher = req.headers["x-forwarded-proto"] === "https" || (process.env.OEFFENTLICHE_URL ?? "").startsWith("https:");
  res.setHeader(
    "set-cookie",
    `${COOKIE}=${encodeURIComponent(wert)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAlter}${sicher ? "; Secure" : ""}`,
  );
}

// ---------- Einrichtung (erstes Konto) ----------

let einrichtungsCode = null;
export async function einrichtungNoetig() {
  return (await alleBenutzer()).length === 0;
}
export async function einrichtungsCodeErzeugen() {
  if (!(await einrichtungNoetig())) return null;
  einrichtungsCode ??= randomBytes(4).toString("hex").toUpperCase();
  return einrichtungsCode;
}
export function einrichtungsCodeOk(code) {
  return Boolean(einrichtungsCode) && String(code ?? "").trim().toUpperCase() === einrichtungsCode;
}

// ---------- Einladungen ----------

export async function einladungErstellen({ reiseId, personId = null, rolle = "mitreisend", vonId }) {
  const t = token();
  await aendern(EINLADUNGEN, [], (liste) => {
    const jetzt = Date.now();
    for (let i = liste.length - 1; i >= 0; i--) if (liste[i].ablauf < jetzt) liste.splice(i, 1);
    liste.push({ hash: sha(t), reiseId, personId, rolle, vonId, erstellt: new Date().toISOString(), ablauf: jetzt + 14 * 86400_000, benutzt: 0 });
  });
  return t;
}

export async function einladungLesen(t) {
  const e = (await lesen(EINLADUNGEN, [])).find((x) => x.hash === sha(String(t ?? "")));
  return e && e.ablauf > Date.now() ? e : null;
}

export async function einladungVerbrauchen(t) {
  await aendern(EINLADUNGEN, [], (liste) => {
    const e = liste.find((x) => x.hash === sha(String(t ?? "")));
    if (e) {
      e.benutzt += 1;
      // Einladung für eine bestimmte Person gilt nur einmal
      if (e.personId) e.ablauf = 0;
    }
  });
}

export function fehler(status, message) {
  return Object.assign(new Error(message), { status });
}
