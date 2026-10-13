// Erlebnisse: Bewertungen mit Fotos und Kommentaren (Ausflüge, Unterkünfte) und das Tauchlogbuch.
import { zustand, $, esc, einfachesMarkdown, datumText, haefen, ausfluegeIn, hafenVon, hatKoord, aktionen, aenderungen, neuZeichnen, dialogOeffnen, dialog, anfrage, fotoHochladen, fotoLeiste, sterneText, sternEingabe, ortsSuche, ortAuslesen, beitraegeLaden, istPlaner } from "./kern.js";
import { KATEGORIEN, zahl, dauerText, tauchProfilSvg, entfernungKm } from "./rechnen.js";
import { zipTexte } from "./zip.js";
import { exifLesen, fotoZuordnen, tauchImport, tauchgangDoppelt, tauchStatistik, ARTEN_MEER, sichtungenListe } from "./unterwegs-logik.js";
import { fotoUrl, stationsArt } from "./kern.js";

const bewertungenZu = (zielArt, zielId) => zustand.beitraege.bewertungen.filter((b) => b.zielArt === zielArt && b.zielId === zielId);
const name = (id) => zustand.beitraege.namen?.[id] ?? zustand.mitglieder.find((m) => m.userId === id)?.name ?? "Mitreisende/r";
const schnitt = (liste) => (liste.length ? liste.reduce((s, b) => s + b.sterne, 0) / liste.length : null);

/** Kleine Zeile unter einem Ausflug/Hotel: Sterne, Fotos, Bewerten, Teilen. */
export function bewertungsZeile(zielArt, zielId) {
  const liste = bewertungenZu(zielArt, zielId);
  const meine = liste.find((b) => b.autorId === zustand.ich?.id);
  const fotos = liste.flatMap((b) => b.fotos ?? []).slice(0, 6);
  return `<div class="bewertungszeile">
    ${liste.length ? `<button class="link ohne" data-aktion="bewertungen-zeigen" data-art="${zielArt}" data-id="${esc(zielId)}">${sterneText(schnitt(liste))} <span class="klein leise">${liste.length} Bewertung${liste.length === 1 ? "" : "en"}</span></button>` : ""}
    ${fotos.length ? fotoLeiste(fotos) : ""}
    <span class="knoepfe">
      <button class="link" data-aktion="bewerten" data-art="${zielArt}" data-id="${esc(zielId)}">${meine ? "Meine Bewertung ändern" : "★ Bewerten"}</button>
      ${liste.length ? `<button class="link" data-aktion="teilen" data-art="${zielArt}" data-id="${esc(zielId)}">Teilen</button>` : ""}
    </span>
  </div>`;
}

function zielTitel(zielArt, zielId) {
  if (zielArt === "hotel") return zustand.reise.hotels?.find((h) => h.id === zielId)?.name ?? "Unterkunft";
  if (zielArt === "flughafen") return (zustand.reise.flughafenOrte ?? []).find((o) => o.id === zielId)?.name ?? "Flughafen";
  return zustand.reise.ausfluege?.find((a) => a.id === zielId)?.titel ?? "Ausflug";
}

// ---------- Fotos im Dialog ----------

function fotoFeld(ids, privat = []) {
  return `<fieldset><legend>Fotos</legend>
    <p class="klein leise">Antippen von 🔒/🌍 schaltet um: 🔒 = nur für uns, 🌍 = darf geteilt werden (Freigabe-Links, Reisetagebuch, Social Media). Neue Fotos sind erst einmal 🔒.</p>
    <div id="fotoListe">${fotoLeiste(ids, { entfernbar: true, privat, schaltbar: true })}</div>
    <input type="hidden" name="fotos" value="${esc(JSON.stringify(ids))}">
    <input type="hidden" name="fotosPrivat" value="${esc(JSON.stringify(privat))}">
    <label class="knopf leise">📷 Fotos hinzufügen<input type="file" accept="image/*" multiple hidden id="fotoWahl"></label>
    <span class="klein leise" id="fotoStatus">Fotos werden vor dem Hochladen verkleinert.</span>
  </fieldset>`;
}

const jsonFeld = (form, name) => {
  try {
    return JSON.parse(new FormData(form).get(name) || "[]");
  } catch {
    return [];
  }
};
const fotosLesen = (form) => jsonFeld(form, "fotos");
const fotosPrivatLesen = (form) => jsonFeld(form, "fotosPrivat").filter((f) => fotosLesen(form).includes(f));

function fotosSetzen(form, ids, privat = fotosPrivatLesen(form)) {
  form.querySelector("input[name=fotos]").value = JSON.stringify(ids);
  form.querySelector("input[name=fotosPrivat]").value = JSON.stringify(privat.filter((f) => ids.includes(f)));
  $("#fotoListe").innerHTML = fotoLeiste(ids, { entfernbar: true, privat, schaltbar: true });
}

aktionen["foto-sichtbarkeit"] = (el) => {
  const form = el.closest("form");
  const privat = new Set(fotosPrivatLesen(form));
  if (privat.has(el.dataset.id)) privat.delete(el.dataset.id);
  else privat.add(el.dataset.id);
  fotosSetzen(form, fotosLesen(form), [...privat]);
};

