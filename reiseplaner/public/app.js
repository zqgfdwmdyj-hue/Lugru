import {
  QUELLEN, STATUS, KATEGORIEN, zeitZuMin, minZuZeit, dauerText, zahl, istKind, sichereUrl,
  ausflugKosten, reiseKosten, zeitplan, bewertung, entfernungKm, textZuAusfluegen, startpunkt, hotelKosten,
  REISEARTEN, VERKEHRSMITTEL, festeZeit, familieVon, zimmerVon, moeglicheDubletten, buchungsKonflikte, punkteErklaerung,
} from "./rechnen.js";
import {
  zustand, $, esc, neueId, datumText, personen, haefen, hafenVon, ausfluegeIn, hatKoord, geld, istPlaner, linkHtml, stationsArt, istKreuzfahrt,
  aktionen, aenderungen, setzeZeichner, setzeAbmeldung, anfrage, lokalLesen, lokalEntfernen, lokalSichern, lokalMerken, lokalHolen, speichern, status, beitraegeLaden,
  dialog, dialogOeffnen, ortsSuche, ortSuchen, ortAuslesen, herunterladen, extrasLaden, heute,
} from "./kern.js";
import { anmeldungPruefen, anmeldenZeigen } from "./konto.js";
import { hotelsAnsicht, hotelStatusAendern } from "./hotels.js";
import { erlebnisseAnsicht, bewertungsZeile } from "./erlebnisse.js";
import { kiImportBox, kiKnopf, kiPanel, koordinatenErgaenzen } from "./ki.js";
import { weltkarteLaden, weltkarteAnsicht, weltkartePins } from "./weltkarte.js";
import { vorbereitungAnsicht } from "./vorbereitung.js";
import { unterwegsAnsicht, nachUnterwegs, weckerPlanen } from "./unterwegs.js";
import { kinderAnsicht } from "./kinder.js";
import { flugAnsicht, fluege } from "./flug.js";
import { uebersichtAnsicht } from "./uebersicht.js";
import { planB, PLAN_B_IDEEN } from "./unterwegs-logik.js";
import { bordkonto, inReisewaehrung, etappen, spritkosten } from "./unterwegs-logik.js";
import { verbindungText } from "./unterwegs.js";
import "./reisebuch.js";
import "./teilen.js";

const inhalt = $("#inhalt");

// ---------- Reisen laden ----------

async function reisenLaden() {
  try {
    zustand.reisen = await anfrage("/api/reisen");
    lokalMerken("reisen", zustand.reisen);
  } catch (e) {
    zustand.reisen = (e.status === 0 && lokalHolen("reisen")) || [];
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
    } else if (!lokal?.ungespeichert) lokalSichern(reise, false); // Kopie fürs Öffnen ohne Internet
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
  reise.verbindungen ??= [];
  reise.zimmer ??= [];
  reise.familien ??= [];
  zustand.reise = reise;
  // Unterwegs: heutigen Tag zeigen, sonst den ersten Landtag
  zustand.hafenId = haefen().find((h) => h.datum === heute())?.id ?? haefen().find((h) => stationsArt(h) !== "seetag")?.id ?? haefen()[0]?.id ?? null;
  zustand.unterwegsTag = null;
  zustand.gygErgebnisse = {};
  try {
    localStorage.setItem("reiseplaner:letzte", id);
  } catch {}
  $("#reiseWahl").value = id;
  await Promise.all([beitraegeLaden(), mitgliederLaden(), extrasLaden()]);
  alles();
  orteAutomatischSuchen();
  weckerPlanen();
}

// Ältere/importierte Reisen ohne Kartenpunkte: einmal je Sitzung automatisch nachsuchen
const schonGesucht = new Set();
async function orteAutomatischSuchen() {
  const r = zustand.reise;
  if (!r || schonGesucht.has(r.id)) return;
  const fehlen = haefen().filter((h) => stationsArt(h) !== "seetag" && !hatKoord(h) && h.name);
  if (!fehlen.length) return;
  schonGesucht.add(r.id);
  await koordinatenErgaenzen(r, (t) => status(t));
  if (zustand.reise !== r) return;
  speichern();
  alles();
}

aktionen["orte-suchen"] = async (el) => {
  el.disabled = true;
  const fehlend = await koordinatenErgaenzen(zustand.reise, (t) => status(t));
  speichern();
  alles();
  if (fehlend.length) alert(`Nicht gefunden: ${[...new Set(fehlend)].join(", ")}.\nBitte unter „Tag bearbeiten“ den Ort suchen oder Koordinaten aus Google Maps einfügen.`);
};

async function mitgliederLaden() {
  try {
    zustand.mitglieder = await anfrage(`/api/reisen/${zustand.reise.id}/mitglieder`);
    lokalMerken(`mitglieder:${zustand.reise.id}`, zustand.mitglieder);
  } catch (e) {
    zustand.mitglieder = (e.status === 0 && lokalHolen(`mitglieder:${zustand.reise.id}`)) || [];
  }
}

function neueReiseVorlage(name, art, tag = null) {
  const ich = zustand.ich;
  return {
    name,
    art,
    schiff: art === "kreuzfahrt" ? "Mein Schiff" : "",
    waehrung: "EUR",
    personen: [{ id: neueId(), name: ich?.name ?? "Ich", typ: "erwachsen", alter: "", userId: ich?.id }],
    haefen: tag ? [{ id: neueId(), art: "ort", ...tag }] : [],
    hotels: [],
    ausfluege: [],
    kosten: [],
    verbindungen: [],
    zimmer: [],
    familien: [],
  };
}

aktionen["reise-neu"] = () => {
  dialogOeffnen(`<form method="dialog" class="formular" id="neuForm">
    <h3>Neue Reise</h3>
    <label>Name<input name="name" required placeholder="z. B. Sommer an der Ostsee, Mein Schiff 4 – Kanaren"></label>
    <label>Art<select name="art">${Object.entries(REISEARTEN).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join("")}</select></label>
    <div class="nur-tagesausflug formular zwei"><label>Datum<input type="date" name="datum"></label><label>Ziel<input name="ziel" placeholder="z. B. Europa-Park, Rust"></label></div>
    <p class="klein leise">Tipp: Hast du schon einen Plan (z. B. von ChatGPT)? Dann unter „Import &amp; KI“ einlesen lassen.</p>
    <div class="zeile"><span class="platz"></span><button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button><button class="knopf" value="ok">Anlegen</button></div>
  </form>`);
  const form = $("#neuForm");
  const artWechsel = () => form.classList.toggle("tagesausflug", form.art.value === "tagesausflug");
  form.art.addEventListener("change", artWechsel);
  artWechsel();
  form.addEventListener("submit", async (e) => {
    const f = new FormData(e.target);
    const art = f.get("art");
    const tag = art === "tagesausflug" ? { datum: f.get("datum") || heute(), name: String(f.get("ziel") || "Ausflugsziel").trim() } : null;
    const reise = await anfrage("/api/reisen", { method: "POST", body: neueReiseVorlage(String(f.get("name")).trim(), art, tag) });
    await reisenLaden();
    await reiseOeffnen(reise.id);
    ansichtWechseln(art === "kreuzfahrt" || art === "roadtrip" || art === "rundreise" ? "verlauf" : art === "tagesausflug" ? "plan" : "hotels");
  });
};

$("#reiseWahl").addEventListener("change", (e) => e.target.value && reiseOeffnen(e.target.value));

// ---------- Navigation: 6 Hauptbereiche, Unterbereiche, „Reise verwalten“, Kindermodus ----------

/** Hauptbereiche und ihre Ansichten (die erste ist der Einstieg). */
const GRUPPEN = {
  uebersicht: ["uebersicht"],
  reiseplan: ["plan", "verlauf", "hotels", "flug"],
  vorbereitung: ["vorbereitung"],
  unterwegs: ["unterwegs"],
  kosten: ["kosten"],
  erinnerungen: ["erlebnisse"],
  verwalten: ["personen", "daten", "einstellungen"],
  kinder: ["kinder"],
  weltkarte: ["weltkarte"],
};
const gruppeVon = (ansicht) => Object.keys(GRUPPEN).find((g) => GRUPPEN[g].includes(ansicht)) ?? "uebersicht";
const UNTER_NAMEN = () => ({
  plan: "📅 Tage & Ausflüge",
  verlauf: istKreuzfahrt() ? "🚢 Route & Häfen" : "🗺️ Reiseverlauf & Anreise",
  hotels: "🏨 Unterkünfte",
  flug: "✈️ Flug",
  personen: "👥 Reisende & Zugänge",
  daten: "📥 Import & Sicherung",
  einstellungen: "⚙️ Reise & Freigabe",
});
const letzteJeGruppe = {};

/** Ansichten mit Karte – und wie sie gezeigt wird (Liste / Geteilt / Karte, je Gerät gemerkt). */
const KARTEN_ANSICHTEN = new Set(["plan", "verlauf", "hotels", "weltkarte"]);
const schmal = () => window.matchMedia("(max-width: 900px)").matches;
function kartenModus() {
  let m = null;
  try {
    m = localStorage.getItem(`reiseplaner:karte:${schmal() ? "schmal" : "breit"}`);
  } catch {}
  return ["liste", "geteilt", "karte"].includes(m) ? m : schmal() ? "liste" : "geteilt";
}
aktionen["karten-modus"] = (el) => {
  try {
    localStorage.setItem(`reiseplaner:karte:${schmal() ? "schmal" : "breit"}`, el.dataset.modus);
  } catch {}
  navZeichnen();
  karteZeichnen();
  if (el.dataset.modus !== "liste") document.querySelector(".kartenbereich")?.scrollIntoView({ block: "nearest" });
};

function navZeichnen() {
  const gruppe = gruppeVon(zustand.ansicht);
  for (const b of document.querySelectorAll("#reiter button[data-gruppe]")) b.classList.toggle("aktiv", b.dataset.gruppe === gruppe);
  const unter = (GRUPPEN[gruppe] ?? []).filter((a) => a !== "flug" || fluege().length || zustand.ansicht === "flug");
  const namen = UNTER_NAMEN();
  const mitKarte = Boolean(zustand.reise || zustand.ansicht === "weltkarte") && KARTEN_ANSICHTEN.has(zustand.ansicht);
  const modus = mitKarte ? (zustand.ansicht === "weltkarte" && kartenModus() === "liste" ? "geteilt" : kartenModus()) : "aus";
  const leiste = $("#unterreiter");
  leiste.innerHTML = `${unter.length > 1 ? unter.map((a) => `<button data-ansicht="${a}" class="${a === zustand.ansicht ? "aktiv" : ""}">${esc(namen[a] ?? a)}</button>`).join("") : ""}
    ${mitKarte ? `<span class="platz"></span><span class="kartenwahl" role="group" aria-label="Karte">${[["liste", "☰ Liste"], ["geteilt", "◧ Geteilt"], ["karte", "🗺️ Karte"]].filter(([m]) => !(m === "liste" && zustand.ansicht === "weltkarte")).map(([m, t]) => `<button data-aktion="karten-modus" data-modus="${m}" class="${modus === m ? "aktiv" : ""}" aria-pressed="${modus === m}">${t}</button>`).join("")}</span>` : ""}`;
  leiste.hidden = !leiste.innerHTML.trim() || !zustand.reise && zustand.ansicht !== "weltkarte";
  document.body.classList.toggle("karte-aus", modus === "aus" || modus === "liste");
  document.body.classList.toggle("karte-nur", modus === "karte");
  const kinder = zustand.ansicht === "kinder";
  document.body.classList.toggle("kindermodus", kinder);
  $("#kinderleiste").hidden = !kinder;
  $("#reiter").hidden = !zustand.reise;
  for (const b of document.querySelectorAll('[data-aktion="ansicht"][data-ziel="weltkarte"]')) b.classList.toggle("aktiv", zustand.ansicht === "weltkarte");
}

