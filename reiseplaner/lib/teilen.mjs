// Öffentliche Freigaben: Ein Link zeigt genau einen Beitrag (Bewertungen eines Ausflugs oder
// Hotels, einen Tauchgang oder den Reisebericht) – nie die übrige Reise, Kosten oder Mitreisende.
import path from "node:path";
import { DATA_DIR, lesen, aendern } from "./speicher.mjs";
import { token } from "./konten.mjs";
import { QUELLEN, KATEGORIEN, ausflugKosten, oeffentlicheFotos, tauchProfilSvg, FLUGHAFEN_ARTEN } from "../public/rechnen.js";

const FREIGABEN = path.join(DATA_DIR, "freigaben.json");
export const ARTEN = ["ausflug", "hotel", "flughafen", "tauchgang", "bericht"];

export const alleFreigaben = () => lesen(FREIGABEN, []);

export async function freigabeErstellen({ reiseId, art, zielId, vonId, mitPreis = false }) {
  return aendern(FREIGABEN, [], (liste) => {
    const vorhanden = liste.find((f) => f.reiseId === reiseId && f.art === art && f.zielId === zielId && f.aktiv);
    if (vorhanden) {
      vorhanden.mitPreis = Boolean(mitPreis);
      return vorhanden;
    }
    const f = { token: token(), reiseId, art, zielId, vonId, mitPreis: Boolean(mitPreis), aktiv: true, erstellt: new Date().toISOString(), aufrufe: 0 };
    liste.push(f);
    return f;
  });
}

export async function freigabeBeenden(t) {
  return aendern(FREIGABEN, [], (liste) => {
    const f = liste.find((x) => x.token === t);
    if (f) f.aktiv = false;
    return f;
  });
}

export async function freigabeLesen(t, zaehlen = false) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(t ?? ""))) return null;
  if (!zaehlen) return (await alleFreigaben()).find((f) => f.token === t && f.aktiv) ?? null;
  return aendern(FREIGABEN, [], (liste) => {
    const f = liste.find((x) => x.token === t && x.aktiv);
    if (f) f.aufrufe = (f.aufrufe ?? 0) + 1;
    return f ?? null;
  });
}

const vorname = (name) => String(name ?? "").trim().split(/\s+/)[0] || "Mitreisende/r";
const datumLang = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "");

/**
 * Inhalt einer Freigabe als einfaches Objekt (für die öffentliche Seite und die KI-Beitragstexte).
 * Gibt null zurück, wenn das Ziel nicht (mehr) existiert.
 */
