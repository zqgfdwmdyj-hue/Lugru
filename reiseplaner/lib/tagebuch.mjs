// Weltkarte und öffentliches Reisetagebuch.
// Öffentlich erscheint nur, was ausdrücklich freigegeben ist: Reisen mit „oeffentlich“, davon nur
// vergangene Tage, gebuchte Ausflüge/Unterkünfte, nicht-private Bewertungen und Tauchgänge.
// Nie: Kosten, Preise, Notizen, Mitreisende, Nachnamen, Planungen in der Zukunft.
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, readdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DATA_DIR, lesen, aendern, schreiben, exklusiv } from "./speicher.mjs";
import { KATEGORIEN, oeffentlicheFotos, FLUGHAFEN_ARTEN, tauchProfilSvg } from "../public/rechnen.js";

// Jedes Konto hat sein eigenes Tagebuch (Weltkarte, nachgetragene Orte, freigegebene Reisen, eigener Link).
const ORDNER = path.join(DATA_DIR, "tagebuecher");
const ALT = path.join(DATA_DIR, "tagebuch.json"); // frühere gemeinsame Fassung – geht an das erste Verwaltungskonto
const STANDARD = path.join(DATA_DIR, "tagebuch-standard.json"); // wohin der alte Link /tagebuch zeigt
const LEER = { titel: "Unsere Reisen", text: "", orte: [], reisen: [], kennung: "" };
const ID = /^[a-z0-9-]{8,64}$/;
const datei = (userId) => {
  if (!ID.test(String(userId ?? ""))) throw Object.assign(new Error("Ungültiges Konto."), { status: 400 });
  return path.join(ORDNER, `${userId}.json`);
};
const neueKennung = () => randomBytes(12).toString("base64url");
await mkdir(ORDNER, { recursive: true });

/**
 * Tagebuch eines Kontos. migrieren: { reisen: [IDs] } – nur für das Verwaltungskonto, das die alte
 * gemeinsame Fassung übernimmt (einmalig; danach zeigt /tagebuch auf dieses Tagebuch).
 */
export async function einstellungenLesen(userId, { migrieren = null } = {}) {
  const d = datei(userId);
  return exklusiv(d, async () => {
    const e = await lesen(d, null);
    if (e?.kennung) return { ...structuredClone(LEER), ...e };
    const neu = { ...structuredClone(LEER), ...(e ?? {}), kennung: neueKennung() };
    if (migrieren) {
      await exklusiv(ALT, async () => {
        const alt = existsSync(ALT) ? await lesen(ALT, null) : null;
        if (!alt) return;
        Object.assign(neu, { titel: alt.titel || LEER.titel, text: alt.text ?? "", orte: [...(alt.orte ?? []), ...neu.orte], reisen: [...new Set([...(migrieren.reisen ?? []), ...neu.reisen])] });
        await rename(ALT, `${ALT}.uebernommen`);
        await schreiben(STANDARD, { userId, kennung: neu.kennung });
      });
    }
    await schreiben(d, neu);
    return neu;
  });
}

/** userId zu einer öffentlichen Kennung (oder der alte Link ohne Kennung). */
export async function kontoZuKennung(kennung) {
  if (!kennung) return (await lesen(STANDARD, null))?.userId ?? null;
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(kennung)) return null;
  for (const f of await readdir(ORDNER)) {
    if (!f.endsWith(".json")) continue;
    const e = await lesen(path.join(ORDNER, f), null);
    if (e?.kennung === kennung) return f.slice(0, -5);
  }
  return null;
}

export function einstellungenAendern(userId, { titel, text }) {
  return aendern(datei(userId), LEER, (e) => {
    if (titel != null) e.titel = String(titel).trim().slice(0, 120) || LEER.titel;
    if (text != null) e.text = String(text).slice(0, 2000);
    return e;
  });
}