document.addEventListener("change", async (e) => {
  if (e.target.id !== "fotoWahl") return;
  const form = e.target.closest("form");
  const dateien = [...e.target.files];
  const ids = fotosLesen(form);
  let n = 0;
  for (const d of dateien) {
    $("#fotoStatus").textContent = `Lade hoch … ${++n}/${dateien.length}`;
    try {
      const neu = await fotoHochladen(d);
      ids.push(neu);
      fotosSetzen(form, ids, [...fotosPrivatLesen(form), neu]);
    } catch (err) {
      alert(err.message);
    }
  }
  $("#fotoStatus").textContent = `${dateien.length} Foto(s) hochgeladen.`;
  e.target.value = "";
});

aktionen["foto-entfernen"] = async (el) => {
  const form = el.closest("form");
  if (!form) return;
  if (!confirm("Foto entfernen?")) return;
  fotosSetzen(form, fotosLesen(form).filter((x) => x !== el.dataset.id), fotosPrivatLesen(form).filter((x) => x !== el.dataset.id));
  await anfrage(`/api/reisen/${zustand.reise.id}/fotos/${el.dataset.id}`, { method: "DELETE" }).catch(() => {});
};

// ---------- Bewertungen ----------

function bewertungDialog(zielArt, zielId) {
  const b = bewertungenZu(zielArt, zielId).find((x) => x.autorId === zustand.ich.id) ?? { sterne: 0, titel: "", text: "", fotos: [] };
  dialogOeffnen(`<form method="dialog" class="formular" id="bewertungForm">
    <h3>Bewertung: ${esc(zielTitel(zielArt, zielId))}</h3>
    <label>Wie war es?${sternEingabe("sterne", b.sterne)}</label>
    <label>Überschrift<input name="titel" value="${esc(b.titel ?? "")}" maxlength="200" placeholder="z. B. Bestes Highlight der Reise!"></label>
    <label>🌍 Kommentar zum Teilen<textarea name="text" rows="5" placeholder="Was war toll, was nicht? Tipps für andere (Treffpunkt, Kinder, Wartezeiten …) – erscheint in Freigaben und im Reisetagebuch">${esc(b.text ?? "")}</textarea></label>
    <label>🔒 Private Notiz – nur für uns<textarea name="textPrivat" rows="3" placeholder="z. B. Trinkgeld, Name des Guides, was wir nicht öffentlich schreiben wollen">${esc(b.textPrivat ?? "")}</textarea></label>
    ${fotoFeld(b.fotos ?? [], b.fotosPrivat ?? [])}
    <label class="haken"><input type="checkbox" name="privat" ${b.privat ? "checked" : ""}> 🔒 Ganze Bewertung nur für Mitreisende (auch Sterne und Kommentar nie teilen)</label>
    <div class="zeile">
      ${b.id ? `<button type="button" class="knopf gefahr" data-aktion="bewertung-loeschen" data-id="${esc(b.id)}">Löschen</button>` : ""}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
  </form>`);
  $("#bewertungForm").addEventListener("submit", async (e) => {
    const f = new FormData(e.target);
    const daten = { zielArt, zielId, sterne: Number(f.get("sterne")), titel: f.get("titel"), text: f.get("text"), textPrivat: f.get("textPrivat"), fotos: fotosLesen(e.target), fotosPrivat: fotosPrivatLesen(e.target), privat: f.get("privat") === "on" };
    try {
      await anfrage(`/api/reisen/${zustand.reise.id}/bewertungen`, { method: "POST", body: daten });
      await beitraegeLaden();
      neuZeichnen();
    } catch (err) {
      alert(err.message);
    }
  });
}

aktionen["bewerten"] = (el) => bewertungDialog(el.dataset.art, el.dataset.id);
aktionen["bewertung-loeschen"] = async (el) => {
  if (!confirm("Bewertung löschen?")) return;
  await anfrage(`/api/reisen/${zustand.reise.id}/bewertungen/${el.dataset.id}`, { method: "DELETE" });
  dialog().close();
  await beitraegeLaden();
  neuZeichnen();
};

aktionen["bewertungen-zeigen"] = (el) => {
  const { art, id } = el.dataset;
  const liste = bewertungenZu(art, id);
  dialogOeffnen(`<div class="formular">
    <h3>${esc(zielTitel(art, id))} ${sterneText(schnitt(liste))}</h3>
    ${liste.map((b) => `<article class="bewertung"><div class="zeile"><strong>${esc(name(b.autorId))}</strong> ${sterneText(b.sterne)}${b.privat ? ' <span class="klein leise">🔒 privat</span>' : ""} <span class="leise klein">${esc(new Date(b.erstellt).toLocaleDateString("de-DE"))}</span></div>
      ${b.titel ? `<h4>${esc(b.titel)}</h4>` : ""}${b.text ? `<p class="notiz">${esc(b.text)}</p>` : ""}${b.textPrivat ? `<p class="notiz privatnotiz">🔒 ${esc(b.textPrivat)}</p>` : ""}${fotoLeiste(b.fotos ?? [], { privat: b.fotosPrivat ?? [], zeigeStatus: true })}</article>`).join("")}
    <div class="zeile"><button class="knopf leise" data-aktion="teilen" data-art="${art}" data-id="${esc(id)}">Teilen …</button><span class="platz"></span><button class="knopf" data-aktion="dialog-zu">Schließen</button></div>
  </div>`, true);
};

// ---------- Tauchlog ----------

const STROEMUNG = ["", "keine", "leicht", "mittel", "stark"];
const EINSTIEG = ["", "Boot", "Ufer", "Hausriff", "Liveaboard"];