export function inhaltFuer(reise, beitraege, benutzer, f) {
  const namen = Object.fromEntries(benutzer.map((b) => [b.id, vorname(b.name)]));
  const station = (id) => reise.haefen?.find((h) => h.id === id);
  const bewertungenVon = (zielArt, zielId) =>
    beitraege.bewertungen
      .filter((b) => b.zielArt === zielArt && b.zielId === zielId && !b.privat)
      .sort((a, b) => String(a.erstellt).localeCompare(String(b.erstellt)))
      .map((b) => ({ autor: namen[b.autorId] ?? "Mitreisende/r", sterne: b.sterne, titel: b.titel ?? "", text: b.text ?? "", fotos: oeffentlicheFotos(b), datum: b.erstellt }));
  const schnitt = (liste) => (liste.length ? Math.round((liste.reduce((s, b) => s + (Number(b.sterne) || 0), 0) / liste.length) * 10) / 10 : null);

  if (f.art === "ausflug") {
    const a = reise.ausfluege?.find((x) => x.id === f.zielId);
    if (!a) return null;
    const h = station(a.hafenId);
    const bew = bewertungenVon("ausflug", a.id);
    const k = ausflugKosten(a, reise.personen ?? []);
    return {
      art: "ausflug",
      titel: a.titel,
      unterzeile: [h?.name, h?.land, datumLang(h?.datum)].filter(Boolean).join(" · "),
      kategorie: KATEGORIEN[a.kategorie] ?? "",
      anbieter: ["sonstige", "eigene"].includes(a.quelle) ? "" : (QUELLEN[a.quelle] ?? QUELLEN.sonstige).name,
      link: f.mitPreis ? a.link ?? "" : "",
      preis: f.mitPreis && a.preisArt !== "gruppe" && a.preisErw != null ? { erw: a.preisErw, kind: a.preisKind } : f.mitPreis && a.preisArt === "gruppe" ? { gruppe: a.preisGruppe } : null,
      kostenSumme: f.mitPreis ? k.summe : null,
      dauerMin: a.dauerMin ?? null,
      ort: a.ziel?.lat != null ? a.ziel : h?.lat != null ? { lat: h.lat, lng: h.lng, name: h.name } : null,
      sterne: schnitt(bew),
      bewertungen: bew,
      fotos: bew.flatMap((b) => b.fotos),
    };
  }
  if (f.art === "flughafen") {
    const o = (reise.flughafenOrte ?? []).find((x) => x.id === f.zielId);
    if (!o) return null;
    const bew = bewertungenVon("flughafen", o.id);
    return {
      art: "flughafen",
      titel: o.name,
      unterzeile: [o.flughafen, o.terminal].filter(Boolean).join(" · "),
      kategorie: FLUGHAFEN_ARTEN[o.art] ?? "Flughafen",
      ort: null,
      sterne: schnitt(bew),
      bewertungen: bew,
      fotos: bew.flatMap((b) => b.fotos),
    };
  }
  if (f.art === "hotel") {
    const ho = reise.hotels?.find((x) => x.id === f.zielId);
    if (!ho) return null;
    const bew = bewertungenVon("hotel", ho.id);
    return {
      art: "hotel",
      titel: ho.name,
      unterzeile: [ho.ort, ho.anreise && ho.abreise ? `${datumLang(ho.anreise)} – ${datumLang(ho.abreise)}` : ""].filter(Boolean).join(" · "),
      kategorie: ho.kategorie ? `${"★".repeat(Number(ho.kategorie) || 0)} Hotel` : "Unterkunft",
      verpflegung: ho.verpflegung ?? "",
      link: f.mitPreis ? ho.link ?? "" : "",
      preis: f.mitPreis && ho.preis != null ? { hotel: ho.preis, art: ho.preisArt } : null,
      ort: ho.lat != null ? { lat: ho.lat, lng: ho.lng, name: ho.name } : null,
      sterne: schnitt(bew),
      bewertungen: bew,
      fotos: bew.flatMap((b) => b.fotos),
    };
  }
  if (f.art === "tauchgang") {
    const roh = beitraege.tauchgaenge.find((x) => x.id === f.zielId && !x.privat);
    if (!roh) return null;
    const { textPrivat, fotosPrivat, ...t } = roh;
    return {
      art: "tauchgang",
      titel: t.tauchplatz || "Tauchgang",
      unterzeile: [t.ort, datumLang(t.datum), t.basis].filter(Boolean).join(" · "),
      kategorie: "Tauchgang",
      taucher: namen[t.taucherId] ?? "",
      tauchgang: t,
      ort: t.lat != null ? { lat: t.lat, lng: t.lng, name: t.tauchplatz } : null,
      sterne: t.sterne ?? null,
      bewertungen: t.text ? [{ autor: namen[t.taucherId] ?? "", sterne: t.sterne, text: t.text, fotos: [] }] : [],
      fotos: oeffentlicheFotos(roh),
    };
  }
  if (f.art === "bericht") {
    const haefen = [...(reise.haefen ?? [])].sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    const eintraege = [];
    for (const h of haefen) {
      for (const a of (reise.ausfluege ?? []).filter((x) => x.hafenId === h.id)) {
        const bew = bewertungenVon("ausflug", a.id);
        if (bew.length) eintraege.push({ art: "ausflug", titel: a.titel, unterzeile: [h.name, datumLang(h.datum)].filter(Boolean).join(" · "), sterne: schnitt(bew), bewertungen: bew, fotos: bew.flatMap((b) => b.fotos), datum: h.datum });
      }
    }
    for (const ho of reise.hotels ?? []) {
      const bew = bewertungenVon("hotel", ho.id);
      if (bew.length) eintraege.push({ art: "hotel", titel: ho.name, unterzeile: ho.ort ?? "", sterne: schnitt(bew), bewertungen: bew, fotos: bew.flatMap((b) => b.fotos), datum: ho.anreise });
    }
    for (const o of reise.flughafenOrte ?? []) {
      const bew = bewertungenVon("flughafen", o.id);
      const v = (reise.verbindungen ?? []).find((x) => x.id === o.verbindungId);
      if (bew.length) eintraege.push({ art: "flughafen", titel: o.name, unterzeile: [o.flughafen, v?.datum ? datumLang(v.datum) : ""].filter(Boolean).join(" · "), sterne: schnitt(bew), bewertungen: bew, fotos: bew.flatMap((b) => b.fotos), datum: v?.datum ?? "" });
    }
    for (const roh of beitraege.tauchgaenge.filter((x) => !x.privat)) {
      const { textPrivat, fotosPrivat, ...t } = roh;
      eintraege.push({ art: "tauchgang", titel: t.tauchplatz || "Tauchgang", unterzeile: [t.ort, datumLang(t.datum)].filter(Boolean).join(" · "), sterne: t.sterne ?? null, tauchgang: t, taucher: namen[t.taucherId] ?? "", bewertungen: t.text ? [{ autor: namen[t.taucherId] ?? "", sterne: t.sterne, text: t.text, fotos: [] }] : [], fotos: oeffentlicheFotos(roh), datum: t.datum });
    }
    eintraege.sort((a, b) => String(a.datum ?? "").localeCompare(String(b.datum ?? "")));
    return {
      art: "bericht",
      titel: reise.name,
      unterzeile: [haefen[0]?.datum && datumLang(haefen[0].datum), haefen.at(-1)?.datum && datumLang(haefen.at(-1).datum)].filter(Boolean).join(" – "),
      kategorie: reise.art === "kreuzfahrt" ? `Kreuzfahrt${reise.schiff ? ` mit ${reise.schiff}` : ""}` : "Reisebericht",
      eintraege,
      fotos: eintraege.flatMap((e) => e.fotos),
    };
  }
  return null;
}