$("#reiter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-gruppe]");
  if (!b) return;
  const g = b.dataset.gruppe;
  ansichtWechseln(letzteJeGruppe[g] && GRUPPEN[g].includes(letzteJeGruppe[g]) ? letzteJeGruppe[g] : GRUPPEN[g][0]);
});
$("#unterreiter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-ansicht]");
  if (b) ansichtWechseln(b.dataset.ansicht);
});
aktionen["ansicht"] = (el) => ansichtWechseln(el.dataset.ziel);
aktionen["kindermodus-ende"] = () => ansichtWechseln(zustand.vorKindern && zustand.vorKindern !== "kinder" ? zustand.vorKindern : "uebersicht");

function ansichtWechseln(ansicht) {
  if (!gruppeVon(ansicht) || !Object.values(GRUPPEN).flat().includes(ansicht)) ansicht = "uebersicht";
  if (ansicht === "kinder" && zustand.ansicht !== "kinder") zustand.vorKindern = zustand.ansicht;
  zustand.ansicht = ansicht;
  letzteJeGruppe[gruppeVon(ansicht)] = ansicht;
  alles();
  window.scrollTo({ top: 0 });
  if (ansicht === "weltkarte") weltkarteLaden().then(alles);
}

// ---------- Darstellung ----------

function alles() {
  $("#kiKnopfPlatz").innerHTML = zustand.ansicht === "kinder" ? "" : kiKnopf();
  navZeichnen();
  if (zustand.ansicht === "weltkarte") {
    inhalt.innerHTML = weltkarteAnsicht();
    karteZeichnen();
    return;
  }
  if (!zustand.reise) {
    inhalt.innerHTML = `
      <div class="leer">
        <h2>Willkommen${zustand.ich ? `, ${esc(zustand.ich.name.split(" ")[0])}` : ""}!</h2>
        <p>Lege eine Reise an – Kreuzfahrt, Hotel oder Rundreise. Danach sammelst du Ausflüge und Unterkünfte, vergleichst sie auf der Karte,
        planst die Kosten für alle Mitreisenden und hältst hinterher Bewertungen, Fotos und Tauchgänge fest.</p>
        <button class="knopf" data-aktion="reise-neu">+ Erste Reise anlegen</button>
        <p class="klein leise">Du wurdest eingeladen? Dann öffne den Einladungslink – die Reise erscheint danach hier.</p>
      </div>
      ${erinnerungBanner()}
      ${kiImportBox()}`;
    karteZeichnen();
    return;
  }
  const ansichten = { uebersicht: uebersichtAnsicht, flug: flugAnsicht, plan: planAnsicht, hotels: hotelsAnsicht, erlebnisse: erlebnisseAnsicht, kosten: kostenAnsicht, personen: personenAnsicht, verlauf: verlaufAnsicht, daten: datenAnsicht, einstellungen: einstellungenAnsicht, vorbereitung: vorbereitungAnsicht, unterwegs: unterwegsAnsicht, kinder: kinderAnsicht };
  inhalt.innerHTML = (ansichten[zustand.ansicht] ?? uebersichtAnsicht)();
  if (zustand.ansicht === "plan") nachPlan();
  if (zustand.ansicht === "unterwegs") nachUnterwegs();
  karteZeichnen();
}
setzeZeichner(alles);

/** Tagesauswahl: vorheriger/nächster Tag und direkte Auswahl – ohne verschachtelte Scrollleisten. */
function tagWahl() {
  const liste = haefen();
  if (!liste.length) {
    return `<div class="hinweis">Noch keine Tage eingetragen. <button class="link" data-aktion="zu-verlauf">${istKreuzfahrt() ? "Route eintragen" : "Reiseverlauf anlegen"} →</button>${!istKreuzfahrt() ? ` – oder unter „Unterkünfte“ ein Hotel anlegen und „Tage anlegen“ wählen.` : ""}</div>`;
  }
  const i = Math.max(0, liste.findIndex((h) => h.id === zustand.hafenId));
  const kosten = reiseKosten(zustand.reise);
  const h = liste[i];
  const amTag = ausfluegeIn(h.id).filter((a) => a.status !== "verworfen");
  const gebucht = amTag.filter((a) => a.status === "gebucht").length;
  return `<div class="tagwahl">
    <button class="knopf leise" data-aktion="tag-schritt" data-richtung="-1" ${i === 0 ? "disabled" : ""} aria-label="Vorheriger Tag">‹<span class="breit-nur"> Vorheriger</span></button>
    <select data-aktion="tag-wahl" aria-label="Tag wählen">${liste.map((t, n) => {
      const art = stationsArt(t);
      const anzahl = ausfluegeIn(t.id).filter((a) => a.status !== "verworfen").length;
      const ok = ausfluegeIn(t.id).some((a) => a.status === "gebucht");
      return `<option value="${esc(t.id)}" ${t.id === h.id ? "selected" : ""}>Tag ${n + 1} · ${esc(datumText(t.datum))} · ${art === "seetag" ? "🌊 Seetag" : `${art === "hafen" ? "⚓ " : ""}${esc(t.name || "Ort")}`}${anzahl ? ` · ${anzahl}${ok ? " ✅" : ""}` : ""}</option>`;
    }).join("")}</select>
    <button class="knopf leise" data-aktion="tag-schritt" data-richtung="1" ${i === liste.length - 1 ? "disabled" : ""} aria-label="Nächster Tag"><span class="breit-nur">Nächster </span>›</button>
  </div>
  <p class="klein leise tagwahl-info">Tag ${i + 1} von ${liste.length} · ${amTag.length} ${stationsArt(h) === "seetag" ? "an Bord" : amTag.length === 1 ? "Ausflug" : "Ausflüge"}${gebucht ? ` · ${gebucht} gebucht` : ""}${kosten.jeHafen[h.id] ? ` · ${geld(kosten.jeHafen[h.id])}` : ""}</p>`;
}

aenderungen["tag-wahl"] = (el) => {
  zustand.hafenId = el.value;
  alles();
};
aktionen["tag-schritt"] = (el) => {
  const liste = haefen();
  const i = Math.max(0, liste.findIndex((h) => h.id === zustand.hafenId));
  const neu = liste[Math.min(liste.length - 1, Math.max(0, i + Number(el.dataset.richtung)))];
  if (neu) zustand.hafenId = neu.id;
  alles();
};

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

const SORTIERUNGEN = { punkte: "Sinnvollste zuerst", stimmen: "Beliebteste (Abstimmung)", preis: "Günstigste zuerst", puffer: "Meiste Zeitreserve", beginn: "Beginn", dauer: "Längste", fahrzeit: "Kürzester Weg" };
const SORTIER_ERKLAERUNG = "„Sinnvollste zuerst“ sortiert nach einem Punktwert: Interesse (1–5 Punkte × 20) zählt am meisten, dazu die Bewertung beim Anbieter. Abgezogen werden ein hoher Preis je Person und Stunde, ein knapper Puffer bis zur festen Zeit (z. B. „Alle an Bord“) und eine lange Anfahrt. Die Punkte sind nur innerhalb eines Tages vergleichbar – bei jedem Ausflug erklärt ⓘ die Rechnung.";
aktionen["sortierung-erklaeren"] = () => alert(SORTIER_ERKLAERUNG);
aktionen["plan-darstellung"] = (el) => {
  zustand.planDarstellung = el.dataset.wert;
  alles();
};
// Auf-/Zuklappen von „Ideen & Alternativen“ je Tag merken
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.dataset?.klappe) (zustand.klappen ??= {})[d.dataset.klappe] = d.open;
}, true);
const klappeOffen = (schluessel, standard) => zustand.klappen?.[schluessel] ?? standard;

function vergleichsTabelle(liste, h) {
  return `<div class="tabelle"><table class="vergleich"><thead><tr><th>Ausflug</th><th>Zeit</th><th>Wer</th><th class="zahl">Gesamt</th><th>Status</th><th class="zahl">Puffer</th></tr></thead><tbody>
    ${liste.map(({ a, b }) => {
      const z = b.zeit;
      const dabei = personen().filter((p) => (a.teilnehmer ?? []).includes(p.id));
      const konflikt = buchungsKonflikte(zustand.reise).has(a.id);
      return `<tr class="status-${esc(a.status)}"><td data-label="Ausflug"><button class="link" data-aktion="ausflug-bearbeiten" data-id="${esc(a.id)}">${esc(a.titel)}</button>${konflikt ? " ⛔" : ""}<div class="klein leise">${esc((QUELLEN[a.quelle] ?? QUELLEN.sonstige).name)}</div></td>
        <td class="klein" data-label="Zeit">${z.start != null && z.zurueck != null ? `${z.startAngenommen ? "ca. " : ""}${minZuZeit(z.start)}–${minZuZeit(z.zurueck)}` : a.beginn ? esc(a.beginn) : "–"}</td>
        <td class="klein" data-label="Wer">${dabei.length === personen().length ? "alle" : dabei.length ? esc(dabei.map((p) => p.name.split(" ")[0]).join(", ")) : "–"}</td>
        <td class="zahl" data-label="Gesamt">${kostenText(b.kosten)}</td>
        <td class="klein" data-label="Status">${esc(STATUS[a.status] ?? "")}</td>
        <td data-label="Puffer" class="zahl ${z.puffer == null ? "" : z.puffer < 0 ? "rot" : a.quelle !== "schiff" && z.puffer < 60 ? "gelb" : "gruen"}">${z.puffer != null ? `${z.annahmen.length ? "ca. " : ""}${z.puffer < 0 ? "−" : ""}${dauerText(Math.abs(z.puffer))}` : "–"}</td></tr>`;
    }).join("")}</tbody></table></div>
    <p class="klein leise">„ca.“ = mit angenommener Zeit (Beginn oder „Alle an Bord“ fehlt). ${stationsArt(h) === "hafen" ? "Schiffsausflüge: Transfer in der Dauer enthalten." : ""}</p>`;
}

