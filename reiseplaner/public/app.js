import {
  QUELLEN, STATUS, KATEGORIEN, zeitZuMin, minZuZeit, dauerText, zahl, istKind, sichereUrl,
  ausflugKosten, reiseKosten, zeitplan, bewertung, entfernungKm, textZuAusfluegen, startpunkt, hotelKosten,
} from "./rechnen.js";
import {
  zustand, $, esc, neueId, datumText, personen, haefen, hafenVon, ausfluegeIn, hatKoord, geld, istPlaner, linkHtml, stationsArt, istKreuzfahrt,
  aktionen, aenderungen, setzeZeichner, setzeAbmeldung, anfrage, lokalLesen, lokalEntfernen, speichern, status, beitraegeLaden,
  dialog, dialogOeffnen, ortsSuche, ortSuchen, ortAuslesen, herunterladen,
} from "./kern.js";
import { anmeldungPruefen, anmeldenZeigen } from "./konto.js";
import { hotelsAnsicht, hotelStatusAendern } from "./hotels.js";
import { erlebnisseAnsicht, bewertungsZeile } from "./erlebnisse.js";
import { kiImportBox, kiKnopf, kiPanel } from "./ki.js";
import "./teilen.js";

const inhalt = $("#inhalt");

// ---------- Reisen laden ----------

async function reisenLaden() {
  try {
    zustand.reisen = await anfrage("/api/reisen");
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
    reise = await anfrage(`/api/reisen/${id}`);
    const lokal = lokalLesen(id);
    if (lokal?.ungespeichert && Number(lokal.reise.version) === Number(reise.version)) {
      reise = { ...lokal.reise, meineRolle: reise.meineRolle }; // Offline-Änderungen übernehmen und nachspeichern
      setTimeout(speichern, 100);
    }
  } catch (e) {
    if (e.status === 404) lokalEntfernen(id);
    else {
      reise = lokalLesen(id)?.reise ?? null;
      if (reise) status("Offline – lokale Kopie", true);
    }
  }
  if (!reise) return;
  zustand.rolle = reise.meineRolle ?? "mitreisend";
  delete reise.meineRolle;
  reise.hotels ??= [];
  reise.kosten ??= [];
  zustand.reise = reise;
  zustand.hafenId = haefen().find((h) => stationsArt(h) !== "seetag")?.id ?? haefen()[0]?.id ?? null;
  zustand.gygErgebnisse = {};
  try {
    localStorage.setItem("reiseplaner:letzte", id);
  } catch {}
  $("#reiseWahl").value = id;
  await Promise.all([beitraegeLaden(), mitgliederLaden()]);
  alles();
}

async function mitgliederLaden() {
  try {
    zustand.mitglieder = await anfrage(`/api/reisen/${zustand.reise.id}/mitglieder`);
  } catch {
    zustand.mitglieder = [];
  }
}

function neueReiseVorlage(name, art) {
  const ich = zustand.ich;
  return {
    name,
    art,
    schiff: art === "kreuzfahrt" ? "Mein Schiff" : "",
    waehrung: "EUR",
    personen: [{ id: neueId(), name: ich?.name ?? "Ich", typ: "erwachsen", alter: "", userId: ich?.id }],
    haefen: [],
    hotels: [],
    ausfluege: [],
    kosten: [],
  };
}

aktionen["reise-neu"] = () => {
  dialogOeffnen(`<form method="dialog" class="formular" id="neuForm">
    <h3>Neue Reise</h3>
    <label>Name<input name="name" required placeholder="z. B. Mein Schiff 4 – Kanaren 2026"></label>
    <label>Art<select name="art"><option value="kreuzfahrt">Kreuzfahrt</option><option value="hotel">Hotel-/Strandurlaub</option><option value="rundreise">Rundreise</option></select></label>
    <p class="klein leise">Tipp: Hast du schon einen Plan (z. B. von ChatGPT)? Dann unter „Import &amp; KI“ einlesen lassen.</p>
    <div class="zeile"><span class="platz"></span><button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button><button class="knopf" value="ok">Anlegen</button></div>
  </form>`);
  $("#neuForm").addEventListener("submit", async (e) => {
    const f = new FormData(e.target);
    const reise = await anfrage("/api/reisen", { method: "POST", body: neueReiseVorlage(String(f.get("name")).trim(), f.get("art")) });
    await reisenLaden();
    await reiseOeffnen(reise.id);
    ansichtWechseln(f.get("art") === "kreuzfahrt" ? "verlauf" : "hotels");
  });
};

$("#reiseWahl").addEventListener("change", (e) => e.target.value && reiseOeffnen(e.target.value));
$("#reiter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ansicht]");
  if (b) ansichtWechseln(b.dataset.ansicht);
});

function ansichtWechseln(ansicht) {
  zustand.ansicht = ansicht;
  for (const b of document.querySelectorAll("#reiter button")) b.classList.toggle("aktiv", b.dataset.ansicht === ansicht);
  alles();
  window.scrollTo({ top: 0 });
}

// ---------- Darstellung ----------

function alles() {
  $("#kiKnopfPlatz").innerHTML = kiKnopf();
  if (!zustand.reise) {
    inhalt.innerHTML = `
      <div class="leer">
        <h2>Willkommen${zustand.ich ? `, ${esc(zustand.ich.name.split(" ")[0])}` : ""}!</h2>
        <p>Lege eine Reise an – Kreuzfahrt, Hotel oder Rundreise. Danach sammelst du Ausflüge und Unterkünfte, vergleichst sie auf der Karte,
        planst die Kosten für alle Mitreisenden und hältst hinterher Bewertungen, Fotos und Tauchgänge fest.</p>
        <button class="knopf" data-aktion="reise-neu">+ Erste Reise anlegen</button>
        <p class="klein leise">Du wurdest eingeladen? Dann öffne den Einladungslink – die Reise erscheint danach hier.</p>
      </div>
      ${kiImportBox()}`;
    karteZeichnen();
    return;
  }
  document.querySelector('[data-ansicht="verlauf"]').textContent = istKreuzfahrt() ? "Route & Häfen" : "Reiseverlauf";
  const ansichten = { plan: planAnsicht, hotels: hotelsAnsicht, erlebnisse: erlebnisseAnsicht, kosten: kostenAnsicht, personen: personenAnsicht, verlauf: verlaufAnsicht, daten: datenAnsicht };
  inhalt.innerHTML = (ansichten[zustand.ansicht] ?? planAnsicht)();
  if (zustand.ansicht === "plan") nachPlan();
  karteZeichnen();
}
setzeZeichner(alles);