/** Fotos, die über diese Freigabe abrufbar sein dürfen. */
export function erlaubteFotos(inhalt) {
  return new Set(inhalt?.fotos ?? []);
}

// ---------- Öffentliche Seite ----------

const sicher = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sterneHtml = (n) => (n == null ? "" : `<span class="sterne" aria-label="${esc(n)} von 5 Sternen">${"★".repeat(Math.round(n))}${"☆".repeat(5 - Math.round(n))}</span> <span class="leise">${String(n).replace(".", ",")}</span>`);
const euro = (n) => (n == null ? "" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n));

function tauchTabelle(t) {
  const de = (n) => String(n).replace(".", ",");
  const zeilen = [
    ["Max. Tiefe", t.maxTiefe != null ? `${de(t.maxTiefe)} m` : ""],
    ["Ø Tiefe", t.mittelTiefe != null ? `${de(t.mittelTiefe)} m` : ""],
    ["Tauchzeit", t.tauchzeitMin != null ? `${t.tauchzeitMin} Min.` : ""],
    ["Wasser", t.wasserTemp != null ? `${de(t.wasserTemp)} °C` : ""],
    ["Sicht", t.sicht != null ? `${de(t.sicht)} m` : ""],
    ["Strömung", t.stroemung ?? ""],
    ["Einstieg", t.einstieg ?? ""],
    ["Gas", t.gas ? `${t.gas}${t.gas === "Nitrox" && t.nitroxProzent ? ` ${t.nitroxProzent} %` : ""}` : ""],
    ["Basis", t.basis ?? ""],
  ].filter(([, v]) => v !== "" && v != null);
  return `<dl class="tauchdaten">${zeilen.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    ${tauchProfilSvg(t.profil)}
    ${t.sichtungen ? `<p><strong>Gesehen:</strong> ${esc(t.sichtungen)}</p>` : ""}`;
}

function fotosHtml(fotos, basis) {
  if (!fotos.length) return "";
  return `<div class="galerie">${fotos.map((id) => `<a href="${basis}/foto/${esc(id)}" target="_blank"><img loading="lazy" src="${basis}/foto/${esc(id)}?klein=1" alt=""></a>`).join("")}</div>`;
}