/** Reise im eigenen öffentlichen Tagebuch zeigen oder nicht. */
export function reiseFreigeben(userId, reiseId, an) {
  return aendern(datei(userId), LEER, (e) => {
    e.reisen = (e.reisen ?? []).filter((x) => x !== reiseId);
    if (an) e.reisen.push(reiseId);
    return e.reisen;
  });
}

function ortAus(d) {
  const lat = Number(d.lat);
  const lng = Number(d.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw Object.assign(new Error("Bitte den Ort auf der Karte suchen."), { status: 400 });
  return {
    name: String(d.name ?? "").trim().slice(0, 120) || "Ort",
    land: String(d.land ?? "").trim().slice(0, 80),
    jahr: /^\d{4}$/.test(String(d.jahr ?? "")) ? String(d.jahr) : "",
    notiz: String(d.notiz ?? "").slice(0, 500),
    lat,
    lng,
  };
}

export async function ortHinzufuegen(userId, d) {
  const ort = { id: randomUUID(), ...ortAus(d) };
  return aendern(datei(userId), LEER, (e) => {
    if (e.orte.length >= 2000) throw Object.assign(new Error("Zu viele Orte."), { status: 400 });
    e.orte.push(ort);
    return ort;
  });
}

export async function ortAendern(userId, id, d) {
  const neu = ortAus(d);
  return aendern(datei(userId), LEER, (e) => {
    const o = e.orte.find((x) => x.id === id);
    if (!o) throw Object.assign(new Error("Ort nicht gefunden."), { status: 404 });
    return Object.assign(o, neu);
  });
}

export function ortLoeschen(userId, id) {
  return aendern(datei(userId), LEER, (e) => {
    e.orte = e.orte.filter((o) => o.id !== id);
  });
}

/** „Griechenland, Griechenland“ → „Griechenland“ */
const ortOhneDoppel = (ort) => [...new Set(String(ort ?? "").split(",").map((x) => x.trim()).filter(Boolean))].join(", ");
const vorname = (name) => String(name ?? "").trim().split(/\s+/)[0] || "";
const artVon = (h) => h.art ?? (h.seetag ? "seetag" : "hafen");
const mitKoord = (o) => Number.isFinite(o?.lat) && Number.isFinite(o?.lng);

/** Orte, an denen man war (vergangene Tage mit Kartenpunkt + gebuchte Unterkünfte). */
export function besuchteOrte(reise, heute) {
  const orte = [];
  for (const h of reise.haefen ?? []) {
    if (artVon(h) === "seetag" || !mitKoord(h) || !h.datum || h.datum > heute) continue;
    orte.push({ name: h.name, land: h.land ?? "", lat: h.lat, lng: h.lng, datum: h.datum, art: artVon(h), reise: reise.name, reiseId: reise.id });
  }
  for (const ho of reise.hotels ?? []) {
    if (ho.status !== "gebucht" || !mitKoord(ho) || !ho.anreise || ho.anreise > heute) continue;
    orte.push({ name: ho.name, land: "", ort: ho.ort ?? "", lat: ho.lat, lng: ho.lng, datum: ho.anreise, art: "hotel", reise: reise.name, reiseId: reise.id });
  }
  return orte;
}

/** Inhalt des öffentlichen Tagebuchs. reisen: [{ reise, beitraege }] */
export function tagebuchInhalt(reisen, benutzer, einstellungen, heute) {
  const namen = Object.fromEntries(benutzer.map((b) => [b.id, vorname(b.name)]));
  const bewertungenVon = (b, zielArt, zielId) =>
    b.bewertungen
      .filter((x) => x.zielArt === zielArt && x.zielId === zielId && !x.privat)
      .map((x) => ({ autor: namen[x.autorId] ?? "", sterne: x.sterne, titel: x.titel ?? "", text: x.text ?? "", fotos: oeffentlicheFotos(x) }));
  const schnitt = (l) => (l.length ? Math.round((l.reduce((s, x) => s + (Number(x.sterne) || 0), 0) / l.length) * 10) / 10 : null);
  const ausgabe = [];
  for (const { reise, beitraege } of reisen) {
    if (!reise.oeffentlich) continue;
    const tage = [...(reise.haefen ?? [])].filter((h) => h.datum && h.datum <= heute).sort((a, b) => a.datum.localeCompare(b.datum));
    if (!tage.length) continue;
    const tagIds = new Set(tage.map((h) => h.id));
    const station = (id) => tage.find((h) => h.id === id);
    const ausfluege = (reise.ausfluege ?? [])
      .filter((a) => a.status === "gebucht" && tagIds.has(a.hafenId))
      .map((a) => {
        const bew = bewertungenVon(beitraege, "ausflug", a.id);
        const h = station(a.hafenId);
        return { titel: a.titel, kategorie: KATEGORIEN[a.kategorie] ?? "", datum: h.datum, ort: h.name, lat: mitKoord(a.ziel) ? a.ziel.lat : h.lat ?? null, lng: mitKoord(a.ziel) ? a.ziel.lng : h.lng ?? null, sterne: schnitt(bew), bewertungen: bew };
      })
      .sort((x, y) => x.datum.localeCompare(y.datum));
    const hotels = (reise.hotels ?? [])
      .filter((ho) => ho.status === "gebucht" && ho.anreise && ho.anreise <= heute)
      .map((ho) => {
        const bew = bewertungenVon(beitraege, "hotel", ho.id);
        return { name: ho.name, ort: ho.ort ?? "", anreise: ho.anreise, abreise: ho.abreise ?? "", lat: ho.lat ?? null, lng: ho.lng ?? null, sterne: schnitt(bew), bewertungen: bew };
      });
    // Flughafen: Lounges, Restaurants, Spielplätze vergangener Flüge mit Bewertungen
    const flughafen = (reise.flughafenOrte ?? [])
      .map((o) => ({ o, v: (reise.verbindungen ?? []).find((x) => x.id === o.verbindungId) }))
      .filter(({ v }) => v?.datum && v.datum <= heute && v.status !== "verworfen")
      .map(({ o, v }) => {
        const bew = bewertungenVon(beitraege, "flughafen", o.id);
        return { name: o.name, art: o.art ?? "", flughafen: o.flughafen ?? "", datum: v.datum, sterne: schnitt(bew), bewertungen: bew };
      })
      .filter((x) => x.bewertungen.length);
    const tauchgaenge = beitraege.tauchgaenge
      .filter((t) => !t.privat && t.datum && t.datum <= heute)
      .sort((a, b) => `${a.datum}${a.beginn}`.localeCompare(`${b.datum}${b.beginn}`))
      // Öffentlich: Tauchdaten, Profil, Sichtungen, Bewertung – keine Namen von Buddy/Guide, kein Flaschendruck
      .map((t) => ({
        tauchplatz: t.tauchplatz, ort: ortOhneDoppel(t.ort), datum: t.datum, beginn: t.beginn ?? "", maxTiefe: t.maxTiefe, mittelTiefe: t.mittelTiefe ?? null, tauchzeitMin: t.tauchzeitMin,
        wasserTemp: t.wasserTemp, luftTemp: t.luftTemp ?? null, sicht: t.sicht, stroemung: t.stroemung ?? "", einstieg: t.einstieg ?? "", basis: t.basis ?? "", anzug: t.anzug ?? "",
        gas: t.gas ? `${t.gas}${t.gas === "Nitrox" && t.nitroxProzent ? ` ${t.nitroxProzent} %` : ""}` : "", profil: Array.isArray(t.profil) ? t.profil : [],
        sichtungen: t.sichtungen ?? "", sterne: t.sterne ?? null, text: t.text ?? "", taucher: namen[t.taucherId] ?? "", fotos: oeffentlicheFotos(t), lat: t.lat ?? null, lng: t.lng ?? null,
      }));
    ausgabe.push({
      name: reise.name,
      art: reise.art ?? "kreuzfahrt",
      schiff: reise.art === "kreuzfahrt" || !reise.art ? reise.schiff ?? "" : "",
      von: tage[0].datum,
      bis: tage.at(-1).datum,
      orte: besuchteOrte(reise, heute).map(({ reiseId, ...o }) => o),
      ausfluege,
      hotels,
      flughafen,
      tauchgaenge,
      // Album: nur ausdrücklich geteilte Fotos (🌍) vergangener Tage
      album: (beitraege.fotos ?? []).filter((f) => f.geteilt === true && f.art !== "kinder" && tagIds.has(f.hafenId)).map((f) => f.id),
    });
  }
  ausgabe.sort((a, b) => b.von.localeCompare(a.von));
  const orte = [
    ...ausgabe.flatMap((r) => r.orte.filter((o) => o.art !== "hotel")),
    ...einstellungen.orte.map((o) => ({ name: o.name, land: o.land, lat: o.lat, lng: o.lng, datum: o.jahr, art: "ort", reise: o.notiz })),
  ];
  const fotos = new Set();
  for (const r of ausgabe) {
    for (const x of [...r.ausfluege, ...r.hotels, ...(r.flughafen ?? [])]) for (const b of x.bewertungen) b.fotos.forEach((f) => fotos.add(f));
    for (const t of r.tauchgaenge) t.fotos.forEach((f) => fotos.add(f));
    r.album.forEach((f) => fotos.add(f));
  }
  return { titel: einstellungen.titel, text: einstellungen.text, reisen: ausgabe, orte, fotos };
}

// ---------- Öffentliche Seite ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const datum = (iso, opt = { day: "numeric", month: "long", year: "numeric" }) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", opt) : esc(iso ?? ""));
const sterne = (n) => (n == null ? "" : `<span class="sterne" aria-label="${n} von 5">${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}</span>`);

let fotoBasis = "/tagebuch";
function galerie(fotos) {
  if (!fotos?.length) return "";
  return `<div class="galerie">${fotos.map((id) => `<a href="${fotoBasis}/foto/${esc(id)}" target="_blank"><img loading="lazy" src="${fotoBasis}/foto/${esc(id)}?klein=1" alt=""></a>`).join("")}</div>`;
}

function bewertungen(liste) {
  return liste
    .map((b) => `<div class="bewertung"><div><strong>${esc(b.autor)}</strong> ${sterne(b.sterne)}</div>${b.titel ? `<div class="btitel">${esc(b.titel)}</div>` : ""}${b.text ? `<p>${esc(b.text).replace(/\n/g, "<br>")}</p>` : ""}${galerie(b.fotos)}</div>`)
    .join("");
}

const z = (n) => String(n).replace(".", ",");

/** Kurze Zusammenfassung der Tauchgänge einer Reise. */
function tauchUebersicht(liste) {
  const tiefe = Math.max(...liste.map((t) => t.maxTiefe ?? 0));
  const minuten = liste.reduce((s, t) => s + (t.tauchzeitMin ?? 0), 0);
  const temps = liste.map((t) => t.wasserTemp).filter((x) => x != null);
  return `<p class="tauchsumme">${liste.length} Tauchgänge${tiefe ? ` · tiefster ${z(tiefe)} m` : ""}${minuten ? ` · ${Math.floor(minuten / 60) ? `${Math.floor(minuten / 60)} Std. ` : ""}${minuten % 60} Min. unter Wasser` : ""}${temps.length ? ` · Wasser ${z(Math.min(...temps))}–${z(Math.max(...temps))} °C` : ""}</p>`;
}

/** Ein Tauchgang mit allen öffentlichen Daten, Tiefenprofil, Sichtungen, Bewertung und Fotos. */
function tauchgangHtml(t) {
  const daten = [
    ["Max. Tiefe", t.maxTiefe != null ? `${z(t.maxTiefe)} m` : ""],
    ["Ø Tiefe", t.mittelTiefe != null ? `${z(t.mittelTiefe)} m` : ""],
    ["Tauchzeit", t.tauchzeitMin ? `${t.tauchzeitMin} Min.` : ""],
    ["Wasser", t.wasserTemp != null ? `${z(t.wasserTemp)} °C` : ""],
    ["Luft", t.luftTemp != null ? `${z(t.luftTemp)} °C` : ""],
    ["Sicht", t.sicht != null ? `${z(t.sicht)} m` : ""],
    ["Strömung", t.stroemung],
    ["Einstieg", t.einstieg],
    ["Gas", t.gas],
    ["Anzug", t.anzug],
    ["Basis", t.basis],
  ].filter(([, w]) => w);
  return `<article class="eintrag tauchgang">
    <div class="kopf"><strong>${esc(t.tauchplatz)}</strong> ${sterne(t.sterne)} <span class="leise">${esc([t.ort, `${datum(t.datum, { day: "numeric", month: "short", year: "numeric" })}${t.beginn ? `, ${t.beginn} Uhr` : ""}`, t.taucher].filter(Boolean).join(" · "))}</span>${t.lat != null ? ` <button type="button" class="flieg klein" data-lat="${t.lat}" data-lng="${t.lng}" data-zoom="13">📍 Karte</button>` : ""}</div>
    ${daten.length ? `<dl class="tauchdaten">${daten.map(([k, w]) => `<div><dt>${esc(k)}</dt><dd>${esc(w)}</dd></div>`).join("")}</dl>` : ""}
    ${t.profil?.length ? `<div class="profil">${tauchProfilSvg(t.profil)}</div>` : ""}
    ${t.sichtungen ? `<p>🐠 <strong>Gesehen:</strong> ${esc(t.sichtungen)}</p>` : ""}
    ${t.text ? `<p>${esc(t.text)}</p>` : ""}
    ${galerie(t.fotos)}
  </article>`;
}

export function seiteRendern(inhalt, basisUrl, kachelUrl, kachelHinweis, pfad = "/tagebuch") {
  fotoBasis = pfad;
  const laender = new Set(inhalt.orte.map((o) => o.land).filter(Boolean));
  const tauchgaenge = inhalt.reisen.reduce((s, r) => s + r.tauchgaenge.length, 0);
  const ersteFoto = [...inhalt.fotos][0];
  const pins = inhalt.orte.map((o) => ({ n: o.name, l: o.land, a: o.lat, o: o.lng, d: o.datum ?? "", r: o.reise ?? "" }));
  const zahl = (n) => String(n).replace(".", ",");
  const mitKoordinaten = (x) => Number.isFinite(x?.lat) && Number.isFinite(x?.lng);
  for (const r of inhalt.reisen) {
    for (const t of r.tauchgaenge.filter(mitKoordinaten)) pins.push({ typ: "t", n: t.tauchplatz, a: t.lat, o: t.lng, d: datum(t.datum), r: [t.maxTiefe != null ? `${zahl(t.maxTiefe)} m` : "", t.tauchzeitMin ? `${t.tauchzeitMin} Min.` : "", t.sterne ? "★".repeat(t.sterne) : ""].filter(Boolean).join(" · ") });
    for (const a of r.ausfluege.filter((x) => mitKoordinaten(x) && x.bewertungen.length)) pins.push({ typ: "a", n: a.titel, a: a.lat, o: a.lng, d: datum(a.datum), r: a.sterne != null ? `${"★".repeat(Math.round(a.sterne))} ${zahl(a.sterne)}` : "" });
    for (const h of r.hotels.filter(mitKoordinaten)) pins.push({ typ: "h", n: h.name, a: h.lat, o: h.lng, d: datum(h.anreise), r: h.sterne != null ? `${"★".repeat(Math.round(h.sterne))} ${zahl(h.sterne)}` : "" });
  }
  // Gruppiert nach Land für die Liste (Klick → Karte fliegt hin)
  const nachLand = new Map();
  for (const o of inhalt.orte) {
    const k = o.land || "Weitere Orte";
    if (!nachLand.has(k)) nachLand.set(k, new Map());
    nachLand.get(k).set(o.name, o);
  }
  const laenderListe = [...nachLand.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "de"))
    .map(([land, orte]) => `<details><summary><button type="button" class="flieg" data-lat="${[...orte.values()][0].lat}" data-lng="${[...orte.values()][0].lng}" data-zoom="6">${esc(land)}</button> <span class="leise">(${orte.size})</span></summary><div class="orte">${[...orte.values()].map((o) => `<button type="button" class="flieg ort" data-lat="${o.lat}" data-lng="${o.lng}" data-zoom="11">📍 ${esc(o.name)}</button>`).join("")}</div></details>`)
    .join("");
  const reisen = inhalt.reisen
    .map(
      (r) => `<section class="reise">
      <h2>${esc(r.name)}</h2>
      <p class="leise">${datum(r.von)} – ${datum(r.bis)}${r.schiff ? ` · ${esc(r.schiff)}` : ""}</p>
      <p class="stationen">${[...new Map(r.orte.filter((o) => o.art !== "hotel").map((o) => [o.name, o])).values()].map((o) => `<button type="button" class="flieg chip" data-lat="${o.lat}" data-lng="${o.lng}" data-zoom="11">${esc(o.name)}</button>`).join("")}</p>
      ${r.flughafen?.length ? `<h3>✈️ Flughafen</h3>${r.flughafen.map((x) => `<article class="eintrag"><div class="kopf"><strong>${esc(x.name)}</strong> ${sterne(x.sterne)} <span class="leise">${esc([FLUGHAFEN_ARTEN[x.art], x.flughafen].filter(Boolean).join(" · "))} · ${datum(x.datum, { day: "numeric", month: "short" })}</span></div>${bewertungen(x.bewertungen)}</article>`).join("")}` : ""}
      ${r.hotels.length ? `<h3>🏨 Unterkünfte</h3>${r.hotels.map((h) => `<article class="eintrag"><div class="kopf"><strong>${esc(h.name)}</strong> ${sterne(h.sterne)} <span class="leise">${esc(h.ort)} · ${datum(h.anreise, { day: "numeric", month: "short" })} – ${datum(h.abreise, { day: "numeric", month: "short" })}</span>${h.lat != null ? ` <button type="button" class="flieg klein" data-lat="${h.lat}" data-lng="${h.lng}" data-zoom="13">Karte</button>` : ""}</div>${bewertungen(h.bewertungen)}</article>`).join("")}` : ""}
      ${r.ausfluege.length ? `<h3>📍 Ausflüge</h3>${r.ausfluege.map((a) => `<article class="eintrag"><div class="kopf"><strong>${esc(a.titel)}</strong> ${sterne(a.sterne)} <span class="leise">${esc(a.ort)} · ${datum(a.datum, { day: "numeric", month: "short" })}${a.kategorie ? ` · ${esc(a.kategorie)}` : ""}</span>${a.lat != null ? ` <button type="button" class="flieg klein" data-lat="${a.lat}" data-lng="${a.lng}" data-zoom="12">Karte</button>` : ""}</div>${bewertungen(a.bewertungen)}</article>`).join("")}` : ""}
      ${r.album.length ? `<h3>📷 Fotos</h3>${galerie(r.album)}` : ""}
      ${r.tauchgaenge.length ? `<h3>🤿 Tauchgänge</h3>${tauchUebersicht(r.tauchgaenge)}${r.tauchgaenge.map((t) => tauchgangHtml(t)).join("")}` : ""}
    </section>`,
    )
    .join("");
  const url = `${basisUrl}${pfad}`;
  const daten = JSON.stringify(pins).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(inhalt.titel)}</title>