function planAnsicht() {
  const h = hafenVon(zustand.hafenId) ?? haefen()[0];
  if (h && zustand.hafenId !== h.id) zustand.hafenId = h.id;
  if (!h) return `${erinnerungBanner()}${tagWahl()}`;
  const art = stationsArt(h);
  const seetag = art === "seetag";
  const liste = ausfluegeIn(h.id).map((a) => ({ a, b: bewertung(a, h, personen(), zustand.reise) }));
  const sortierer = {
    punkte: (x, y) => y.b.punkte - x.b.punkte,
    preis: (x, y) => x.b.kosten.offen - y.b.kosten.offen || x.b.kosten.summe - y.b.kosten.summe,
    puffer: (x, y) => (y.b.zeit.puffer ?? -1e9) - (x.b.zeit.puffer ?? -1e9),
    dauer: (x, y) => (zahl(y.a.dauerMin) ?? 0) - (zahl(x.a.dauerMin) ?? 0),
    fahrzeit: (x, y) => (zahl(x.a.fahrzeitMin) ?? 0) - (zahl(y.a.fahrzeitMin) ?? 0),
    beginn: (x, y) => (zeitZuMin(x.a.beginn) ?? 9999) - (zeitZuMin(y.a.beginn) ?? 9999),
    stimmen: (x, y) => stimmenSumme(y.a) - stimmenSumme(x.a),
  };
  const sortierung = sortierer[zustand.sortierung] ? zustand.sortierung : "punkte";
  const statusRang = { gebucht: 0, favorit: 1, idee: 2, verworfen: 3 };
  const aktive = liste.filter((x) => x.a.status !== "verworfen").sort((x, y) => sortierer[sortierung](x, y) || statusRang[x.a.status] - statusRang[y.a.status]);
  const verworfen = liste.filter((x) => x.a.status === "verworfen");
  const gebucht = aktive.filter((x) => x.a.status === "gebucht").sort((x, y) => (x.b.zeit.start ?? 9999) - (y.b.zeit.start ?? 9999));
  const ideen = aktive.filter((x) => x.a.status !== "gebucht");
  // Markierungen nur unter Ausflügen mit bekanntem Preis – sonst wäre „ohne Preis“ immer am günstigsten
  const mitPreis = ideen.filter((x) => x.b.kosten.summe > 0 && !x.b.kosten.offen);
  const besteId = ideen.length > 1 ? [...ideen].sort(sortierer.punkte)[0].a.id : null;
  const guenstigsteId = mitPreis.length > 1 ? [...mitPreis].sort(sortierer.preis)[0].a.id : null;
  const karte = ({ a, b }) => ausflugKarte(a, b, h, { beste: a.id === besteId, guenstig: a.id === guenstigsteId });
  const tabelle = zustand.planDarstellung === "tabelle";
  const knoepfe = `${seetag && personen().some(istKind) ? `<button class="knopf leise" data-aktion="kinderprogramm-neu">+ Kinderprogramm</button>` : ""}${seetag ? "" : `<button class="knopf leise" data-aktion="reservierung-neu">+ Reservierung</button>`}<button class="knopf" data-aktion="ausflug-neu">+ ${seetag ? "Aktivität" : "Ausflug"}</button>`;
  const sortierFeld = `<label class="klein">Sortieren <select data-aktion="sortieren">${Object.entries(SORTIERUNGEN).map(([k, v]) => `<option value="${k}" ${sortierung === k ? "selected" : ""}>${v}</option>`).join("")}</select></label><button class="link klein" data-aktion="sortierung-erklaeren" aria-label="Wie wird sortiert?">ⓘ</button>`;
  const darstellung = aktive.length > 1 ? `<span class="segment" role="group" aria-label="Darstellung"><button data-aktion="plan-darstellung" data-wert="karten" class="${tabelle ? "" : "aktiv"}">Karten</button><button data-aktion="plan-darstellung" data-wert="tabelle" class="${tabelle ? "aktiv" : ""}">Vergleich</button></span>` : "";

  const inhaltTag = tabelle
    ? `<div class="karte-box"><div class="zeile"><h3>Vergleich (${aktive.length})</h3><span class="platz"></span>${sortierFeld}${darstellung}</div>${dublettenHinweis(h)}${vergleichsTabelle(aktive, h)}<div class="zeile">${knoepfe}</div></div>`
    : `<div class="karte-box">
        <div class="zeile"><h3>📌 ${seetag ? "Gebucht an Bord" : "Tagesablauf – gebucht"} (${gebucht.length})</h3><span class="platz"></span>${darstellung}</div>
        ${gebucht.length ? `<div class="ausfluege">${gebucht.map(karte).join("")}</div>` : `<p class="leise">Für diesen Tag ist noch nichts gebucht${ideen.length ? " – Ideen und Favoriten stehen darunter." : "."}</p>`}
        <div class="zeile">${knoepfe}</div>
      </div>
      ${ideen.length ? `<details class="karte-box klappe" data-klappe="ideen:${esc(h.id)}" ${klappeOffen(`ideen:${h.id}`, !gebucht.length) ? "open" : ""}>
        <summary><h3>💡 Ideen, Favoriten &amp; Alternativen (${ideen.length})</h3></summary>
        <div class="zeile">${sortierFeld}</div>
        ${dublettenHinweis(h)}
        <div class="ausfluege">${ideen.map(karte).join("")}</div>
      </details>` : dublettenHinweis(h)}`;

  const kopf = seetag
    ? `<div class="karte-box hafenkopf"><div><h2>🌊 Seetag</h2><div class="zeiten"><span>📅 ${esc(datumText(h.datum, { weekday: "long", day: "numeric", month: "long" }))}</span></div>
        <p class="leise klein">Zeit fürs Schiff: Spa, Friseur, Shows, Restaurants, Kinderclub, Kurse … – mit Uhrzeit, Preis und wer mitmacht.</p>${h.notiz ? `<p class="notiz">${esc(h.notiz)}</p>` : ""}</div>
        <div class="kopfknoepfe"><button class="knopf leise" data-aktion="hafen-bearbeiten" data-id="${esc(h.id)}">Tag bearbeiten</button></div></div>`
    : tagKopf(h);
  const finden = seetag
    ? ""
    : `<details class="karte-box klappe" data-klappe="finden:${esc(h.id)}" ${klappeOffen(`finden:${h.id}`, !aktive.length) ? "open" : ""}>
        <summary><h3>🔎 Weitere Ausflüge finden in ${esc(h.suchname || h.name)}</h3></summary>
        <p class="leise klein">Öffnet die Suche beim Anbieter (bei GetYourGuide mit Datum). Gefundenes mit „+ Ausflug“ eintragen – Link, Preis und Dauer übernehmen.</p>
        ${zustand.info.ki ? `<p><button class="knopf leise" data-aktion="ki-oeffnen" data-senden="1" data-frage="${esc(`Schlage für den Tag ${datumText(h.datum)} in ${h.name} (stationId ${h.id}) die 3 besten Ausflüge für unsere Familie vor – passend zum Alter der Kinder, unseren Interessen (z. B. Tauchen, Tiere, Strand, frühere Bewertungen) und einem vernünftigen Budget. Prüfe jeweils, ob wir sicher vor der festen Zeit (z. B. „Alle an Bord“) zurück sind, und lege sie mit ausflug_vorschlagen an (nur echte Anbieter und Links).`)}">✨ 3 passende Ausflüge vorschlagen</button></p>` : ""}
        ${suchLinks(h)}
        ${zustand.info.gyg ? `<div class="gyg"><button class="knopf leise" data-aktion="gyg-laden" data-id="${esc(h.id)}">GetYourGuide-Angebote hier anzeigen</button><div id="gygListe"></div></div>` : ""}
      </details>`;
  const weg = verworfen.length
    ? `<details class="karte-box klappe" data-klappe="verworfen:${esc(h.id)}" ${klappeOffen(`verworfen:${h.id}`, false) ? "open" : ""}><summary><h3 class="leise">🗑️ Verworfen (${verworfen.length})</h3></summary><div class="ausfluege">${verworfen.map(karte).join("")}</div></details>`
    : "";
  return `${erinnerungBanner()}${heuteHinweis()}${tagWahl()}${kopf}${inhaltTag}${finden}${weg}`;
}

function tagKopf(h) {
  const art = stationsArt(h);
  const start = startpunkt(h, zustand.reise.hotels);
  const landgang = zeitZuMin(h.allesAnBord || h.abfahrt) - zeitZuMin(h.ankunft);
  const fest = festeZeit(h, zustand.reise);
  const etappe = etappen(zustand.reise).find((e) => e.id === h.id);
  const verbindungen = (zustand.reise.verbindungen ?? []).filter((v) => v.status !== "verworfen" && (v.datum === h.datum || v.anDatum === h.datum));
  return `
      <div class="karte-box hafenkopf">
        <div>
          <h2>${esc(h.name)}${h.land ? `<span class="leise">, ${esc(h.land)}</span>` : ""}</h2>
          <div class="zeiten">
            <span>📅 ${esc(datumText(h.datum, { weekday: "long", day: "numeric", month: "long" }))}</span>
            ${art === "hafen" ? `<span>⚓ ${esc(h.ankunft || "–")} – ${esc(h.abfahrt || "–")}</span><span class="wichtig">⏰ Alle an Bord: ${h.allesAnBord ? esc(h.allesAnBord) : fest?.angenommen ? `ca. ${esc(fest.zeit)} <span class="annahme" title="${esc(fest.grundlage)}">angenommen</span>` : "–"}</span>${Number.isFinite(landgang) && landgang > 0 ? `<span>Landgang: ${dauerText(landgang)}</span>` : ""}` : ""}
            ${art !== "hafen" && fest ? `<span class="wichtig">⏰ ${esc(fest.titel)}${fest.kurz.startsWith("Check-out") || !/um \d/.test(fest.titel) ? ` ${esc(fest.zeit)}` : ""}</span>` : ""}
            ${start?.hotel ? `<span>🏨 Start: ${esc(start.name)}</span>` : art === "ort" && zustand.reise.art !== "tagesausflug" ? `<span class="leise">Keine Unterkunft für diesen Tag – <button class="link" data-aktion="zu-hotels">Unterkunft eintragen</button></span>` : ""}
            ${etappe ? `<span>${ETAPPEN_SYMBOL[etappe.mittel] ?? "🚗"} ${esc(etappe.von)} → ${esc(etappe.nach)}: ${etappe.mittel === "auto" ? `${etappe.berechnet ? "" : "ca. "}${etappe.km} km${etappe.min ? ` · ${dauerText(etappe.min)}` : ""}` : `${esc(VERKEHRSMITTEL[etappe.mittel]?.name.replace(/^\S+\s/, "") ?? "")} (Luftlinie ca. ${etappe.km} km)`}</span>` : ""}
          </div>
          ${verbindungen.length ? `<ul class="ablauf klein">${verbindungen.map((v) => `<li>${verbindungText(v)}</li>`).join("")}</ul>` : ""}
          ${fest?.angenommen && art === "hafen" ? `<p class="klein annahme-text">ℹ️ Rückkehrzeiten rechnen mit ${esc(fest.grundlage)} – bitte „Alle an Bord“ unter „Tag bearbeiten“ eintragen.</p>` : ""}
          ${hatKoord(h) ? "" : `<p class="klein warnung">📍 Noch kein Kartenpunkt – <button class="link" data-aktion="orte-suchen">automatisch suchen</button> oder unter „Tag bearbeiten“ eintragen.</p>`}
          <div id="wetter" class="wetter"></div>
          ${h.notiz ? `<p class="notiz">${esc(h.notiz)}</p>` : ""}
        </div>
        <div class="kopfknoepfe">
          ${hatKoord(h) ? `<a class="knopf leise" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}">Google Maps ↗</a>` : ""}
          <button class="knopf leise" data-aktion="hafen-bearbeiten" data-id="${esc(h.id)}">Tag bearbeiten</button>
        </div>
      </div>`;
}

// „Heute vor … Jahren“ – einmal je Tag, wegklickbar
function erinnerungBanner() {
  const liste = zustand.erinnerungen ?? [];
  let weg = "";
  try {
    weg = localStorage.getItem("reiseplaner:erinnerung-weg") ?? "";
  } catch {}
  if (!liste.length || weg === heute()) return "";
  const e = liste[0];
  return `<div class="karte-box erinnerung">
    <button class="link weg" data-aktion="erinnerung-weg" aria-label="Schließen">✕</button>
    <h3>💭 Heute vor ${e.jahre} ${e.jahre === 1 ? "Jahr" : "Jahren"}${liste.length > 1 ? ` <span class="leise klein">(+${liste.length - 1} weitere)</span>` : ""}</h3>
    <p>${e.art === "seetag" ? `wart ihr auf See – ${esc(e.reise)}` : `wart ihr in <strong>${esc(e.name)}</strong>${e.land ? `, ${esc(e.land)}` : ""}`} <span class="leise">(${esc(e.reise)})</span>${e.ausfluege.length ? `<br><span class="klein">${e.ausfluege.map(esc).join(" · ")}</span>` : ""}</p>
    ${e.fotos.length ? `<div class="fotoleiste">${e.fotos.map((f) => `<span class="foto"><a href="/api/reisen/${esc(e.reiseId)}/fotos/${esc(f)}" target="_blank"><img loading="lazy" src="/api/reisen/${esc(e.reiseId)}/fotos/${esc(f)}?klein=1" alt=""></a></span>`).join("")}</div>` : ""}
    ${zustand.reise?.id !== e.reiseId ? `<button class="link" data-aktion="reise-wechseln" data-id="${esc(e.reiseId)}">Reise öffnen →</button>` : ""}
  </div>`;
}

// Auf Reise: Hinweis auf Tagesbriefing und Wecker
function heuteHinweis() {
  const t = haefen().find((h) => h.datum === heute());
  if (!t) return "";
  return `<div class="hinweis heute"><strong>Heute: ${stationsArt(t) === "seetag" ? "🌊 Seetag" : esc(t.name)}</strong>${t.allesAnBord ? ` · ⏰ Alle an Bord ${esc(t.allesAnBord)}` : ""} <button class="link" data-aktion="zu-unterwegs">Tagesbriefing &amp; Rückweg →</button></div>`;
}

aktionen["erinnerung-weg"] = () => {
  try {
    localStorage.setItem("reiseplaner:erinnerung-weg", heute());
  } catch {}
  alles();
};
aktionen["reise-wechseln"] = (el) => reiseOeffnen(el.dataset.id);
aktionen["zu-unterwegs"] = () => ansichtWechseln("unterwegs");

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
      ${a.oeffnungszeiten ? `<p class="klein leise">🕑 ${esc(a.oeffnungszeiten)}</p>` : ""}
      <div class="werte">
        <div><span>Zeit</span><strong>${a.beginn && z.start != null ? `${minZuZeit(z.start)} – ${minZuZeit(z.zurueck ?? NaN)}` : "–"}</strong><em>${dauerText(zahl(a.dauerMin))}</em></div>
        <div><span>Weg ab ${start?.hotel ? "Hotel" : art === "hafen" ? "Schiff" : "Start"}</span><strong>${inklusive ? "inklusive" : a.fahrzeitMin ? `${Math.round(a.fahrzeitMin)} Min.` : "–"}</strong><em>${a.km ? `${a.km.toFixed(1).replace(".", ",")} km` : inklusive ? "Bus ab Pier" : ""}</em></div>
        ${z.fest ? `<div class="${pufferKlasse}" title="${esc([z.rechenweg, ...z.annahmen].filter(Boolean).join(" · "))}"><span>Puffer bis ${esc(z.fest.kurz === "Alle an Bord" ? "an Bord" : z.fest.kurz)}</span><strong>${z.puffer != null ? `${z.annahmen.length ? "ca. " : ""}${z.puffer < 0 ? "−" : ""}${dauerText(Math.abs(z.puffer))}` : "–"}</strong><em>${z.puffer != null ? (z.annahmen.length ? "mit Annahme" : `zurück ${minZuZeit(z.zurueck)}`) : zahl(a.dauerMin) == null ? "Dauer fehlt" : ""}</em></div>` : ""}
        <div><span>Kosten</span><strong>${kostenText(k)}</strong><em>${k.erwachsene} Erw. · ${k.kinder} Ki.</em></div>
        <div><span>€/Pers./Std.</span><strong>${b.proPersonStunde != null ? geld(b.proPersonStunde) : "–"}</strong><em>${a.sterne ? `★ ${String(a.sterne).replace(".", ",")}` : ""}</em></div>
        <div title="${esc(punkteErklaerung(a, b))}"><span>Interesse</span><strong>${"●".repeat(zahl(a.interesse) ?? 3)}${"○".repeat(5 - (zahl(a.interesse) ?? 3))}</strong><em>${b.punkte} Pkt. <button class="link klein" data-aktion="punkte-erklaeren" data-text="${esc(punkteErklaerung(a, b))}" aria-label="Punkte erklären">ⓘ</button></em></div>
      </div>
      ${z.puffer != null ? `<p class="klein leise rechenweg">⏱️ ${esc(z.rechenweg)}${z.annahmen.length ? `<br><span class="annahme-text">Annahme: ${esc(z.annahmen.join("; "))}</span>` : ""}</p>` : ""}
      ${z.warnungen.length ? `<ul class="warnungen">${z.warnungen.map((w) => `<li>⚠️ ${esc(w)}</li>`).join("")}</ul>` : ""}
      ${konfliktZeilen(a)}
      ${alternativenZeile(a)}
      ${kiCheckAnzeige(a)}
      ${a.status !== "verworfen" && personen().length > 1 ? stimmenLeiste(a) : ""}
      <div class="ausflug-fuss">
        <span class="klein leise">${namen.length === personen().length ? "Alle dabei" : namen.length ? esc(namen.join(", ")) : "Niemand ausgewählt"}</span>
        <span class="knoepfe">
          ${gm ? `<a class="link" href="${esc(gm)}" target="_blank" rel="noopener">Route ↗</a>` : ""}
          <button class="link" data-aktion="auf-karte" data-id="${esc(a.id)}">Karte</button>
          ${zustand.info.ki ? `<button class="link" data-aktion="ki-oeffnen" data-frage="${esc(frage)}">KI fragen</button>` : ""}
          ${zustand.info.ki && a.quelle !== "schiff" && a.status !== "verworfen" && (z.fest || a.link) ? `<button class="link" data-aktion="ausflug-check" data-id="${esc(a.id)}">✨ Rechtzeitig zurück?</button>` : ""}
          ${a.kategorie === "tauchen" && a.status === "gebucht" ? `<button class="link" data-aktion="tauchgang-neu" data-ausflug="${esc(a.id)}">🤿 Loggen</button>` : ""}
          ${a.status !== "verworfen" ? `<button class="link" data-aktion="alternative-waehlen" data-id="${esc(a.id)}">⇄ Alternative</button>` : ""}
          <button class="link" data-aktion="ausflug-bearbeiten" data-id="${esc(a.id)}">Bearbeiten</button>
        </span>
      </div>
      ${a.status === "gebucht" || zustand.beitraege.bewertungen.some((x) => x.zielId === a.id) ? bewertungsZeile("ausflug", a.id) : ""}
      ${a.notiz ? `<details class="klein"><summary>Notiz</summary><p class="notiz">${esc(a.notiz)}</p></details>` : ""}
    </article>`;
}