function bewertungenHtml(liste, basis) {
  return liste
    .map(
      (b) => `<article class="bewertung">
        <div class="kopf"><strong>${esc(b.autor)}</strong> ${sterneHtml(b.sterne)}</div>
        ${b.titel ? `<h3>${esc(b.titel)}</h3>` : ""}
        ${b.text ? `<p>${esc(b.text).replace(/\n/g, "<br>")}</p>` : ""}
        ${fotosHtml(b.fotos, basis)}
      </article>`,
    )
    .join("");
}

export function seiteRendern(inhalt, f, basisUrl) {
  const basis = `/teilen/${esc(f.token)}`;
  const url = `${basisUrl}/teilen/${f.token}`;
  const bild = inhalt.fotos[0] ? `${basisUrl}/teilen/${f.token}/foto/${inhalt.fotos[0]}` : "";
  const beschreibung = [inhalt.unterzeile, inhalt.sterne != null ? `${String(inhalt.sterne).replace(".", ",")} von 5 Sternen` : ""].filter(Boolean).join(" · ");
  let haupt = "";
  if (inhalt.art === "bericht") {
    haupt = inhalt.eintraege.length
      ? inhalt.eintraege
          .map(
            (e) => `<section class="eintrag">
          <p class="kat">${e.art === "tauchgang" ? "🤿 Tauchgang" : e.art === "hotel" ? "🏨 Unterkunft" : e.art === "flughafen" ? "✈️ Flughafen" : "📍 Ausflug"}</p>
          <h2>${esc(e.titel)}</h2><p class="leise">${esc(e.unterzeile)} ${e.sterne != null ? `· ${sterneHtml(e.sterne)}` : ""}</p>
          ${e.tauchgang ? tauchTabelle(e.tauchgang) + fotosHtml(e.fotos, basis) : ""}
          ${bewertungenHtml(e.bewertungen, basis)}
        </section>`,
          )
          .join("")
      : `<p class="leise">Noch keine Bewertungen.</p>`;
  } else {
    haupt = `
      ${inhalt.preis ? `<p class="preis">${inhalt.preis.erw != null ? `${euro(inhalt.preis.erw)} pro Erwachsene/r${inhalt.preis.kind != null ? ` · ${euro(inhalt.preis.kind)} pro Kind` : ""}` : inhalt.preis.gruppe != null ? `${euro(inhalt.preis.gruppe)} pro Gruppe` : inhalt.preis.hotel != null ? `${euro(inhalt.preis.hotel)} ${inhalt.preis.art === "nacht" ? "pro Nacht" : "gesamt"}` : ""}</p>` : ""}
      ${sicher(inhalt.link) ? `<p><a href="${esc(sicher(inhalt.link))}" rel="noopener nofollow" target="_blank">Zum Angebot ↗</a></p>` : ""}
      ${inhalt.tauchgang ? tauchTabelle(inhalt.tauchgang) + fotosHtml(inhalt.fotos, basis) : ""}
      ${inhalt.ort ? `<p><a href="https://www.google.com/maps/search/?api=1&query=${inhalt.ort.lat},${inhalt.ort.lng}" target="_blank" rel="noopener">📍 Auf der Karte ansehen ↗</a></p>` : ""}
      ${inhalt.art !== "tauchgang" ? bewertungenHtml(inhalt.bewertungen, basis) || `<p class="leise">Noch keine Bewertungen.</p>` : bewertungenHtml(inhalt.bewertungen.map((b) => ({ ...b, fotos: [] })), basis)}`;
  }
  const text = encodeURIComponent(`${inhalt.titel} – ${inhalt.unterzeile}`);
  const u = encodeURIComponent(url);
  return `<!doctype html>
<html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(inhalt.titel)}</title>
<meta name="description" content="${esc(beschreibung)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(inhalt.titel)}">
<meta property="og:description" content="${esc(beschreibung)}">
<meta property="og:url" content="${esc(url)}">
${bild ? `<meta property="og:image" content="${esc(bild)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<link rel="icon" href="/icon.svg">
<style>
:root{--hg:#f4f6f9;--fl:#fff;--tx:#1c2430;--le:#5f6b7a;--ra:#dde3ea;--ak:#0b5394;--st:#e0a100;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--hg:#12161c;--fl:#1b2129;--tx:#e6eaf0;--le:#9aa6b4;--ra:#2c3540;--ak:#5aa2e8;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--hg);color:var(--tx);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 48px}a{color:var(--ak)}
.titelbild{width:100%;max-height:420px;object-fit:cover;border-radius:14px;display:block;margin-bottom:16px}
.kat{text-transform:uppercase;letter-spacing:.05em;font-size:.78rem;color:var(--ak);font-weight:700;margin:0}
h1{margin:.1em 0 .2em;font-size:1.7rem;line-height:1.2}h2{margin:.2em 0;font-size:1.25rem}h3{margin:.3em 0;font-size:1.05rem}
.leise{color:var(--le)}.sterne{color:var(--st);letter-spacing:1px}.preis{font-weight:600}
.bewertung,.eintrag{background:var(--fl);border:1px solid var(--ra);border-radius:12px;padding:14px 16px;margin:14px 0}
.eintrag .bewertung{border:0;padding:8px 0;margin:6px 0;border-top:1px solid var(--ra);border-radius:0}
.kopf{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.galerie{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-top:10px}
.galerie img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block}
.tauchdaten{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:12px 0}
.tauchdaten div{background:var(--fl);border:1px solid var(--ra);border-radius:10px;padding:8px 10px}
.tauchdaten dt{font-size:.75rem;color:var(--le);text-transform:uppercase}.tauchdaten dd{margin:0;font-weight:600}
.teilen{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}
.teilen a,.teilen button{padding:7px 12px;border-radius:99px;border:1px solid var(--ra);background:var(--fl);color:var(--tx);text-decoration:none;font:inherit;font-size:.9rem;cursor:pointer}
footer{margin-top:30px;font-size:.85rem;color:var(--le);text-align:center}
</style></head>
<body><main>
${bild ? `<img class="titelbild" src="${basis}/foto/${esc(inhalt.fotos[0])}" alt="">` : ""}
<p class="kat">${esc(inhalt.kategorie || "")}${inhalt.anbieter ? ` · ${esc(inhalt.anbieter)}` : ""}</p>
<h1>${esc(inhalt.titel)}</h1>
<p class="leise">${esc(inhalt.unterzeile)}${inhalt.taucher ? ` · Taucher/in: ${esc(inhalt.taucher)}` : ""}</p>
${inhalt.sterne != null && inhalt.art !== "bericht" ? `<p>${sterneHtml(inhalt.sterne)}</p>` : ""}
<div class="teilen">
  <button type="button" id="teilenKnopf" hidden>Teilen …</button>
  <a href="https://wa.me/?text=${text}%20${u}" target="_blank" rel="noopener">WhatsApp</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener">Facebook</a>
  <a href="https://twitter.com/intent/tweet?text=${text}&url=${u}" target="_blank" rel="noopener">X</a>
  <a href="https://pinterest.com/pin/create/button/?url=${u}&description=${text}${bild ? `&media=${encodeURIComponent(bild)}` : ""}" target="_blank" rel="noopener">Pinterest</a>
  <a href="https://t.me/share/url?url=${u}&text=${text}" target="_blank" rel="noopener">Telegram</a>
  <a href="mailto:?subject=${text}&body=${u}">E-Mail</a>
  <button type="button" id="kopieren">Link kopieren</button>
</div>
${haupt}
<footer>Geteilt mit dem Reiseplaner</footer>
</main>
<script>
const t=document.getElementById("teilenKnopf");if(navigator.share){t.hidden=false;t.onclick=()=>navigator.share({title:document.title,url:location.href}).catch(()=>{})}
document.getElementById("kopieren").onclick=async(e)=>{try{await navigator.clipboard.writeText(location.href);e.target.textContent="Kopiert ✓"}catch{prompt("Link:",location.href)}};
</script>
</body></html>`;
}

export function nichtGefundenSeite() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nicht verfügbar</title><meta name="robots" content="noindex"><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f4f6f9;color:#1c2430}@media (prefers-color-scheme:dark){body{background:#12161c;color:#e6eaf0}}</style></head><body><p>Dieser Link ist nicht (mehr) verfügbar.</p></body></html>`;
}