<meta name="description" content="${esc(`${inhalt.orte.length} Orte in ${laender.size} Ländern`)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(inhalt.titel)}">
<meta property="og:description" content="${esc(inhalt.text || `${inhalt.orte.length} Orte in ${laender.size} Ländern`)}"><meta property="og:url" content="${esc(url)}">
${ersteFoto ? `<meta property="og:image" content="${esc(`${basisUrl}${pfad}/foto/${ersteFoto}`)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<link rel="icon" href="/icon.svg">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<style>
:root{--hg:#f4f6f9;--fl:#fff;--tx:#1c2430;--le:#5f6b7a;--ra:#dde3ea;--ak:#0b5394;--rot:#d0021b;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--hg:#12161c;--fl:#1b2129;--tx:#e6eaf0;--le:#9aa6b4;--ra:#2c3540;--ak:#5aa2e8;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--hg);color:var(--tx);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:var(--ak);color:#fff;padding:22px 16px}@media (prefers-color-scheme:dark){header{background:#0d2f52}}
header h1{margin:0;font-size:1.6rem}header p{margin:6px 0 0;opacity:.9}
.zahlen{display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;font-size:.95rem}.zahlen b{font-size:1.3rem;display:block}
main{max-width:1100px;margin:0 auto;padding:16px;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px}
@media (max-width:860px){main{grid-template-columns:1fr}}
#karte{height:60vh;min-height:320px;border-radius:12px;border:1px solid var(--ra);grid-column:1/-1}
aside,.reise{background:var(--fl);border:1px solid var(--ra);border-radius:12px;padding:14px 16px}
aside{align-self:start}aside h2{font-size:1.05rem;margin:0 0 8px}
details{border-top:1px solid var(--ra);padding:6px 0}summary{cursor:pointer}
.orte{display:flex;flex-direction:column;align-items:flex-start;padding:4px 0 4px 14px}
button.flieg{background:none;border:0;padding:2px 0;color:var(--ak);font:inherit;cursor:pointer;text-align:left}
button.flieg.chip{border:1px solid var(--ra);border-radius:99px;padding:3px 10px;margin:0 6px 6px 0;color:var(--tx)}
button.flieg.klein{font-size:.85rem;text-decoration:underline}
.inhalt{display:flex;flex-direction:column;gap:16px}h2{margin:.1em 0}h3{margin:16px 0 6px;font-size:1.05rem}
.leise{color:var(--le)}.sterne{color:#e0a100}.eintrag{border-top:1px solid var(--ra);padding:8px 0}
.kopf{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}.bewertung{margin:6px 0 6px 12px}.btitel{font-weight:600}
.galerie{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;margin-top:6px}
.galerie img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block}
.pin svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
.tauchdaten{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;margin:8px 0}.tauchdaten div{background:var(--hg);border:1px solid var(--ra);border-radius:8px;padding:6px 8px}
.tauchdaten dt{font-size:.72rem;color:var(--le);text-transform:uppercase}.tauchdaten dd{margin:0;font-weight:600}
.profil{max-width:520px;margin:6px 0;color:var(--tx)}.tauchsumme{font-weight:600;margin:4px 0 8px}
.legende{grid-column:1/-1;display:flex;gap:14px;flex-wrap:wrap;font-size:.85rem;color:var(--le);margin-top:-8px}.legende span::before{content:"";display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;background:var(--f)}
.teilen{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.teilen a,.teilen button{color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:99px;padding:4px 12px;text-decoration:none;background:none;font:inherit;font-size:.9rem;cursor:pointer}
footer{text-align:center;color:var(--le);font-size:.85rem;padding:24px}
</style></head><body>
<header>
  <h1>🌍 ${esc(inhalt.titel)}</h1>
  ${inhalt.text ? `<p>${esc(inhalt.text)}</p>` : ""}
  <div class="zahlen"><span><b>${laender.size}</b>Länder</span><span><b>${new Set(inhalt.orte.map((o) => o.name)).size}</b>Orte</span><span><b>${inhalt.reisen.length}</b>Reisen</span>${tauchgaenge ? `<span><b>${tauchgaenge}</b>Tauchgänge</span>` : ""}</div>
  <div class="teilen">
    <button type="button" id="teilenKnopf" hidden>Teilen …</button>
    <a href="https://wa.me/?text=${encodeURIComponent(`${inhalt.titel} ${url}`)}" target="_blank" rel="noopener">WhatsApp</a>
    <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener">Facebook</a>
    <button type="button" id="kopieren">Link kopieren</button>
  </div>
</header>
<main>
  <div id="karte"></div>
  <div class="legende"><span style="--f:#d0021b">Orte</span>${pins.some((p) => p.typ === "t") ? `<span style="--f:#0277bd">Tauchplätze</span>` : ""}${pins.some((p) => p.typ === "a") ? `<span style="--f:#ef6c00">Ausflüge</span>` : ""}${pins.some((p) => p.typ === "h") ? `<span style="--f:#6a1b9a">Unterkünfte</span>` : ""}</div>
  <div class="inhalt">${reisen || `<section class="reise"><p class="leise">Noch keine freigegebenen Reisen.</p></section>`}</div>
  <aside><h2>Länder &amp; Inseln</h2>${laenderListe || `<p class="leise">Noch keine Orte.</p>`}</aside>
</main>
<footer>Reisetagebuch · Karte © OpenStreetMap</footer>
<script id="pins" type="application/json">${daten}</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
const pins = JSON.parse(document.getElementById("pins").textContent);
const karte = L.map("karte", { worldCopyJump: true }).setView([25, 0], 2);
L.tileLayer(${JSON.stringify(kachelUrl)}, { maxZoom: 19, crossOrigin: true, referrerPolicy: "strict-origin-when-cross-origin", attribution: ${JSON.stringify(kachelHinweis)} }).addTo(karte);
const nadelIn = (farbe, zeichen) => L.divIcon({ className: "pin", html: '<svg width="26" height="38" viewBox="0 0 26 38"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.8 13 25 13 25s13-15.2 13-25C26 5.8 20.2 0 13 0z" fill="' + farbe + '"/>' + (zeichen ? '<text x="13" y="18" font-size="13" text-anchor="middle">' + zeichen + '</text>' : '<circle cx="13" cy="13" r="5" fill="#fff"/>') + '</svg>', iconSize: [26, 38], iconAnchor: [13, 38], popupAnchor: [0, -34] });
const nadeln = { o: nadelIn("#d0021b"), t: nadelIn("#0277bd", "🤿"), a: nadelIn("#ef6c00", "⭐"), h: nadelIn("#6a1b9a", "🏨") };
const nadel = nadeln.o;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const grenzen = [];
for (const p of pins) {
  L.marker([p.a, p.o], { icon: nadeln[p.typ] ?? nadel, zIndexOffset: p.typ ? 100 : 0 }).bindPopup("<strong>" + esc(p.n) + "</strong>" + (p.l ? ", " + esc(p.l) : "") + (p.d ? "<br>" + esc(p.d) : "") + (p.r ? "<br>" + esc(p.r) : "")).addTo(karte);
  grenzen.push([p.a, p.o]);
}
if (grenzen.length > 1) karte.fitBounds(grenzen, { padding: [30, 30], maxZoom: 8 });
else if (grenzen.length === 1) karte.setView(grenzen[0], 8);
document.addEventListener("click", (e) => {
  const b = e.target.closest("button.flieg");
  if (!b) return;
  karte.flyTo([Number(b.dataset.lat), Number(b.dataset.lng)], Number(b.dataset.zoom) || 10, { duration: 1.2 });
  document.getElementById("karte").scrollIntoView({ behavior: "smooth", block: "center" });
});
const t = document.getElementById("teilenKnopf");
if (navigator.share) { t.hidden = false; t.onclick = () => navigator.share({ title: document.title, url: location.href }).catch(() => {}); }
document.getElementById("kopieren").onclick = async (e) => { try { await navigator.clipboard.writeText(location.href); e.target.textContent = "Kopiert ✓"; } catch { prompt("Link:", location.href); } };
</script>
</body></html>`;
}