/** „Preis offen“ statt 0 € – bei teilweise bekanntem Preis „ab …“. */
export function kostenText(k) {
  if (!k.offen) return geld(k.summe);
  return k.summe > 0 ? `ab ${geld(k.summe)} <span class="preis-offen">+ offen</span>` : `<span class="preis-offen">Preis offen</span>`;
}

const ETAPPEN_SYMBOL = { auto: "🚗", flug: "✈️", faehre: "⛴️", zug: "🚆", bus: "🚌" };

aktionen["punkte-erklaeren"] = (el) => alert(`${el.dataset.text}\n\nDer Punktwert hilft nur beim Sortieren („Sinnvollste zuerst“): Interesse zählt am meisten, ein hoher Preis je Stunde, knapper Puffer und lange Anfahrt ziehen ab.`);

// ---------- Buchungskonflikte, Alternativen, mögliche Dubletten ----------

function konfliktZeilen(a) {
  const liste = buchungsKonflikte(zustand.reise).get(a.id) ?? [];
  if (!liste.length) return "";
  return `<ul class="warnungen konflikt">${liste.map((k) => `<li>⛔ ${esc(k.grund)} mit „${esc(k.mit.titel)}“ (gebucht)${k.personen.length ? ` – betrifft ${esc(k.personen.join(", "))}` : ""}${k.angenommen ? " <span class='annahme-text'>(Beginn teils angenommen)</span>" : ""}</li>`).join("")}</ul>`;
}

function alternativenZeile(a) {
  const ids = a.alternativen ?? [];
  const andere = zustand.reise.ausfluege.filter((x) => ids.includes(x.id) || (x.alternativen ?? []).includes(a.id));
  if (!andere.length) return "";
  return `<p class="klein alternativen">⇄ Alternative zu: ${andere.map((x) => `<strong>${esc(x.titel)}</strong> <span class="leise">(${esc(STATUS[x.status] ?? "")})</span> <button class="link klein" data-aktion="alternative-loesen" data-a="${esc(a.id)}" data-b="${esc(x.id)}" aria-label="Verknüpfung lösen">✕</button>`).join(" · ")}</p>`;
}

function dublettenHinweis(h) {
  const paare = moeglicheDubletten(ausfluegeIn(h.id));
  if (!paare.length) return "";
  return `<div class="hinweis dubletten"><strong>🔁 Mögliche Dubletten (${paare.length})</strong> – bitte prüfen, nichts wird automatisch zusammengeführt:
    <ul class="klein">${paare.map(([x, y]) => `<li>„${esc(x.titel)}“ <span class="leise">(${esc(STATUS[x.status])}${x.beginn ? `, ${esc(x.beginn)}` : ""})</span> und „${esc(y.titel)}“ <span class="leise">(${esc(STATUS[y.status])}${y.beginn ? `, ${esc(y.beginn)}` : ""})</span>
      <span class="knoepfe"><button class="link" data-aktion="dublette-alternative" data-a="${esc(x.id)}" data-b="${esc(y.id)}">Als Alternativen verknüpfen</button> · <button class="link" data-aktion="dublette-nein" data-a="${esc(x.id)}" data-b="${esc(y.id)}">Keine Dublette</button></span></li>`).join("")}</ul>
    <span class="klein leise">Ist es doppelt, den überflüssigen Eintrag über „Bearbeiten“ verwerfen oder löschen.</span></div>`;
}

const ausflugMit = (id) => zustand.reise.ausfluege.find((x) => x.id === id);
function verknuepfen(feld, idA, idB, an = true) {
  for (const [x, y] of [[idA, idB], [idB, idA]]) {
    const a = ausflugMit(x);
    if (!a) continue;
    const liste = new Set(a[feld] ?? []);
    if (an) liste.add(y);
    else liste.delete(y);
    a[feld] = [...liste];
    if (!a[feld].length) delete a[feld];
  }
  speichern();
  alles();
}
aktionen["dublette-alternative"] = (el) => verknuepfen("alternativen", el.dataset.a, el.dataset.b);
aktionen["dublette-nein"] = (el) => verknuepfen("keineDublette", el.dataset.a, el.dataset.b);
aktionen["alternative-loesen"] = (el) => verknuepfen("alternativen", el.dataset.a, el.dataset.b, false);
aktionen["alternative-waehlen"] = (el) => {
  const a = ausflugMit(el.dataset.id);
  const kandidaten = ausfluegeIn(a.hafenId).filter((x) => x.id !== a.id && x.status !== "verworfen");
  if (!kandidaten.length) return alert("An diesem Tag gibt es keinen weiteren Ausflug, der eine Alternative sein könnte.");
  dialogOeffnen(`<form method="dialog" class="formular" id="altForm">
    <h3>⇄ Alternativen zu „${esc(a.titel)}“</h3>
    <p class="klein leise">Alternativen schließen sich aus: Ist mehr als eine davon gebucht, erscheint ein Hinweis. Sie bleiben getrennte Einträge.</p>
    <div class="teilnehmer spalte">${kandidaten.map((x) => `<label class="haken"><input type="checkbox" name="alt" value="${esc(x.id)}" ${(a.alternativen ?? []).includes(x.id) || (x.alternativen ?? []).includes(a.id) ? "checked" : ""}> ${esc(x.titel)} <span class="leise klein">(${esc(STATUS[x.status])}${x.beginn ? `, ${esc(x.beginn)}` : ""})</span></label>`).join("")}</div>
    <div class="zeile"><span class="platz"></span><button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button><button class="knopf" value="ok">Speichern</button></div>
  </form>`);
  $("#altForm").addEventListener("submit", () => {
    const gewaehlt = new Set(new FormData($("#altForm")).getAll("alt"));
    for (const x of kandidaten) {
      const an = gewaehlt.has(x.id);
      for (const [p, q] of [[a, x], [x, a]]) {
        const l = new Set(p.alternativen ?? []);
        if (an) l.add(q.id);
        else l.delete(q.id);
        p.alternativen = [...l];
        if (!p.alternativen.length) delete p.alternativen;
      }
    }
    speichern();
    alles();
  });
};

// ---------- Abstimmen: Wer will mit? ----------

