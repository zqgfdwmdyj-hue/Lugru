// Unterkünfte: Hotels sammeln, vergleichen, buchen – und mit den Reisetagen verknüpfen.
import { zustand, $, esc, neueId, datumText, personen, hatKoord, geld, linkHtml, aktionen, speichern, neuZeichnen, dialogOeffnen, dialog, ortsSuche, ortAuslesen, sterneText } from "./kern.js";
import { STATUS, VERPFLEGUNG, zahl, hotelKosten, naechte, istKind, QUELLEN, zimmerVon, fehlendeNaechte } from "./rechnen.js";
import { bewertungsZeile } from "./erlebnisse.js";

export const hotels = () => zustand.reise?.hotels ?? [];
const kosten = (h) => hotelKosten(h, personen(), zimmerVon(zustand.reise, h.id));
const istKreuzfahrt = () => (zustand.reise?.art ?? "kreuzfahrt") === "kreuzfahrt";

// ---------- Zimmer & Kabinen ----------

function zimmerListe(unterkunft, titel, nachtpreis) {
  const liste = zimmerVon(zustand.reise, unterkunft);
  const name = (id) => personen().find((p) => p.id === id)?.name ?? "?";
  const verteilt = new Set(liste.flatMap((z) => z.personen ?? []));
  const offen = personen().filter((p) => !verteilt.has(p.id));
  return `<div class="zimmerbox">
    <div class="zeile"><h4>🛏️ ${esc(titel)}</h4><span class="platz"></span><button class="link" data-aktion="zimmer-neu" data-unterkunft="${esc(unterkunft)}">+ ${unterkunft === "schiff" ? "Kabine" : "Zimmer"}</button></div>
    ${liste.length ? `<div class="zimmerliste">${liste.map((z) => `<button class="zimmer" data-aktion="zimmer-bearbeiten" data-id="${esc(z.id)}">
        <strong>${unterkunft === "schiff" ? "Kabine" : "Zimmer"} ${esc(z.nummer || "?")}</strong>${z.deck ? ` <span class="leise">· ${unterkunft === "schiff" ? "Deck" : "Etage"} ${esc(z.deck)}</span>` : ""}
        ${z.kategorie ? `<span class="klein leise">${esc(z.kategorie)}</span>` : ""}
        <span class="klein">${(z.personen ?? []).map(name).map(esc).join(", ") || "noch niemand"}</span>
        ${zahl(z.preis) != null ? `<span class="klein">${geld(zahl(z.preis))}${nachtpreis ? " / Nacht" : ""}</span>` : ""}</button>`).join("")}</div>
      ${offen.length && liste.length ? `<p class="klein leise">Noch ohne ${unterkunft === "schiff" ? "Kabine" : "Zimmer"}: ${offen.map((p) => esc(p.name)).join(", ")}</p>` : ""}` : `<p class="klein leise">Nummern, Deck/Etage und wer wo schläft – erscheint im Tagesbriefing und bei den Kindern. Mit Preis je ${unterkunft === "schiff" ? "Kabine" : "Zimmer"} werden die Kosten den Bewohnern zugerechnet.</p>`}
  </div>`;
}