function hafenLeiste() {
  const liste = haefen();
  if (!liste.length) {
    return `<div class="hinweis">Noch keine Tage eingetragen. <button class="link" data-aktion="zu-verlauf">${istKreuzfahrt() ? "Route eintragen" : "Reiseverlauf anlegen"} →</button>${!istKreuzfahrt() ? ` – oder unter „Unterkünfte“ ein Hotel anlegen und „Tage anlegen“ wählen.` : ""}</div>`;
  }
  const kosten = reiseKosten(zustand.reise);
  return `<div class="hafenleiste" role="tablist">${liste
    .map((h, i) => {
      const art = stationsArt(h);
      const anzahl = ausfluegeIn(h.id).filter((a) => a.status !== "verworfen").length;
      const gebucht = ausfluegeIn(h.id).some((a) => a.status === "gebucht");
      return `<button class="hafenchip ${h.id === zustand.hafenId ? "aktiv" : ""} ${art === "seetag" ? "seetag" : ""}" data-aktion="hafen" data-id="${esc(h.id)}">
        <span class="tag">Tag ${i + 1} · ${esc(datumText(h.datum))}</span>
        <strong>${art === "seetag" ? "🌊 Seetag" : `${art === "hafen" ? "⚓ " : ""}${esc(h.name || "Ort")}`}</strong>
        ${art === "seetag" ? "" : `<span class="mini">${anzahl} Ausfl.${gebucht ? " · ✅" : ""}${kosten.jeHafen[h.id] ? ` · ${geld(kosten.jeHafen[h.id])}` : ""}</span>`}
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
  const kreuz = stationsArt(hafen) === "hafen";
  const links = [
    ["GetYourGuide", `https://www.getyourguide.de/s/?${gygParams}`, "getyourguide"],
    ["Viator", `https://www.viator.com/de-DE/searchResults/all?text=${q}`, "viator"],
    ["Tiqets", google(`site:tiqets.com ${ort}`), "tiqets"],
    ["Civitatis", google(`site:civitatis.com ${ort}`), "civitatis"],
    ["Klook", google(`site:klook.com ${ort} tour`), "sonstige"],
    ["ToursByLocals", google(`site:toursbylocals.com ${ort}`), "sonstige"],
    ["Tripadvisor", `https://www.tripadvisor.de/Search?q=${q}`, "sonstige"],
    ...(kreuz ? [["Mein-Schiff-Ausflüge", google(`Mein Schiff Landausflüge ${ort}`), "schiff"], ["Auf eigene Faust", google(`${ort} Kreuzfahrt Landgang auf eigene Faust`), "eigene"]] : [["Ausflugstipps", google(`${ort} Ausflüge Tipps Familie`), "eigene"]]),
    ["Tauchen", `https://www.google.com/maps/search/${encodeURIComponent(`Tauchbasis ${ort}`)}${hatKoord(hafen) ? `/@${hafen.lat},${hafen.lng},11z` : ""}`, "eigene"],
    ["Wikivoyage", `https://de.wikivoyage.org/w/index.php?search=${q}`, "eigene"],
    ["Sehenswertes", hatKoord(hafen) ? `https://www.google.com/maps/search/Sehensw%C3%BCrdigkeiten/@${hafen.lat},${hafen.lng},12z` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Sehenswürdigkeiten ${ort}`)}`, "eigene"],
  ];
  return `<div class="links">${links.map(([name, url, quelle]) => `<a class="linkchip" style="--farbe:${QUELLEN[quelle].farbe}" href="${esc(url)}" target="_blank" rel="noopener">${esc(name)} ↗</a>`).join("")}</div>`;
}

