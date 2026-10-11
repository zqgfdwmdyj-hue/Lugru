import {
  QUELLEN, STATUS, zeitZuMin, minZuZeit, dauerText, euro, zahl, istKind,
  ausflugKosten, reiseKosten, zeitplan, bewertung, entfernungKm, textZuAusfluegen,
} from "./rechnen.js";

// ---------- Zustand ----------

const zustand = {
  info: { gyg: false, gygPartnerId: "" },
  reisen: [],
  reise: null,
  ansicht: "plan",
  hafenId: null,
  sortierung: "punkte",
  gygErgebnisse: {}, // hafenId → Liste
  wetter: {}, // hafenId → Daten
  wege: {}, // Schlüssel → { km, min, linie }
};

const $ = (sel, el = document) => el.querySelector(sel);
const inhalt = $("#inhalt");
const dialog = $("#dialog");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const neueId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const datumText = (iso, opt = { weekday: "short", day: "2-digit", month: "2-digit" }) => {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("de-DE", opt);
};
const personen = () => zustand.reise?.personen ?? [];
const haefen = () => [...(zustand.reise?.haefen ?? [])].sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
const hafenVon = (id) => zustand.reise?.haefen?.find((h) => h.id === id);
const ausfluegeIn = (hafenId) => (zustand.reise?.ausfluege ?? []).filter((a) => a.hafenId === hafenId);
const hatKoord = (o) => o && Number.isFinite(o.lat) && Number.isFinite(o.lng);
const waehrung = () => zustand.reise?.waehrung || "EUR";
const geld = (n) => euro(n, waehrung());

// ---------- Server ----------

async function anfrage(pfad, optionen = {}) {
  const res = await fetch(pfad, {
    ...optionen,
    headers: { "content-type": "application/json", ...(optionen.headers ?? {}) },
    body: optionen.body && typeof optionen.body !== "string" ? JSON.stringify(optionen.body) : optionen.body,
  });
  const daten = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(daten.error ?? `Fehler ${res.status}`), { status: res.status, daten });
  return daten;
}

const LOKAL = (id) => `reiseplaner:reise:${id}`;
function lokalSichern(reise, ungespeichert) {
  try {
    localStorage.setItem(LOKAL(reise.id), JSON.stringify({ reise, ungespeichert }));
  } catch {}
}
function lokalLesen(id) {
  try {
    return JSON.parse(localStorage.getItem(LOKAL(id)) ?? "null");
  } catch {
    return null;
  }
}

let speicherTimer = null;
let speichertGerade = false;
let nochmal = false;
function speichern() {
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
    const antwort = await anfrage(`api/reisen/${reise.id}`, { method: "PUT", body: reise });
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
        alles();
      } else if (aktuell) {
        reise.version = aktuell.version;
        nochmal = true;
      }
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

function status(text, warnung = false) {
  const el = $("#speicherStatus");
  el.textContent = text;
  el.classList.toggle("warnung", warnung);
}

async function reisenLaden() {
  try {
    zustand.reisen = await anfrage("api/reisen");
  } catch {
    zustand.reisen = [];
  }
  const wahl = $("#reiseWahl");
  wahl.innerHTML = zustand.reisen.length
    ? zustand.reisen.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}${r.beginn ? ` (${datumText(r.beginn, { month: "short", year: "numeric" })})` : ""}</option>`).join("")
    : `<option value="">– noch keine Reise –</option>`;
  if (zustand.reise) wahl.value = zustand.reise.id;
}

async function reiseOeffnen(id) {
  let reise = null;
  try {
    reise = await anfrage(`api/reisen/${id}`);
    const lokal = lokalLesen(id);
    if (lokal?.ungespeichert && Number(lokal.reise.version) === Number(reise.version)) {
      reise = lokal.reise; // Offline-Änderungen übernehmen und gleich nachspeichern
      setTimeout(speichern, 100);
    }
  } catch {
    reise = lokalLesen(id)?.reise ?? null;
    if (reise) status("Offline – lokale Kopie", true);
  }
  if (!reise) return;
  zustand.reise = reise;
  zustand.hafenId = haefen().find((h) => !h.seetag)?.id ?? haefen()[0]?.id ?? null;
  try {
    localStorage.setItem("reiseplaner:letzte", id);
  } catch {}
  $("#reiseWahl").value = id;
  alles();
}

function neueReiseVorlage() {
  const p = (name, typ, alter = "") => ({ id: neueId(), name, typ, alter });
  return {
    name: "Kreuzfahrt",
    schiff: "Mein Schiff",
    waehrung: "EUR",
    personen: [p("Erwachsene/r 1", "erwachsen"), p("Erwachsene/r 2", "erwachsen"), p("Erwachsene/r 3", "erwachsen"), p("Erwachsene/r 4", "erwachsen"), p("Kind 1", "kind", 10), p("Kind 2", "kind", 7)],
    haefen: [],
    ausfluege: [],
  };
}

$("#neueReise").addEventListener("click", async () => {
  const name = prompt("Name der Reise (z. B. „Mein Schiff 4 – Kanaren“):", "Kreuzfahrt");
  if (!name) return;
  const reise = await anfrage("api/reisen", { method: "POST", body: { ...neueReiseVorlage(), name } });
  await reisenLaden();
  await reiseOeffnen(reise.id);
  ansichtWechseln("haefen");
});

$("#reiseWahl").addEventListener("change", (e) => e.target.value && reiseOeffnen(e.target.value));

$("#reiter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ansicht]");
  if (b) ansichtWechseln(b.dataset.ansicht);
});

function ansichtWechseln(ansicht) {
  zustand.ansicht = ansicht;
  for (const b of document.querySelectorAll("#reiter button")) b.classList.toggle("aktiv", b.dataset.ansicht === ansicht);
  alles();
}

// ---------- Darstellung ----------

function alles() {
  if (!zustand.reise) {
    inhalt.innerHTML = `
      <div class="leer">
        <h2>Willkommen!</h2>
        <p>Lege zuerst eine Reise an. Danach trägst du die Häfen ein, sammelst die Ausflüge vom Schiff,
        von GetYourGuide &amp; Co. und vergleichst sie auf der Karte – mit Kosten für alle Mitreisenden.</p>
        <button class="knopf" onclick="document.getElementById('neueReise').click()">+ Erste Reise anlegen</button>
      </div>`;
    karteZeichnen();
    return;
  }
  const ansichten = { plan: planAnsicht, kosten: kostenAnsicht, personen: personenAnsicht, haefen: haefenAnsicht, daten: datenAnsicht };
  inhalt.innerHTML = (ansichten[zustand.ansicht] ?? planAnsicht)();
  if (zustand.ansicht === "plan") nachPlan();
  karteZeichnen();
}

function hafenLeiste() {
  const liste = haefen();
  if (!liste.length) {
    return `<div class="hinweis">Noch keine Häfen. <button class="link" data-aktion="zu-haefen">Route eintragen →</button></div>`;
  }
  const kosten = reiseKosten(zustand.reise);
  return `<div class="hafenleiste" role="tablist">${liste
    .map((h, i) => {
      const anzahl = ausfluegeIn(h.id).filter((a) => a.status !== "verworfen").length;
      const gebucht = ausfluegeIn(h.id).some((a) => a.status === "gebucht");
      return `<button class="hafenchip ${h.id === zustand.hafenId ? "aktiv" : ""} ${h.seetag ? "seetag" : ""}" data-aktion="hafen" data-id="${esc(h.id)}">
        <span class="tag">Tag ${i + 1} · ${esc(datumText(h.datum))}</span>
        <strong>${h.seetag ? "🌊 Seetag" : esc(h.name || "Hafen")}</strong>
        ${h.seetag ? "" : `<span class="mini">${anzahl} Ausfl.${gebucht ? " · ✅" : ""}${kosten.jeHafen[h.id] ? ` · ${geld(kosten.jeHafen[h.id])}` : ""}</span>`}
      </button>`;
    })
    .join("")}</div>`;
}

function suchLinks(hafen) {
  const ort = (hafen.suchname || hafen.name || "").trim();
  const q = encodeURIComponent(ort);
  const d = hafen.datum || "";
  const gygParams = new URLSearchParams({ q: ort });
  if (d) {
    gygParams.set("date_from", d);
    gygParams.set("date_to", d);
  }
  if (zustand.info.gygPartnerId) gygParams.set("partner_id", zustand.info.gygPartnerId);
  const google = (s) => `https://www.google.com/search?q=${encodeURIComponent(s)}`;
  const links = [
    ["GetYourGuide", `https://www.getyourguide.de/s/?${gygParams}`, "getyourguide"],
    ["Viator", `https://www.viator.com/de-DE/searchResults/all?text=${q}`, "viator"],
    ["Tiqets", google(`site:tiqets.com ${ort}`), "tiqets"],
    ["Civitatis", google(`site:civitatis.com ${ort}`), "civitatis"],
    ["Klook", google(`site:klook.com ${ort} tour`), "sonstige"],
    ["ToursByLocals", google(`site:toursbylocals.com ${ort}`), "sonstige"],
    ["Tripadvisor", `https://www.tripadvisor.de/Search?q=${q}`, "sonstige"],
    ["Mein-Schiff-Ausflüge", google(`Mein Schiff Landausflüge ${ort}`), "schiff"],
    ["Auf eigene Faust", google(`${ort} Kreuzfahrt Landgang auf eigene Faust`), "eigene"],
    ["Wikivoyage", `https://de.wikivoyage.org/w/index.php?search=${q}`, "eigene"],
    ["Strände & Sehenswertes", hatKoord(hafen) ? `https://www.google.com/maps/search/Sehensw%C3%BCrdigkeiten/@${hafen.lat},${hafen.lng},12z` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Sehenswürdigkeiten ${ort}`)}`, "eigene"],
  ];
  return `<div class="links">${links
    .map(([name, url, quelle]) => `<a class="linkchip" style="--farbe:${QUELLEN[quelle].farbe}" href="${esc(url)}" target="_blank" rel="noopener">${esc(name)} ↗</a>`)
    .join("")}</div>`;
}