function zimmerDialog(id, unterkunft) {
  const r = zustand.reise;
  const z = id ? r.zimmer.find((x) => x.id === id) : { id: neueId(), unterkunft, personen: [] };
  const schiff = z.unterkunft === "schiff";
  const hotel = hotels().find((h) => h.id === z.unterkunft);
  dialogOeffnen(`<form method="dialog" class="formular" id="zimmerForm">
    <h3>${schiff ? "Kabine" : `Zimmer – ${esc(hotel?.name ?? "")}`}</h3>
    <div class="formular drei">
      <label>Nummer<input name="nummer" value="${esc(z.nummer ?? "")}" placeholder="${schiff ? "z. B. 8123" : "z. B. 214"}" maxlength="20"></label>
      <label>${schiff ? "Deck" : "Etage"}<input name="deck" value="${esc(z.deck ?? "")}" maxlength="20"></label>
      <label>Kategorie<input name="kategorie" value="${esc(z.kategorie ?? "")}" placeholder="${schiff ? "z. B. Balkonkabine" : "z. B. Familienzimmer"}" maxlength="60"></label>
      <label>Preis (€) ${schiff ? "für die Reise" : hotel?.preisArt === "nacht" ? "pro Nacht" : "für den Aufenthalt"}<input name="preis" inputmode="decimal" value="${esc(z.preis ?? "")}" placeholder="optional"></label>
    </div>
    <fieldset><legend>Wer schläft hier?</legend><div class="teilnehmer">${personen().map((p) => `<label class="haken"><input type="checkbox" name="personen" value="${esc(p.id)}" ${(z.personen ?? []).includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div></fieldset>
    <label>Notiz<input name="notiz" value="${esc(z.notiz ?? "")}" placeholder="z. B. Verbindungstür zu 8125" maxlength="300"></label>
    <div class="zeile">
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
    ${id ? `<details class="gefahr-klein"><summary class="klein leise">Weitere Aktionen</summary><button type="button" class="knopf gefahr" data-aktion="zimmer-loeschen" data-id="${esc(id)}">Löschen</button></details>` : ""}
  </form>`);
  $("#zimmerForm").addEventListener("submit", (e) => {
    const f = new FormData(e.target);
    const neuePersonen = f.getAll("personen");
    Object.assign(z, { nummer: String(f.get("nummer")).trim(), deck: String(f.get("deck")).trim(), kategorie: String(f.get("kategorie")).trim(), preis: zahl(f.get("preis")), notiz: f.get("notiz"), personen: neuePersonen });
    r.zimmer ??= [];
    // Eine Person schläft je Unterkunft nur in einem Zimmer
    for (const x of r.zimmer) if (x !== z && x.unterkunft === z.unterkunft) x.personen = (x.personen ?? []).filter((p) => !neuePersonen.includes(p));
    if (!id) r.zimmer.push(z);
    speichern();
    neuZeichnen();
  });
}

aktionen["zimmer-neu"] = (el) => zimmerDialog(null, el.dataset.unterkunft);
aktionen["zimmer-bearbeiten"] = (el) => zimmerDialog(el.dataset.id);
aktionen["zimmer-loeschen"] = (el) => {
  if (!confirm("Löschen?")) return;
  zustand.reise.zimmer = zustand.reise.zimmer.filter((z) => z.id !== el.dataset.id);
  dialog().close();
  speichern();
  neuZeichnen();
};

function suchLinks(ort, anreise, abreise) {
  const ps = personen();
  const erw = ps.filter((p) => !istKind(p)).length || 2;
  const kinder = ps.filter(istKind);
  const q = encodeURIComponent(ort);
  const booking = new URLSearchParams({ ss: ort, group_adults: erw, group_children: kinder.length, no_rooms: 1 });
  for (const k of kinder) booking.append("age", k.alter || 8);
  if (anreise) booking.set("checkin", anreise);
  if (abreise) booking.set("checkout", abreise);
  const google = (s) => `https://www.google.com/search?q=${encodeURIComponent(s)}`;
  const daten = anreise && abreise ? `&checkin=${anreise}&checkout=${abreise}` : "";
  const links = [
    ["Booking.com", `https://www.booking.com/searchresults.de.html?${booking}`],
    ["HolidayCheck", google(`site:holidaycheck.de Hotel ${ort}`)],
    ["Tripadvisor", `https://www.tripadvisor.de/Search?q=${q}&searchSessionId=&sid=&blockRedirect=true&ssrc=h`],
    ["Google Hotels", `https://www.google.com/travel/search?q=${encodeURIComponent(`Hotels ${ort}`)}`],
    ["Expedia", `https://www.expedia.de/Hotel-Search?destination=${q}${anreise ? `&startDate=${anreise}` : ""}${abreise ? `&endDate=${abreise}` : ""}&adults=${erw}`],
    ["Check24", google(`site:check24.de Hotel ${ort}`)],
    ["Airbnb", `https://www.airbnb.de/s/${q}/homes?adults=${erw}&children=${kinder.length}${daten}`],
    ["Tauchbasen", `https://www.google.com/maps/search/${encodeURIComponent(`Tauchbasis ${ort}`)}`],
  ];
  return `<div class="links">${links.map(([n, u]) => `<a class="linkchip" style="--farbe:${n === "Tauchbasen" ? "#0277bd" : QUELLEN.sonstige.farbe}" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join("")}</div>`;
}

// ---------- Wünsche an die Unterkunft (die KI berücksichtigt sie bei jeder Suche) ----------

/** Wünsche nach Themen – je Merkmal ausdrücklich „Muss“, „Wunsch“ oder „Egal“. */
export const WUNSCH_GRUPPEN = {
  "Art der Unterkunft": ["Bungalow / Ferienhaus", "Ferienwohnung", "Hotel"],
  "Zimmer & Ausstattung": ["Eigenes Schlafzimmer je Familie", "Mehrere Bäder", "Küche", "Spülmaschine", "Waschmaschine", "Klimaanlage", "WLAN", "Terrasse / Garten", "Grill", "Babybett / Hochstuhl", "Barrierefrei"],
  Lage: ["Strand ≤ 5 Min. zu Fuß", "Sandstrand", "Ruhige Lage", "Restaurants zu Fuß", "Supermarkt in der Nähe", "Parkplatz"],
  "Kinder & Freizeit": ["Pool", "Kinderpool", "Kinderclub", "Spielplatz", "Tauchbasis / Hausriff"],
  "Verpflegung & Buchung": ["All inclusive", "Frühstück", "Kostenlos stornierbar", "Haustiere erlaubt"],
};
export const WUNSCH_MERKMALE = Object.values(WUNSCH_GRUPPEN).flat();

const wuensche = () => (zustand.reise.wuensche ??= { muss: [], schoen: [], text: "", budget: "", anreise: "", abreise: "" });

/** Wer reist mit – nach Familien, als Text für die KI. */
export function gruppeText(r = zustand.reise) {
  const ps = r.personen ?? [];
  const beschreibung = (liste) => {
    const erw = liste.filter((p) => !istKind(p)).length;
    const kinder = liste.filter(istKind);
    return [erw && `${erw} Erw.`, kinder.length && `${kinder.length} ${kinder.length === 1 ? "Kind" : "Kinder"}${kinder.some((k) => k.alter) ? ` (${kinder.map((k) => k.alter || "?").join(", ")} J.)` : ""}`].filter(Boolean).join(", ");
  };
  const fam = (r.familien ?? []).map((f) => ({ name: f.name, liste: ps.filter((p) => p.familie === f.id) })).filter((f) => f.liste.length);
  const ohne = ps.filter((p) => !(r.familien ?? []).some((f) => f.id === p.familie));
  const teile = fam.map((f) => `${f.name}: ${beschreibung(f.liste)}`);
  if (ohne.length) teile.push(`${fam.length ? "weitere: " : ""}${beschreibung(ohne)}`);
  return `${ps.length} Personen${fam.length > 1 ? ` in ${fam.length} Familien` : ""}${teile.length ? ` – ${teile.join("; ")}` : ""}`;
}

/** Suchzeitraum: eigener Zeitraum aus den Wünschen, sonst die erste fehlende Nacht, sonst die ganze Reise. */
export function suchZeitraum() {
  const w = wuensche();
  const tage = [...(zustand.reise.haefen ?? [])].map((h) => h.datum).filter(Boolean).sort();
  const luecke = fehlendeNaechte(zustand.reise)[0];
  return { anreise: w.anreise || luecke?.von || tage[0] || "", abreise: w.abreise || luecke?.bis || tage.at(-1) || "", eigen: Boolean(w.anreise || w.abreise) };
}

function wunschBox(ort) {
  const w = wuensche();
  const z = suchZeitraum();
  const wahl = (m) => (w.muss.includes(m) ? "muss" : w.schoen.includes(m) ? "schoen" : "egal");
  const zeile = (m) => `<div class="wunschzeile"><span>${esc(m)}</span><span class="segment klein" role="group" aria-label="${esc(m)}">${[["muss", "Muss"], ["schoen", "Wunsch"], ["egal", "Egal"]].map(([k, t]) => `<button type="button" data-aktion="wunsch-wahl" data-wert="${esc(m)}" data-wahl="${k}" class="${wahl(m) === k ? "aktiv" : ""} ${k}" aria-pressed="${wahl(m) === k}">${t}</button>`).join("")}</span></div>`;
  const gewaehlt = [...w.muss.map((m) => `<span class="wunschchip muss">Muss: ${esc(m)}</span>`), ...w.schoen.map((m) => `<span class="wunschchip schoen">Wunsch: ${esc(m)}</span>`)];
  return `<div class="karte-box wunschbox">
    <h3>🔎 Unterkünfte suchen</h3>
    <p class="klein">${esc(gruppeText())} <span class="leise">(aus „Reisende“)</span></p>
    <div class="formular drei">
      <label>Ort / Region<input id="hotelSuchort" value="${esc(ort)}" placeholder="z. B. Bayahibe"></label>
      <label>Anreise<input type="date" data-wunschfeld="anreise" value="${esc(z.anreise)}"></label>
      <label>Abreise<input type="date" data-wunschfeld="abreise" value="${esc(z.abreise)}"></label>
    </div>
    <p class="klein suchzeitraum">📅 Suchzeitraum: <strong>${z.anreise ? `${esc(datumText(z.anreise))} – ${esc(datumText(z.abreise))} · ${naechte(z.anreise, z.abreise)} ${naechte(z.anreise, z.abreise) === 1 ? "Nacht" : "Nächte"}` : "noch offen"}</strong> <span class="leise">– gilt für die Anbieter-Links und die KI-Suche${z.eigen ? "" : " (automatisch aus den Reisetagen)"}</span></p>
    <div id="hotelLinks">${suchLinks(ort, z.anreise, z.abreise)}</div>
    <h4>🎯 Unsere Wünsche ${gewaehlt.length ? `<span class="leise klein">(${gewaehlt.length})</span>` : ""}</h4>
    ${gewaehlt.length ? `<div class="wunschchips">${gewaehlt.join("")}</div>` : `<p class="klein leise">Noch keine Wünsche gewählt – je Merkmal „Muss“, „Wunsch“ oder „Egal“.</p>`}
    ${Object.entries(WUNSCH_GRUPPEN).map(([g, liste]) => {
      const n = liste.filter((m) => wahl(m) !== "egal").length;
      return `<details class="wunschgruppe" data-klappe="wunsch:${esc(g)}" ${zustand.klappen?.[`wunsch:${g}`] ?? n > 0 ? "open" : ""}><summary>${esc(g)}${n ? ` <span class="leise klein">(${n} gewählt)</span>` : ""}</summary>${liste.map(zeile).join("")}</details>`;
    }).join("")}
    <div class="formular zwei">
      <label>Budget<input data-wunschfeld="budget" value="${esc(w.budget)}" placeholder="z. B. 250 € pro Nacht für alle" maxlength="120"></label>
    </div>
    <label>Weitere Wünsche<textarea data-wunschfeld="text" rows="2" maxlength="2000" placeholder="z. B. 3 Familien wollen zusammen wohnen, aber jede mit eigenem Bad; Oma kann keine Treppen; Hund (15 kg) kommt mit">${esc(w.text)}</textarea></label>
    ${zustand.info.ki ? `<button class="knopf" data-aktion="wunsch-suche">✨ Passende Unterkünfte suchen${ort ? ` in ${esc(ort)}` : ""}</button>` : ""}
  </div>`;
}

aktionen["wunsch-wahl"] = (el) => {
  const w = wuensche();
  const m = el.dataset.wert;
  w.muss = w.muss.filter((x) => x !== m);
  w.schoen = w.schoen.filter((x) => x !== m);
  if (el.dataset.wahl === "muss") w.muss.push(m);
  if (el.dataset.wahl === "schoen") w.schoen.push(m);
  speichern();
  neuZeichnen();
};

document.addEventListener("change", (e) => {
  const feld = e.target.dataset?.wunschfeld;
  if (!feld || !zustand.reise) return;
  wuensche()[feld] = String(e.target.value).trim();
  speichern();
  // Zeitraum ändert die Anbieter-Links und die Anzeige
  if (feld === "anreise" || feld === "abreise") neuZeichnen();
});

const deDatum = (iso) => String(iso).split("-").reverse().join(".");

/** Auftrag an die KI aus den Wünschen. */
export function wunschAuftrag(ort) {
  const w = wuensche();
  const { anreise: an, abreise: ab } = suchZeitraum();
  return [
    `Such uns passende Unterkünfte${ort ? ` in/um ${ort}` : ""}${an ? ` vom ${deDatum(an)}` : ""}${ab ? ` bis ${deDatum(ab)}` : ""}.`,
    `Wir sind ${gruppeText()}.`,
    w.muss.length ? `Muss: ${w.muss.join(", ")}.` : "",
    w.schoen.length ? `Wäre schön: ${w.schoen.join(", ")}.` : "",
    w.budget ? `Budget: ${w.budget}.` : "",
    w.text ? `Außerdem: ${w.text}` : "",
    "Prüfe jede Muss-Anforderung mit der Websuche (Ausstattung, Lage, Bettenzahl). Schlage nur Unterkünfte vor, die alle Muss-Punkte erfüllen und genug Platz für alle haben – höchstens 5, mit hotel_vorschlagen und echtem Link. Schreib zu jeder, welche Wünsche sicher erfüllt sind und was unklar ist. Wenn nichts alles erfüllt, sag ehrlich, woran es scheitert, und schlag die beste Annäherung vor.",
  ].filter(Boolean).join("\n");
}

aktionen["wunsch-suche"] = () => {
  if (document.activeElement?.dataset?.wunschfeld) document.activeElement.dispatchEvent(new Event("change", { bubbles: true }));
  aktionen["ki-oeffnen"]({ dataset: { frage: wunschAuftrag($("#hotelSuchort")?.value.trim() ?? ""), senden: "1" } });
};

export function hotelsAnsicht() {
  const liste = [...hotels()].sort((a, b) => String(a.anreise).localeCompare(String(b.anreise)));
  const gebucht = liste.filter((h) => h.status === "gebucht");
  const kandidaten = liste.filter((h) => h.status === "idee" || h.status === "favorit");
  const verworfen = liste.filter((h) => h.status === "verworfen");
  const orte = [...new Set(liste.map((h) => h.ort).filter(Boolean))];
  const ersterOrt = zustand.hotelSuchort ?? orte[0] ?? zustand.reise?.haefen?.find((x) => x.art === "ort")?.name ?? "";
  const luecken = fehlendeNaechte(zustand.reise);
  // Kandidaten je Zeitraum vergleichen
  const zeitraeume = new Map();
  for (const h of kandidaten) {
    const k = `${h.anreise ?? ""}|${h.abreise ?? ""}|${h.ort ?? ""}`;
    if (!zeitraeume.has(k)) zeitraeume.set(k, []);
    zeitraeume.get(k).push(h);
  }
  return `
    ${istKreuzfahrt() ? `<div class="karte-box">${zimmerListe("schiff", `Kabinen auf ${zustand.reise.schiff || "dem Schiff"}`, false)}</div>` : ""}
    <div class="karte-box">
      <div class="zeile"><h3>🏨 Gebuchte Unterkünfte (${gebucht.length})</h3><span class="platz"></span><button class="knopf" data-aktion="hotel-neu">+ Unterkunft</button></div>
      ${gebucht.length ? `<div class="ausfluege">${gebucht.map((h) => hotelKarte(h, false)).join("")}</div>` : `<p class="leise">${istKreuzfahrt() ? "Hotel vor oder nach der Kreuzfahrt? Hier eintragen." : "Noch keine Unterkunft gebucht."}</p>`}
      ${luecken.length ? `<h4>⚠️ Fehlende Übernachtungen</h4><ul class="aufgaben">${luecken.map((l) => `<li class="${l.nurGeplant ? "gelb" : "rot"}">${l.nurGeplant ? "Noch nicht gebucht" : "Keine Unterkunft"}: <strong>${esc(datumText(l.von))} – ${esc(datumText(l.bis))}</strong> (${l.naechte} ${l.naechte === 1 ? "Nacht" : "Nächte"})
        <span class="knoepfe"><button class="link" data-aktion="luecke-suchen" data-von="${esc(l.von)}" data-bis="${esc(l.bis)}">Für diesen Zeitraum suchen</button> · <button class="link" data-aktion="luecke-eintragen" data-von="${esc(l.von)}" data-bis="${esc(l.bis)}">Unterkunft eintragen</button></span></li>`).join("")}</ul>` : ""}
    </div>
    ${istKreuzfahrt() && !liste.length ? "" : wunschBox(ersterOrt)}
    ${kandidaten.length ? [...zeitraeume.values()].map((gruppe) => {
      const h0 = gruppe[0];
      const mitPreis = gruppe.filter((h) => !kosten(h).offen);
      const guenstig = mitPreis.length > 1 ? [...mitPreis].sort((a, b) => kosten(a).summe - kosten(b).summe)[0].id : null;
      return `<div class="karte-box">
        <h3>💡 Zur Auswahl: ${esc(h0.ort || "Ohne Ort")} <span class="leise klein">${h0.anreise ? `${esc(datumText(h0.anreise))} – ${esc(datumText(h0.abreise))} · ${naechte(h0.anreise, h0.abreise)} Nächte` : ""}</span></h3>
        <div class="ausfluege">${gruppe.map((h) => hotelKarte(h, h.id === guenstig)).join("")}</div>
      </div>`;
    }).join("") : ""}
    ${verworfen.length ? `<details class="karte-box klappe"><summary><h3 class="leise">🗑️ Verworfen (${verworfen.length})</h3></summary><div class="ausfluege">${verworfen.map((h) => hotelKarte(h, false)).join("")}</div></details>` : ""}`;
}

aktionen["luecke-suchen"] = (el) => {
  Object.assign(wuensche(), { anreise: el.dataset.von, abreise: el.dataset.bis });
  speichern();
  neuZeichnen();
  document.querySelector(".wunschbox")?.scrollIntoView({ behavior: "smooth", block: "start" });
};
aktionen["luecke-eintragen"] = (el) => hotelDialog(null, { anreise: el.dataset.von, abreise: el.dataset.bis, ort: $("#hotelSuchort")?.value ?? "" });

function hotelKarte(h, guenstig) {
  const k = kosten(h);
  const merkmale = [h.strandM != null ? `🏖️ ${h.strandM < 1000 ? `${h.strandM} m` : `${(h.strandM / 1000).toFixed(1).replace(".", ",")} km`} zum Strand` : "", h.zentrumKm != null ? `🏙️ ${String(h.zentrumKm).replace(".", ",")} km ins Zentrum` : "", h.pool ? "🏊 Pool" : "", h.kinder ? "🧒 Kinderclub" : "", h.tauchbasis ? "🤿 Tauchbasis" : "", h.hausriff ? "🐠 Hausriff" : ""].filter(Boolean);
  return `<article class="ausflug status-${esc(h.status)}" style="--farbe:#00897b">
    <div class="ausflug-kopf">
      <span class="quelle">${h.kategorie ? `${"★".repeat(Number(h.kategorie))} ` : ""}${esc(VERPFLEGUNG[h.verpflegung] ?? "")}</span>
      ${guenstig ? `<span class="abzeichen">€ Günstigste</span>` : ""}
      <select class="statuswahl" data-aktion="hotel-status" data-id="${esc(h.id)}" aria-label="Status">
        ${Object.entries(STATUS).map(([s, t]) => `<option value="${s}" ${h.status === s ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>
    <h4>${linkHtml(h.link, esc(h.name))}</h4>
    <div class="werte">
      <div><span>Gesamt</span><strong>${k.offen ? `<span class="preis-offen">Preis offen</span>` : geld(k.summe)}</strong><em>${k.naechte} Nächte${zahl(h.zimmer) > 1 ? ` · ${h.zimmer} Zimmer` : ""}</em></div>
      <div><span>Pro Nacht</span><strong>${k.proNacht != null ? geld(k.proNacht) : "–"}</strong></div>
      <div><span>Pro Person/Nacht</span><strong>${k.proPersonNacht != null ? geld(k.proPersonNacht) : "–"}</strong></div>
      <div><span>Gästebewertung</span><strong>${h.gaeste != null ? String(h.gaeste).replace(".", ",") : "–"}</strong><em>${esc(h.gaesteQuelle ?? "")}</em></div>
    </div>
    ${merkmale.length ? `<p class="klein">${merkmale.map(esc).join(" · ")}</p>` : ""}
    ${h.status === "gebucht" || h.status === "favorit" || zimmerVon(zustand.reise, h.id).length ? zimmerListe(h.id, "Zimmer", h.preisArt === "nacht") : ""}
    ${infosVorOrt(h)}
    ${bewertungsZeile("hotel", h.id)}
    <div class="ausflug-fuss">
      <span class="klein leise">${h.notiz ? esc(h.notiz.slice(0, 120)) : ""}</span>
      <span class="knoepfe">
        ${hatKoord(h) ? `<a class="link" href="https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}" target="_blank" rel="noopener">Karte ↗</a>` : ""}
        ${h.anreise && h.abreise ? `<button class="link" data-aktion="hotel-tage" data-id="${esc(h.id)}">Tage anlegen</button>` : ""}
        <button class="link" data-aktion="hotel-bearbeiten" data-id="${esc(h.id)}">Bearbeiten</button>
      </span>
    </div>
  </article>`;
}

function infosVorOrt(h) {
  const z = [
    h.checkin || h.checkout ? `🕑 Check-in ${esc(h.checkin || "–")} · Check-out ${esc(h.checkout || "–")}` : "",
    h.adresse ? `📍 ${esc(h.adresse)}` : "",
    h.telefon ? `📞 <a href="tel:${esc(h.telefon.replace(/[^\d+]/g, ""))}">${esc(h.telefon)}</a>` : "",
    h.wlan ? `📶 ${esc(h.wlan)}${h.wlanPasswort ? ` · <code>${esc(h.wlanPasswort)}</code>` : ""}` : "",
    h.zugang ? `🔑 ${esc(h.zugang)}` : "",
    h.infos ? `ℹ️ ${esc(h.infos)}` : "",
  ].filter(Boolean);
  return z.length ? `<details class="infosvorort"><summary class="klein">🔑 Infos vor Ort (nur für Mitreisende)</summary><p class="klein">${z.join("<br>")}</p></details>` : "";
}

export function hotelDialog(id, vorlage = {}) {
  const neu = !id;
  const h = id ? hotels().find((x) => x.id === id) : { id: neueId(), status: "idee", preisArt: "nacht", zimmer: 1, verpflegung: "", ...vorlage };
  dialogOeffnen(`<form method="dialog" class="formular" id="hotelForm">
    <h3>${neu ? "Unterkunft hinzufügen" : "Unterkunft bearbeiten"}</h3>
    <div class="formular zwei">
      <label>Name<input name="name" value="${esc(h.name ?? "")}" required></label>
      <label>Ort<input name="ort" value="${esc(h.ort ?? "")}" placeholder="z. B. Marsa Alam"></label>
      <label>Anreise<input type="date" name="anreise" value="${esc(h.anreise ?? "")}"></label>
      <label>Abreise<input type="date" name="abreise" value="${esc(h.abreise ?? "")}"></label>
      <label>Link<input type="url" name="link" value="${esc(h.link ?? "")}" placeholder="https://…"></label>
      <label>Status<select name="status">${Object.entries(STATUS).map(([k, t]) => `<option value="${k}" ${h.status === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    </div>
    <fieldset><legend>Preis</legend><div class="formular drei">
      <label>Preis (€)<input name="preis" inputmode="decimal" value="${esc(h.preis ?? "")}"></label>
      <label>gilt<select name="preisArt"><option value="nacht" ${h.preisArt !== "gesamt" ? "selected" : ""}>pro Nacht und Zimmer</option><option value="gesamt" ${h.preisArt === "gesamt" ? "selected" : ""}>für den ganzen Aufenthalt</option></select></label>
      <label>Zimmer<input name="zimmer" type="number" min="1" value="${esc(h.zimmer ?? 1)}"></label>
      <label>Verpflegung<select name="verpflegung"><option value="">–</option>${Object.entries(VERPFLEGUNG).map(([k, t]) => `<option value="${k}" ${h.verpflegung === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Hotelsterne<select name="kategorie"><option value="">–</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(h.kategorie) === n ? "selected" : ""}>${"★".repeat(n)}</option>`).join("")}</select></label>
      <label>Gästebewertung<input name="gaeste" inputmode="decimal" value="${esc(h.gaeste ?? "")}" placeholder="z. B. 8,9"></label>
      <label>Bewertung von<input name="gaesteQuelle" value="${esc(h.gaesteQuelle ?? "")}" placeholder="Booking, HolidayCheck …"></label>
    </div><div class="vorschau" id="hotelVorschau"></div></fieldset>
    <fieldset><legend>Lage &amp; Ausstattung</legend>
      ${ortsSuche("lage", hatKoord(h) ? { lat: h.lat, lng: h.lng, name: h.name } : null, "Hotel auf der Karte suchen")}
      <div class="formular drei">
        <label>Strand (Meter)<input name="strandM" inputmode="numeric" value="${esc(h.strandM ?? "")}"></label>
        <label>Zentrum (km)<input name="zentrumKm" inputmode="decimal" value="${esc(h.zentrumKm ?? "")}"></label>
      </div>
      <div class="teilnehmer">
        ${[["pool", "Pool"], ["kinder", "Kinderclub/-pool"], ["tauchbasis", "Tauchbasis am Hotel"], ["hausriff", "Hausriff"]].map(([k, t]) => `<label class="haken"><input type="checkbox" name="${k}" ${h[k] ? "checked" : ""}> ${t}</label>`).join("")}
      </div>
    </fieldset>
    <fieldset><legend>🔑 Infos vor Ort (nur für Mitreisende, nie in Freigaben)</legend><div class="formular drei">
      <label>Check-in ab<input type="time" name="checkin" value="${esc(h.checkin ?? "")}"></label>
      <label>Check-out bis<input type="time" name="checkout" value="${esc(h.checkout ?? "")}"></label>
      <label>Telefon<input name="telefon" type="tel" value="${esc(h.telefon ?? "")}"></label>
      <label>Adresse<input name="adresse" value="${esc(h.adresse ?? "")}"></label>
      <label>WLAN-Name<input name="wlan" value="${esc(h.wlan ?? "")}"></label>
      <label>WLAN-Passwort<input name="wlanPasswort" value="${esc(h.wlanPasswort ?? "")}"></label>
    </div>
      <label>Zugang (Schlüsselbox, Code, Rezeption …)<input name="zugang" value="${esc(h.zugang ?? "")}" placeholder="z. B. Schlüsselbox links neben der Tür, Code 4711"></label>
      <label>Hausregeln, Anfahrt, Parken, Müll …<textarea name="infos" rows="2">${esc(h.infos ?? "")}</textarea></label>
      <p class="klein leise">Der Check-out zählt als feste Zeit am Abreisetag (Wecker, Puffer der Ausflüge).</p>
    </fieldset>
    <label>Notiz<textarea name="notiz" rows="3">${esc(h.notiz ?? "")}</textarea></label>
    <div class="zeile">
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
    ${neu ? "" : `<details class="gefahr-klein"><summary class="klein leise">Weitere Aktionen</summary><button type="button" class="knopf gefahr" data-aktion="hotel-loeschen" data-id="${esc(h.id)}">Löschen</button></details>`}
  </form>`);
  const form = $("#hotelForm");
  if (!hatKoord(h) && h.name) $(".ortsq", form).value = `${h.name} ${h.ort ?? ""}`.trim();
  const lesen = () => {
    const f = new FormData(form);
    const lage = ortAuslesen(form, "lage");
    return {
      name: String(f.get("name")).trim(), ort: String(f.get("ort")).trim(), anreise: f.get("anreise"), abreise: f.get("abreise"), link: String(f.get("link")).trim(), status: f.get("status"),
      preis: zahl(f.get("preis")), preisArt: f.get("preisArt"), zimmer: zahl(f.get("zimmer")) ?? 1, verpflegung: f.get("verpflegung"), kategorie: zahl(f.get("kategorie")),
      gaeste: zahl(f.get("gaeste")), gaesteQuelle: String(f.get("gaesteQuelle")).trim(), strandM: zahl(f.get("strandM")), zentrumKm: zahl(f.get("zentrumKm")),
      pool: f.get("pool") === "on", kinder: f.get("kinder") === "on", tauchbasis: f.get("tauchbasis") === "on", hausriff: f.get("hausriff") === "on",
      lat: lage?.lat ?? null, lng: lage?.lng ?? null, notiz: f.get("notiz"),
      checkin: f.get("checkin"), checkout: f.get("checkout"), telefon: String(f.get("telefon")).trim(), adresse: String(f.get("adresse")).trim(),
      wlan: String(f.get("wlan")).trim(), wlanPasswort: String(f.get("wlanPasswort")), zugang: String(f.get("zugang")).trim(), infos: f.get("infos"),
    };
  };
  const vorschau = () => {
    const k = hotelKosten(lesen(), personen(), zimmerVon(zustand.reise, h.id));
    $("#hotelVorschau").innerHTML = `<strong>${geld(k.summe)}</strong> für ${k.naechte} Nächte${k.proPersonNacht != null ? ` · ${geld(k.proPersonNacht)} pro Person und Nacht` : ""}`;
  };
  form.addEventListener("input", vorschau);
  vorschau();
  form.addEventListener("submit", () => {
    Object.assign(h, lesen());
    zustand.reise.hotels ??= [];
    if (neu) zustand.reise.hotels.push(h);
    speichern();
    neuZeichnen();
  });
}

aktionen["hotel-neu"] = () => hotelDialog(null, { ort: $("#hotelSuchort")?.value ?? "" });
aktionen["hotel-bearbeiten"] = (el) => hotelDialog(el.dataset.id);
aktionen["hotel-loeschen"] = (el) => {
  if (!confirm("Unterkunft löschen?")) return;
  zustand.reise.hotels = hotels().filter((h) => h.id !== el.dataset.id);
  zustand.reise.zimmer = (zustand.reise.zimmer ?? []).filter((z) => z.unterkunft !== el.dataset.id);
  dialog().close();
  speichern();
  neuZeichnen();
};
aktionen["hotel-tage"] = (el) => {
  const h = hotels().find((x) => x.id === el.dataset.id);
  const r = zustand.reise;
  r.haefen ??= [];
  let neu = 0;
  for (let d = new Date(`${h.anreise}T12:00:00`); d < new Date(`${h.abreise}T12:00:00`); d.setDate(d.getDate() + 1)) {
    const datum = d.toISOString().slice(0, 10);
    if (r.haefen.some((x) => x.datum === datum)) continue;
    r.haefen.push({ id: neueId(), datum, art: "ort", name: h.ort || h.name, land: "", lat: h.lat ?? null, lng: h.lng ?? null });
    neu++;
  }
  speichern();
  alert(neu ? `${neu} Tage angelegt. Unter „Planen“ kannst du jetzt je Tag Ausflüge sammeln – Startpunkt ist das Hotel.` : "Für diesen Zeitraum gibt es schon alle Tage.");
  neuZeichnen();
};

document.addEventListener("input", (e) => {
  if (e.target.id !== "hotelSuchort") return;
  zustand.hotelSuchort = e.target.value;
  const z = suchZeitraum();
  $("#hotelLinks").innerHTML = suchLinks(e.target.value, z.anreise, z.abreise);
});

export function hotelStatusAendern(id, status) {
  const h = hotels().find((x) => x.id === id);
  h.status = status;
  speichern();
  neuZeichnen();
}