function planAnsicht() {
  const h = hafenVon(zustand.hafenId);
  let detail = "";
  if (h && stationsArt(h) === "seetag") {
    detail = `<div class="karte-box"><h2>🌊 Seetag – ${esc(datumText(h.datum, { weekday: "long", day: "numeric", month: "long" }))}</h2><p>Zeit fürs Schiff. Ausflüge gibt es an diesem Tag nicht.</p>${h.notiz ? `<p>${esc(h.notiz)}</p>` : ""}</div>`;
  } else if (h) {
    const art = stationsArt(h);
    const start = startpunkt(h, zustand.reise.hotels);
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
    // Markierungen nur unter Ausflügen mit bekanntem Preis – sonst wäre „ohne Preis“ immer am günstigsten
    const mitPreis = aktive.filter((x) => x.b.kosten.summe > 0);
    const besteId = mitPreis.length > 1 ? [...mitPreis].sort(sortierer.punkte)[0].a.id : null;
    const guenstigsteId = mitPreis.length > 1 ? [...mitPreis].sort(sortierer.preis)[0].a.id : null;

    detail = `
      <div class="karte-box hafenkopf">
        <div>
          <h2>${esc(h.name)}${h.land ? `<span class="leise">, ${esc(h.land)}</span>` : ""}</h2>
          <div class="zeiten">
            <span>📅 ${esc(datumText(h.datum, { weekday: "long", day: "numeric", month: "long" }))}</span>
            ${art === "hafen" ? `<span>⚓ ${esc(h.ankunft || "–")} – ${esc(h.abfahrt || "–")}</span><span class="wichtig">⏰ Alle an Bord: ${esc(h.allesAnBord || "–")}</span>${Number.isFinite(landgang) && landgang > 0 ? `<span>Landgang: ${dauerText(landgang)}</span>` : ""}` : ""}
            ${start?.hotel ? `<span>🏨 Start: ${esc(start.name)}</span>` : art === "ort" ? `<span class="leise">Kein Hotel für diesen Tag – <button class="link" data-aktion="zu-hotels">Unterkunft eintragen</button></span>` : ""}
          </div>
          <div id="wetter" class="wetter"></div>
          ${h.notiz ? `<p class="notiz">${esc(h.notiz)}</p>` : ""}
        </div>
        <div class="kopfknoepfe">
          ${hatKoord(h) ? `<a class="knopf leise" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}">Google Maps ↗</a>` : ""}
          <button class="knopf leise" data-aktion="hafen-bearbeiten" data-id="${esc(h.id)}">Tag bearbeiten</button>
        </div>
      </div>

      <div class="karte-box">
        <h3>Ausflüge finden in ${esc(h.suchname || h.name)}</h3>
        <p class="leise klein">Öffnet die Suche beim Anbieter (bei GetYourGuide mit Datum). Gefundenes mit „+ Ausflug“ eintragen – Link, Preis und Dauer übernehmen.</p>
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
        ${liste.length ? `<div class="ausfluege">${liste.map(({ a, b }) => ausflugKarte(a, b, h, { beste: a.id === besteId, guenstig: a.id === guenstigsteId })).join("")}</div>` : `<p class="leise">Noch keine Ausflüge für diesen Tag. ${art === "hafen" ? "Trage die Schiffsausflüge ein (oder lies sie unter „Import &amp; KI“ ein) und ergänze Angebote von GetYourGuide &amp; Co." : "Sammle hier Ausflüge von GetYourGuide &amp; Co. oder eigene Ideen."}</p>`}
      </div>`;
  } else {
    detail = `<p class="leise">Wähle oben einen Tag.</p>`;
  }
  return `${hafenLeiste()}${detail}`;
}

function ausflugKarte(a, b, h, { beste, guenstig }) {
  const q = QUELLEN[a.quelle] ?? QUELLEN.sonstige;
  const k = b.kosten;
  const z = b.zeit;
  const art = stationsArt(h);
  const start = startpunkt(h, zustand.reise.hotels);
  const pufferKlasse = z.puffer == null ? "" : z.puffer < 0 ? "rot" : a.quelle !== "schiff" && z.puffer < 60 ? "gelb" : "gruen";
  const gm = hatKoord(start) && hatKoord(a.ziel) ? `https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${a.ziel.lat},${a.ziel.lng}&travelmode=${a.verkehr === "fuss" ? "walking" : "driving"}` : "";
  const namen = personen().filter((p) => (a.teilnehmer ?? []).includes(p.id)).map((p) => p.name);
  const inklusive = a.quelle === "schiff";
  const frage = `Ist der Ausflug „${a.titel}“ für uns sinnvoll? Was spricht dafür und dagegen, gibt es eine bessere Alternative?`;
  return `
    <article class="ausflug status-${esc(a.status)}" style="--farbe:${q.farbe}">
      <div class="ausflug-kopf">
        <span class="quelle">${esc(q.name)}${a.code ? ` · ${esc(a.code)}` : ""}${a.kategorie && a.kategorie !== "ausflug" ? ` · ${esc(KATEGORIEN[a.kategorie] ?? "")}` : ""}</span>
        ${beste ? `<span class="abzeichen gruen">★ Beste Wahl</span>` : ""}
        ${guenstig ? `<span class="abzeichen">€ Günstigste</span>` : ""}
        <select class="statuswahl" data-aktion="status" data-id="${esc(a.id)}" aria-label="Status">
          ${Object.entries(STATUS).map(([s, t]) => `<option value="${s}" ${a.status === s ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </div>
      <h4>${linkHtml(a.link, esc(a.titel))}</h4>
      <div class="werte">
        <div><span>Zeit</span><strong>${a.beginn && z.start != null ? `${minZuZeit(z.start)} – ${minZuZeit(z.zurueck ?? NaN)}` : "–"}</strong><em>${dauerText(zahl(a.dauerMin))}</em></div>
        <div><span>Weg ab ${start?.hotel ? "Hotel" : art === "hafen" ? "Schiff" : "Start"}</span><strong>${inklusive ? "inklusive" : a.fahrzeitMin ? `${Math.round(a.fahrzeitMin)} Min.` : "–"}</strong><em>${a.km ? `${a.km.toFixed(1).replace(".", ",")} km` : inklusive ? "Bus ab Pier" : ""}</em></div>
        ${art === "hafen" ? `<div class="${pufferKlasse}"><span>Puffer bis an Bord</span><strong>${z.puffer != null ? (z.puffer < 0 ? "−" : "") + dauerText(Math.abs(z.puffer)) : "–"}</strong></div>` : ""}
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
          ${zustand.info.ki ? `<button class="link" data-aktion="ki-oeffnen" data-frage="${esc(frage)}">KI fragen</button>` : ""}
          ${a.kategorie === "tauchen" && a.status === "gebucht" ? `<button class="link" data-aktion="tauchgang-neu" data-ausflug="${esc(a.id)}">🤿 Loggen</button>` : ""}
          <button class="link" data-aktion="ausflug-bearbeiten" data-id="${esc(a.id)}">Bearbeiten</button>
        </span>
      </div>
      ${a.status === "gebucht" || zustand.beitraege.bewertungen.some((x) => x.zielId === a.id) ? bewertungsZeile("ausflug", a.id) : ""}
      ${a.notiz ? `<details class="klein"><summary>Notiz</summary><p class="notiz">${esc(a.notiz)}</p></details>` : ""}
    </article>`;
}

function nachPlan() {
  const h = hafenVon(zustand.hafenId);
  if (!h || stationsArt(h) === "seetag") return;
  wetterLaden(h);
  if (zustand.gygErgebnisse[h.id]) gygZeigen(h);
  const start = startpunkt(h, zustand.reise.hotels);
  for (const a of ausfluegeIn(h.id)) {
    if (a.quelle !== "schiff" && hatKoord(a.ziel) && hatKoord(start) && a.fahrzeitMin == null) wegBerechnen(a, start);
  }
}

async function wetterLaden(h) {
  const el = $("#wetter");
  const ort = startpunkt(h, zustand.reise.hotels);
  if (!el || !hatKoord(ort) || !h.datum) return;
  const tage = (new Date(`${h.datum}T12:00:00`) - new Date()) / 86400_000;
  if (tage > 15 || tage < -2) {
    el.innerHTML = `<span class="leise klein">Wetter: Vorhersage gibt es ab ca. 16 Tage vorher.</span>`;
    return;
  }
  if (!zustand.wetter[h.id]) {
    try {
      const p = new URLSearchParams({ latitude: ort.lat, longitude: ort.lng, daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunset", timezone: "auto", start_date: h.datum, end_date: h.datum });
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
async function wegBerechnen(a, start) {
  const modus = a.verkehr === "fuss" ? "fuss" : "auto";
  const schluessel = `${a.id}:${modus}:${a.ziel.lat},${a.ziel.lng}:${start.lat},${start.lng}`;
  if (berechnet.has(schluessel)) return;
  berechnet.add(schluessel);
  try {
    const w = await anfrage(`/api/route?von=${start.lat},${start.lng}&nach=${a.ziel.lat},${a.ziel.lng}&modus=${modus}`);
    zustand.wege[`${a.id}:${modus}`] = w;
    if (!a.fahrzeitManuell) a.fahrzeitMin = Math.round(w.min);
    a.km = Math.round(w.km * 10) / 10;
  } catch {
    // Kein Weg (z. B. andere Insel): Luftlinie als grobe Schätzung
    const km = entfernungKm(start, a.ziel);
    if (km == null || a.fahrzeitMin != null) return;
    a.km = Math.round(km * 10) / 10;
    a.fahrzeitMin = Math.round((km / (modus === "fuss" ? 4.5 : 35)) * 60);
  }
  speichern();
  if (zustand.ansicht === "plan") alles();
}

async function gygLaden(h) {
  const el = $("#gygListe");
  el.innerHTML = `<p class="leise">Lade Angebote …</p>`;
  try {
    const p = new URLSearchParams({ datum: h.datum || "" });
    const ort = startpunkt(h, zustand.reise.hotels);
    if (hatKoord(ort)) {
      p.set("lat", ort.lat);
      p.set("lng", ort.lng);
    } else p.set("q", h.suchname || h.name);
    zustand.gygErgebnisse[h.id] = await anfrage(`/api/gyg?${p}`);
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
        <div>${linkHtml(t.link, esc(t.titel))}
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
    .filter((h) => stationsArt(h) !== "seetag")
    .map((h) => {
      const gewaehlt = ausfluegeIn(h.id).filter((a) => a.status === "gebucht" || a.status === "favorit");
      if (!gewaehlt.length) return "";
      return `<tr><td>${esc(datumText(h.datum))}</td><td>${esc(h.name)}</td><td>${gewaehlt.map((a) => `${esc(a.titel)} <span class="leise klein">(${STATUS[a.status]}, ${geld(ausflugKosten(a, ps).summe)})</span>`).join("<br>")}</td><td class="zahl">${geld(k.jeHafen[h.id] ?? 0)}</td></tr>`;
    })
    .join("");
  const hotelZeilen = r.hotels
    .filter((h) => h.status === "gebucht" || h.status === "favorit")
    .map((h) => `<tr><td>${esc(h.name)} <span class="leise klein">(${STATUS[h.status]})</span></td><td class="klein">${esc(datumText(h.anreise))} – ${esc(datumText(h.abreise))}</td><td class="zahl">${geld(hotelKosten(h, ps).summe)}</td></tr>`)
    .join("");
  return `
    <div class="kacheln">
      <div class="kachel"><span>Gebucht</span><strong>${geld(k.gebucht)}</strong></div>
      <div class="kachel"><span>Gebucht + Favoriten</span><strong>${geld(k.geplant)}</strong></div>
      <div class="kachel"><span>Je Person (Ø)</span><strong>${geld(ps.length ? k.geplant / ps.length : 0)}</strong></div>
    </div>
    <div class="kacheln klein-kacheln">
      <div class="kachel"><span>Ausflüge</span><strong>${geld(k.ausfluege.geplant)}</strong></div>
      <div class="kachel"><span>Unterkünfte</span><strong>${geld(k.hotels.geplant)}</strong></div>
      <div class="kachel"><span>Weitere Kosten</span><strong>${geld(k.sonstiges.geplant)}</strong></div>
    </div>
    <div class="karte-box">
      <h3>Ausflüge je Tag</h3>
      <p class="leise klein">Gezählt werden Einträge mit Status „Gebucht“ oder „Favorit“.</p>
      <div class="tabelle"><table><thead><tr><th>Tag</th><th>Ort</th><th>Ausflüge</th><th class="zahl">Summe</th></tr></thead>
      <tbody>${zeilenHafen || `<tr><td colspan="4" class="leise">Noch keine Ausflüge als Favorit oder gebucht.</td></tr>`}</tbody>
      <tfoot><tr><th colspan="3">Ausflüge gesamt</th><th class="zahl">${geld(k.ausfluege.geplant)}</th></tr></tfoot></table></div>
    </div>
    ${hotelZeilen ? `<div class="karte-box"><h3>Unterkünfte</h3><div class="tabelle"><table><tbody>${hotelZeilen}</tbody></table></div></div>` : ""}
    <div class="karte-box">
      <div class="zeile"><h3>Weitere Kosten</h3><button class="knopf leise" data-aktion="kosten-neu">+ Posten</button></div>
      <p class="leise klein">Flug, Kreuzfahrt-Grundpreis, Mietwagen, Trinkgeld, Versicherung … werden gleichmäßig auf alle verteilt.</p>
      ${r.kosten.length ? `<div class="kostenliste">${r.kosten.map((x) => `<div class="kostenzeile" data-id="${esc(x.id)}">
        <input data-kfeld="titel" value="${esc(x.titel ?? "")}" placeholder="z. B. Flug" aria-label="Posten">
        <input data-kfeld="betrag" inputmode="decimal" value="${esc(x.betrag ?? "")}" placeholder="€" aria-label="Betrag">
        <select data-kfeld="status" aria-label="Status">${["idee", "favorit", "gebucht"].map((s) => `<option value="${s}" ${x.status === s ? "selected" : ""}>${STATUS[s]}</option>`).join("")}</select>
        <button class="link rot" data-aktion="kosten-loeschen" data-id="${esc(x.id)}" aria-label="Entfernen">✕</button></div>`).join("")}</div>` : ""}
    </div>
    <div class="karte-box">
      <h3>Je Person</h3>
      <div class="tabelle"><table><thead><tr><th>Name</th><th></th><th class="zahl">Anteil</th></tr></thead>
      <tbody>${ps.map((p) => `<tr><td>${esc(p.name)}</td><td class="leise">${istKind(p) ? `Kind${p.alter ? `, ${esc(p.alter)} J.` : ""}` : "Erwachsen"}</td><td class="zahl">${geld(k.jePerson[p.id] ?? 0)}</td></tr>`).join("")}</tbody></table></div>
      <p class="leise klein">Ausflüge nach Teilnahme; Gruppenpreise, Zusatzkosten, Unterkünfte und weitere Kosten gleichmäßig verteilt.</p>
    </div>
    <div class="karte-box">
      <h3>Ausflüge je Anbieter</h3>
      <div class="tabelle"><table><tbody>${Object.entries(k.jeQuelle).map(([q, s]) => `<tr><td><span class="punkt" style="--farbe:${(QUELLEN[q] ?? QUELLEN.sonstige).farbe}"></span>${esc((QUELLEN[q] ?? QUELLEN.sonstige).name)}</td><td class="zahl">${geld(s)}</td></tr>`).join("") || `<tr><td class="leise">–</td></tr>`}</tbody></table></div>
    </div>`;
}

aktionen["kosten-neu"] = () => {
  zustand.reise.kosten.push({ id: neueId(), titel: "", betrag: null, status: "gebucht" });
  speichern();
  alles();
  document.querySelector(".kostenzeile:last-child input")?.focus();
};
aktionen["kosten-loeschen"] = (el) => {
  zustand.reise.kosten = zustand.reise.kosten.filter((x) => x.id !== el.dataset.id);
  speichern();
  alles();
};

function personenAnsicht() {
  const ps = personen();
  const konten = zustand.mitglieder;
  const kontoName = (id) => konten.find((m) => m.userId === id)?.name;
  return `
    <div class="karte-box">
      <h3>Mitreisende (${ps.filter((p) => !istKind(p)).length} Erwachsene, ${ps.filter(istKind).length} Kinder)</h3>
      <p class="leise klein">Das Alter der Kinder zählt für Kinderpreise. Wer bei einem Ausflug nicht mitkommt, wählst du im Ausflug ab. Über „Einladen“ bekommt jede/r ein eigenes Konto – zum Mitplanen, Bewerten und für das eigene Tauchlog.</p>
      <div class="personen">
        ${ps.map((p) => `<div class="person" data-id="${esc(p.id)}">
          <input data-feld="name" value="${esc(p.name)}" aria-label="Name">
          <select data-feld="typ" aria-label="Erwachsen oder Kind"><option value="erwachsen" ${!istKind(p) ? "selected" : ""}>Erwachsen</option><option value="kind" ${istKind(p) ? "selected" : ""}>Kind</option></select>
          <input data-feld="alter" type="number" min="0" max="17" value="${esc(p.alter ?? "")}" placeholder="Alter" aria-label="Alter" ${istKind(p) ? "" : "disabled"}>
          <span class="klein">${p.userId ? `👤 ${esc(kontoName(p.userId) ?? "Konto")}` : istPlaner() ? `<button class="link" data-aktion="einladen" data-person="${esc(p.id)}">Einladen</button>` : ""}</span>
          <button class="link rot" data-aktion="person-loeschen" data-id="${esc(p.id)}">Entfernen</button>
        </div>`).join("")}
      </div>
      <div class="zeile">
        <button class="knopf leise" data-aktion="person-neu" data-typ="erwachsen">+ Erwachsene/r</button>
        <button class="knopf leise" data-aktion="person-neu" data-typ="kind">+ Kind</button>
      </div>
    </div>
    <div class="karte-box">
      <div class="zeile"><h3>Zugang zur Reise</h3>${istPlaner() ? `<button class="knopf leise" data-aktion="einladen">Einladungslink</button>` : ""}</div>
      <div class="tabelle"><table><tbody>${konten.map((m) => `<tr><td>${esc(m.name)}${m.userId === zustand.ich.id ? " <span class='leise'>(du)</span>" : ""}<div class="klein leise">${esc(m.email)}</div></td>
        <td>${istPlaner() && m.userId !== zustand.ich.id ? `<select data-aktion="mitglied-rolle" data-id="${esc(m.userId)}"><option value="mitreisend" ${m.rolle !== "planer" ? "selected" : ""}>Mitreisend</option><option value="planer" ${m.rolle === "planer" ? "selected" : ""}>Planer/in</option></select>` : m.rolle === "planer" ? "Planer/in" : "Mitreisend"}</td>
        <td>${istPlaner() && m.userId !== zustand.ich.id ? `<button class="link rot" data-aktion="mitglied-entfernen" data-id="${esc(m.userId)}">Entfernen</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="leise klein">Mitreisende sehen und bearbeiten den Plan, bewerten und führen ihr Tauchlog. Planer/innen laden zusätzlich ein und verwalten den Zugang.</p>
    </div>`;
}

aktionen["einladen"] = async (el) => {
  const personId = el.dataset.person ?? null;
  const p = personen().find((x) => x.id === personId);
  const { link } = await anfrage(`/api/reisen/${zustand.reise.id}/einladungen`, { method: "POST", body: { personId } });
  const text = `Hallo${p ? ` ${p.name}` : ""}! Hier ist dein Zugang zu unserem Reiseplaner „${zustand.reise.name}“: ${link}`;
  dialogOeffnen(`<div class="formular">
    <h3>Einladung${p ? ` für ${esc(p.name)}` : ""}</h3>
    <p class="leise klein">Der Link gilt 14 Tage${p ? " und nur einmal" : ""}. Wer ihn öffnet, legt ein eigenes Konto an (E-Mail + Passwort).</p>
    <div class="linkfeld"><input readonly value="${esc(link)}" onclick="this.select()"><button class="knopf leise" data-aktion="link-kopieren" data-url="${esc(link)}">Kopieren</button></div>
    <div class="links">
      <a class="linkchip" style="--farbe:#25d366" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Per WhatsApp senden</a>
      <a class="linkchip" style="--farbe:#555" href="mailto:?subject=${encodeURIComponent(`Einladung: ${zustand.reise.name}`)}&body=${encodeURIComponent(text)}">Per E-Mail senden</a>
    </div>
    <div class="zeile"><span class="platz"></span><button class="knopf" data-aktion="dialog-zu">Fertig</button></div>
  </div>`);
};

aktionen["mitglied-entfernen"] = async (el) => {
  if (!confirm("Zugang zu dieser Reise entfernen?")) return;
  await anfrage(`/api/reisen/${zustand.reise.id}/mitglieder/${el.dataset.id}`, { method: "DELETE" }).catch((e) => alert(e.message));
  await mitgliederLaden();
  alles();
};
aenderungen["mitglied-rolle"] = async (el) => {
  await anfrage(`/api/reisen/${zustand.reise.id}/mitglieder/${el.dataset.id}`, { method: "PUT", body: { rolle: el.value } }).catch((e) => alert(e.message));
  await mitgliederLaden();
  alles();
};

function verlaufAnsicht() {
  const r = zustand.reise;
  return `
    <div class="karte-box">
      <h3>Reise</h3>
      <div class="formular drei">
        <label>Name<input data-reise="name" value="${esc(r.name)}"></label>
        <label>Art<select data-reise="art"><option value="kreuzfahrt" ${r.art === "kreuzfahrt" || !r.art ? "selected" : ""}>Kreuzfahrt</option><option value="hotel" ${r.art === "hotel" ? "selected" : ""}>Hotel-/Strandurlaub</option><option value="rundreise" ${r.art === "rundreise" ? "selected" : ""}>Rundreise</option></select></label>
        ${istKreuzfahrt() ? `<label>Schiff<input data-reise="schiff" value="${esc(r.schiff ?? "")}" placeholder="z. B. Mein Schiff 4"></label>` : ""}
      </div>
    </div>
    <div class="karte-box">
      <div class="zeile"><h3>${istKreuzfahrt() ? "Route" : "Tage"}</h3><button class="knopf" data-aktion="hafen-neu">+ ${istKreuzfahrt() ? "Hafen / Seetag" : "Tag / Ort"}</button></div>
      <p class="leise klein">${istKreuzfahrt() ? "Die Zeiten stehen im Reiseplan bzw. in der Mein-Schiff-App. „Alle an Bord“ ist meist 30 Min. vor Abfahrt." : "Tage im Hotel kannst du auch unter „Unterkünfte“ → „Tage anlegen“ erzeugen; Startpunkt der Ausflüge ist dann das Hotel."}</p>
      <div class="tabelle"><table class="haefen">
        <thead><tr><th>Datum</th><th>Ort</th>${istKreuzfahrt() ? "<th>Ankunft</th><th>Abfahrt</th><th>Alle an Bord</th>" : ""}<th>Karte</th><th></th></tr></thead>
        <tbody>${haefen()
          .map((h) => `<tr>
            <td>${esc(datumText(h.datum))}</td>
            <td>${stationsArt(h) === "seetag" ? "🌊 Seetag" : `${stationsArt(h) === "hafen" ? "⚓" : "📍"} ${esc(h.name)}`}</td>
            ${istKreuzfahrt() ? `<td>${esc(h.ankunft ?? "")}</td><td>${esc(h.abfahrt ?? "")}</td><td>${esc(h.allesAnBord ?? "")}</td>` : ""}
            <td>${stationsArt(h) === "seetag" ? "" : hatKoord(h) ? "✓" : `<span class="warnung">fehlt</span>`}</td>
            <td><button class="link" data-aktion="hafen-bearbeiten" data-id="${esc(h.id)}">Bearbeiten</button></td>
          </tr>`)
          .join("") || `<tr><td colspan="7" class="leise">Noch keine Tage eingetragen.</td></tr>`}</tbody>
      </table></div>
    </div>
    ${istPlaner() ? `<div class="karte-box"><h3>Reise löschen</h3><p class="leise klein">Löscht Plan, Bewertungen, Tauchgänge und Fotos dieser Reise.</p><button class="knopf gefahr" data-aktion="reise-loeschen">Diese Reise löschen</button></div>` : ""}`;
}

function datenAnsicht() {
  const hs = haefen().filter((h) => stationsArt(h) !== "seetag");
  return `
    ${kiImportBox()}
    <div class="karte-box">
      <h3>Schiffsausflüge übernehmen (ohne KI)</h3>
      <p class="leise klein">In der Mein-Schiff-App bzw. auf meinschiff.com die Ausflüge eines Hafens markieren, kopieren und hier einfügen.
      Jeder Ausflug in einem eigenen Absatz (Leerzeile dazwischen); erste Zeile = Titel. Erkannt werden Preise
      (Erwachsene/Kinder), Dauer („ca. 4 Std.“) und Beginn („09:30 Uhr“). Du siehst vor dem Übernehmen eine Vorschau.</p>
      <label>Tag <select id="importHafen">${hs.map((h) => `<option value="${esc(h.id)}" ${h.id === zustand.hafenId ? "selected" : ""}>${esc(datumText(h.datum))} – ${esc(h.name)}</option>`).join("")}</select></label>
      <textarea id="importText" rows="8" placeholder="Inselrundfahrt mit Weinprobe&#10;ca. 4,5 Std. · ab 09:00 Uhr&#10;Erwachsene 69 € · Kinder 49 €&#10;&#10;Altstadt zu Fuß&#10;ca. 2 Std.&#10;39 €"></textarea>
      <div class="zeile"><button class="knopf leise" data-aktion="import-vorschau">Vorschau</button></div>
      <div id="importVorschau"></div>
    </div>
    <div class="karte-box">
      <h3>Tabelle (CSV, z. B. aus Excel)</h3>
      <p class="leise klein">Spalten (Semikolon getrennt): <code>Datum;Hafen;Titel;Anbieter;Status;Beginn;Dauer (Min);Preis Erw;Preis Kind;Gruppenpreis;Link;Notiz</code>. Tage werden über Datum + Name zugeordnet.</p>
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
        <button class="knopf leise" data-aktion="drucken">Drucken</button>
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
  // OpenStreetMap verlangt eine Herkunftsangabe (Referer); eigener Kartendienst über KARTEN_KACHELN.
  L.tileLayer(zustand.info.kacheln || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    referrerPolicy: "strict-origin-when-cross-origin",
    attribution: zustand.info.kachelnHinweis || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
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
  const alleTage = haefen();
  const liste = alleTage.filter((h) => stationsArt(h) !== "seetag" && hatKoord(h));
  const legendeTeile = [`<span><span class="punkt" style="--farbe:#0b5394"></span>${istKreuzfahrt() ? "Häfen / Route" : "Orte"}</span>`];
  if (liste.length > 1) L.polyline(liste.map((h) => [h.lat, h.lng]), { color: "#0b5394", weight: 2, dashArray: "6 6", opacity: 0.7 }).addTo(ebene);
  for (const h of liste) {
    const nr = alleTage.indexOf(h) + 1;
    const aktiv = h.id === zustand.hafenId && zustand.ansicht === "plan";
    L.marker([h.lat, h.lng], { icon: icon(aktiv ? "#d0021b" : "#0b5394", String(nr), true), zIndexOffset: aktiv ? 1000 : 0 })
      .bindTooltip(`Tag ${nr}: ${esc(h.name)}`)
      .on("click", () => {
        zustand.hafenId = h.id;
        if (zustand.ansicht !== "plan") ansichtWechseln("plan");
        else alles();
      })
      .addTo(ebene);
  }
  const grenzen = [];
  const verwendet = new Set();

  // Unterkünfte
  const hotelsSichtbar = zustand.ansicht === "hotels" ? zustand.reise.hotels.filter((h) => hatKoord(h) && h.status !== "verworfen") : zustand.reise.hotels.filter((h) => hatKoord(h) && h.status === "gebucht");
  for (const h of hotelsSichtbar) {
    const k = hotelKosten(h, personen());
    L.marker([h.lat, h.lng], { icon: icon("#00897b", h.status === "gebucht" ? "✓" : h.status === "favorit" ? "★" : "H") })
      .bindPopup(`<strong>${esc(h.name)}</strong><br>${esc(STATUS[h.status])} · ${geld(k.summe)}${k.proNacht ? ` (${geld(k.proNacht)}/Nacht)` : ""}<br><a href="https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}" target="_blank" rel="noopener">In Google Maps öffnen ↗</a>`)
      .addTo(ebene);
    if (zustand.ansicht === "hotels") grenzen.push([h.lat, h.lng]);
  }
  if (hotelsSichtbar.length) legendeTeile.push(`<span><span class="punkt" style="--farbe:#00897b"></span>Unterkünfte</span>`);

  // Tauchplätze
  if (zustand.ansicht === "erlebnisse") {
    for (const t of zustand.beitraege.tauchgaenge.filter(hatKoord)) {
      L.marker([t.lat, t.lng], { icon: icon("#0277bd", "🤿") }).bindPopup(`<strong>${esc(t.tauchplatz)}</strong><br>${esc(datumText(t.datum))}${t.maxTiefe != null ? ` · ${t.maxTiefe} m` : ""}${t.tauchzeitMin ? ` · ${t.tauchzeitMin} Min.` : ""}`).addTo(ebene);
      grenzen.push([t.lat, t.lng]);
    }
    if (zustand.beitraege.tauchgaenge.some(hatKoord)) legendeTeile.push(`<span><span class="punkt" style="--farbe:#0277bd"></span>Tauchplätze</span>`);
  }

  // Ausflüge des gewählten Tages
  const h = hafenVon(zustand.hafenId);
  const start = h ? startpunkt(h, zustand.reise.hotels) : null;
  if (zustand.ansicht === "plan" && h && hatKoord(start) && stationsArt(h) !== "seetag") {
    grenzen.push([start.lat, start.lng]);
    for (const a of ausfluegeIn(h.id)) {
      if (!hatKoord(a.ziel) || a.status === "verworfen") continue;
      const q = QUELLEN[a.quelle] ?? QUELLEN.sonstige;
      verwendet.add(a.quelle);
      const k = ausflugKosten(a, personen());
      const z = zeitplan(a, h);
      const m = L.marker([a.ziel.lat, a.ziel.lng], { icon: icon(q.farbe, a.status === "gebucht" ? "✓" : a.status === "favorit" ? "★" : "") })
        .bindPopup(`<strong>${esc(a.titel)}</strong><br>${esc(q.name)} · ${STATUS[a.status]}<br>${geld(k.summe)} · ${dauerText(zahl(a.dauerMin))}${a.fahrzeitMin && a.quelle !== "schiff" ? `<br>Weg: ${Math.round(a.fahrzeitMin)} Min. je Richtung` : ""}${z.puffer != null ? `<br>Puffer: ${z.puffer < 0 ? "−" : ""}${dauerText(Math.abs(z.puffer))}` : ""}<br><a href="https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${a.ziel.lat},${a.ziel.lng}" target="_blank" rel="noopener">In Google Maps öffnen ↗</a>`)
        .addTo(ebene);
      kartenMarker[a.id] = m;
      grenzen.push([a.ziel.lat, a.ziel.lng]);
      const weg = zustand.wege[`${a.id}:${a.verkehr === "fuss" ? "fuss" : "auto"}`];
      if (weg?.linie) L.polyline(weg.linie, { color: q.farbe, weight: 4, opacity: 0.75 }).addTo(ebene);
      else if (a.quelle !== "schiff") wegNachladen(a, start);
      else L.polyline([[start.lat, start.lng], [a.ziel.lat, a.ziel.lng]], { color: q.farbe, weight: 2, opacity: 0.6, dashArray: "2 6" }).addTo(ebene);
    }
    for (const t of zustand.gygErgebnisse[h.id] ?? []) {
      if (t.lat == null) continue;
      L.circleMarker([t.lat, t.lng], { radius: 5, color: QUELLEN.getyourguide.farbe, weight: 1, fillOpacity: 0.5 })
        .bindPopup(`<strong>${esc(t.titel)}</strong><br>${t.preis != null ? `ab ${geld(t.preis)}` : ""} ${t.dauerMin ? `· ${dauerText(t.dauerMin)}` : ""}<br>${linkHtml(t.link, "GetYourGuide")}`)
        .addTo(ebene);
    }
  }
  legende.innerHTML = [...legendeTeile, ...[...verwendet].map((q) => `<span><span class="punkt" style="--farbe:${QUELLEN[q].farbe}"></span>${esc(QUELLEN[q].name)}</span>`), `<span>✓ gebucht · ★ Favorit</span>`].join("");
  if (grenzen.length > 1) karte.fitBounds(grenzen, { padding: [30, 30], maxZoom: 14 });
  else if (grenzen.length === 1) karte.setView(grenzen[0], 12);
  else if (liste.length > 1) karte.fitBounds(liste.map((x) => [x.lat, x.lng]), { padding: [30, 30] });
  else if (liste.length === 1) karte.setView([liste[0].lat, liste[0].lng], 10);
  setTimeout(() => karte.invalidateSize(), 50);
}

const ladeWege = new Set();
async function wegNachladen(a, start) {
  const modus = a.verkehr === "fuss" ? "fuss" : "auto";
  const s = `${a.id}:${modus}`;
  if (ladeWege.has(s)) return;
  ladeWege.add(s);
  try {
    zustand.wege[s] = await anfrage(`/api/route?von=${start.lat},${start.lng}&nach=${a.ziel.lat},${a.ziel.lng}&modus=${modus}`);
    if (zustand.ansicht === "plan") karteZeichnen();
  } catch {
    zustand.wege[s] = { linie: [[start.lat, start.lng], [a.ziel.lat, a.ziel.lng]] };
  }
}

// ---------- Dialoge: Tag und Ausflug ----------

function hafenDialog(id) {
  const neu = !id;
  const letzter = haefen().at(-1);
  const naechsterTag = letzter?.datum ? new Date(new Date(`${letzter.datum}T12:00:00`).getTime() + 86400_000).toISOString().slice(0, 10) : "";
  const h = id ? hafenVon(id) : { id: neueId(), datum: naechsterTag, name: "", art: istKreuzfahrt() ? "hafen" : "ort", ankunft: istKreuzfahrt() ? "08:00" : "", abfahrt: istKreuzfahrt() ? "18:00" : "", allesAnBord: istKreuzfahrt() ? "17:30" : "" };
  const art = stationsArt(h);
  dialogOeffnen(`<form method="dialog" class="formular art-${art}" id="hafenForm">
    <h3>${neu ? "Tag hinzufügen" : "Tag bearbeiten"}</h3>
    <div class="formular zwei">
      <label>Datum<input type="date" name="datum" value="${esc(h.datum)}" required></label>
      <label>Art<select name="art"><option value="hafen" ${art === "hafen" ? "selected" : ""}>Hafen (Kreuzfahrt)</option><option value="seetag" ${art === "seetag" ? "selected" : ""}>Seetag</option><option value="ort" ${art === "ort" ? "selected" : ""}>Tag an Land / im Hotel</option></select></label>
      <label class="ohne-seetag">Hafen / Ort<input name="name" value="${esc(h.name)}" placeholder="z. B. Santa Cruz de Tenerife"></label>
      <label class="ohne-seetag">Land<input name="land" value="${esc(h.land ?? "")}"></label>
      <label class="nur-hafen">Ankunft<input type="time" name="ankunft" value="${esc(h.ankunft ?? "")}"></label>
      <label class="nur-hafen">Abfahrt<input type="time" name="abfahrt" value="${esc(h.abfahrt ?? "")}"></label>
      <label class="nur-hafen">Alle an Bord<input type="time" name="allesAnBord" value="${esc(h.allesAnBord ?? "")}"></label>
      <label class="ohne-seetag">Suchbegriff für Anbieter<input name="suchname" value="${esc(h.suchname ?? "")}" placeholder="z. B. Teneriffa (statt Hafenname)"></label>
    </div>
    <div class="ohne-seetag"><label>Liegeplatz / Ort auf der Karte</label>
    ${ortsSuche("ort", hatKoord(h) ? { lat: h.lat, lng: h.lng, name: h.ortName ?? h.name } : null)}</div>
    <label>Notiz<textarea name="notiz" rows="2">${esc(h.notiz ?? "")}</textarea></label>
    <div class="zeile">
      ${neu ? "" : `<button type="button" class="knopf gefahr" data-aktion="hafen-loeschen" data-id="${esc(h.id)}">Löschen</button>`}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
  </form>`);
  const form = $("#hafenForm");
  if (!hatKoord(h) && h.name) $(".ortsq", form).value = h.name;
  form.querySelector("select[name=art]").addEventListener("change", (e) => {
    form.className = `formular art-${e.target.value}`;
  });
  form.addEventListener("submit", () => {
    const f = new FormData(form);
    const ort = ortAuslesen(form, "ort");
    const neueArt = f.get("art");
    Object.assign(h, {
      datum: f.get("datum"),
      art: neueArt,
      seetag: neueArt === "seetag",
      name: String(f.get("name")).trim() || (neueArt === "seetag" ? "Seetag" : ""),
      land: String(f.get("land")).trim(),
      ankunft: neueArt === "hafen" ? f.get("ankunft") : "",
      abfahrt: neueArt === "hafen" ? f.get("abfahrt") : "",
      allesAnBord: neueArt === "hafen" ? f.get("allesAnBord") : "",
      suchname: String(f.get("suchname")).trim(),
      notiz: f.get("notiz"),
      lat: ort?.lat ?? null,
      lng: ort?.lng ?? null,
      ortName: ort?.name ?? "",
    });
    if (neu) zustand.reise.haefen.push(h);
    if (!zustand.hafenId || neu) zustand.hafenId = h.id;
    for (const a of ausfluegeIn(h.id)) if (!a.fahrzeitManuell) a.fahrzeitMin = null;
    speichern();
    alles();
  });
}

function ausflugDialog(id, vorlage = {}) {
  const neu = !id;
  const a = id
    ? zustand.reise.ausfluege.find((x) => x.id === id)
    : { id: neueId(), hafenId: zustand.hafenId, quelle: stationsArt(hafenVon(zustand.hafenId)) === "hafen" ? "schiff" : "getyourguide", kategorie: "ausflug", status: "idee", preisArt: "person", teilnehmer: personen().map((p) => p.id), interesse: 3, verkehr: "auto", ...vorlage };
  const hs = haefen().filter((h) => stationsArt(h) !== "seetag");
  dialogOeffnen(`<form method="dialog" class="formular" id="ausflugForm">
    <h3>${neu ? "Ausflug hinzufügen" : "Ausflug bearbeiten"}</h3>
    <label>Titel<input name="titel" value="${esc(a.titel ?? "")}" required placeholder="z. B. Teide-Nationalpark mit Seilbahn"></label>
    <div class="formular drei">
      <label>Tag<select name="hafenId">${hs.map((h) => `<option value="${esc(h.id)}" ${h.id === a.hafenId ? "selected" : ""}>${esc(datumText(h.datum))} – ${esc(h.name)}</option>`).join("")}</select></label>
      <label>Anbieter<select name="quelle">${Object.entries(QUELLEN).map(([k, q]) => `<option value="${k}" ${a.quelle === k ? "selected" : ""}>${esc(q.name)}</option>`).join("")}</select></label>
      <label>Art<select name="kategorie">${Object.entries(KATEGORIEN).map(([k, t]) => `<option value="${k}" ${(a.kategorie ?? "ausflug") === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label>Status<select name="status">${Object.entries(STATUS).map(([k, t]) => `<option value="${k}" ${a.status === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
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
        <label>Bewertung beim Anbieter<input name="sterne" inputmode="decimal" value="${esc(a.sterne ?? "")}" placeholder="z. B. 4,7"></label>
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
        <label>Weg ab Schiff/Hotel<select name="verkehr"><option value="auto" ${a.verkehr !== "fuss" ? "selected" : ""}>Auto / Taxi / Bus</option><option value="fuss" ${a.verkehr === "fuss" ? "selected" : ""}>zu Fuß</option></select></label>
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
  </form>`);
  const form = $("#ausflugForm");
  const auslesen = () => {
    const f = new FormData(form);
    const fahrzeit = zahl(f.get("fahrzeitMin"));
    const dauerStd = zahl(f.get("dauerStd"));
    return {
      titel: String(f.get("titel")).trim(),
      hafenId: f.get("hafenId"),
      quelle: f.get("quelle"),
      kategorie: f.get("kategorie"),
      status: f.get("status"),
      link: sichereUrl(f.get("link")),
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
      ziel: ortAuslesen(form, "ziel"),
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

Object.assign(aktionen, {
  hafen: (el) => {
    zustand.hafenId = el.dataset.id;
    alles();
  },
  "zu-verlauf": () => ansichtWechseln("verlauf"),
  "zu-hotels": () => ansichtWechseln("hotels"),
  "hafen-neu": () => hafenDialog(null),
  "hafen-bearbeiten": (el) => hafenDialog(el.dataset.id),
  "hafen-loeschen": (el) => {
    const id = el.dataset.id;
    const anzahl = ausfluegeIn(id).length;
    if (!confirm(`Tag löschen?${anzahl ? ` Die ${anzahl} Ausflüge dort werden mit gelöscht.` : ""}`)) return;
    const r = zustand.reise;
    r.haefen = r.haefen.filter((h) => h.id !== id);
    r.ausfluege = r.ausfluege.filter((a) => a.hafenId !== id);
    if (zustand.hafenId === id) zustand.hafenId = haefen()[0]?.id ?? null;
    dialog().close();
    speichern();
    alles();
  },
  "ausflug-neu": () => ausflugDialog(null),
  "ausflug-bearbeiten": (el) => ausflugDialog(el.dataset.id),
  "ausflug-loeschen": (el) => {
    if (!confirm("Ausflug löschen?")) return;
    zustand.reise.ausfluege = zustand.reise.ausfluege.filter((a) => a.id !== el.dataset.id);
    dialog().close();
    speichern();
    alles();
  },
  "auf-karte": (el) => {
    const m = kartenMarker[el.dataset.id];
    if (!m) return alert("Für diesen Ausflug ist noch kein Ziel auf der Karte eingetragen (Bearbeiten → Ziel / Treffpunkt).");
    m.openPopup();
    karte.setView(m.getLatLng(), Math.max(karte.getZoom(), 12));
    document.querySelector(".kartenbereich").scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
  "dialog-zu": () => dialog().close(),
  drucken: () => window.print(),
  "ort-suchen": (el) => ortSuchen(el.closest(".ortssuche")),
  "ort-waehlen": (el) => {
    const box = el.closest(".ortssuche");
    const wert = JSON.parse(el.dataset.wert);
    box.querySelector("input[type=hidden]").value = JSON.stringify(wert);
    box.querySelector(".ortswert").textContent = `📍 ${wert.name} (${wert.lat.toFixed(4)}, ${wert.lng.toFixed(4)})`;
    box.querySelector(".orttreffer").innerHTML = "";
    box.closest("form")?.dispatchEvent(new Event("input"));
  },
  "gyg-laden": (el) => gygLaden(hafenVon(el.dataset.id)),
  "gyg-uebernehmen": (el) => {
    const h = hafenVon(zustand.hafenId);
    const t = zustand.gygErgebnisse[h.id][Number(el.dataset.i)];
    const gruppe = /gruppe|group/i.test(t.preisHinweis);
    ausflugDialog(null, {
      titel: t.titel, quelle: "getyourguide", gygId: t.id, link: t.link, dauerMin: t.dauerMin, preisErw: gruppe ? null : t.preis,
      preisArt: gruppe ? "gruppe" : "person", preisGruppe: gruppe ? t.preis : null, sterne: t.sterne,
      ziel: t.lat != null ? { lat: t.lat, lng: t.lng, name: t.titel } : null, notiz: t.kurz,
    });
  },
  "person-neu": (el) => {
    const r = zustand.reise;
    const kind = el.dataset.typ === "kind";
    const n = personen().filter((p) => istKind(p) === kind).length + 1;
    const neuePerson = { id: neueId(), name: kind ? `Kind ${n}` : `Erwachsene/r ${n}`, typ: kind ? "kind" : "erwachsen", alter: "" };
    r.personen.push(neuePerson);
    // Neue Mitreisende standardmäßig bei allen noch nicht gebuchten Ausflügen dabei
    for (const a of r.ausfluege) if (a.status !== "gebucht") a.teilnehmer = [...(a.teilnehmer ?? []), neuePerson.id];
    speichern();
    alles();
  },
  "person-loeschen": (el) => {
    if (!confirm("Person entfernen? Sie wird auch aus allen Ausflügen genommen.")) return;
    const r = zustand.reise;
    r.personen = r.personen.filter((p) => p.id !== el.dataset.id);
    for (const a of r.ausfluege) a.teilnehmer = (a.teilnehmer ?? []).filter((t) => t !== el.dataset.id);
    speichern();
    alles();
  },
  "reise-loeschen": async () => {
    const r = zustand.reise;
    if (!confirm(`Reise „${r.name}“ mit allen Bewertungen, Tauchgängen und Fotos endgültig löschen?`)) return;
    await anfrage(`/api/reisen/${r.id}`, { method: "DELETE" });
    lokalEntfernen(r.id);
    zustand.reise = null;
    await reisenLaden();
    if (zustand.reisen[0]) await reiseOeffnen(zustand.reisen[0].id);
    else alles();
  },
  "import-vorschau": () => importVorschau(),
  "import-uebernehmen": () => importUebernehmen(),
  "csv-export": () => csvExport(),
  "json-export": () => herunterladen(`${zustand.reise.name.replace(/[^\wäöüß -]/gi, "")}.json`, JSON.stringify(zustand.reise, null, 2), "application/json"),
});

Object.assign(aenderungen, {
  status: (el) => {
    zustand.reise.ausfluege.find((x) => x.id === el.dataset.id).status = el.value;
    speichern();
    alles();
  },
  "hotel-status": (el) => hotelStatusAendern(el.dataset.id, el.value),
  sortieren: (el) => {
    zustand.sortierung = el.value;
    alles();
  },
});

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-aktion]");
  if (!el || el.tagName === "SELECT") return;
  const fn = aktionen[el.dataset.aktion];
  if (!fn) return;
  if (el.tagName === "BUTTON" && el.type !== "submit") e.preventDefault();
  Promise.resolve(fn(el, e)).catch((err) => alert(err.message));
});

document.addEventListener("change", (e) => {
  const el = e.target;
  const r = zustand.reise;
  if (el.dataset.aktion && aenderungen[el.dataset.aktion]) return aenderungen[el.dataset.aktion](el);
  if (!r) return;
  if (el.closest(".person") && el.dataset.feld) {
    const p = r.personen.find((x) => x.id === el.closest(".person").dataset.id);
    p[el.dataset.feld] = el.dataset.feld === "alter" ? (el.value === "" ? "" : Number(el.value)) : el.value;
    speichern();
    if (el.dataset.feld === "typ") alles();
  } else if (el.closest(".kostenzeile")) {
    const k = r.kosten.find((x) => x.id === el.closest(".kostenzeile").dataset.id);
    k[el.dataset.kfeld] = el.dataset.kfeld === "betrag" ? zahl(el.value) : el.value;
    speichern();
    alles();
  } else if (el.dataset.reise) {
    r[el.dataset.reise] = el.value;
    speichern();
    reisenLaden();
    if (el.dataset.reise === "art") alles();
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
  if (!hafenId) return alert("Bitte zuerst einen Tag anlegen.");
  const gewaehlt = [...document.querySelectorAll("[data-import]")].filter((c) => c.checked).map((c) => importListe[Number(c.dataset.import)]);
  for (const x of gewaehlt) {
    zustand.reise.ausfluege.push({ id: neueId(), hafenId, quelle: "schiff", kategorie: "ausflug", status: "idee", preisArt: "person", interesse: 3, verkehr: "auto", teilnehmer: personen().map((p) => p.id), ...x });
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
  const kopf = text.split("\n")[0];
  const trenner = (kopf.match(/;/g) ?? []).length >= (kopf.match(/,/g) ?? []).length ? ";" : ",";
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
      h = { id: neueId(), datum, name: name || "Ort", art: istKreuzfahrt() ? "hafen" : "ort", ankunft: "", abfahrt: "", allesAnBord: "", lat: null, lng: null };
      r.haefen.push(h);
    }
    if (!h) continue;
    const anbieter = wert(s.anbieter).toLowerCase();
    const quelle = Object.entries(QUELLEN).find(([k, q]) => anbieter && (k === anbieter || q.name.toLowerCase() === anbieter))?.[0] ?? (anbieter ? "sonstige" : "schiff");
    const statusText = wert(s.status).toLowerCase();
    const st = Object.entries(STATUS).find(([k, t]) => k === statusText || t.toLowerCase() === statusText)?.[0] ?? "idee";
    const gruppe = zahl(wert(s.gruppe));
    r.ausfluege.push({
      id: neueId(), hafenId: h.id, titel, quelle, kategorie: "ausflug", status: st, beginn: wert(s.beginn), dauerMin: zahl(wert(s.dauer)),
      preisArt: gruppe != null ? "gruppe" : "person", preisErw: zahl(wert(s.erw)), preisKind: zahl(wert(s.kind)), preisGruppe: gruppe,
      link: sichereUrl(wert(s.link)), notiz: wert(s.notiz), interesse: 3, verkehr: "auto", teilnehmer: personen().map((p) => p.id),
    });
    neu++;
  }
  speichern();
  alert(`${neu} Ausflüge importiert. Orte ohne Kartenpunkt bitte unter „${istKreuzfahrt() ? "Route & Häfen" : "Reiseverlauf"}“ ergänzen.`);
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
  const { id, version, mitglieder, meineRolle, ...rest } = daten;
  const reise = await anfrage("/api/reisen", { method: "POST", body: { ...rest, name: `${rest.name ?? "Reise"} (Kopie)` } });
  await reisenLaden();
  await reiseOeffnen(reise.id);
}

// ---------- Start ----------

async function start() {
  const ich = await anmeldungPruefen(start);
  if (!ich) return;
  $("#ichKnopf").textContent = ich.name;
  $("#kiPanelPlatz").innerHTML = kiPanel();
  await reisenLaden();
  const gewuenscht = new URLSearchParams(location.search).get("reise");
  if (gewuenscht) history.replaceState(null, "", "/");
  let letzte = null;
  try {
    letzte = localStorage.getItem("reiseplaner:letzte");
  } catch {}
  const id = zustand.reisen.find((r) => r.id === gewuenscht)?.id ?? zustand.reisen.find((r) => r.id === letzte)?.id ?? zustand.reisen[0]?.id;
  if (id) await reiseOeffnen(id);
  else alles();
}

setzeAbmeldung(() => anmeldenZeigen(start));
start().catch((e) => {
  inhalt.innerHTML = `<div class="leer"><p class="warnung">Der Server ist nicht erreichbar: ${esc(e.message)}</p></div>`;
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
