// Gemeinsamer Zustand und Hilfen für alle Teile der Oberfläche.
import { euro, sichereUrl } from "./rechnen.js";

export const zustand = {
  info: { gyg: false, gygPartnerId: "", ki: false },
  ich: null,
  reisen: [],
  reise: null,
  rolle: null,
  ansicht: "plan",
  hafenId: null,
  sortierung: "punkte",
  gygErgebnisse: {},
  wetter: {},
  wege: {},
  beitraege: { bewertungen: [], tauchgaenge: [], fotos: [], namen: {} },
  mitglieder: [],
};

export const $ = (sel, el = document) => el.querySelector(sel);
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const neueId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
export const datumText = (iso, opt = { weekday: "short", day: "2-digit", month: "2-digit" }) => {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("de-DE", opt);
};
export const personen = () => zustand.reise?.personen ?? [];
export const haefen = () => [...(zustand.reise?.haefen ?? [])].sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
export const hafenVon = (id) => zustand.reise?.haefen?.find((h) => h.id === id);
export const ausfluegeIn = (hafenId) => (zustand.reise?.ausfluege ?? []).filter((a) => a.hafenId === hafenId);
export const hatKoord = (o) => o && Number.isFinite(o.lat) && Number.isFinite(o.lng);
export const waehrung = () => zustand.reise?.waehrung || "EUR";
export const geld = (n) => euro(n, waehrung());
export const istPlaner = () => zustand.rolle === "planer";
export const linkHtml = (url, text) => (sichereUrl(url) ? `<a href="${esc(sichereUrl(url))}" target="_blank" rel="noopener">${text} ↗</a>` : text);
export const stationsArt = (h) => h?.art ?? (h?.seetag ? "seetag" : "hafen");
export const istKreuzfahrt = () => (zustand.reise?.art ?? "kreuzfahrt") === "kreuzfahrt";

/** Ereignis-Handler, die die einzelnen Module eintragen (data-aktion="…"). */
export const aktionen = {};
export const aenderungen = {};

let zeichner = () => {};
export const setzeZeichner = (fn) => (zeichner = fn);
export const neuZeichnen = () => zeichner();

// ---------- Server ----------

let beiAbmeldung = () => {};
export const setzeAbmeldung = (fn) => (beiAbmeldung = fn);

export async function anfrage(pfad, optionen = {}) {
  let res;
  try {
    res = await fetch(pfad.startsWith("/") ? pfad : `/${pfad}`, {
      ...optionen,
      headers: { "content-type": "application/json", "x-reiseplaner": "1", ...(optionen.headers ?? {}) },
      body: optionen.body && typeof optionen.body !== "string" ? JSON.stringify(optionen.body) : optionen.body,
    });
  } catch {
    // Netzwerkfehler (Server neu gestartet, SSH-Tunnel/Internet weg) – verständlich melden
    throw Object.assign(new Error("Keine Verbindung zum Server. Bitte Internet bzw. SSH-Tunnel prüfen und erneut versuchen."), { status: 0 });
  }
  const daten = await res.json().catch(() => ({}));
  if (res.status === 401 && !pfad.includes("anmelden")) beiAbmeldung();
  if (!res.ok) throw Object.assign(new Error(daten.error ?? `Fehler ${res.status}`), { status: res.status, daten });
  return daten;
}

const LOKAL = (id) => `reiseplaner:reise:${id}`;
export function lokalSichern(reise, ungespeichert) {
  try {
    localStorage.setItem(LOKAL(reise.id), JSON.stringify({ reise, ungespeichert }));
  } catch {}
}
export function lokalLesen(id) {
  try {
    return JSON.parse(localStorage.getItem(LOKAL(id)) ?? "null");
  } catch {
    return null;
  }
}
export function lokalEntfernen(id) {
  try {
    localStorage.removeItem(LOKAL(id));
  } catch {}
}

let speicherTimer = null;
let speichertGerade = false;
let nochmal = false;
export function speichern() {
  if (!zustand.reise) return;
  lokalSichern(zustand.reise, true);
  status("Ungespeichert …");
  clearTimeout(speicherTimer);
  speicherTimer = setTimeout(jetztSpeichern, 700);
}

async function jetztSpeichern() {
  if (speichertGerade) {
    nochmal = true;
    return;
  }
  speichertGerade = true;
  const reise = zustand.reise;
  try {
    const antwort = await anfrage(`/api/reisen/${reise.id}`, { method: "PUT", body: reise });
    reise.version = antwort.version;
    reise.geaendert = antwort.geaendert;
    lokalSichern(reise, false);
    status("Gespeichert ✓");
  } catch (e) {
    if (e.status === 409) {
      const aktuell = e.daten?.aktuell;
      if (aktuell && confirm(`${e.message}\n\nOK = die neuere Fassung laden (deine letzten Änderungen gehen verloren).\nAbbrechen = deine Fassung behalten und die andere überschreiben.`)) {
        zustand.reise = aktuell;
        lokalSichern(aktuell, false);
        neuZeichnen();
      } else if (aktuell) {
        reise.version = aktuell.version;
        nochmal = true;
      }
    } else if (e.status === 401 || e.status === 403 || e.status === 404) {
      status(e.message, true);
    } else {
      status("Offline – wird lokal gehalten und später gespeichert", true);
      setTimeout(() => speichern(), 15_000);
    }
  } finally {
    speichertGerade = false;
    if (nochmal) {
      nochmal = false;
      jetztSpeichern();
    }
  }
}