function planAnsicht() {
  const h = hafenVon(zustand.hafenId);
  let detail = "";
  if (h && h.seetag) {
    detail = `<div class="karte-box"><h2>🌊 Seetag – ${esc(datumText(h.datum, { weekday: "long", day: "numeric", month: "long" }))}</h2><p>Zeit fürs Schiff. Ausflüge gibt es an diesem Tag nicht.</p>${h.notiz ? `<p>${esc(h.notiz)}</p>` : ""}</div>`;
  } else if (h) {
    const landgang = zeitZuMin(h.allesAnBord || h.abfahrt) - zeitZuMin(h.ankunft);
    const liste = ausfluegeIn(h.id).map((a) => ({ a, b: bewertung(a, h, personen()) }));
    const sortierer = {
      punkte: (x, y) => y.b.punkte - x.b.punkte,
      preis: (x, y) => x.b.kosten.summe - y.b.kosten.summe,
      puffer: (x, y) => (y.b.zeit.puffer ?? -1e9) - (x.b.zeit.puffer ?? -1e9),
      dauer: (x, y) => (zahl(y.a.dauerMin) ?? 0) - (zahl(x.a.dauerMin) ?? 0),
      fahrzeit: (x, y) => (zahl(x.a.fahrzeitMin) ?? 0) - (zahl(y.a.fahrzeitMin) ?? 0),
      beginn: (x, y) => (zeitZuMin(x.a.beginn) ?? 9999) - (zeitZuMin(y.a.beginn) ?? 9999),
    };
    const statusRang = { gebucht: 0, favorit: 1, idee: 2, verworfen: 3 };
    liste.sort((x, y) => (x.a.status === "verworfen") - (y.a.status === "verworfen") || sortierer[zustand.sortierung](x, y) || statusRang[x.a.status] - statusRang[y.a.status]);
    const aktive = liste.filter((x) => x.a.status !== "verworfen");
    const besteId = aktive.length > 1 ? [...aktive].sort(sortierer.punkte)[0].a.id : null;
    const guenstigsteId = aktive.length > 1 ? [...aktive].sort(sortierer.preis)[0].a.id : null;

    detail = `
      <div class="karte-box hafenkopf">
        <div>
          <h2>${esc(h.name)}${h.land ? `<span class="leise">, ${esc(h.land)}</span>` : ""}</h2>
          <div class="zeiten">
            <span>📅 ${esc(datumText(h.datum, { weekday: "long", day: "numeric", month: "long" }))}</span>
            <span>⚓ ${esc(h.ankunft || "–")} – ${esc(h.abfahrt || "–")}</span>
            <span class="wichtig">⏰ Alle an Bord: ${esc(h.allesAnBord || "–")}</span>
            ${Number.isFinite(landgang) && landgang > 0 ? `<span>Landgang: ${dauerText(landgang)}</span>` : ""}
          </div>
          <div id="wetter" class="wetter"></div>
          ${h.notiz ? `<p class="notiz">${esc(h.notiz)}</p>` : ""}
        </div>
        <div class="kopfknoepfe">
          ${hatKoord(h) ? `<a class="knopf leise" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}">Google Maps ↗</a>` : ""}
          <button class="knopf leise" data-aktion="hafen-bearbeiten" data-id="${esc(h.id)}">Hafen bearbeiten</button>
        </div>
      </div>

      <div class="karte-box">
        <h3>Ausflüge finden in ${esc(h.name)}</h3>
        <p class="leise klein">Öffnet die Suche beim Anbieter (Datum ist bei GetYourGuide schon gesetzt). Gefundenes mit „+ Ausflug“ eintragen – Link einfügen, Preis und Dauer übernehmen.</p>
        ${suchLinks(h)}
        ${zustand.info.gyg ? `<div class="gyg"><button class="knopf leise" data-aktion="gyg-laden" data-id="${esc(h.id)}">GetYourGuide-Angebote hier anzeigen</button><div id="gygListe"></div></div>` : ""}
      </div>

      <div class="karte-box">
        <div class="zeile">
          <h3>Vergleich (${aktive.length})</h3>
          <label class="klein">Sortieren:
            <select data-aktion="sortieren">
              ${Object.entries({ punkte: "Sinnvollste zuerst", preis: "Günstigste zuerst", puffer: "Meiste Zeitreserve", beginn: "Beginn", dauer: "Längste", fahrzeit: "Kürzester Weg" })
                .map(([k, v]) => `<option value="${k}" ${zustand.sortierung === k ? "selected" : ""}>${v}</option>`)
                .join("")}
            </select>
          </label>
          <button class="knopf" data-aktion="ausflug-neu">+ Ausflug</button>
        </div>
        ${liste.length ? `<div class="ausfluege">${liste.map(({ a, b }) => ausflugKarte(a, b, h, { beste: a.id === besteId, guenstig: a.id === guenstigsteId })).join("")}</div>` : `<p class="leise">Noch keine Ausflüge für diesen Hafen. Trage die Schiffsausflüge ein (oder importiere sie unter „Import / Export“) und ergänze Angebote von GetYourGuide &amp; Co.</p>`}
      </div>`;
  } else {
    detail = `<p class="leise">Wähle oben einen Hafen.</p>`;
  }
  return `${hafenLeiste()}${detail}`;
}

function ausflugKarte(a, b, h, { beste, guenstig }) {
  const q = QUELLEN[a.quelle] ?? QUELLEN.sonstige;
  const k = b.kosten;
  const z = b.zeit;
  const pufferKlasse = z.puffer == null ? "" : z.puffer < 0 ? "rot" : a.quelle !== "schiff" && z.puffer < 60 ? "gelb" : "gruen";
  const gm = hatKoord(h) && hatKoord(a.ziel) ? `https://www.google.com/maps/dir/?api=1&origin=${h.lat},${h.lng}&destination=${a.ziel.lat},${a.ziel.lng}&travelmode=${a.verkehr === "fuss" ? "walking" : "driving"}` : "";
  const namen = personen().filter((p) => (a.teilnehmer ?? []).includes(p.id)).map((p) => p.name);
  return `
    <article class="ausflug status-${esc(a.status)}" style="--farbe:${q.farbe}">
      <div class="ausflug-kopf">
        <span class="quelle">${esc(q.name)}${a.code ? ` · ${esc(a.code)}` : ""}</span>
        ${beste ? `<span class="abzeichen gruen">★ Beste Wahl</span>` : ""}
        ${guenstig ? `<span class="abzeichen">€ Günstigste</span>` : ""}
        <select class="statuswahl" data-aktion="status" data-id="${esc(a.id)}" aria-label="Status">
          ${Object.entries(STATUS).map(([s, t]) => `<option value="${s}" ${a.status === s ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </div>
      <h4>${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.titel)} ↗</a>` : esc(a.titel)}</h4>
      <div class="werte">
        <div><span>Zeit</span><strong>${z.start != null ? `${minZuZeit(z.start)} – ${minZuZeit(z.zurueck ?? NaN)}` : "–"}</strong><em>${dauerText(zahl(a.dauerMin))}</em></div>
        <div><span>Weg ab Schiff</span><strong>${a.quelle === "schiff" ? "inklusive" : a.fahrzeitMin ? `${Math.round(a.fahrzeitMin)} Min.` : "–"}</strong><em>${a.km ? `${a.km.toFixed(1).replace(".", ",")} km` : a.quelle === "schiff" ? "Bus ab Pier" : ""}</em></div>
        <div class="${pufferKlasse}"><span>Puffer bis an Bord</span><strong>${z.puffer != null ? (z.puffer < 0 ? "−" : "") + dauerText(Math.abs(z.puffer)) : "–"}</strong></div>
        <div><span>Kosten</span><strong>${geld(k.summe)}</strong><em>${k.erwachsene} Erw. · ${k.kinder} Ki.</em></div>
        <div><span>€/Pers./Std.</span><strong>${b.proPersonStunde != null ? geld(b.proPersonStunde) : "–"}</strong><em>${a.sterne ? `★ ${String(a.sterne).replace(".", ",")}` : ""}</em></div>
        <div><span>Interesse</span><strong>${"●".repeat(zahl(a.interesse) ?? 3)}${"○".repeat(5 - (zahl(a.interesse) ?? 3))}</strong><em>${b.punkte} Pkt.</em></div>
      </div>
      ${z.warnungen.length ? `<ul class="warnungen">${z.warnungen.map((w) => `<li>⚠️ ${esc(w)}</li>`).join("")}</ul>` : ""}
      <div class="ausflug-fuss">
        <span class="klein leise">${namen.length === personen().length ? "Alle dabei" : namen.length ? esc(namen.join(", ")) : "Niemand ausgewählt"}</span>
        <span class="knoepfe">
          ${gm ? `<a class="link" href="${esc(gm)}" target="_blank" rel="noopener">Route ↗</a>` : ""}
          <button class="link" data-aktion="auf-karte" data-id="${esc(a.id)}">Karte</button>
          <button class="link" data-aktion="ausflug-bearbeiten" data-id="${esc(a.id)}">Bearbeiten</button>
        </span>
      </div>
      ${a.notiz ? `<details class="klein"><summary>Notiz</summary><p class="notiz">${esc(a.notiz)}</p></details>` : ""}
    </article>`;
}