const STIMME = { 1: "👍", "-1": "👎" };
function stimmenLeiste(a) {
  const s = zustand.extras.stimmen?.[a.id] ?? {};
  const dafuer = Object.values(s).filter((x) => x === 1).length;
  const dagegen = Object.values(s).filter((x) => x === -1).length;
  const fam = zustand.reise.familien ?? [];
  const jeFamilie = fam.length > 1 ? fam.map((f) => {
    const ids = personen().filter((p) => p.familie === f.id).map((p) => p.id);
    const ja = ids.filter((id) => s[id] === 1).length;
    const nein = ids.filter((id) => s[id] === -1).length;
    return ja || nein ? `${esc(f.name)}: 👍${ja}${nein ? ` 👎${nein}` : ""}` : "";
  }).filter(Boolean).join(" · ") : "";
  return `<div class="stimmen"><span class="klein leise">Wer will?${dafuer || dagegen ? ` <strong>👍 ${dafuer}</strong> · 👎 ${dagegen}` : ""}${jeFamilie ? ` <span class="klein">(${jeFamilie})</span>` : ""}</span>
    ${personen().map((p) => `<button class="stimme ${s[p.id] === 1 ? "ja" : s[p.id] === -1 ? "nein" : ""}" data-aktion="stimme" data-a="${esc(a.id)}" data-p="${esc(p.id)}" title="${esc(p.name)}: antippen zum Abstimmen">${esc(p.name.split(" ")[0])} ${STIMME[s[p.id]] ?? "·"}</button>`).join("")}</div>`;
}
const stimmenSumme = (a) => Object.values(zustand.extras.stimmen?.[a.id] ?? {}).reduce((x, y) => x + y, 0);

// Schnelles Tippen: Stimmen nacheinander senden, sofort anzeigen
let stimmKette = Promise.resolve();
aktionen["stimme"] = (el) => {
  const { a, p } = el.dataset;
  const s = (zustand.extras.stimmen[a] ??= {});
  const wert = !s[p] ? 1 : s[p] === 1 ? -1 : 0;
  if (wert) s[p] = wert;
  else delete s[p];
  alles();
  stimmKette = stimmKette.then(async () => {
    try {
      await anfrage(`/api/reisen/${zustand.reise.id}/stimmen`, { method: "PUT", body: { ausflugId: a, personId: p, wert } });
    } catch (e) {
      alert(e.message);
      await extrasLaden();
      alles();
    }
  });
};

// ---------- KI: Ist der Ausflug rechtzeitig zurück? ----------