export function status(text, warnung = false) {
  const el = $("#speicherStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("warnung", warnung);
}

export async function beitraegeLaden() {
  if (!zustand.reise) return;
  try {
    zustand.beitraege = await anfrage(`/api/reisen/${zustand.reise.id}/beitraege`);
  } catch {}
}

// ---------- Dialog ----------

export const dialog = () => $("#dialog");
export function dialogOeffnen(html, breit = false) {
  const d = dialog();
  d.classList.toggle("breit", breit);
  d.innerHTML = html;
  if (!d.open) d.showModal();
  return d;
}

// ---------- Ortssuche (in mehreren Dialogen) ----------

export function ortsSuche(feldname, wert, platzhalter = "Ort suchen, z. B. „Teide Nationalpark“ oder „28.27, -16.64“") {
  return `<div class="ortssuche" data-ort="${feldname}">
    <div class="zeile eng"><input type="search" placeholder="${esc(platzhalter)}" class="ortsq"><button type="button" class="knopf leise" data-aktion="ort-suchen">Suchen</button></div>
    <div class="orttreffer"></div>
    <div class="klein leise ortswert">${hatKoord(wert) ? `📍 ${esc(wert.name ?? "")} (${wert.lat.toFixed(4)}, ${wert.lng.toFixed(4)})` : "Noch kein Ort gewählt"}</div>
    <input type="hidden" name="${feldname}" value="${esc(hatKoord(wert) ? JSON.stringify(wert) : "")}">
  </div>`;
}

export async function ortSuchen(box) {
  const q = box.querySelector(".ortsq").value.trim();
  const ziel = box.querySelector(".orttreffer");
  const koord = /^(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(q);
  if (koord) {
    const wert = { lat: Number(koord[1]), lng: Number(koord[2]), name: q };
    ziel.innerHTML = `<button type="button" class="treffer" data-aktion="ort-waehlen" data-wert='${esc(JSON.stringify(wert))}'>📍 Koordinaten ${esc(q)} übernehmen</button>`;
    return;
  }
  if (q.length < 2) return;
  ziel.innerHTML = `<span class="leise klein">Suche …</span>`;
  try {
    const treffer = await anfrage(`/api/geo?q=${encodeURIComponent(q)}`);
    ziel.innerHTML = treffer.length
      ? treffer.map((t) => `<button type="button" class="treffer" data-aktion="ort-waehlen" data-wert='${esc(JSON.stringify({ lat: t.lat, lng: t.lng, name: t.name.split(",").slice(0, 3).join(",") }))}'>${esc(t.name)}</button>`).join("")
      : `<span class="leise klein">Nichts gefunden. Tipp: In Google Maps rechts auf den Ort klicken, die Koordinaten kopieren und hier einfügen.</span>`;
  } catch (e) {
    ziel.innerHTML = `<span class="warnung klein">${esc(e.message)}</span>`;
  }
}

export function ortAuslesen(form, feld) {
  const v = new FormData(form).get(feld);
  return v ? JSON.parse(v) : null;
}

// ---------- Fotos ----------

export const fotoUrl = (id, klein = false) => `/api/reisen/${zustand.reise.id}/fotos/${id}${klein ? "?klein=1" : ""}`;

/** Verkleinert ein Bild im Browser (spart Datenvolumen an Bord) und lädt es hoch. */
export async function fotoHochladen(datei) {
  const bild = await createImageBitmap(datei, { imageOrientation: "from-image" }).catch(() => null);
  if (!bild) throw new Error(`„${datei.name}“ ist kein lesbares Bild.`);
  const skalieren = (max, qualitaet) => {
    const f = Math.min(1, max / Math.max(bild.width, bild.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bild.width * f);
    c.height = Math.round(bild.height * f);
    c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
    return { url: c.toDataURL("image/jpeg", qualitaet), breite: c.width, hoehe: c.height };
  };
  const gross = skalieren(2048, 0.85);
  const klein = skalieren(480, 0.75);
  const { id } = await anfrage(`/api/reisen/${zustand.reise.id}/fotos`, { method: "POST", body: { gross: gross.url, klein: klein.url, breite: gross.breite, hoehe: gross.hoehe } });
  zustand.beitraege.fotos.push({ id, autorId: zustand.ich?.id });
  return id;
}

export function fotoLeiste(ids, { entfernbar = false } = {}) {
  if (!ids?.length) return "";
  return `<div class="fotoleiste">${ids
    .map((id) => `<span class="foto"><a href="${fotoUrl(id)}" target="_blank"><img loading="lazy" src="${fotoUrl(id, true)}" alt=""></a>${entfernbar ? `<button type="button" class="weg" data-aktion="foto-entfernen" data-id="${esc(id)}" aria-label="Foto entfernen">×</button>` : ""}</span>`)
    .join("")}</div>`;
}

// ---------- Sterne ----------

export function sterneText(n) {
  if (n == null) return "";
  const r = Math.round(n);
  return `<span class="sterne" aria-label="${n} von 5">${"★".repeat(r)}${"☆".repeat(5 - r)}</span>`;
}

export function sternEingabe(name, wert) {
  return `<div class="sterneingabe" role="radiogroup" aria-label="Sterne">${[5, 4, 3, 2, 1]
    .map((n) => `<label><input type="radio" name="${name}" value="${n}" ${Number(wert) === n ? "checked" : ""} required><span>★</span></label>`)
    .join("")}</div>`;
}

export function herunterladen(name, inhalt, typ) {
  const url = URL.createObjectURL(inhalt instanceof Blob ? inhalt : new Blob([inhalt], { type: typ }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