function nachPlan() {
  const h = hafenVon(zustand.hafenId);
  if (!h || h.seetag) return;
  wetterLaden(h);
  if (zustand.gygErgebnisse[h.id]) gygZeigen(h);
  // Fehlende Fahrzeiten im Hintergrund berechnen
  for (const a of ausfluegeIn(h.id)) {
    if (a.quelle !== "schiff" && hatKoord(a.ziel) && hatKoord(h) && a.fahrzeitMin == null) wegBerechnen(a, h);
  }
}

async function wetterLaden(h) {
  const el = $("#wetter");
  if (!el || !hatKoord(h) || !h.datum) return;
  const tage = (new Date(`${h.datum}T12:00:00`) - new Date()) / 86400_000;
  if (tage > 15 || tage < -2) {
    el.innerHTML = `<span class="leise klein">Wetter: Vorhersage gibt es ab ca. 16 Tage vorher.</span>`;
    return;
  }
  if (!zustand.wetter[h.id]) {
    try {
      const p = new URLSearchParams({ latitude: h.lat, longitude: h.lng, daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunset", timezone: "auto", start_date: h.datum, end_date: h.datum });
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`).then((x) => x.json());
      zustand.wetter[h.id] = r.daily;
    } catch {
      return;
    }
  }
  const d = zustand.wetter[h.id];
  if (!d?.time?.length || !$("#wetter")) return;
  const code = d.weather_code[0];
  const symbol = code === 0 ? "☀️" : code <= 2 ? "🌤️" : code <= 3 ? "☁️" : code <= 48 ? "🌫️" : code <= 67 ? "🌧️" : code <= 77 ? "🌨️" : code <= 82 ? "🌦️" : "⛈️";
  $("#wetter").innerHTML = `${symbol} ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])} °C · Regen ${d.precipitation_probability_max[0] ?? "–"} % · Wind ${Math.round(d.wind_speed_10m_max[0])} km/h · Sonnenuntergang ${String(d.sunset[0]).slice(11, 16)}`;
}

const berechnet = new Set();
async function wegBerechnen(a, h) {
  const modus = a.verkehr === "fuss" ? "fuss" : "auto";
  const schluessel = `${a.id}:${modus}:${a.ziel.lat},${a.ziel.lng}:${h.lat},${h.lng}`;
  if (berechnet.has(schluessel)) return;
  berechnet.add(schluessel);
  try {
    const w = await anfrage(`api/route?von=${h.lat},${h.lng}&nach=${a.ziel.lat},${a.ziel.lng}&modus=${modus}`);
    zustand.wege[`${a.id}:${modus}`] = w;
    if (!a.fahrzeitManuell) a.fahrzeitMin = Math.round(w.min);
    a.km = Math.round(w.km * 10) / 10;
    speichern();
    if (zustand.ansicht === "plan" && zustand.hafenId === h.id) alles();
  } catch {
    // Kein Weg (z. B. andere Insel): Luftlinie als grobe Schätzung
    const km = entfernungKm(h, a.ziel);
    if (km != null && a.fahrzeitMin == null) {
      a.km = Math.round(km * 10) / 10;
      a.fahrzeitMin = Math.round((km / (modus === "fuss" ? 4.5 : 35)) * 60);
      speichern();
      if (zustand.ansicht === "plan") alles();
    }
  }
}

async function gygLaden(h) {
  const el = $("#gygListe");
  el.innerHTML = `<p class="leise">Lade Angebote …</p>`;
  try {
    const p = new URLSearchParams({ datum: h.datum || "" });
    if (hatKoord(h)) {
      p.set("lat", h.lat);
      p.set("lng", h.lng);
    } else p.set("q", h.suchname || h.name);
    zustand.gygErgebnisse[h.id] = await anfrage(`api/gyg?${p}`);
    gygZeigen(h);
    karteZeichnen();
  } catch (e) {
    el.innerHTML = `<p class="warnung">${esc(e.message)}</p>`;
  }
}

function gygZeigen(h) {
  const el = $("#gygListe");
  const liste = zustand.gygErgebnisse[h.id] ?? [];
  if (!el) return;
  if (!liste.length) {
    el.innerHTML = `<p class="leise">Keine Angebote gefunden.</p>`;
    return;
  }
  const vorhanden = new Set(ausfluegeIn(h.id).map((a) => a.gygId).filter(Boolean));
  el.innerHTML = `<div class="gygliste">${liste
    .map(
      (t, i) => `<div class="gygzeile">
        <div><a href="${esc(t.link)}" target="_blank" rel="noopener">${esc(t.titel)} ↗</a>
        <div class="klein leise">${t.preis != null ? `ab ${geld(t.preis)}${t.preisHinweis ? ` ${esc(t.preisHinweis)}` : ""}` : ""}${t.dauerMin ? ` · ${dauerText(t.dauerMin)}` : ""}${t.sterne ? ` · ★ ${t.sterne.toFixed(1).replace(".", ",")} (${t.bewertungen})` : ""}${t.abholung ? " · Abholung" : ""}</div></div>
        ${vorhanden.has(t.id) ? `<span class="klein leise">übernommen</span>` : `<button class="knopf leise" data-aktion="gyg-uebernehmen" data-i="${i}">Übernehmen</button>`}
      </div>`,
    )
    .join("")}</div>`;
}

function kostenAnsicht() {
  const r = zustand.reise;
  const k = reiseKosten(r);
  const ps = personen();
  const zeilenHafen = haefen()
    .filter((h) => !h.seetag)
    .map((h) => {
      const gewaehlt = ausfluegeIn(h.id).filter((a) => a.status === "gebucht" || a.status === "favorit");
      return `<tr><td>${esc(datumText(h.datum))}</td><td>${esc(h.name)}</td><td>${gewaehlt.map((a) => `${esc(a.titel)} <span class="leise klein">(${STATUS[a.status]}, ${geld(ausflugKosten(a, ps).summe)})</span>`).join("<br>") || `<span class="leise">–</span>`}</td><td class="zahl">${geld(k.jeHafen[h.id] ?? 0)}</td></tr>`;
    })
    .join("");
  return `
    <div class="kacheln">
      <div class="kachel"><span>Gebucht</span><strong>${geld(k.gebucht)}</strong></div>
      <div class="kachel"><span>Gebucht + Favoriten</span><strong>${geld(k.geplant)}</strong></div>
      <div class="kachel"><span>Je Person (Ø)</span><strong>${geld(ps.length ? k.geplant / ps.length : 0)}</strong></div>
    </div>
    <div class="karte-box">
      <h3>Je Hafen</h3>
      <p class="leise klein">Gezählt werden Ausflüge mit Status „Gebucht“ oder „Favorit“.</p>
      <div class="tabelle"><table><thead><tr><th>Tag</th><th>Hafen</th><th>Ausflüge</th><th class="zahl">Summe</th></tr></thead>
      <tbody>${zeilenHafen || `<tr><td colspan="4" class="leise">Noch keine Häfen</td></tr>`}</tbody>
      <tfoot><tr><th colspan="3">Gesamt</th><th class="zahl">${geld(k.geplant)}</th></tr></tfoot></table></div>
    </div>
    <div class="karte-box">
      <h3>Je Person</h3>
      <div class="tabelle"><table><thead><tr><th>Name</th><th></th><th class="zahl">Anteil</th></tr></thead>
      <tbody>${ps.map((p) => `<tr><td>${esc(p.name)}</td><td class="leise">${istKind(p) ? `Kind${p.alter ? `, ${esc(p.alter)} J.` : ""}` : "Erwachsen"}</td><td class="zahl">${geld(k.jePerson[p.id] ?? 0)}</td></tr>`).join("")}</tbody></table></div>
      <p class="leise klein">Gruppenpreise und Zusatzkosten werden gleichmäßig auf die Teilnehmenden verteilt.</p>
    </div>
    <div class="karte-box">
      <h3>Je Anbieter</h3>
      <div class="tabelle"><table><tbody>${Object.entries(k.jeQuelle).map(([q, s]) => `<tr><td><span class="punkt" style="--farbe:${(QUELLEN[q] ?? QUELLEN.sonstige).farbe}"></span>${esc((QUELLEN[q] ?? QUELLEN.sonstige).name)}</td><td class="zahl">${geld(s)}</td></tr>`).join("") || `<tr><td class="leise">–</td></tr>`}</tbody></table></div>
    </div>`;
}

function personenAnsicht() {
  const ps = personen();
  return `
    <div class="karte-box">
      <h3>Mitreisende (${ps.filter((p) => !istKind(p)).length} Erwachsene, ${ps.filter(istKind).length} Kinder)</h3>
      <p class="leise klein">Das Alter der Kinder zählt für Kinderpreise („kostenlos unter … Jahren“). Wer bei einem Ausflug nicht mitkommt, wählst du im Ausflug selbst ab.</p>
      <div class="personen">
        ${ps
          .map(
            (p) => `<div class="person" data-id="${esc(p.id)}">
          <input data-feld="name" value="${esc(p.name)}" aria-label="Name">
          <select data-feld="typ" aria-label="Erwachsen oder Kind"><option value="erwachsen" ${!istKind(p) ? "selected" : ""}>Erwachsen</option><option value="kind" ${istKind(p) ? "selected" : ""}>Kind</option></select>
          <input data-feld="alter" type="number" min="0" max="17" value="${esc(p.alter ?? "")}" placeholder="Alter" aria-label="Alter" ${istKind(p) ? "" : "disabled"}>
          <button class="link rot" data-aktion="person-loeschen" data-id="${esc(p.id)}">Entfernen</button>
        </div>`,
          )
          .join("")}
      </div>
      <div class="zeile">
        <button class="knopf leise" data-aktion="person-neu" data-typ="erwachsen">+ Erwachsene/r</button>
        <button class="knopf leise" data-aktion="person-neu" data-typ="kind">+ Kind</button>
      </div>
    </div>`;
}

function haefenAnsicht() {
  const r = zustand.reise;
  return `
    <div class="karte-box">
      <h3>Reise</h3>
      <div class="formular zwei">
        <label>Name<input data-reise="name" value="${esc(r.name)}"></label>
        <label>Schiff<input data-reise="schiff" value="${esc(r.schiff ?? "")}" placeholder="z. B. Mein Schiff 4"></label>
      </div>
    </div>
    <div class="karte-box">
      <div class="zeile"><h3>Route</h3><button class="knopf" data-aktion="hafen-neu">+ Hafen / Seetag</button></div>
      <p class="leise klein">Die Zeiten stehen im Reiseplan bzw. in der Mein-Schiff-App. „Alle an Bord“ ist meist 30 Min. vor Abfahrt.</p>
      <div class="tabelle"><table class="haefen">
        <thead><tr><th>Datum</th><th>Hafen</th><th>Ankunft</th><th>Abfahrt</th><th>Alle an Bord</th><th>Karte</th><th></th></tr></thead>
        <tbody>${haefen()
          .map(
            (h) => `<tr>
            <td>${esc(datumText(h.datum))}</td>
            <td>${h.seetag ? "🌊 Seetag" : esc(h.name)}</td>
            <td>${esc(h.ankunft ?? "")}</td><td>${esc(h.abfahrt ?? "")}</td><td>${esc(h.allesAnBord ?? "")}</td>
            <td>${h.seetag ? "" : hatKoord(h) ? "✓" : `<span class="warnung">fehlt</span>`}</td>
            <td><button class="link" data-aktion="hafen-bearbeiten" data-id="${esc(h.id)}">Bearbeiten</button></td>
          </tr>`,
          )
          .join("") || `<tr><td colspan="7" class="leise">Noch keine Häfen eingetragen.</td></tr>`}</tbody>
      </table></div>
    </div>
    <div class="karte-box">
      <h3>Reise löschen</h3>
      <button class="knopf gefahr" data-aktion="reise-loeschen">Diese Reise löschen</button>
    </div>`;
}

function datenAnsicht() {
  const hs = haefen().filter((h) => !h.seetag);
  return `
    <div class="karte-box">
      <h3>Schiffsausflüge übernehmen (Mein Schiff)</h3>
      <p class="leise klein">In der Mein-Schiff-App bzw. auf meinschiff.com die Ausflüge eines Hafens markieren, kopieren und hier einfügen.
      Jeder Ausflug in einem eigenen Absatz (Leerzeile dazwischen); erste Zeile = Titel. Erkannt werden Preise
      (Erwachsene/Kinder), Dauer („ca. 4 Std.“) und Beginn („09:30 Uhr“). Du siehst vor dem Übernehmen eine Vorschau.</p>
      <label>Hafen <select id="importHafen">${hs.map((h) => `<option value="${esc(h.id)}" ${h.id === zustand.hafenId ? "selected" : ""}>${esc(datumText(h.datum))} – ${esc(h.name)}</option>`).join("")}</select></label>
      <textarea id="importText" rows="10" placeholder="Inselrundfahrt mit Weinprobe&#10;ca. 4,5 Std. · ab 09:00 Uhr&#10;Erwachsene 69 € · Kinder 49 €&#10;&#10;Altstadt zu Fuß&#10;ca. 2 Std.&#10;39 €"></textarea>
      <div class="zeile"><button class="knopf leise" data-aktion="import-vorschau">Vorschau</button></div>
      <div id="importVorschau"></div>
    </div>
    <div class="karte-box">
      <h3>Tabelle (CSV, z. B. aus Excel)</h3>
      <p class="leise klein">Spalten (Semikolon getrennt): <code>Datum;Hafen;Titel;Anbieter;Beginn;Dauer (Min);Preis Erw;Preis Kind;Link;Status</code>. Häfen werden über Datum + Name zugeordnet.</p>
      <div class="zeile">
        <button class="knopf leise" data-aktion="csv-export">Ausflüge als CSV</button>
        <label class="knopf leise">CSV importieren<input type="file" accept=".csv,text/csv" id="csvDatei" hidden></label>
      </div>
    </div>
    <div class="karte-box">
      <h3>Sicherung</h3>
      <div class="zeile">
        <button class="knopf leise" data-aktion="json-export">Ganze Reise herunterladen (JSON)</button>
        <label class="knopf leise">Reise aus JSON laden<input type="file" accept=".json,application/json" id="jsonDatei" hidden></label>
        <button class="knopf leise" onclick="window.print()">Drucken</button>
      </div>
    </div>`;
}

// ---------- Karte ----------

let karte = null;
let ebene = null;
const kartenMarker = {};

function karteInit() {
  if (karte || !window.L) return;
  karte = L.map("karte", { zoomControl: true }).setView([40, 10], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(karte);
  ebene = L.layerGroup().addTo(karte);
}

const icon = (farbe, text = "", gross = false) =>
  L.divIcon({
    className: "pin",
    html: `<span style="--farbe:${farbe}" class="${gross ? "gross" : ""}">${esc(text)}</span>`,
    iconSize: gross ? [30, 30] : [24, 24],
    iconAnchor: gross ? [15, 15] : [12, 12],
  });

function karteZeichnen() {
  karteInit();
  if (!karte) return;
  ebene.clearLayers();
  for (const k of Object.keys(kartenMarker)) delete kartenMarker[k];
  const legende = $("#legende");
  if (!zustand.reise) {
    legende.innerHTML = "";
    return;
  }
  const liste = haefen().filter((h) => !h.seetag && hatKoord(h));
  // Schiffsroute
  if (liste.length > 1) L.polyline(liste.map((h) => [h.lat, h.lng]), { color: "#0b5394", weight: 2, dashArray: "6 6", opacity: 0.7 }).addTo(ebene);
  const alleTage = haefen();
  for (const h of liste) {
    const nr = alleTage.indexOf(h) + 1;
    const aktiv = h.id === zustand.hafenId;
    L.marker([h.lat, h.lng], { icon: icon(aktiv ? "#d0021b" : "#0b5394", String(nr), true), zIndexOffset: aktiv ? 1000 : 0 })
      .bindTooltip(`Tag ${nr}: ${esc(h.name)}`)
      .on("click", () => {
        zustand.hafenId = h.id;
        if (zustand.ansicht !== "plan") ansichtWechseln("plan");
        else alles();
      })
      .addTo(ebene);
  }
  const h = hafenVon(zustand.hafenId);
  const grenzen = [];
  const verwendet = new Set();
  if (h && hatKoord(h) && !h.seetag) {
    grenzen.push([h.lat, h.lng]);
    for (const a of ausfluegeIn(h.id)) {
      if (!hatKoord(a.ziel) || a.status === "verworfen") continue;
      const q = QUELLEN[a.quelle] ?? QUELLEN.sonstige;
      verwendet.add(a.quelle);
      const k = ausflugKosten(a, personen());
      const z = zeitplan(a, h);
      const m = L.marker([a.ziel.lat, a.ziel.lng], { icon: icon(q.farbe, a.status === "gebucht" ? "✓" : a.status === "favorit" ? "★" : "") })
        .bindPopup(
          `<strong>${esc(a.titel)}</strong><br>${esc(q.name)} · ${STATUS[a.status]}<br>${geld(k.summe)} · ${dauerText(zahl(a.dauerMin))}${a.fahrzeitMin && a.quelle !== "schiff" ? `<br>Weg: ${Math.round(a.fahrzeitMin)} Min. je Richtung` : ""}${z.puffer != null ? `<br>Puffer: ${z.puffer < 0 ? "−" : ""}${dauerText(Math.abs(z.puffer))}` : ""}<br><a href="https://www.google.com/maps/dir/?api=1&origin=${h.lat},${h.lng}&destination=${a.ziel.lat},${a.ziel.lng}" target="_blank" rel="noopener">In Google Maps öffnen ↗</a>`,
        )
        .addTo(ebene);
      kartenMarker[a.id] = m;
      grenzen.push([a.ziel.lat, a.ziel.lng]);
      const weg = zustand.wege[`${a.id}:${a.verkehr === "fuss" ? "fuss" : "auto"}`];
      if (weg?.linie) L.polyline(weg.linie, { color: q.farbe, weight: 4, opacity: 0.75 }).addTo(ebene);
      else if (a.quelle !== "schiff") wegNachladen(a, h);
      else L.polyline([[h.lat, h.lng], [a.ziel.lat, a.ziel.lng]], { color: q.farbe, weight: 2, opacity: 0.6, dashArray: "2 6" }).addTo(ebene);
    }
    for (const t of zustand.gygErgebnisse[h.id] ?? []) {
      if (t.lat == null) continue;
      L.circleMarker([t.lat, t.lng], { radius: 5, color: QUELLEN.getyourguide.farbe, weight: 1, fillOpacity: 0.5 })
        .bindPopup(`<strong>${esc(t.titel)}</strong><br>${t.preis != null ? `ab ${geld(t.preis)}` : ""} ${t.dauerMin ? `· ${dauerText(t.dauerMin)}` : ""}<br><a href="${esc(t.link)}" target="_blank" rel="noopener">GetYourGuide ↗</a>`)
        .addTo(ebene);
    }
  }
  legende.innerHTML = [`<span><span class="punkt" style="--farbe:#0b5394"></span>Häfen / Route</span>`, ...[...verwendet].map((q) => `<span><span class="punkt" style="--farbe:${QUELLEN[q].farbe}"></span>${esc(QUELLEN[q].name)}</span>`), `<span>✓ gebucht · ★ Favorit</span>`].join("");
  if (grenzen.length > 1) karte.fitBounds(grenzen, { padding: [30, 30], maxZoom: 14 });
  else if (grenzen.length === 1) karte.setView(grenzen[0], 12);
  else if (liste.length > 1) karte.fitBounds(liste.map((x) => [x.lat, x.lng]), { padding: [30, 30] });
  else if (liste.length === 1) karte.setView([liste[0].lat, liste[0].lng], 10);
  setTimeout(() => karte.invalidateSize(), 50);
}

const ladeWege = new Set();
async function wegNachladen(a, h) {
  const modus = a.verkehr === "fuss" ? "fuss" : "auto";
  const s = `${a.id}:${modus}`;
  if (ladeWege.has(s)) return;
  ladeWege.add(s);
  try {
    zustand.wege[s] = await anfrage(`api/route?von=${h.lat},${h.lng}&nach=${a.ziel.lat},${a.ziel.lng}&modus=${modus}`);
    if (zustand.hafenId === h.id) karteZeichnen();
  } catch {
    zustand.wege[s] = { linie: [[h.lat, h.lng], [a.ziel.lat, a.ziel.lng]] };
  }
}

// ---------- Dialoge ----------

function ortsSuche(feldname, wert) {
  return `<div class="ortssuche" data-ort="${feldname}">
    <div class="zeile eng"><input type="search" placeholder="Ort suchen, z. B. „Teide Nationalpark“ oder „28.27, -16.64“" class="ortsq"><button type="button" class="knopf leise" data-aktion="ort-suchen">Suchen</button></div>
    <div class="orttreffer"></div>
    <div class="klein leise ortswert">${hatKoord(wert) ? `📍 ${esc(wert.name ?? "")} (${wert.lat.toFixed(4)}, ${wert.lng.toFixed(4)})` : "Noch kein Ort gewählt"}</div>
    <input type="hidden" name="${feldname}" value="${esc(hatKoord(wert) ? JSON.stringify(wert) : "")}">
  </div>`;
}

function hafenDialog(id) {
  const neu = !id;
  const letzter = haefen().at(-1);
  const naechsterTag = letzter?.datum ? new Date(new Date(`${letzter.datum}T12:00:00`).getTime() + 86400_000).toISOString().slice(0, 10) : "";
  const h = id ? hafenVon(id) : { id: neueId(), datum: naechsterTag, name: "", ankunft: "08:00", abfahrt: "18:00", allesAnBord: "17:30", seetag: false };
  dialog.innerHTML = `<form method="dialog" class="formular" id="hafenForm">
    <h3>${neu ? "Hafen hinzufügen" : "Hafen bearbeiten"}</h3>
    <div class="formular zwei">
      <label>Datum<input type="date" name="datum" value="${esc(h.datum)}" required></label>
      <label class="haken"><input type="checkbox" name="seetag" ${h.seetag ? "checked" : ""}> Seetag</label>
      <label>Hafen / Insel<input name="name" value="${esc(h.name)}" placeholder="z. B. Santa Cruz de Tenerife"></label>
      <label>Land<input name="land" value="${esc(h.land ?? "")}"></label>
      <label>Ankunft<input type="time" name="ankunft" value="${esc(h.ankunft ?? "")}"></label>
      <label>Abfahrt<input type="time" name="abfahrt" value="${esc(h.abfahrt ?? "")}"></label>
      <label>Alle an Bord<input type="time" name="allesAnBord" value="${esc(h.allesAnBord ?? "")}"></label>
      <label>Suchbegriff für Anbieter<input name="suchname" value="${esc(h.suchname ?? "")}" placeholder="z. B. Teneriffa (statt Hafenname)"></label>
    </div>
    <label>Liegeplatz / Pier auf der Karte</label>
    ${ortsSuche("ort", hatKoord(h) ? { lat: h.lat, lng: h.lng, name: h.ortName ?? h.name } : null)}
    <label>Notiz<textarea name="notiz" rows="2">${esc(h.notiz ?? "")}</textarea></label>
    <div class="zeile">
      ${neu ? "" : `<button type="button" class="knopf gefahr" data-aktion="hafen-loeschen" data-id="${esc(h.id)}">Löschen</button>`}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
  </form>`;
  dialog.showModal();
  if (!hatKoord(h) && h.name) $(".ortsq", dialog).value = h.name;
  $("#hafenForm").addEventListener("submit", (e) => {
    const f = new FormData(e.target);
    const ort = f.get("ort") ? JSON.parse(f.get("ort")) : null;
    Object.assign(h, {
      datum: f.get("datum"),
      seetag: f.get("seetag") === "on",
      name: String(f.get("name")).trim(),
      land: String(f.get("land")).trim(),
      ankunft: f.get("ankunft"),
      abfahrt: f.get("abfahrt"),
      allesAnBord: f.get("allesAnBord"),
      suchname: String(f.get("suchname")).trim(),
      notiz: f.get("notiz"),
      lat: ort?.lat ?? null,
      lng: ort?.lng ?? null,
      ortName: ort?.name ?? "",
    });
    if (!h.name && h.seetag) h.name = "Seetag";
    if (neu) zustand.reise.haefen.push(h);
    if (!zustand.hafenId || neu) zustand.hafenId = h.id;
    // Fahrzeiten der Ausflüge neu berechnen, wenn sich der Pier geändert hat
    for (const a of ausfluegeIn(h.id)) if (!a.fahrzeitManuell) a.fahrzeitMin = null;
    speichern();
    alles();
  });
}

function ausflugDialog(id, vorlage = {}) {
  const neu = !id;
  const a = id
    ? zustand.reise.ausfluege.find((x) => x.id === id)
    : { id: neueId(), hafenId: zustand.hafenId, quelle: "schiff", status: "idee", preisArt: "person", teilnehmer: personen().map((p) => p.id), interesse: 3, verkehr: "auto", ...vorlage };
  const hs = haefen().filter((h) => !h.seetag);
  dialog.innerHTML = `<form method="dialog" class="formular" id="ausflugForm">
    <h3>${neu ? "Ausflug hinzufügen" : "Ausflug bearbeiten"}</h3>
    <label>Titel<input name="titel" value="${esc(a.titel ?? "")}" required placeholder="z. B. Teide-Nationalpark mit Seilbahn"></label>
    <div class="formular drei">
      <label>Hafen<select name="hafenId">${hs.map((h) => `<option value="${esc(h.id)}" ${h.id === a.hafenId ? "selected" : ""}>${esc(datumText(h.datum))} – ${esc(h.name)}</option>`).join("")}</select></label>
      <label>Anbieter<select name="quelle">${Object.entries(QUELLEN).map(([k, q]) => `<option value="${k}" ${a.quelle === k ? "selected" : ""}>${esc(q.name)}</option>`).join("")}</select></label>
      <label>Status<select name="status">${Object.entries(STATUS).map(([k, t]) => `<option value="${k}" ${a.status === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    </div>
    <div class="formular zwei">
      <label>Link zum Angebot<input name="link" type="url" value="${esc(a.link ?? "")}" placeholder="https://…"></label>
      <label>Ausflugs-Nr. / Code<input name="code" value="${esc(a.code ?? "")}"></label>
    </div>
    <div class="formular drei">
      <label>Beginn<input type="time" name="beginn" value="${esc(a.beginn ?? "")}"></label>
      <label>Dauer (Std.)<input name="dauerStd" inputmode="decimal" value="${a.dauerMin ? String(Math.round((a.dauerMin / 60) * 100) / 100).replace(".", ",") : ""}" placeholder="z. B. 4,5"></label>
      <label>Interesse<select name="interesse">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(a.interesse ?? 3) === n ? "selected" : ""}>${"●".repeat(n)}${"○".repeat(5 - n)}</option>`).join("")}</select></label>
    </div>
    <fieldset>
      <legend>Preis</legend>
      <div class="formular drei">
        <label>Abrechnung<select name="preisArt"><option value="person" ${a.preisArt !== "gruppe" ? "selected" : ""}>pro Person</option><option value="gruppe" ${a.preisArt === "gruppe" ? "selected" : ""}>pro Gruppe / Fahrzeug</option></select></label>
        <label class="nur-person">Erwachsene (€)<input name="preisErw" inputmode="decimal" value="${esc(a.preisErw ?? "")}"></label>
        <label class="nur-person">Kinder (€)<input name="preisKind" inputmode="decimal" value="${esc(a.preisKind ?? "")}" placeholder="leer = wie Erw."></label>
        <label class="nur-person">Kinder gratis unter (Jahre)<input name="kostenlosBis" inputmode="numeric" value="${esc(a.kostenlosBis ?? "")}"></label>
        <label class="nur-gruppe">Gruppenpreis (€)<input name="preisGruppe" inputmode="decimal" value="${esc(a.preisGruppe ?? "")}"></label>
        <label>Zusatzkosten gesamt (€)<input name="zusatzkosten" inputmode="decimal" value="${esc(a.zusatzkosten ?? "")}" placeholder="Taxi, Eintritt …"></label>
        <label>Bewertung (Sterne)<input name="sterne" inputmode="decimal" value="${esc(a.sterne ?? "")}" placeholder="z. B. 4,7"></label>
      </div>
    </fieldset>
    <fieldset>
      <legend>Wer kommt mit?</legend>
      <div class="teilnehmer">${personen().map((p) => `<label class="haken"><input type="checkbox" name="teilnehmer" value="${esc(p.id)}" ${(a.teilnehmer ?? []).includes(p.id) ? "checked" : ""}> ${esc(p.name)}${istKind(p) ? ` <span class="leise">(Kind${p.alter ? `, ${esc(p.alter)}` : ""})</span>` : ""}</label>`).join("")}</div>
      <div class="vorschau" id="kostenVorschau"></div>
    </fieldset>
    <fieldset>
      <legend>Ziel / Treffpunkt auf der Karte</legend>
      ${ortsSuche("ziel", a.ziel)}
      <div class="formular drei">
        <label>Weg ab Schiff<select name="verkehr"><option value="auto" ${a.verkehr !== "fuss" ? "selected" : ""}>Auto / Taxi / Bus</option><option value="fuss" ${a.verkehr === "fuss" ? "selected" : ""}>zu Fuß</option></select></label>
        <label>Fahrzeit je Richtung (Min.)<input name="fahrzeitMin" inputmode="numeric" value="${esc(a.fahrzeitManuell ? a.fahrzeitMin : "")}" placeholder="${a.fahrzeitMin != null && !a.fahrzeitManuell ? `automatisch: ${Math.round(a.fahrzeitMin)}` : "automatisch"}"></label>
      </div>
      <p class="klein leise">Bei Schiffsausflügen ist der Transfer in der Dauer enthalten – und das Schiff wartet, falls der Bus sich verspätet. Bei allen anderen Anbietern rechnet der Planer Hin- und Rückweg dazu.</p>
    </fieldset>
    <label>Notiz<textarea name="notiz" rows="3">${esc(a.notiz ?? "")}</textarea></label>
    <div class="zeile">
      ${neu ? "" : `<button type="button" class="knopf gefahr" data-aktion="ausflug-loeschen" data-id="${esc(a.id)}">Löschen</button>`}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
  </form>`;
  dialog.showModal();
  const form = $("#ausflugForm");
  const auslesen = () => {
    const f = new FormData(form);
    const ziel = f.get("ziel") ? JSON.parse(f.get("ziel")) : null;
    const fahrzeit = zahl(f.get("fahrzeitMin"));
    const dauerStd = zahl(f.get("dauerStd"));
    return {
      titel: String(f.get("titel")).trim(),
      hafenId: f.get("hafenId"),
      quelle: f.get("quelle"),
      status: f.get("status"),
      link: String(f.get("link")).trim(),
      code: String(f.get("code")).trim(),
      beginn: f.get("beginn"),
      dauerMin: dauerStd != null ? Math.round(dauerStd * 60) : null,
      interesse: Number(f.get("interesse")),
      preisArt: f.get("preisArt"),
      preisErw: zahl(f.get("preisErw")),
      preisKind: zahl(f.get("preisKind")),
      kostenlosBis: zahl(f.get("kostenlosBis")),
      preisGruppe: zahl(f.get("preisGruppe")),
      zusatzkosten: zahl(f.get("zusatzkosten")),
      sterne: zahl(f.get("sterne")),
      teilnehmer: f.getAll("teilnehmer"),
      ziel,
      verkehr: f.get("verkehr"),
      fahrzeitManuell: fahrzeit != null,
      fahrzeitWert: fahrzeit,
      notiz: f.get("notiz"),
    };
  };
  const vorschau = () => {
    const w = auslesen();
    form.classList.toggle("gruppe", w.preisArt === "gruppe");
    const k = ausflugKosten(w, personen());
    $("#kostenVorschau").innerHTML = `<strong>${geld(k.summe)}</strong> für ${k.erwachsene} Erwachsene und ${k.kinder} Kinder`;
  };
  form.addEventListener("input", vorschau);
  vorschau();
  form.addEventListener("submit", () => {
    const w = auslesen();
    const zielGeaendert = JSON.stringify(w.ziel) !== JSON.stringify(a.ziel ?? null) || w.verkehr !== a.verkehr || w.hafenId !== a.hafenId;
    const warManuell = a.fahrzeitManuell;
    const { fahrzeitWert, ...rest } = w;
    Object.assign(a, rest);
    // Manuelle Fahrzeit gilt; sonst bei neuem Ziel (oder wenn sie gerade geleert wurde) neu berechnen.
    if (w.fahrzeitManuell) a.fahrzeitMin = fahrzeitWert;
    else if (zielGeaendert || warManuell || !hatKoord(a.ziel)) a.fahrzeitMin = null;
    if (zielGeaendert || !hatKoord(a.ziel)) a.km = null;
    if (neu) zustand.reise.ausfluege.push(a);
    zustand.hafenId = a.hafenId;
    speichern();
    alles();
  });
}

// ---------- Ereignisse ----------

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-aktion]");
  if (!el || el.tagName === "SELECT") return;
  const { aktion, id } = el.dataset;
  const r = zustand.reise;
  switch (aktion) {
    case "hafen":
      zustand.hafenId = id;
      alles();
      break;
    case "zu-haefen":
      ansichtWechseln("haefen");
      break;
    case "hafen-neu":
      hafenDialog(null);
      break;
    case "hafen-bearbeiten":
      hafenDialog(id);
      break;
    case "hafen-loeschen": {
      const anzahl = ausfluegeIn(id).length;
      if (!confirm(`Hafen löschen?${anzahl ? ` Die ${anzahl} Ausflüge dort werden mit gelöscht.` : ""}`)) return;
      r.haefen = r.haefen.filter((h) => h.id !== id);
      r.ausfluege = r.ausfluege.filter((a) => a.hafenId !== id);
      if (zustand.hafenId === id) zustand.hafenId = haefen()[0]?.id ?? null;
      dialog.close();
      speichern();
      alles();
      break;
    }
    case "ausflug-neu":
      ausflugDialog(null);
      break;
    case "ausflug-bearbeiten":
      ausflugDialog(id);
      break;
    case "ausflug-loeschen":
      if (!confirm("Ausflug löschen?")) return;
      r.ausfluege = r.ausfluege.filter((a) => a.id !== id);
      dialog.close();
      speichern();
      alles();
      break;
    case "auf-karte":
      kartenMarker[id]?.openPopup();
      if (kartenMarker[id]) karte.setView(kartenMarker[id].getLatLng(), Math.max(karte.getZoom(), 12));
      else alert("Für diesen Ausflug ist noch kein Ziel auf der Karte eingetragen (Bearbeiten → Ziel / Treffpunkt).");
      document.querySelector(".kartenbereich").scrollIntoView({ behavior: "smooth", block: "nearest" });
      break;
    case "dialog-zu":
      dialog.close();
      break;
    case "ort-suchen":
      ortSuchen(el.closest(".ortssuche"));
      break;
    case "ort-waehlen": {
      const box = el.closest(".ortssuche");
      const wert = JSON.parse(el.dataset.wert);
      box.querySelector("input[type=hidden]").value = JSON.stringify(wert);
      box.querySelector(".ortswert").textContent = `📍 ${wert.name} (${wert.lat.toFixed(4)}, ${wert.lng.toFixed(4)})`;
      box.querySelector(".orttreffer").innerHTML = "";
      box.closest("form")?.dispatchEvent(new Event("input"));
      break;
    }
    case "gyg-laden":
      gygLaden(hafenVon(id));
      break;
    case "gyg-uebernehmen": {
      const h = hafenVon(zustand.hafenId);
      const t = zustand.gygErgebnisse[h.id][Number(el.dataset.i)];
      ausflugDialog(null, {
        titel: t.titel,
        quelle: "getyourguide",
        gygId: t.id,
        link: t.link,
        dauerMin: t.dauerMin,
        preisErw: t.preis,
        preisArt: /gruppe|group/i.test(t.preisHinweis) ? "gruppe" : "person",
        preisGruppe: /gruppe|group/i.test(t.preisHinweis) ? t.preis : null,
        sterne: t.sterne,
        ziel: t.lat != null ? { lat: t.lat, lng: t.lng, name: t.titel } : null,
        notiz: t.kurz,
      });
      break;
    }
    case "person-neu": {
      const kind = el.dataset.typ === "kind";
      const n = personen().filter((p) => istKind(p) === kind).length + 1;
      r.personen.push({ id: neueId(), name: kind ? `Kind ${n}` : `Erwachsene/r ${n}`, typ: kind ? "kind" : "erwachsen", alter: "" });
      // Neue Mitreisende standardmäßig bei allen noch nicht gebuchten Ausflügen dabei
      const neuePerson = r.personen.at(-1);
      for (const a of r.ausfluege) if (a.status !== "gebucht") a.teilnehmer = [...(a.teilnehmer ?? []), neuePerson.id];
      speichern();
      alles();
      break;
    }
    case "person-loeschen":
      if (!confirm("Person entfernen? Sie wird auch aus allen Ausflügen genommen.")) return;
      r.personen = r.personen.filter((p) => p.id !== id);
      for (const a of r.ausfluege) a.teilnehmer = (a.teilnehmer ?? []).filter((t) => t !== id);
      speichern();
      alles();
      break;
    case "reise-loeschen":
      if (!confirm(`Reise „${r.name}“ endgültig löschen?`)) return;
      await anfrage(`api/reisen/${r.id}`, { method: "DELETE" });
      try {
        localStorage.removeItem(LOKAL(r.id));
      } catch {}
      zustand.reise = null;
      await reisenLaden();
      if (zustand.reisen[0]) await reiseOeffnen(zustand.reisen[0].id);
      else alles();
      break;
    case "import-vorschau":
      importVorschau();
      break;
    case "import-uebernehmen":
      importUebernehmen();
      break;
    case "csv-export":
      csvExport();
      break;
    case "json-export":
      herunterladen(`${r.name.replace(/[^\wäöüß -]/gi, "")}.json`, JSON.stringify(r, null, 2), "application/json");
      break;
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  const r = zustand.reise;
  if (el.dataset.aktion === "status") {
    const a = r.ausfluege.find((x) => x.id === el.dataset.id);
    a.status = el.value;
    speichern();
    alles();
  } else if (el.dataset.aktion === "sortieren") {
    zustand.sortierung = el.value;
    alles();
  } else if (el.closest(".person")) {
    const p = r.personen.find((x) => x.id === el.closest(".person").dataset.id);
    p[el.dataset.feld] = el.dataset.feld === "alter" ? (el.value === "" ? "" : Number(el.value)) : el.value;
    speichern();
    if (el.dataset.feld === "typ") alles();
  } else if (el.dataset.reise) {
    r[el.dataset.reise] = el.value;
    speichern();
    reisenLaden();
  } else if (el.id === "csvDatei" && el.files[0]) {
    el.files[0].text().then(csvImport);
  } else if (el.id === "jsonDatei" && el.files[0]) {
    el.files[0].text().then(jsonImport);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList?.contains("ortsq")) {
    e.preventDefault();
    ortSuchen(e.target.closest(".ortssuche"));
  }
});

async function ortSuchen(box) {
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
    const treffer = await anfrage(`api/geo?q=${encodeURIComponent(q)}`);
    ziel.innerHTML = treffer.length
      ? treffer.map((t) => `<button type="button" class="treffer" data-aktion="ort-waehlen" data-wert='${esc(JSON.stringify({ lat: t.lat, lng: t.lng, name: t.name.split(",").slice(0, 3).join(",") }))}'>${esc(t.name)}</button>`).join("")
      : `<span class="leise klein">Nichts gefunden. Tipp: In Google Maps rechts auf den Ort klicken, die Koordinaten kopieren und hier einfügen.</span>`;
  } catch (e) {
    ziel.innerHTML = `<span class="warnung klein">${esc(e.message)}</span>`;
  }
}

// ---------- Import / Export ----------

let importListe = [];
function importVorschau() {
  importListe = textZuAusfluegen($("#importText").value);
  const el = $("#importVorschau");
  if (!importListe.length) {
    el.innerHTML = `<p class="leise">Kein Ausflug erkannt.</p>`;
    return;
  }
  el.innerHTML = `<div class="tabelle"><table><thead><tr><th></th><th>Titel</th><th>Beginn</th><th>Dauer</th><th class="zahl">Erw.</th><th class="zahl">Kind</th></tr></thead><tbody>
    ${importListe.map((a, i) => `<tr><td><input type="checkbox" checked data-import="${i}"></td><td>${esc(a.titel)}${a.code ? ` <span class="leise klein">${esc(a.code)}</span>` : ""}</td><td>${esc(a.beginn || "–")}</td><td>${dauerText(a.dauerMin)}</td><td class="zahl">${a.preisErw != null ? geld(a.preisErw) : "–"}</td><td class="zahl">${a.preisKind != null ? geld(a.preisKind) : "–"}</td></tr>`).join("")}
  </tbody></table></div>
  <p class="klein leise">Fehlt etwas oder stimmt nicht, kannst du es danach im Ausflug korrigieren.</p>
  <button class="knopf" data-aktion="import-uebernehmen">Ausgewählte übernehmen</button>`;
}

function importUebernehmen() {
  const hafenId = $("#importHafen").value;
  if (!hafenId) return alert("Bitte zuerst einen Hafen anlegen.");
  const gewaehlt = [...document.querySelectorAll("[data-import]")].filter((c) => c.checked).map((c) => importListe[Number(c.dataset.import)]);
  for (const x of gewaehlt) {
    zustand.reise.ausfluege.push({
      id: neueId(), hafenId, quelle: "schiff", status: "idee", preisArt: "person", interesse: 3, verkehr: "auto",
      teilnehmer: personen().map((p) => p.id), ...x,
    });
  }
  zustand.hafenId = hafenId;
  speichern();
  alert(`${gewaehlt.length} Ausflüge übernommen.`);
  ansichtWechseln("plan");
}

const CSV_KOPF = ["Datum", "Hafen", "Titel", "Anbieter", "Status", "Beginn", "Dauer (Min)", "Preis Erw", "Preis Kind", "Gruppenpreis", "Teilnehmer", "Kosten gesamt", "Link", "Notiz"];
function csvExport() {
  const zelle = (v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dez = (n) => (n == null || n === "" ? "" : String(n).replace(".", ","));
  const zeilen = [CSV_KOPF];
  for (const h of haefen()) {
    for (const a of ausfluegeIn(h.id)) {
      const k = ausflugKosten(a, personen());
      zeilen.push([h.datum, h.name, a.titel, (QUELLEN[a.quelle] ?? QUELLEN.sonstige).name, STATUS[a.status], a.beginn, a.dauerMin, dez(a.preisErw), dez(a.preisKind), dez(a.preisGruppe), k.anzahl, dez(k.summe), a.link, a.notiz]);
    }
  }
  herunterladen(`${zustand.reise.name}-Ausfluege.csv`, "﻿" + zeilen.map((z) => z.map(zelle).join(";")).join("\r\n"), "text/csv");
}

function csvZeilen(text) {
  const zeilen = [];
  let feld = "";
  let zeile = [];
  let inQuote = false;
  const trenner = (text.split("\n")[0].match(/;/g) ?? []).length >= (text.split("\n")[0].match(/,/g) ?? []).length ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') (feld += '"'), i++;
      else if (c === '"') inQuote = false;
      else feld += c;
    } else if (c === '"') inQuote = true;
    else if (c === trenner) zeile.push(feld), (feld = "");
    else if (c === "\n") zeile.push(feld.replace(/\r$/, "")), zeilen.push(zeile), (zeile = []), (feld = "");
    else feld += c;
  }
  if (feld || zeile.length) zeile.push(feld.replace(/\r$/, "")), zeilen.push(zeile);
  return zeilen.filter((z) => z.some((x) => x.trim()));
}

function csvImport(text) {
  const [kopf, ...zeilen] = csvZeilen(text.replace(/^﻿/, ""));
  if (!kopf) return;
  const spalte = (name) => kopf.findIndex((k) => k.trim().toLowerCase().startsWith(name.toLowerCase()));
  const s = { datum: spalte("Datum"), hafen: spalte("Hafen"), titel: spalte("Titel"), anbieter: spalte("Anbieter"), status: spalte("Status"), beginn: spalte("Beginn"), dauer: spalte("Dauer"), erw: spalte("Preis Erw"), kind: spalte("Preis Kind"), gruppe: spalte("Gruppenpreis"), link: spalte("Link"), notiz: spalte("Notiz") };
  if (s.titel < 0) return alert("Spalte „Titel“ fehlt.");
  const r = zustand.reise;
  let neu = 0;
  for (const z of zeilen) {
    const wert = (i) => (i >= 0 ? (z[i] ?? "").trim() : "");
    const titel = wert(s.titel);
    if (!titel) continue;
    const datum = wert(s.datum).replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, (_, d, m, y) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
    const name = wert(s.hafen);
    let h = r.haefen.find((x) => (datum ? x.datum === datum : true) && (!name || x.name.toLowerCase() === name.toLowerCase()));
    if (!h && (datum || name)) {
      h = { id: neueId(), datum, name: name || "Hafen", ankunft: "", abfahrt: "", allesAnBord: "", seetag: false, lat: null, lng: null };
      r.haefen.push(h);
    }
    if (!h) continue;
    const anbieter = wert(s.anbieter).toLowerCase();
    const quelle = Object.entries(QUELLEN).find(([k, q]) => anbieter && (k === anbieter || q.name.toLowerCase() === anbieter))?.[0] ?? (anbieter ? "sonstige" : "schiff");
    const statusText = wert(s.status).toLowerCase();
    const status = Object.entries(STATUS).find(([k, t]) => k === statusText || t.toLowerCase() === statusText)?.[0] ?? "idee";
    const gruppe = zahl(wert(s.gruppe));
    r.ausfluege.push({
      id: neueId(), hafenId: h.id, titel, quelle, status, beginn: wert(s.beginn), dauerMin: zahl(wert(s.dauer)),
      preisArt: gruppe != null ? "gruppe" : "person", preisErw: zahl(wert(s.erw)), preisKind: zahl(wert(s.kind)), preisGruppe: gruppe,
      link: wert(s.link), notiz: wert(s.notiz), interesse: 3, verkehr: "auto", teilnehmer: personen().map((p) => p.id),
    });
    neu++;
  }
  speichern();
  alert(`${neu} Ausflüge importiert. Häfen ohne Kartenpunkt bitte unter „Route & Häfen“ ergänzen.`);
  alles();
}

async function jsonImport(text) {
  let daten;
  try {
    daten = JSON.parse(text);
  } catch {
    return alert("Keine gültige JSON-Datei.");
  }
  if (!Array.isArray(daten.haefen) || !Array.isArray(daten.ausfluege)) return alert("Die Datei enthält keine Reise.");
  const { id, version, ...rest } = daten;
  const reise = await anfrage("api/reisen", { method: "POST", body: { ...rest, name: `${rest.name ?? "Reise"} (Kopie)` } });
  await reisenLaden();
  await reiseOeffnen(reise.id);
}

function herunterladen(name, inhaltText, typ) {
  const url = URL.createObjectURL(new Blob([inhaltText], { type: typ }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Start ----------

(async () => {
  try {
    zustand.info = await anfrage("api/info");
  } catch {}
  await reisenLaden();
  let letzte = null;
  try {
    letzte = localStorage.getItem("reiseplaner:letzte");
  } catch {}
  const id = zustand.reisen.find((r) => r.id === letzte)?.id ?? zustand.reisen[0]?.id;
  if (id) await reiseOeffnen(id);
  else alles();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