function tauchgangDialog(id, vorlage = {}) {
  const neu = !id;
  const t = id ? zustand.beitraege.tauchgaenge.find((x) => x.id === id) : { taucherId: zustand.ich.id, gas: "Luft", fotos: [], ...vorlage };
  const taucherWahl = istPlaner() && zustand.mitglieder.length > 1
    ? `<label>Taucher/in<select name="taucherId">${zustand.mitglieder.map((m) => `<option value="${esc(m.userId)}" ${m.userId === t.taucherId ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>`
    : `<input type="hidden" name="taucherId" value="${esc(t.taucherId ?? zustand.ich.id)}">`;
  const tauchAusfluege = (zustand.reise.ausfluege ?? []).filter((a) => ["tauchen", "schnorcheln", "boot"].includes(a.kategorie));
  const zahlFeld = (n, label, einheit, schritt = "any") => `<label>${label}<span class="einheit"><input name="${n}" type="number" step="${schritt}" inputmode="decimal" value="${esc(t[n] ?? "")}"><em>${einheit}</em></span></label>`;
  dialogOeffnen(`<form method="dialog" class="formular" id="tauchForm">
    <h3>${neu ? "Tauchgang eintragen" : "Tauchgang bearbeiten"}</h3>
    ${t.profil?.length ? `<figure class="profilbox">${tauchProfilSvg(t.profil)}<figcaption class="klein leise">Tiefenprofil vom Tauchcomputer</figcaption></figure>` : ""}
    <div class="formular drei">
      <label>Datum<input type="date" name="datum" value="${esc(t.datum ?? "")}" required></label>
      <label>Abtauchen<input type="time" name="beginn" value="${esc(t.beginn ?? "")}"></label>
      ${taucherWahl}
      <label>Tauchplatz<input name="tauchplatz" value="${esc(t.tauchplatz ?? "")}" required placeholder="z. B. Elphinstone Reef"></label>
      <label>Gebiet / Ort<input name="ort" value="${esc(t.ort ?? "")}" placeholder="z. B. Marsa Alam, Ägypten"></label>
      <label>Tauchbasis<input name="basis" value="${esc(t.basis ?? "")}"></label>
      <label>Einstieg<select name="einstieg">${EINSTIEG.map((x) => `<option ${t.einstieg === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <label>Ausflug<select name="ausflugId"><option value="">–</option>${tauchAusfluege.map((a) => `<option value="${esc(a.id)}" ${t.ausflugId === a.id ? "selected" : ""}>${esc(datumText(hafenVon(a.hafenId)?.datum))} ${esc(a.titel)}</option>`).join("")}</select></label>
      <label>Bewertung<select name="sterne"><option value="">–</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(t.sterne) === n ? "selected" : ""}>${"★".repeat(n)}</option>`).join("")}</select></label>
    </div>
    <fieldset><legend>Tauchprofil</legend><div class="formular drei">
      ${zahlFeld("maxTiefe", "Max. Tiefe", "m", "0.1")}${zahlFeld("mittelTiefe", "Ø Tiefe", "m", "0.1")}${zahlFeld("tauchzeitMin", "Tauchzeit", "Min.", "1")}
      ${zahlFeld("wasserTemp", "Wasser", "°C", "0.5")}${zahlFeld("luftTemp", "Luft", "°C", "0.5")}${zahlFeld("sicht", "Sicht", "m", "1")}
      <label>Strömung<select name="stroemung">${STROEMUNG.map((x) => `<option ${t.stroemung === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
    </div></fieldset>
    <fieldset><legend>Ausrüstung &amp; Gas</legend><div class="formular drei">
      <label>Anzug<input name="anzug" value="${esc(t.anzug ?? "")}" placeholder="z. B. 5 mm Nass"></label>
      ${zahlFeld("blei", "Blei", "kg", "0.5")}${zahlFeld("flascheL", "Flasche", "Liter", "1")}
      <label>Material<select name="flascheMaterial">${["", "Stahl", "Alu"].map((x) => `<option ${t.flascheMaterial === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <label>Gas<select name="gas">${["Luft", "Nitrox", "Trimix"].map((x) => `<option ${t.gas === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      ${zahlFeld("nitroxProzent", "O₂-Anteil", "%", "1")}${zahlFeld("druckStart", "Druck Start", "bar", "1")}${zahlFeld("druckEnde", "Druck Ende", "bar", "1")}
    </div></fieldset>
    <div class="formular zwei">
      <label>Buddy<input name="buddy" value="${esc(t.buddy ?? "")}"></label>
      <label>Guide<input name="guide" value="${esc(t.guide ?? "")}"></label>
    </div>
    <label>Gesehen (Tiere, Wracks …)<textarea name="sichtungen" rows="2" placeholder="z. B. Hammerhaie, Schildkröte, Napoleon">${esc(t.sichtungen ?? "")}</textarea></label>
    <div class="arten">${ARTEN_MEER.map((a) => `<button type="button" class="artchip ${sichtungenListe(t.sichtungen).includes(a) ? "an" : ""}" data-aktion="art-umschalten" data-art="${esc(a)}">${esc(a)}</button>`).join("")}</div>
    <label>🌍 Kommentar zum Teilen<textarea name="text" rows="3">${esc(t.text ?? "")}</textarea></label>
    <label>🔒 Private Notiz – nur für uns<textarea name="textPrivat" rows="2">${esc(t.textPrivat ?? "")}</textarea></label>
    <label>Tauchplatz auf der Karte</label>
    ${ortsSuche("platz", hatKoord(t) ? { lat: t.lat, lng: t.lng, name: t.tauchplatz } : null, "Tauchplatz suchen oder Koordinaten einfügen")}
    ${fotoFeld(t.fotos ?? [], t.fotosPrivat ?? [])}
    <label class="haken"><input type="checkbox" name="privat" ${t.privat ? "checked" : ""}> 🔒 Ganzer Tauchgang nur für Mitreisende – nicht teilbar</label>
    <div class="zeile">
      ${neu ? "" : `<button type="button" class="knopf gefahr" data-aktion="tauchgang-loeschen" data-id="${esc(t.id)}">Löschen</button>`}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
  </form>`, true);
  $("#tauchForm").addEventListener("submit", async (e) => {
    const f = Object.fromEntries(new FormData(e.target));
    const platz = ortAuslesen(e.target, "platz");
    delete f.platz;
    delete f.fotosPrivat;
    const daten = { ...f, lat: platz?.lat ?? null, lng: platz?.lng ?? null, fotos: fotosLesen(e.target), fotosPrivat: fotosPrivatLesen(e.target), privat: f.privat === "on" };
    for (const k of ["maxTiefe", "mittelTiefe", "wasserTemp", "luftTemp", "sicht", "blei", "nitroxProzent"]) daten[k] = zahl(daten[k]);
    try {
      await anfrage(`/api/reisen/${zustand.reise.id}/tauchgaenge${neu ? "" : `/${t.id}`}`, { method: neu ? "POST" : "PUT", body: daten });
      await beitraegeLaden();
      neuZeichnen();
    } catch (err) {
      alert(err.message);
    }
  });
}

aktionen["tauchgang-neu"] = (el) => {
  const a = el.dataset.ausflug ? zustand.reise.ausfluege.find((x) => x.id === el.dataset.ausflug) : null;
  const h = a ? hafenVon(a.hafenId) : null;
  tauchgangDialog(null, a ? { ausflugId: a.id, datum: h?.datum ?? "", ort: [h?.name, h?.land].filter(Boolean).join(", "), tauchplatz: a.titel, beginn: a.beginn ?? "", ...(hatKoord(a.ziel) ? { lat: a.ziel.lat, lng: a.ziel.lng } : {}) } : {});
};
aktionen["tauchgang-bearbeiten"] = (el) => tauchgangDialog(el.dataset.id);
aktionen["tauchgang-loeschen"] = async (el) => {
  if (!confirm("Tauchgang löschen?")) return;
  await anfrage(`/api/reisen/${zustand.reise.id}/tauchgaenge/${el.dataset.id}`, { method: "DELETE" });
  dialog().close();
  await beitraegeLaden();
  neuZeichnen();
};

aktionen["logbuch"] = async () => {
  const liste = await anfrage("/api/tauchlog");
  const st = tauchStatistik(liste);
  const komma = (n, e) => (n == null ? "–" : `${String(n).replace(".", ",")} ${e}`);
  dialogOeffnen(`<div class="formular">
    <h3>Mein Logbuch – alle Reisen</h3>
    <div class="kacheln">
      <div class="kachel"><span>Tauchgänge</span><strong>${liste.length ? liste.at(-1).nr : zustand.ich.tauchVorher ?? 0}</strong></div>
      <div class="kachel"><span>Unter Wasser (hier erfasst)</span><strong>${dauerText(st.summeMin)}</strong></div>
      <div class="kachel"><span>Tiefster</span><strong>${komma(st.tiefste, "m")}</strong><em class="klein">${esc(st.tiefsterPlatz)}</em></div>
      <div class="kachel"><span>Längster</span><strong>${st.laengste ? `${st.laengste} Min.` : "–"}</strong><em class="klein">${esc(st.laengsterPlatz)}</em></div>
      <div class="kachel"><span>Ø max. Tiefe</span><strong>${komma(st.mittelTiefe, "m")}</strong></div>
      <div class="kachel"><span>Wasser</span><strong>${st.kaelteste != null ? `${komma(st.kaelteste, "")}– ${komma(st.waermste, "°C")}` : "–"}</strong></div>
      <div class="kachel"><span>Tauchplätze</span><strong>${st.plaetze}</strong></div>
      <div class="kachel"><span>Arten gesehen</span><strong>${st.arten.length}</strong></div>
    </div>
    ${st.arten.length ? `<details><summary>🐠 Artenliste (${st.arten.length})</summary><p>${st.arten.map(([a, n]) => `${esc(a)} <span class="leise klein">${n}×</span>`).join(" · ")}</p></details>` : ""}
    <p class="leise klein">Die Nummerierung beginnt nach deinen bisherigen Tauchgängen (einstellbar unter „Mein Konto“).</p>
    <div class="tabelle"><table><thead><tr><th>Nr.</th><th>Datum</th><th>Tauchplatz</th><th>Reise</th><th class="zahl">Tiefe</th><th class="zahl">Zeit</th></tr></thead><tbody>
      ${[...liste].reverse().map((t) => `<tr><td>${t.nr}</td><td>${esc(datumText(t.datum, { day: "2-digit", month: "2-digit", year: "2-digit" }))}</td><td>${esc(t.tauchplatz)}<div class="klein leise">${esc(t.ort ?? "")}</div></td><td class="klein">${esc(t.reiseName)}</td><td class="zahl">${t.maxTiefe != null ? `${String(t.maxTiefe).replace(".", ",")} m` : ""}</td><td class="zahl">${t.tauchzeitMin != null ? `${t.tauchzeitMin}′` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="leise">Noch keine Tauchgänge.</td></tr>`}
    </tbody></table></div>
    <div class="zeile"><span class="platz"></span><button class="knopf" data-aktion="dialog-zu">Schließen</button></div>
  </div>`, true);
};

// ---------- Ansicht ----------

export function erlebnisseAnsicht() {
  const tage = haefen();
  const heute = new Date().toISOString().slice(0, 10);
  const zeilen = tage
    .map((h) => {
      const liste = ausfluegeIn(h.id).filter((a) => a.status === "gebucht" || bewertungenZu("ausflug", a.id).length);
      if (!liste.length) return "";
      return `<div class="erlebnistag"><div class="tagkopf">${esc(datumText(h.datum))} · <strong>${esc(h.name)}</strong>${h.datum > heute ? ' <span class="klein leise">(steht noch bevor)</span>' : ""}</div>
        ${liste.map((a) => `<div class="erlebnis"><div><strong>${esc(a.titel)}</strong> <span class="klein leise">${esc(KATEGORIEN[a.kategorie] ?? "")}</span>
          ${a.kategorie === "tauchen" ? ` <button class="link" data-aktion="tauchgang-neu" data-ausflug="${esc(a.id)}">🤿 Tauchgang loggen</button>` : ""}</div>${bewertungsZeile("ausflug", a.id)}</div>`).join("")}
      </div>`;
    })
    .join("");
  const hotelZeilen = (zustand.reise.hotels ?? []).filter((h) => h.status === "gebucht" || bewertungenZu("hotel", h.id).length)
    .map((h) => `<div class="erlebnis"><div>🏨 <strong>${esc(h.name)}</strong> <span class="klein leise">${esc(h.ort ?? "")}</span></div>${bewertungsZeile("hotel", h.id)}</div>`).join("");
  const tauch = [...zustand.beitraege.tauchgaenge].sort((a, b) => `${a.datum} ${a.beginn}`.localeCompare(`${b.datum} ${b.beginn}`));
  return `
    <div class="karte-box">
      <div class="zeile"><h3>Bewertungen &amp; Fotos</h3><button class="knopf leise" data-aktion="teilen" data-art="bericht" data-id="">Reisebericht teilen</button><button class="knopf leise" data-aktion="reisebuch">📖 Reisebuch / PDF</button><button class="knopf leise" data-aktion="rueckblick">Jahresrückblick</button>${zustand.info.ki ? `<button class="knopf leise" data-aktion="naechste-reise">✨ Ideen für die nächste Reise</button>` : ""}</div>
      <p class="leise klein">Jede/r bewertet selbst – mit Sternen, Kommentar und Fotos. Über „Teilen“ entsteht ein Link, der nur diesen Beitrag zeigt (nicht die Reise, nicht die Kosten).</p>
      ${zeilen || hotelZeilen ? `${zeilen}${hotelZeilen ? `<div class="erlebnistag"><div class="tagkopf"><strong>Unterkünfte</strong></div>${hotelZeilen}</div>` : ""}` : `<p class="leise">Sobald Ausflüge oder Unterkünfte als „Gebucht“ markiert sind, können sie hier bewertet werden.</p>`}
    </div>
    ${albumKarte()}
    <div class="karte-box">
      <div class="zeile"><h3>Tauchlog (${tauch.length})</h3><button class="knopf leise" data-aktion="logbuch">Mein Logbuch &amp; Statistik</button><label class="knopf leise" title="UDDF (auch als ZIP), Subsurface (.ssrf/.xml) oder CSV – z. B. Apple Watch über Oceanic+, Shearwater Cloud, Suunto, Garmin über Subsurface">⌚ Vom Tauchcomputer<input type="file" accept=".uddf,.udcf,.xml,.ssrf,.csv,.tsv,.txt,.zip,application/zip,application/xml,text/xml,text/csv" hidden id="tauchImportDatei"></label><button class="knopf" data-aktion="tauchgang-neu">+ Tauchgang</button></div>
      ${tauch.length ? `<div class="tabelle"><table><thead><tr><th>Datum</th><th>Tauchplatz</th><th>Wer</th><th class="zahl">Tiefe</th><th class="zahl">Zeit</th><th class="zahl">Wasser</th><th></th></tr></thead><tbody>
        ${tauch.map((t) => `<tr><td>${esc(datumText(t.datum))}${t.beginn ? `<div class="klein leise">${esc(t.beginn)}</div>` : ""}</td><td><strong>${esc(t.tauchplatz)}</strong>${t.sterne ? ` ${sterneText(t.sterne)}` : ""}<div class="klein leise">${esc([t.ort, t.basis].filter(Boolean).join(" · "))}</div>${t.sichtungen ? `<div class="klein">🐠 ${esc(t.sichtungen)}</div>` : ""}${fotoLeiste((t.fotos ?? []).slice(0, 4), { privat: t.fotosPrivat ?? [], zeigeStatus: true })}</td><td>${esc(name(t.taucherId))}</td><td class="zahl">${t.maxTiefe != null ? `${String(t.maxTiefe).replace(".", ",")} m` : ""}</td><td class="zahl">${t.tauchzeitMin != null ? `${t.tauchzeitMin}′` : ""}</td><td class="zahl">${t.wasserTemp != null ? `${String(t.wasserTemp).replace(".", ",")} °C` : ""}</td>
          <td><button class="link" data-aktion="tauchgang-bearbeiten" data-id="${esc(t.id)}">Bearbeiten</button> ${t.privat ? '<span class="klein leise">🔒</span>' : `<button class="link" data-aktion="teilen" data-art="tauchgang" data-id="${esc(t.id)}">Teilen</button>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="leise">Noch keine Tauchgänge auf dieser Reise.</p>`}
    </div>`;
}


// ---------- Sichtungen ----------

aktionen["art-umschalten"] = (el) => {
  const feld = el.closest("form").sichtungen;
  const liste = sichtungenListe(feld.value);
  const art = el.dataset.art;
  feld.value = (liste.includes(art) ? liste.filter((x) => x !== art) : [...liste, art]).join(", ");
  el.classList.toggle("an", !liste.includes(art));
};

// ---------- Import vom Tauchcomputer ----------

let importTauch = [];
document.addEventListener("change", async (e) => {
  if (e.target.id !== "tauchImportDatei" || !e.target.files[0]) return;
  const datei = e.target.files[0];
  e.target.value = "";
  try {
    const kopf = new Uint8Array(await datei.slice(0, 4).arrayBuffer());
    const istZip = kopf[0] === 0x50 && kopf[1] === 0x4b;
    const texte = istZip ? await zipTexte(await datei.arrayBuffer()) : [{ name: datei.name, text: await datei.text() }];
    const gesehen = new Set();
    importTauch = texte.flatMap((x) => tauchImport(x.text, x.name)).filter((t) => {
      const k = `${t.datum} ${t.beginn} ${t.maxTiefe}`;
      return !gesehen.has(k) && gesehen.add(k);
    });
  } catch (err) {
    return alert(`Die Datei konnte nicht gelesen werden: ${err.message}`);
  }
  if (!importTauch.length) return alert("In der Datei wurden keine Tauchgänge erkannt. Unterstützt: UDDF (auch als ZIP, z. B. Apple Watch über Oceanic+), Subsurface-Logbuch (.ssrf/.xml) und CSV mit Spalten wie Datum, Zeit, Max. Tiefe, Dauer.");
  const meine = zustand.beitraege.tauchgaenge.filter((t) => t.taucherId === zustand.ich.id);
  const { von, bis } = (() => {
    const d = haefen().map((h) => h.datum).filter(Boolean).sort();
    return { von: d[0] ?? "", bis: d.at(-1) ?? "" };
  })();
  dialogOeffnen(`<form method="dialog" class="formular" id="tauchImportForm">
    <h3>⌚ ${importTauch.length} Tauchgänge erkannt</h3>
    <p class="leise klein">Vorausgewählt sind Tauchgänge im Zeitraum dieser Reise${von ? ` (${esc(datumText(von))} – ${esc(datumText(bis))})` : ""}, die noch nicht im Log stehen. Sehr kurze Tauchgänge (unter 3 Min. oder flacher als 2 m, z. B. Tests an der Oberfläche) sind abgewählt. Tauchplatz und Fotos kannst du danach ergänzen.</p>
    <div class="tabelle"><table><thead><tr><th></th><th>Datum</th><th>Tauchplatz</th><th class="zahl">Tiefe</th><th class="zahl">Zeit</th><th class="zahl">Wasser</th></tr></thead><tbody>
      ${importTauch.map((t, i) => {
        const doppelt = tauchgangDoppelt(t, meine);
        const passt = !von || (t.datum >= von && t.datum <= bis);
        const kurz = (t.tauchzeitMin != null && t.tauchzeitMin < 3) || (t.maxTiefe != null && t.maxTiefe < 2);
        const platz = t.tauchplatz || (t.lat != null ? "📍 GPS-Position" : "–");
        return `<tr class="${doppelt || kurz ? "leise" : ""}"><td><input type="checkbox" name="i" value="${i}" ${passt && !doppelt && !kurz ? "checked" : ""}></td><td>${esc(datumText(t.datum))} ${esc(t.beginn)}</td><td>${esc(platz)}${t.profil?.length ? ' <span class="klein" title="mit Tiefenprofil">📈</span>' : ""}${doppelt ? ' <span class="klein">(schon im Log)</span>' : kurz ? ' <span class="klein">(sehr kurz)</span>' : ""}</td><td class="zahl">${t.maxTiefe != null ? `${String(t.maxTiefe).replace(".", ",")} m` : ""}</td><td class="zahl">${t.tauchzeitMin != null ? `${t.tauchzeitMin}′` : ""}</td><td class="zahl">${t.wasserTemp != null ? `${String(t.wasserTemp).replace(".", ",")} °C` : ""}</td></tr>`;
      }).join("")}
    </tbody></table></div>
    <div class="zeile"><span class="platz"></span><button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button><button class="knopf" value="ok">Übernehmen</button></div>
  </form>`, true);
  $("#tauchImportForm").addEventListener("submit", async (ev) => {
    const auswahl = new FormData(ev.target).getAll("i").map((i) => importTauch[Number(i)]);
    let n = 0;
    for (const t of auswahl) {
      // Passenden Tauch-Ausflug desselben Tages verknüpfen
      const tag = haefen().find((h) => h.datum === t.datum);
      const ausflug = tag ? ausfluegeIn(tag.id).find((a) => a.kategorie === "tauchen" && a.status === "gebucht") : null;
      // Ohne Namen (z. B. Apple Watch/Oceanic+ speichert nur GPS): nächsten bekannten Ort der Reise im Umkreis von 10 km nehmen
      const naechster = hatKoord(t)
        ? [...(zustand.reise.ausfluege ?? []).filter((a) => hatKoord(a.ziel)).map((a) => ({ name: a.titel, ...a.ziel, ausflug: true })), ...haefen().filter(hatKoord)]
            .map((o) => ({ o, km: entfernungKm(t, o) }))
            .filter((x) => x.km != null && x.km <= 10)
            .sort((a, b) => a.km - b.km)[0]?.o
        : null;
      try {
        await anfrage(`/api/reisen/${zustand.reise.id}/tauchgaenge`, { method: "POST", body: { ...t, tauchplatz: t.tauchplatz || ausflug?.titel || (naechster?.ausflug ? naechster.name : "") || `Tauchgang ${t.beginn}`.trim(), ort: t.ort || [tag?.name, tag?.land].filter(Boolean).join(", ") || (naechster && !naechster.ausflug ? [naechster.name, naechster.land].filter(Boolean).join(", ") : ""), ausflugId: ausflug?.id ?? "", taucherId: zustand.ich.id, gas: "Luft", fotos: [], privat: false } });
        n++;
      } catch (err) {
        alert(err.message);
        break;
      }
    }
    await beitraegeLaden();
    neuZeichnen();
    if (n) alert(`${n} Tauchgänge übernommen.`);
  });
});

// ---------- Fotoalbum: automatisch Tagen und Ausflügen zuordnen ----------

function albumKarte() {
  const fotos = zustand.beitraege.fotos.filter((f) => f.art !== "kinder" && ("hafenId" in f || f.aufnahme));
  const tage = haefen();
  const gruppen = tage.map((h) => ({ h, fotos: fotos.filter((f) => f.hafenId === h.id) })).filter((g) => g.fotos.length);
  const ohne = fotos.filter((f) => !f.hafenId || !hafenVon(f.hafenId));
  const titel = (id) => zustand.reise.ausfluege.find((a) => a.id === id)?.titel;
  const zeile = (f) => `<figure class="albumfoto">
      <a href="${fotoUrl(f.id)}" target="_blank"><img loading="lazy" src="${fotoUrl(f.id, true)}" alt=""></a>
      <button type="button" class="sicht ${f.geteilt ? "offen" : "privat"}" data-aktion="album-teilen" data-id="${esc(f.id)}" title="${f.geteilt ? "Wird im Reisetagebuch gezeigt – antippen für nur für uns" : "Nur für uns – antippen zum Freigeben"}">${f.geteilt ? "🌍" : "🔒"}</button>
      <figcaption class="klein">${f.aufnahme?.zeit ? `${esc(f.aufnahme.zeit)} · ` : ""}${f.ausflugId && titel(f.ausflugId) ? esc(titel(f.ausflugId)) : ""}
        <button type="button" class="link" data-aktion="album-zuordnen" data-id="${esc(f.id)}">ändern</button></figcaption>
    </figure>`;
  return `<div class="karte-box">
    <div class="zeile"><h3>📷 Fotoalbum (${fotos.length})</h3><span class="platz"></span><label class="knopf">📷 Fotos hinzufügen<input type="file" accept="image/*" multiple hidden id="albumWahl"></label></div>
    <p class="leise klein">Viele Fotos auf einmal hochladen: Aufnahmezeit und Ort aus dem Foto ordnen sie automatisch dem richtigen Tag und Ausflug zu. Neue Fotos sind 🔒 (nur für uns); 🌍 zeigt sie im öffentlichen Reisetagebuch. GPS-Daten werden nicht weitergegeben.</p>
    <span class="klein leise" id="albumStatus"></span>
    ${gruppen.map((g) => `<div class="albumtag"><h4>${esc(datumText(g.h.datum))} · ${stationsArt(g.h) === "seetag" ? "🌊 Seetag" : esc(g.h.name)} <span class="leise klein">(${g.fotos.length})</span></h4><div class="album">${g.fotos.sort((a, b) => String(a.aufnahme?.zeit ?? "").localeCompare(String(b.aufnahme?.zeit ?? ""))).map(zeile).join("")}</div></div>`).join("")}
    ${ohne.length ? `<div class="albumtag"><h4>Ohne Tag <span class="leise klein">(${ohne.length} – kein Aufnahmedatum oder außerhalb der Reise)</span></h4><div class="album">${ohne.map(zeile).join("")}</div></div>` : ""}
  </div>`;
}

document.addEventListener("change", async (e) => {
  if (e.target.id !== "albumWahl") return;
  const dateien = [...e.target.files];
  e.target.value = "";
  const status = (t) => {
    const el = $("#albumStatus");
    if (el) el.textContent = t;
  };
  let n = 0;
  let zugeordnet = 0;
  for (const d of dateien) {
    status(`Lade hoch … ${++n}/${dateien.length}`);
    try {
      const aufnahme = exifLesen(await d.slice(0, 256 * 1024).arrayBuffer());
      if (!aufnahme.datum && d.lastModified) {
        const m = new Date(d.lastModified);
        aufnahme.datum = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
        aufnahme.zeit = `${String(m.getHours()).padStart(2, "0")}:${String(m.getMinutes()).padStart(2, "0")}`;
      }
      const ziel = fotoZuordnen(aufnahme, zustand.reise);
      if (ziel.hafenId) zugeordnet++;
      await fotoHochladen(d, { aufnahme, hafenId: ziel.hafenId, ausflugId: ziel.ausflugId, geteilt: false });
    } catch (err) {
      alert(err.message);
    }
  }
  neuZeichnen();
  status(`${dateien.length} Foto(s) hochgeladen, ${zugeordnet} automatisch einem Tag zugeordnet.`);
});

async function fotoAendern(id, daten) {
  const x = await anfrage(`/api/reisen/${zustand.reise.id}/fotos/${id}`, { method: "PUT", body: daten });
  Object.assign(zustand.beitraege.fotos.find((f) => f.id === id), x);
  neuZeichnen();
}

aktionen["album-teilen"] = (el) => {
  const f = zustand.beitraege.fotos.find((x) => x.id === el.dataset.id);
  return fotoAendern(f.id, { geteilt: !f.geteilt });
};

aktionen["album-zuordnen"] = (el) => {
  const f = zustand.beitraege.fotos.find((x) => x.id === el.dataset.id);
  const darf = f.autorId === zustand.ich.id || istPlaner();
  dialogOeffnen(`<form method="dialog" class="formular" id="albumForm">
    <h3>Foto zuordnen</h3>
    <img class="albumvorschau" src="${fotoUrl(f.id, true)}" alt="">
    ${f.aufnahme?.datum ? `<p class="klein leise">Aufgenommen ${esc(datumText(f.aufnahme.datum))}${f.aufnahme.zeit ? ` um ${esc(f.aufnahme.zeit)}` : ""}${f.aufnahme.lat != null ? " · mit Ort" : ""}</p>` : ""}
    <label>Tag<select name="hafenId"><option value="">– ohne Tag –</option>${haefen().map((h) => `<option value="${esc(h.id)}" ${f.hafenId === h.id ? "selected" : ""}>${esc(datumText(h.datum))} – ${stationsArt(h) === "seetag" ? "Seetag" : esc(h.name)}</option>`).join("")}</select></label>
    <label>Ausflug<select name="ausflugId"><option value="">– keiner –</option>${zustand.reise.ausfluege.filter((a) => a.status !== "verworfen").map((a) => `<option value="${esc(a.id)}" ${f.ausflugId === a.id ? "selected" : ""}>${esc(datumText(hafenVon(a.hafenId)?.datum))} ${esc(a.titel)}</option>`).join("")}</select></label>
    <div class="zeile">
      ${darf ? `<button type="button" class="knopf gefahr" data-aktion="album-loeschen" data-id="${esc(f.id)}">Foto löschen</button>` : ""}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok" ${darf ? "" : "disabled"}>Speichern</button>
    </div>
  </form>`);
  const form = $("#albumForm");
  form.ausflugId.addEventListener("change", () => {
    const a = zustand.reise.ausfluege.find((x) => x.id === form.ausflugId.value);
    if (a) form.hafenId.value = a.hafenId;
  });
  form.addEventListener("submit", () => fotoAendern(f.id, { hafenId: form.hafenId.value, ausflugId: form.ausflugId.value }).catch((err) => alert(err.message)));
};

aktionen["album-loeschen"] = async (el) => {
  if (!confirm("Foto endgültig löschen?")) return;
  await anfrage(`/api/reisen/${zustand.reise.id}/fotos/${el.dataset.id}`, { method: "DELETE" });
  zustand.beitraege.fotos = zustand.beitraege.fotos.filter((f) => f.id !== el.dataset.id);
  dialog().close();
  neuZeichnen();
};

// ---------- Ideen für die nächste Reise (KI) ----------

function naechsteReiseDialog(text = "", laeuft = false, fehlerText = "") {
  dialogOeffnen(`<form method="dialog" class="formular" id="naechsteForm">
    <h3>✨ Ideen für die nächste Reise</h3>
    <p class="leise klein">Claude schaut sich eure Reisen, Lieblingsorte und Bewertungen an und schlägt passende Ziele vor. Namen der Kinder werden nicht übermittelt, nur ihr Alter.</p>
    <label>Wünsche (optional)<input name="wunsch" maxlength="500" placeholder="z. B. Herbstferien, max. 4 Std. Flug, Tauchen für Anfänger" value="${esc(zustand.naechsteWunsch ?? "")}"></label>
    <div class="zeile"><span class="platz"></span><button type="button" class="knopf leise" data-aktion="dialog-zu">Schließen</button><button class="knopf" value="ok" ${laeuft ? "disabled" : ""}>${laeuft ? "Claude überlegt … (bis zu einer Minute)" : text ? "Neue Ideen" : "Ideen holen"}</button></div>
    ${fehlerText ? `<p class="warnung">${esc(fehlerText)}</p>` : ""}
    ${text ? `<div>${einfachesMarkdown(text)}</div>` : ""}
  </form>`, true);
  $("#naechsteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    zustand.naechsteWunsch = e.target.wunsch.value;
    naechsteReiseDialog(text, true);
    try {
      const r = await anfrage("/api/ki/naechste-reise", { method: "POST", body: { wunsch: zustand.naechsteWunsch } });
      zustand.naechsteIdeen = r.text;
      naechsteReiseDialog(r.text);
    } catch (err) {
      naechsteReiseDialog(text, false, err.message);
    }
  });
}
aktionen["naechste-reise"] = () => naechsteReiseDialog(zustand.naechsteIdeen ?? "");