function kiCheckAnzeige(a) {
  const c = zustand.extras.checks?.[a.id];
  if (!c) return "";
  const farbe = { gruen: "🟢", gelb: "🟡", rot: "🔴" }[c.ampel] ?? "🟡";
  return `<details class="kicheck ${esc(c.ampel)}"><summary>${farbe} KI-Check: ${esc(c.zusammenfassung)}</summary>
    ${c.rueckkehr ? `<p class="klein">Zurück am Schiff ca. <strong>${esc(c.rueckkehr)}</strong>${c.pufferMin != null ? ` · Puffer ${esc(String(c.pufferMin))} Min.` : ""}</p>` : ""}
    ${c.risiken.length ? `<ul class="klein">${c.risiken.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    ${c.empfehlung ? `<p class="klein"><strong>Empfehlung:</strong> ${esc(c.empfehlung)}</p>` : ""}
    ${c.quellen.length ? `<p class="klein leise">Quellen: ${c.quellen.map((q) => linkHtml(q, esc(new URL(q).hostname))).join(", ")}</p>` : ""}
    <p class="klein leise">Geprüft ${esc(new Date(c.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }))} – ohne Gewähr, bitte beim Anbieter bestätigen lassen.</p></details>`;
}

aktionen["ausflug-check"] = async (el) => {
  el.disabled = true;
  el.textContent = "✨ Prüfe (ca. 1 Min.) …";
  try {
    zustand.extras.checks[el.dataset.id] = await anfrage(`/api/reisen/${zustand.reise.id}/ausflug-check`, { method: "POST", body: { ausflugId: el.dataset.id } });
    alles();
  } catch (e) {
    el.disabled = false;
    el.textContent = "✨ Rechtzeitig zurück?";
    alert(e.message);
  }
};

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
  $("#wetter").innerHTML = `${symbol} ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])} °C · Regen ${d.precipitation_probability_max[0] ?? "–"} % · Wind ${Math.round(d.wind_speed_10m_max[0])} km/h · Sonnenuntergang ${String(d.sunset[0]).slice(11, 16)}${planBHtml(h, d, ort)}`;
}

/** Wetter-Plan B: bei Regen, Gewitter oder Sturm Alternativen für Ausflüge im Freien. */
function planBHtml(h, wetter, ort) {
  const b = planB(wetter, ausfluegeIn(h.id));
  if (!b) return "";
  const suche = (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${ort.lat},${ort.lng},13z`;
  const frage = `Für ${datumText(h.datum)} in ${h.name} (stationId ${h.id}) ist ${b.grund} gemeldet.${b.betroffen.length ? ` Betroffen: ${b.betroffen.map((a) => a.titel).join(", ")}.` : ""} Schlag uns einen Plan B für die Familie vor (Indoor oder wetterfest, kindgerecht, mit Blick auf die feste Zeit des Tages) und lege passende Alternativen mit ausflug_vorschlagen an.`;
  return `<div class="planb">
    <strong>🌧️ Plan B: ${esc(b.grund)} gemeldet</strong>
    ${b.betroffen.length ? `<div class="klein">Betrifft: ${b.betroffen.map((a) => esc(a.titel)).join(", ")}</div>` : ""}
    <div class="links">${PLAN_B_IDEEN.map(([e, q]) => `<a class="linkchip" target="_blank" rel="noopener" href="${suche(q)}">${e} ${esc(q)}</a>`).join("")}</div>
    ${zustand.info.ki ? `<button class="knopf leise" data-aktion="ki-oeffnen" data-senden="1" data-frage="${esc(frage)}">✨ Plan B von der KI</button>` : ""}
  </div>`;
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
    .map((h) => {
      const gewaehlt = ausfluegeIn(h.id).filter((a) => a.status === "gebucht" || a.status === "favorit");
      if (!gewaehlt.length) return "";
      return `<tr><td>${esc(datumText(h.datum))}</td><td>${esc(h.name)}</td><td>${gewaehlt.map((a) => `${esc(a.titel)} <span class="leise klein">(${STATUS[a.status]}, ${kostenText(ausflugKosten(a, ps))})</span>`).join("<br>")}</td><td class="zahl">${geld(k.jeHafen[h.id] ?? 0)}</td></tr>`;
    })
    .join("");
  const hotelZeilen = r.hotels
    .filter((h) => h.status === "gebucht" || h.status === "favorit")
    .map((h) => `<tr><td>${esc(h.name)} <span class="leise klein">(${STATUS[h.status]})</span></td><td class="klein">${esc(datumText(h.anreise))} – ${esc(datumText(h.abreise))}</td><td class="zahl">${geld(hotelKosten(h, ps, zimmerVon(r, h.id)).summe)}</td></tr>`)
    .join("");
  const offenHinweis = k.offen.length
    ? `<div class="hinweis warnung-box"><strong>⚠️ Summen unvollständig:</strong> ${k.offen.length} gezählte ${k.offen.length === 1 ? "Posten hat" : "Posten haben"} noch keinen Preis – sie zählen bisher mit 0 €.
      <details class="klein"><summary>Welche?</summary><ul>${k.offen.map((o) => `<li>${esc(o.art)}: ${esc(o.titel)} <span class="leise">(${esc(STATUS[o.status] ?? "")}${o.teilweise ? ", Preis teilweise bekannt" : ""})</span></li>`).join("")}</ul></details></div>`
    : "";
  return `
    ${offenHinweis}
    <div class="kacheln">
      <div class="kachel"><span>Gebucht</span><strong>${geld(k.gebucht)}</strong></div>
      <div class="kachel"><span>Gebucht + Favoriten</span><strong>${geld(k.geplant)}</strong></div>
      <div class="kachel"><span>Je Person (Ø)</span><strong>${geld(ps.length ? k.geplant / ps.length : 0)}</strong></div>
    </div>
    ${zustand.extras.ausgaben.length ? `<div class="hinweis">Unterwegs tatsächlich ausgegeben: <strong>${geld(zustand.extras.ausgaben.reduce((sum, x) => sum + inReisewaehrung(x, r), 0))}</strong> (davon an Bord ${geld(bordkonto(zustand.extras.ausgaben, r).summe)}) <button class="link" data-aktion="zu-unterwegs">Bordkonto &amp; Abrechnung →</button></div>` : ""}
    <div class="kacheln klein-kacheln">
      <div class="kachel"><span>Ausflüge</span><strong>${geld(k.ausfluege.geplant)}</strong></div>
      <div class="kachel"><span>Unterkünfte</span><strong>${geld(k.hotels.geplant)}</strong></div>
      ${k.verbindungen.geplant ? `<div class="kachel"><span>Anreise &amp; Verbindungen</span><strong>${geld(k.verbindungen.geplant)}</strong></div>` : ""}
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
    ${(r.familien ?? []).length ? `<div class="karte-box">
      <h3>Je Familie</h3>
      <label class="klein">Gemeinsame Kosten (Unterkunft ohne Zimmerpreise, weitere Kosten, Verbindungen) aufteilen
        <select data-reise="kostenTeilung"><option value="kopf" ${r.kostenTeilung !== "familie" ? "selected" : ""}>nach Köpfen</option><option value="familie" ${r.kostenTeilung === "familie" ? "selected" : ""}>zu gleichen Teilen je Familie</option></select></label>
      <div class="tabelle"><table><tbody>${Object.entries(k.jeFamilie).map(([f, betrag]) => `<tr><td>${esc(familienName(f))}</td><td class="leise klein">${ps.filter((p) => familieVon(p, r) === f).map((p) => esc(p.name)).join(", ")}</td><td class="zahl">${geld(betrag)}</td></tr>`).join("")}</tbody></table></div>
      <p class="leise klein">Ausflüge zählen nach Teilnahme, Zimmer mit Preis für ihre Bewohner.</p>
    </div>` : ""}
    <div class="karte-box">
      <h3>Je Person</h3>
      <div class="tabelle"><table><thead><tr><th>Name</th><th></th><th class="zahl">Anteil</th></tr></thead>
      <tbody>${ps.map((p) => `<tr><td>${esc(p.name)}</td><td class="leise">${istKind(p) ? `Kind${p.alter ? `, ${esc(p.alter)} J.` : ""}` : "Erwachsen"}</td><td class="zahl">${geld(k.jePerson[p.id] ?? 0)}</td></tr>`).join("")}</tbody></table></div>
      <p class="leise klein">Ausflüge nach Teilnahme; Gruppenpreise und Zusatzkosten unter den Teilnehmenden; Zimmer/Kabinen mit Preis für ihre Bewohner; Verbindungen für die Mitreisenden; Unterkünfte und weitere Kosten ${r.kostenTeilung === "familie" ? "je Familie" : "nach Köpfen"} verteilt.</p>
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

export function familienName(id) {
  if (String(id).startsWith("person:")) return personen().find((p) => p.id === id.slice(7))?.name ?? "?";
  return zustand.reise.familien?.find((f) => f.id === id)?.name ?? "Ohne Familie";
}

/** Eigene Familie (über die Person, die mit meinem Konto verknüpft ist). */
const meineFamilie = () => personen().find((p) => p.userId === zustand.ich?.id)?.familie ?? null;
const darfEinladen = (p) => istPlaner() || (zustand.rolle === "familienplaner" && p?.familie && p.familie === meineFamilie());

function familienBox() {
  const r = zustand.reise;
  const fam = r.familien ?? [];
  const zimmerVonPerson = (pid) => (r.zimmer ?? []).filter((z) => (z.personen ?? []).includes(pid));
  return `<div class="karte-box">
    <div class="zeile"><h3>👨‍👩‍👧 Familien / Haushalte</h3><span class="platz"></span><button class="knopf leise" data-aktion="familie-neu">+ Familie</button></div>
    <p class="leise klein">Reisen mehrere Familien zusammen, ordnet jede Person ihrer Familie zu: Kosten je Familie, Abrechnung zwischen Familien, Packliste je Familie, Abstimmungen zusammengefasst. Eine „Familien-Planer/in“ darf die eigene Familie einladen.</p>
    ${fam.length ? `<div class="familien">${fam.map((f) => `<div class="familie" style="--farbe:${esc(f.farbe ?? "#0b5394")}">
      <input data-familie="${esc(f.id)}" value="${esc(f.name)}" aria-label="Name der Familie" maxlength="60">
      <span class="klein leise">${personen().filter((p) => p.familie === f.id).map((p) => esc(p.name)).join(", ") || "noch niemand"}</span>
      <button class="link rot" data-aktion="familie-loeschen" data-id="${esc(f.id)}" aria-label="Familie entfernen">✕</button></div>`).join("")}</div>` : ""}
    ${r.zimmer?.length ? `<p class="klein">🛏️ ${personen().map((p) => `${esc(p.name)}: ${zimmerVonPerson(p.id).map((z) => esc(z.nummer || "?")).join(", ") || "–"}`).join(" · ")}</p>` : ""}
  </div>`;
}

const FARBEN = ["#0b5394", "#c2185b", "#2e7d32", "#ef6c00", "#6a1b9a", "#00838f"];
aktionen["familie-neu"] = () => {
  const r = zustand.reise;
  const name = prompt("Name der Familie, z. B. „Familie Meier“");
  if (!name?.trim()) return;
  r.familien.push({ id: neueId(), name: name.trim().slice(0, 60), farbe: FARBEN[r.familien.length % FARBEN.length] });
  speichern();
  alles();
};
aktionen["familie-loeschen"] = (el) => {
  if (!confirm("Familie entfernen? (Die Personen bleiben, nur die Zuordnung fällt weg.)")) return;
  const r = zustand.reise;
  r.familien = r.familien.filter((f) => f.id !== el.dataset.id);
  for (const p of r.personen) if (p.familie === el.dataset.id) delete p.familie;
  speichern();
  alles();
};

function personenAnsicht() {
  return `${personenListe()}${familienBox()}`;
}

function personenListe() {
  const ps = personen();
  const konten = zustand.mitglieder;
  const kontoName = (id) => konten.find((m) => m.userId === id)?.name;
  const fam = zustand.reise.familien ?? [];
  return `
    <div class="karte-box">
      <h3>Mitreisende (${ps.filter((p) => !istKind(p)).length} Erwachsene, ${ps.filter(istKind).length} Kinder)</h3>
      <p class="leise klein">Das Alter der Kinder zählt für Kinderpreise. Wer bei einem Ausflug nicht mitkommt, wählst du im Ausflug ab. Über „Einladen“ bekommt jede/r ein eigenes Konto – zum Mitplanen, Bewerten und für das eigene Tauchlog.</p>
      <div class="personen">
        ${ps.map((p) => `<div class="person" data-id="${esc(p.id)}">
          <input data-feld="name" value="${esc(p.name)}" aria-label="Name">
          <select data-feld="typ" aria-label="Erwachsen oder Kind"><option value="erwachsen" ${!istKind(p) ? "selected" : ""}>Erwachsen</option><option value="kind" ${istKind(p) ? "selected" : ""}>Kind</option></select>
          <input data-feld="alter" type="number" min="0" max="17" value="${esc(p.alter ?? "")}" placeholder="Alter" aria-label="Alter" ${istKind(p) ? "" : "disabled"}>
          ${fam.length ? `<select data-feld="familie" aria-label="Familie"><option value="">– Familie –</option>${fam.map((f) => `<option value="${esc(f.id)}" ${p.familie === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>` : ""}
          <span class="klein">${p.userId ? `👤 ${esc(kontoName(p.userId) ?? "Konto")}` : darfEinladen(p) ? `<button class="link" data-aktion="einladen" data-person="${esc(p.id)}">Einladen</button>` : ""}</span>
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
      ${zustand.rolle === "familienplaner" ? `<p class="klein leise">Als Familien-Planer/in lädst du über „Einladen“ neben den Personen deiner Familie ein.</p>` : ""}
      ${konten.some((m) => m.geloescht) ? `<p class="klein warnung">⚠️ ${konten.filter((m) => m.geloescht).length} Zugang/Zugänge gehören zu gelöschten Konten. ${istPlaner() ? "Mit „Entfernen“ aufräumen – Tauchgänge und Bewertungen bleiben erhalten." : ""}</p>` : ""}
      <div class="tabelle"><table><tbody>${konten.map((m) => `<tr class="${m.geloescht ? "leise" : ""}"><td>${esc(m.name)}${m.userId === zustand.ich.id ? " <span class='leise'>(du)</span>" : ""}<div class="klein leise">${esc(m.email)}</div></td>
        <td>${istPlaner() && m.userId !== zustand.ich.id ? `<select data-aktion="mitglied-rolle" data-id="${esc(m.userId)}"><option value="mitreisend" ${m.rolle === "mitreisend" || !m.rolle ? "selected" : ""}>Mitreisend</option><option value="familienplaner" ${m.rolle === "familienplaner" ? "selected" : ""}>Familien-Planer/in</option><option value="planer" ${m.rolle === "planer" ? "selected" : ""}>Planer/in</option></select>` : { planer: "Planer/in", familienplaner: "Familien-Planer/in" }[m.rolle] ?? "Mitreisend"}</td>
        <td>${istPlaner() && m.userId !== zustand.ich.id ? `<button class="link rot" data-aktion="mitglied-entfernen" data-id="${esc(m.userId)}">Entfernen</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="leise klein">Mitreisende sehen und bearbeiten den Plan, bewerten und führen ihr Tauchlog. Planer/innen laden zusätzlich ein und verwalten den Zugang; Familien-Planer/innen laden die Personen ihrer eigenen Familie ein.</p>
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
  return `
    <div class="karte-box">
      <div class="zeile"><h3>${istKreuzfahrt() ? "Route" : "Tage"}</h3>${haefen().some((h) => stationsArt(h) !== "seetag" && !hatKoord(h)) ? `<button class="knopf leise" data-aktion="orte-suchen">📍 Fehlende Orte auf der Karte suchen</button>` : ""}<button class="knopf" data-aktion="hafen-neu">+ ${istKreuzfahrt() ? "Hafen / Seetag" : "Tag / Ort"}</button></div>
      <p class="leise klein">${istKreuzfahrt() ? "Die Zeiten stehen im Reiseplan bzw. in der Mein-Schiff-App. „Alle an Bord“ ist meist 30 Min. vor Abfahrt." : "Tage im Hotel kannst du auch unter „Unterkünfte“ → „Tage anlegen“ erzeugen; Startpunkt der Ausflüge ist dann das Hotel."}</p>
      <div class="tabelle"><table class="haefen">
        <thead><tr><th>Datum</th><th>Ort</th>${istKreuzfahrt() ? "<th>Ankunft</th><th>Abfahrt</th><th>Alle an Bord</th>" : ""}<th>Karte</th><th></th></tr></thead>
        <tbody>${haefen()
          .map((h) => `<tr>
            <td>${esc(datumText(h.datum))}</td>
            <td>${stationsArt(h) === "seetag" ? "🌊 Seetag" : hatKoord(h) ? `<button class="link" data-aktion="flieg" data-lat="${h.lat}" data-lng="${h.lng}" data-zoom="12">${stationsArt(h) === "hafen" ? "⚓" : "📍"} ${esc(h.name)}</button>` : `${stationsArt(h) === "hafen" ? "⚓" : "📍"} ${esc(h.name)}`}${h.land ? ` <span class="leise klein">${esc(h.land)}</span>` : ""}</td>
            ${istKreuzfahrt() ? `<td>${esc(h.ankunft ?? "")}</td><td>${esc(h.abfahrt ?? "")}</td><td>${esc(h.allesAnBord ?? "")}</td>` : ""}
            <td>${stationsArt(h) === "seetag" ? "" : hatKoord(h) ? "✓" : `<span class="warnung">fehlt</span>`}</td>
            <td><button class="link" data-aktion="hafen-bearbeiten" data-id="${esc(h.id)}">Bearbeiten</button></td>
          </tr>`)
          .join("") || `<tr><td colspan="7" class="leise">Noch keine Tage eingetragen.</td></tr>`}</tbody>
      </table></div>
    </div>
    ${verbindungenBox()}
    ${!istKreuzfahrt() ? etappenBox() : ""}`;
}

// ---------- Reise verwalten: Name, Art, Freigabe – Löschen getrennt vom normalen Bearbeiten ----------

function einstellungenAnsicht() {
  const r = zustand.reise;
  return `
    <div class="karte-box">
      <h3>Reise</h3>
      <div class="formular drei">
        <label>Name<input data-reise="name" value="${esc(r.name)}"></label>
        <label>Art<select data-reise="art">${Object.entries(REISEARTEN).map(([k, t]) => `<option value="${k}" ${(r.art ?? "kreuzfahrt") === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
        ${istKreuzfahrt() ? `<label>Schiff<input data-reise="schiff" value="${esc(r.schiff ?? "")}" placeholder="z. B. Mein Schiff 4"></label>` : ""}
      </div>
    </div>
    <div class="karte-box">
      <h3>🌍 Öffentliches Reisetagebuch</h3>
      ${istPlaner() ? `<label class="haken"><input type="checkbox" data-aktion="reise-oeffentlich" data-id="${esc(r.id)}" ${r.oeffentlich ? "checked" : ""}> In meinem öffentlichen Reisetagebuch zeigen</label>` : `<p class="klein leise">Nur Planer/innen schalten die Reise frei.</p>`}
      <p class="leise klein">Sichtbar werden nur vergangene Tage, gebuchte Ausflüge und Unterkünfte, Bewertungen, Tauchgänge und Fotos – ohne Kosten, Planung, Buchungsnummern und 🔒-Fotos.</p>
      ${istPlaner() ? `<div class="zeile"><a class="knopf leise" href="/tagebuch-vorschau/${esc(r.id)}" target="_blank" rel="noopener">👁️ Vorschau vor dem Teilen</a><button class="link" data-aktion="ansicht" data-ziel="weltkarte">Mein Tagebuch &amp; Weltkarte →</button></div>` : ""}
    </div>
    ${istPlaner() ? `<details class="karte-box gefahrzone"><summary><strong>Gefahrenbereich</strong> <span class="leise klein">– endgültige Aktionen</span></summary>
      <p class="leise klein">Löscht Plan, Bewertungen, Tauchgänge, Fotos und Dateien dieser Reise für alle Mitreisenden. Vorher am besten unter „Import &amp; Sicherung“ eine Sicherung herunterladen.</p>
      <button class="knopf gefahr" data-aktion="reise-loeschen">Diese Reise endgültig löschen …</button></details>` : ""}`;
}

// ---------- Anreise & Verbindungen ----------

function verbindungenBox() {
  const liste = [...(zustand.reise.verbindungen ?? [])].sort((a, b) => `${a.datum}${a.abZeit}`.localeCompare(`${b.datum}${b.abZeit}`));
  return `<div class="karte-box">
    <div class="zeile"><h3>✈️ Anreise &amp; Verbindungen</h3><span class="platz"></span><button class="knopf" data-aktion="verbindung-neu">+ Verbindung</button></div>
    <p class="leise klein">Flüge, Züge, Fähren, Mietwagen, Transfers – mit Buchungsnummer, Terminal und Sitz. Die Abfahrt (minus Vorlauf, z. B. 2 Std. beim Flug) wird zur festen Zeit des Tages: für Wecker, Rückweg-Prüfung und den Puffer der Ausflüge.</p>
    ${liste.length ? `<div class="tabelle"><table><tbody>${liste.map((v) => `<tr class="${v.status === "verworfen" ? "leise" : ""}"><td class="klein">${esc(datumText(v.datum))}</td><td>${verbindungText(v)}${v.personen?.length && v.personen.length < personen().length ? `<div class="klein leise">${esc(v.personen.map((id) => personen().find((p) => p.id === id)?.name ?? "").join(", "))}</div>` : ""}</td>
      <td class="zahl klein">${zahl(v.preis) != null ? geld(zahl(v.preis)) : ""}<div class="leise">${esc(STATUS[v.status] ?? "")}</div></td><td><button class="link" data-aktion="verbindung-bearbeiten" data-id="${esc(v.id)}">Bearbeiten</button></td></tr>`).join("")}</tbody></table></div>` : ""}
  </div>`;
}

function verbindungDialog(id) {
  const r = zustand.reise;
  const v = id ? r.verbindungen.find((x) => x.id === id) : { id: neueId(), art: "flug", status: "gebucht", datum: haefen()[0]?.datum ?? "", personen: personen().map((p) => p.id) };
  dialogOeffnen(`<form method="dialog" class="formular" id="verbindungForm">
    <h3>${id ? "Verbindung bearbeiten" : "Verbindung hinzufügen"}</h3>
    <div class="formular drei">
      <label>Art<select name="art">${Object.entries(VERKEHRSMITTEL).map(([k, x]) => `<option value="${k}" ${v.art === k ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      <label>Bezeichnung<input name="titel" value="${esc(v.titel ?? "")}" placeholder="z. B. LH 1234, ICE 578, Sixt" maxlength="80"></label>
      <label>Status<select name="status">${Object.entries(STATUS).map(([k, t]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Von<input name="von" value="${esc(v.von ?? "")}" placeholder="z. B. Frankfurt (FRA)" maxlength="80"></label>
      <label>Nach<input name="nach" value="${esc(v.nach ?? "")}" placeholder="z. B. Barbados (BGI)" maxlength="80"></label>
      <label>Vorlauf (Min.)<input name="vorlaufMin" inputmode="numeric" value="${esc(v.vorlaufMin ?? "")}" placeholder="Standard je Art"></label>
      <label>Abfahrt am<input type="date" name="datum" value="${esc(v.datum ?? "")}" required></label>
      <label>um<input type="time" name="abZeit" value="${esc(v.abZeit ?? "")}"></label>
      <label>Ankunft am<input type="date" name="anDatum" value="${esc(v.anDatum ?? "")}"></label>
      <label>um<input type="time" name="anZeit" value="${esc(v.anZeit ?? "")}"></label>
      <label>Buchungsnummer<input name="buchungsnr" value="${esc(v.buchungsnr ?? "")}" maxlength="60"></label>
      <label>Terminal / Gleis<input name="terminal" value="${esc(v.terminal ?? "")}" maxlength="60"></label>
      <label>Sitz / Wagen<input name="sitz" value="${esc(v.sitz ?? "")}" maxlength="60"></label>
      <label>Gepäck<input name="gepaeck" value="${esc(v.gepaeck ?? "")}" placeholder="z. B. 23 kg + Handgepäck" maxlength="80"></label>
      <label>Preis gesamt (€)<input name="preis" inputmode="decimal" value="${esc(v.preis ?? "")}"></label>
      <label>Anfahrt (Min.)<input name="anfahrtMin" inputmode="numeric" value="${esc(v.anfahrtMin ?? "")}" placeholder="Fahrt von zu Hause"></label>
      <label>Parken / Shuttle (Min.)<input name="parkenMin" inputmode="numeric" value="${esc(v.parkenMin ?? "")}" placeholder="z. B. 20"></label>
      <label>Flug-/Fahrdauer (Min.)<input name="flugdauerMin" inputmode="numeric" value="${esc(v.flugdauerMin ?? "")}" placeholder="z. B. 570 (für „Wo sind wir?“)"></label>
    </div>
    <label>Abfahrtsort auf der Karte (für die Rückweg-Prüfung)</label>
    ${ortsSuche("vonOrt", v.vonOrt, "z. B. Flughafen Frankfurt, Hauptbahnhof")}
    <label>Zielort auf der Karte (für „Wo sind wir gerade?“)</label>
    ${ortsSuche("nachOrt", v.nachOrt, "z. B. Flughafen Barbados")}
    <fieldset><legend>Wer reist mit?</legend><div class="teilnehmer">${personen().map((p) => `<label class="haken"><input type="checkbox" name="personen" value="${esc(p.id)}" ${(v.personen ?? []).includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div></fieldset>
    <label>Notiz<textarea name="notiz" rows="2">${esc(v.notiz ?? "")}</textarea></label>
    <div class="zeile">
      ${id ? `<button type="button" class="knopf gefahr" data-aktion="verbindung-loeschen" data-id="${esc(id)}">Löschen</button>` : ""}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
  </form>`, true);
  const form = $("#verbindungForm");
  if (!v.vonOrt && v.von) $(".ortsq", form).value = v.von;
  if (!v.nachOrt && v.nach) $('[data-ort="nachOrt"] .ortsq', form).value = v.nach;
  form.nach.addEventListener("change", () => {
    if (!ortAuslesen(form, "nachOrt")) $('[data-ort="nachOrt"] .ortsq', form).value = form.nach.value;
  });
  form.von.addEventListener("change", () => {
    if (!ortAuslesen(form, "vonOrt")) $(".ortsq", form).value = form.von.value;
  });
  form.addEventListener("submit", () => {
    const f = new FormData(form);
    Object.assign(v, {
      art: f.get("art"), titel: String(f.get("titel")).trim(), status: f.get("status"), von: String(f.get("von")).trim(), nach: String(f.get("nach")).trim(),
      vorlaufMin: zahl(f.get("vorlaufMin")), datum: f.get("datum"), abZeit: f.get("abZeit"), anDatum: f.get("anDatum"), anZeit: f.get("anZeit"),
      buchungsnr: String(f.get("buchungsnr")).trim(), terminal: String(f.get("terminal")).trim(), sitz: String(f.get("sitz")).trim(), gepaeck: String(f.get("gepaeck")).trim(),
      preis: zahl(f.get("preis")), vonOrt: ortAuslesen(form, "vonOrt"), nachOrt: ortAuslesen(form, "nachOrt"), personen: f.getAll("personen"), notiz: f.get("notiz"),
      anfahrtMin: zahl(f.get("anfahrtMin")), parkenMin: zahl(f.get("parkenMin")), flugdauerMin: zahl(f.get("flugdauerMin")),
    });
    if (!id) zustand.reise.verbindungen.push(v);
    speichern();
    alles();
  });
}

aktionen["verbindung-neu"] = () => verbindungDialog(null);
aktionen["verbindung-bearbeiten"] = (el) => verbindungDialog(el.dataset.id);
aktionen["verbindung-loeschen"] = (el) => {
  if (!confirm("Verbindung löschen?")) return;
  zustand.reise.verbindungen = zustand.reise.verbindungen.filter((v) => v.id !== el.dataset.id);
  dialog().close();
  speichern();
  alles();
};

// ---------- Etappen (Roadtrip, Rundreise, Tagesausflug) ----------

function etappenBox() {
  const r = zustand.reise;
  const liste = etappen(r);
  const auto = liste.filter((e) => e.mittel === "auto");
  const km = auto.reduce((s, e) => s + (e.km ?? 0), 0);
  const min = auto.reduce((s, e) => s + (e.min ?? 0), 0);
  const f = r.fahrzeug ?? {};
  const sprit = spritkosten(km * (r.art === "tagesausflug" ? 2 : 1), f.verbrauch, f.preis);
  return `<div class="karte-box">
    <h3>🚗 ${r.art === "tagesausflug" ? "Anfahrt" : "Etappen"}</h3>
    <label>Start (Zuhause)</label>
    <div class="zuhause">${ortsSuche("zuhause", r.zuhause, "z. B. Wohnort – für die Anfahrt am ersten Tag")}<button class="knopf leise" data-aktion="zuhause-speichern">Übernehmen</button></div>
    ${liste.length ? `<div class="tabelle"><table><thead><tr><th>Tag</th><th>Strecke</th><th class="zahl">km</th><th class="zahl">Fahrzeit</th></tr></thead><tbody>
      ${liste.map((e) => `<tr><td class="klein">${esc(datumText(e.datum))}</td><td>${esc(e.von)} → ${esc(e.nach)} <a class="klein" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${e.vonOrt.lat},${e.vonOrt.lng}&destination=${e.nachOrt.lat},${e.nachOrt.lng}">Route ↗</a></td><td class="zahl">${e.mittel === "auto" ? `${e.berechnet ? "" : "ca. "}${e.km}` : `${ETAPPEN_SYMBOL[e.mittel] ?? ""} <span class="leise klein">nicht gefahren</span>`}</td><td class="zahl">${e.min ? dauerText(e.min) : "–"}</td></tr>`).join("")}
      </tbody><tfoot><tr><th colspan="2">Mit dem Auto${r.art === "tagesausflug" ? " (eine Richtung)" : ""}</th><th class="zahl">${km}</th><th class="zahl">${min ? dauerText(min) : "–"}</th></tr></tfoot></table></div>
      <div class="zeile"><button class="knopf leise" data-aktion="etappen-berechnen">Fahrstrecken berechnen (Straße)</button></div>
      <h4>⛽ Spritkosten</h4>
      <div class="formular drei">
        <label>Verbrauch (l/100 km)<input data-fahrzeug="verbrauch" inputmode="decimal" value="${esc(f.verbrauch ?? "")}" placeholder="z. B. 7,5"></label>
        <label>Preis pro Liter (€)<input data-fahrzeug="preis" inputmode="decimal" value="${esc(f.preis ?? "")}" placeholder="z. B. 1,79"></label>
        <label>Ergebnis<strong class="ergebnis">${sprit != null ? geld(sprit) : "–"}</strong></label>
      </div>
      ${sprit != null ? `<button class="knopf leise" data-aktion="sprit-uebernehmen">Als Kosten übernehmen</button>` : ""}` : `<p class="leise klein">Sobald die Tage Kartenpunkte haben (und gern „Zuhause“), erscheinen hier die Etappen mit Kilometern und Fahrzeit.</p>`}
  </div>`;
}

aktionen["zuhause-speichern"] = (el) => {
  const box = el.closest(".zuhause");
  const v = box.querySelector("input[type=hidden]").value;
  zustand.reise.zuhause = v ? JSON.parse(v) : null;
  speichern();
  alles();
};

aktionen["etappen-berechnen"] = async (el) => {
  el.disabled = true;
  for (const e of etappen(zustand.reise).filter((x) => x.mittel === "auto")) {
    try {
      el.textContent = `Berechne ${e.von} → ${e.nach} …`;
      const w = await anfrage(`/api/route?von=${e.vonOrt.lat},${e.vonOrt.lng}&nach=${e.nachOrt.lat},${e.nachOrt.lng}&modus=auto`);
      const h = hafenVon(e.id);
      if (h) h.etappe = { km: Math.round(w.km), min: Math.round(w.min) };
    } catch {}
  }
  speichern();
  alles();
};

aktionen["sprit-uebernehmen"] = () => {
  const r = zustand.reise;
  const km = etappen(r).filter((e) => e.mittel === "auto").reduce((s, e) => s + (e.km ?? 0), 0) * (r.art === "tagesausflug" ? 2 : 1);
  const betrag = spritkosten(km, r.fahrzeug?.verbrauch, r.fahrzeug?.preis);
  const vorhanden = r.kosten.find((k) => k.auto === "sprit");
  if (vorhanden) Object.assign(vorhanden, { betrag, titel: `Sprit (${km} km, berechnet)` });
  else r.kosten.push({ id: neueId(), titel: `Sprit (${km} km, berechnet)`, betrag, status: "favorit", auto: "sprit" });
  speichern();
  alert(`Spritkosten ${geld(betrag)} unter „Kosten → Weitere Kosten“ eingetragen.`);
  alles();
};

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
    // Mit CORS laden – nur so kann der Service Worker die Kacheln für offline speichern
    crossOrigin: true,
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

const roteNadel = () =>
  L.divIcon({
    className: "nadel",
    html: '<svg width="24" height="36" viewBox="0 0 26 38" aria-hidden="true"><path d="M13 0C5.8 0 0 5.8 0 13c0 9.8 13 25 13 25s13-15.2 13-25C26 5.8 20.2 0 13 0z" fill="#d0021b"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>',
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -32],
  });

function weltkarteZeichnen() {
  const pins = weltkartePins().filter((p) => !p.hotel);
  for (const p of pins) {
    L.marker([p.lat, p.lng], { icon: roteNadel() })
      .bindPopup(`<strong>${esc(p.name)}</strong>${p.land ? `, ${esc(p.land)}` : ""}${p.info ? `<br>${esc(p.info)}` : ""}`)
      .addTo(ebene);
  }
  $("#legende").innerHTML = `<span><span class="punkt" style="--farbe:#d0021b"></span>Hier wart ihr schon (${pins.length})</span>`;
  if (pins.length > 1) karte.flyToBounds(pins.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 7, duration: 0.8 });
  else if (pins.length === 1) karte.flyTo([pins[0].lat, pins[0].lng], 7, { duration: 0.8 });
  else karte.setView([25, 0], 2);
  setTimeout(() => karte.invalidateSize(), 50);
}

function karteZeichnen() {
  // Ausgeblendete Karte nicht zeichnen (Leaflet kann ohne Größe nicht rechnen) – beim Einblenden neu
  if (document.body.classList.contains("karte-aus") || document.body.classList.contains("kindermodus")) return;
  karteInit();
  if (!karte) return;
  karte.invalidateSize();
  ebene.clearLayers();
  for (const k of Object.keys(kartenMarker)) delete kartenMarker[k];
  const legende = $("#legende");
  if (zustand.ansicht === "weltkarte") return weltkarteZeichnen();
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
    const k = hotelKosten(h, personen(), zimmerVon(zustand.reise, h.id));
    L.marker([h.lat, h.lng], { icon: icon("#00897b", h.status === "gebucht" ? "✓" : h.status === "favorit" ? "★" : "H") })
      .bindPopup(`<strong>${esc(h.name)}</strong><br>${esc(STATUS[h.status])} · ${k.offen ? "Preis offen" : geld(k.summe)}${k.proNacht ? ` (${geld(k.proNacht)}/Nacht)` : ""}<br><a href="https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}" target="_blank" rel="noopener">In Google Maps öffnen ↗</a>`)
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
      const z = zeitplan(a, h, zustand.reise);
      const m = L.marker([a.ziel.lat, a.ziel.lng], { icon: icon(q.farbe, a.status === "gebucht" ? "✓" : a.status === "favorit" ? "★" : "") })
        .bindPopup(`<strong>${esc(a.titel)}</strong><br>${esc(q.name)} · ${STATUS[a.status]}<br>${kostenText(k)} · ${dauerText(zahl(a.dauerMin))}${a.fahrzeitMin && a.quelle !== "schiff" ? `<br>Weg: ${Math.round(a.fahrzeitMin)} Min. je Richtung` : ""}${z.puffer != null ? `<br>Puffer: ${z.puffer < 0 ? "−" : ""}${dauerText(Math.abs(z.puffer))}` : ""}<br><a href="https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${a.ziel.lat},${a.ziel.lng}" target="_blank" rel="noopener">In Google Maps öffnen ↗</a>`)
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
  // Sanft zum gewählten Tag/Ort fliegen
  if (grenzen.length > 1) karte.flyToBounds(grenzen, { padding: [30, 30], maxZoom: 14, duration: 0.8 });
  else if (grenzen.length === 1) karte.flyTo(grenzen[0], 12, { duration: 0.8 });
  else if (liste.length > 1) karte.flyToBounds(liste.map((x) => [x.lat, x.lng]), { padding: [30, 30], duration: 0.8 });
  else if (liste.length === 1) karte.flyTo([liste[0].lat, liste[0].lng], 10, { duration: 0.8 });
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
      <label class="ohne-hafen">Feste Zeit<input type="time" name="festeZeit" value="${esc(h.festeZeit?.zeit ?? "")}"></label>
      <label class="ohne-hafen">… wofür<input name="festeZeitTitel" value="${esc(h.festeZeit?.titel ?? "")}" placeholder="z. B. Abholung, Rückgabe Wohnmobil, Zug" maxlength="80"></label>
    </div>
    <p class="klein leise ohne-hafen">Feste Zeit: bis dahin müsst ihr zurück sein (Wecker &amp; Puffer der Ausflüge). Check-out und Abfahrten von Verbindungen zählen automatisch.</p>
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
      festeZeit: neueArt !== "hafen" && f.get("festeZeit") ? { zeit: f.get("festeZeit"), titel: String(f.get("festeZeitTitel")).trim() } : null,
      notiz: f.get("notiz"),
      lat: ort?.lat ?? null,
      lng: ort?.lng ?? null,
      ortName: ort?.name ?? "",
    });
    if (!h.land && ort?.land && h.art !== "seetag") h.land = ort.land;
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
    : { id: neueId(), hafenId: zustand.hafenId, quelle: stationsArt(hafenVon(zustand.hafenId)) === "ort" ? "getyourguide" : "schiff", kategorie: stationsArt(hafenVon(zustand.hafenId)) === "seetag" ? "bord" : "ausflug", status: "idee", preisArt: "person", teilnehmer: personen().map((p) => p.id), interesse: 3, verkehr: "auto", ...vorlage };
  const hs = haefen();
  dialogOeffnen(`<form method="dialog" class="formular" id="ausflugForm">
    <h3>${stationsArt(hafenVon(a.hafenId)) === "seetag" ? (neu ? "Aktivität an Bord hinzufügen" : "Aktivität bearbeiten") : neu ? "Ausflug hinzufügen" : "Ausflug bearbeiten"}</h3>
    <label>Titel<input name="titel" value="${esc(a.titel ?? "")}" required placeholder="z. B. Teide-Nationalpark mit Seilbahn"></label>
    <div class="formular drei">
      <label>Tag<select name="hafenId">${hs.map((h) => `<option value="${esc(h.id)}" ${h.id === a.hafenId ? "selected" : ""}>${esc(datumText(h.datum))} – ${stationsArt(h) === "seetag" ? "🌊 Seetag" : esc(h.name)}</option>`).join("")}</select></label>
      <label>Anbieter<select name="quelle">${Object.entries(QUELLEN).map(([k, q]) => `<option value="${k}" ${a.quelle === k ? "selected" : ""}>${esc(q.name)}</option>`).join("")}</select></label>
      <label>Art<select name="kategorie">${Object.entries(KATEGORIEN).map(([k, t]) => `<option value="${k}" ${(a.kategorie ?? "ausflug") === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label>Status<select name="status">${Object.entries(STATUS).map(([k, t]) => `<option value="${k}" ${a.status === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Link zum Angebot<input name="link" type="url" value="${esc(a.link ?? "")}" placeholder="https://…"></label>
      <label>Ausflugs-/Buchungs-Nr.<input name="code" value="${esc(a.code ?? "")}"></label>
    </div>
    <label>Öffnungszeiten / Zeitfenster<input name="oeffnungszeiten" value="${esc(a.oeffnungszeiten ?? "")}" placeholder="z. B. täglich 9–18 Uhr, Einlass im Zeitfenster 10:30" maxlength="300"></label>
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
      oeffnungszeiten: String(f.get("oeffnungszeiten") ?? "").trim(),
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
  "kinderprogramm-neu": () => {
    const kinder = personen().filter(istKind);
    const tag = haefen().find((h) => h.datum >= heute()) ?? haefen()[0];
    if (!tag) return alert("Bitte zuerst die Reisetage eintragen.");
    if (!zustand.hafenId) zustand.hafenId = tag.id;
    ausflugDialog(null, { hafenId: zustand.hafenId ?? tag.id, kategorie: "kinderclub", quelle: istKreuzfahrt() ? "schiff" : "eigene", status: "gebucht", titel: "Kinderclub", teilnehmer: (kinder.length ? kinder : personen()).map((p) => p.id) });
  },
  "reservierung-neu": () => ausflugDialog(null, { kategorie: "essen", quelle: "eigene", status: "gebucht", titel: "", teilnehmer: personen().map((p) => p.id) }),
  "ausflug-bearbeiten": (el) => ausflugDialog(el.dataset.id),
  "ausflug-loeschen": (el) => {
    if (!confirm("Ausflug löschen?")) return;
    zustand.reise.ausfluege = zustand.reise.ausfluege.filter((a) => a.id !== el.dataset.id);
    dialog().close();
    speichern();
    alles();
  },
  "auf-karte": (el) => {
    if (!kartenMarker[el.dataset.id] && !hatKoord(ausflugMit(el.dataset.id)?.ziel)) return alert("Für diesen Ausflug ist noch kein Ziel auf der Karte eingetragen (Bearbeiten → Ziel / Treffpunkt).");
    // Karte ausgeblendet („Liste“)? Dann geteilt einblenden
    if (document.body.classList.contains("karte-aus")) aktionen["karten-modus"]({ dataset: { modus: "geteilt" } });
    const m = kartenMarker[el.dataset.id];
    if (!m) return;
    m.openPopup();
    karte.setView(m.getLatLng(), Math.max(karte.getZoom(), 12));
    document.querySelector(".kartenbereich").scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
  "dialog-zu": () => dialog().close(),
  flieg: (el) => {
    if (document.body.classList.contains("karte-aus")) aktionen["karten-modus"]({ dataset: { modus: "geteilt" } });
    if (!karte) return;
    karte.flyTo([Number(el.dataset.lat), Number(el.dataset.lng)], Number(el.dataset.zoom) || 10, { duration: 1 });
    if (window.matchMedia("(max-width: 900px)").matches) document.querySelector(".kartenbereich").scrollIntoView({ behavior: "smooth", block: "start" });
  },
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
    const eingabe = prompt(`Reise „${r.name}“ mit allen Bewertungen, Tauchgängen, Fotos und Dateien endgültig löschen?\n\nZur Bestätigung den Namen der Reise eintippen:`);
    if (eingabe == null) return;
    if (eingabe.trim() !== r.name.trim()) return alert("Der Name stimmt nicht – es wurde nichts gelöscht.");
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
  if (el.tagName === "BUTTON" && el.type !== "submit" && !el.closest("summary")) e.preventDefault();
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
    if (el.dataset.feld === "familie" && !el.value) delete p.familie;
    speichern();
    if (el.dataset.feld === "typ" || el.dataset.feld === "familie") alles();
  } else if (el.dataset.familie) {
    const f = r.familien.find((x) => x.id === el.dataset.familie);
    if (f) f.name = el.value.trim().slice(0, 60) || f.name;
    speichern();
    alles();
  } else if (el.closest(".kostenzeile")) {
    const k = r.kosten.find((x) => x.id === el.closest(".kostenzeile").dataset.id);
    k[el.dataset.kfeld] = el.dataset.kfeld === "betrag" ? zahl(el.value) : el.value;
    speichern();
    alles();
  } else if (el.dataset.fahrzeug) {
    r.fahrzeug = { ...(r.fahrzeug ?? {}), [el.dataset.fahrzeug]: zahl(el.value) };
    speichern();
    alles();
  } else if (el.dataset.reise) {
    r[el.dataset.reise] = el.value;
    speichern();
    reisenLaden();
    if (el.dataset.reise === "art" || el.dataset.reise === "kostenTeilung") alles();
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
  anfrage(`/api/erinnerungen?datum=${heute()}`).then((l) => {
    zustand.erinnerungen = l;
    if (l.length && (zustand.ansicht === "plan" || !zustand.reise)) alles();
  }).catch(() => {});
  const gewuenscht = new URLSearchParams(location.search).get("reise");
  const ansichtGewuenscht = new URLSearchParams(location.search).get("ansicht");
  if (gewuenscht) history.replaceState(null, "", "/");
  let letzte = null;
  try {
    letzte = localStorage.getItem("reiseplaner:letzte");
  } catch {}
  const id = zustand.reisen.find((r) => r.id === gewuenscht)?.id ?? zustand.reisen.find((r) => r.id === letzte)?.id ?? zustand.reisen[0]?.id;
  if (id) await reiseOeffnen(id);
  else alles();
  if (id && ansichtGewuenscht && Object.values(GRUPPEN).flat().includes(ansichtGewuenscht)) ansichtWechseln(ansichtGewuenscht);
}

setzeAbmeldung(() => anmeldenZeigen(start));
start().catch((e) => {
  inhalt.innerHTML = `<div class="leer"><p class="warnung">Der Server ist nicht erreichbar: ${esc(e.message)}</p></div>`;
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
