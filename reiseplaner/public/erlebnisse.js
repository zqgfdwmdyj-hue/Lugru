// Erlebnisse: Bewertungen mit Fotos und Kommentaren (Ausflüge, Unterkünfte) und das Tauchlogbuch.
import { zustand, $, esc, datumText, haefen, ausfluegeIn, hafenVon, hatKoord, aktionen, aenderungen, neuZeichnen, dialogOeffnen, dialog, anfrage, fotoHochladen, fotoLeiste, sterneText, sternEingabe, ortsSuche, ortAuslesen, beitraegeLaden, istPlaner } from "./kern.js";
import { KATEGORIEN, zahl, dauerText } from "./rechnen.js";

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
  return zustand.reise.ausfluege?.find((a) => a.id === zielId)?.titel ?? "Ausflug";
}

// ---------- Fotos im Dialog ----------

function fotoFeld(ids) {
  return `<fieldset><legend>Fotos</legend>
    <div id="fotoListe">${fotoLeiste(ids, { entfernbar: true })}</div>
    <input type="hidden" name="fotos" value="${esc(JSON.stringify(ids))}">
    <label class="knopf leise">📷 Fotos hinzufügen<input type="file" accept="image/*" multiple hidden id="fotoWahl"></label>
    <span class="klein leise" id="fotoStatus">Fotos werden vor dem Hochladen verkleinert.</span>
  </fieldset>`;
}

function fotosLesen(form) {
  try {
    return JSON.parse(new FormData(form).get("fotos") || "[]");
  } catch {
    return [];
  }
}

function fotosSetzen(form, ids) {
  form.querySelector("input[name=fotos]").value = JSON.stringify(ids);
  $("#fotoListe").innerHTML = fotoLeiste(ids, { entfernbar: true });
}

document.addEventListener("change", async (e) => {
  if (e.target.id !== "fotoWahl") return;
  const form = e.target.closest("form");
  const dateien = [...e.target.files];
  const ids = fotosLesen(form);
  let n = 0;
  for (const d of dateien) {
    $("#fotoStatus").textContent = `Lade hoch … ${++n}/${dateien.length}`;
    try {
      ids.push(await fotoHochladen(d));
      fotosSetzen(form, ids);
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
  fotosSetzen(form, fotosLesen(form).filter((x) => x !== el.dataset.id));
  await anfrage(`/api/reisen/${zustand.reise.id}/fotos/${el.dataset.id}`, { method: "DELETE" }).catch(() => {});
};

// ---------- Bewertungen ----------

function bewertungDialog(zielArt, zielId) {
  const b = bewertungenZu(zielArt, zielId).find((x) => x.autorId === zustand.ich.id) ?? { sterne: 0, titel: "", text: "", fotos: [] };
  dialogOeffnen(`<form method="dialog" class="formular" id="bewertungForm">
    <h3>Bewertung: ${esc(zielTitel(zielArt, zielId))}</h3>
    <label>Wie war es?${sternEingabe("sterne", b.sterne)}</label>
    <label>Überschrift<input name="titel" value="${esc(b.titel ?? "")}" maxlength="200" placeholder="z. B. Bestes Highlight der Reise!"></label>
    <label>Kommentar<textarea name="text" rows="6" placeholder="Was war toll, was nicht? Tipps für andere (Treffpunkt, Kinder, Wartezeiten …)">${esc(b.text ?? "")}</textarea></label>
    ${fotoFeld(b.fotos ?? [])}
    <label class="haken"><input type="checkbox" name="privat" ${b.privat ? "checked" : ""}> 🔒 Nur für Mitreisende – nie in öffentlichen Freigaben zeigen</label>
    <div class="zeile">
      ${b.id ? `<button type="button" class="knopf gefahr" data-aktion="bewertung-loeschen" data-id="${esc(b.id)}">Löschen</button>` : ""}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
  </form>`);
  $("#bewertungForm").addEventListener("submit", async (e) => {
    const f = new FormData(e.target);
    const daten = { zielArt, zielId, sterne: Number(f.get("sterne")), titel: f.get("titel"), text: f.get("text"), fotos: fotosLesen(e.target), privat: f.get("privat") === "on" };
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
      ${b.titel ? `<h4>${esc(b.titel)}</h4>` : ""}${b.text ? `<p class="notiz">${esc(b.text)}</p>` : ""}${fotoLeiste(b.fotos ?? [])}</article>`).join("")}
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
    <label>Kommentar<textarea name="text" rows="3">${esc(t.text ?? "")}</textarea></label>
    <label>Tauchplatz auf der Karte</label>
    ${ortsSuche("platz", hatKoord(t) ? { lat: t.lat, lng: t.lng, name: t.tauchplatz } : null, "Tauchplatz suchen oder Koordinaten einfügen")}
    ${fotoFeld(t.fotos ?? [])}
    <label class="haken"><input type="checkbox" name="privat" ${t.privat ? "checked" : ""}> 🔒 Nur für Mitreisende – nicht teilbar</label>
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
    const daten = { ...f, lat: platz?.lat ?? null, lng: platz?.lng ?? null, fotos: fotosLesen(e.target), privat: f.privat === "on" };
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
  const summe = liste.reduce((s, t) => s + (zahl(t.tauchzeitMin) ?? 0), 0);
  const tiefste = Math.max(0, ...liste.map((t) => zahl(t.maxTiefe) ?? 0));
  dialogOeffnen(`<div class="formular">
    <h3>Mein Logbuch – alle Reisen</h3>
    <div class="kacheln">
      <div class="kachel"><span>Tauchgänge</span><strong>${liste.length ? liste.at(-1).nr : zustand.ich.tauchVorher ?? 0}</strong></div>
      <div class="kachel"><span>Unter Wasser (hier erfasst)</span><strong>${dauerText(summe)}</strong></div>
      <div class="kachel"><span>Tiefster</span><strong>${tiefste ? `${String(tiefste).replace(".", ",")} m` : "–"}</strong></div>
    </div>
    <p class="leise klein">Die Nummerierung beginnt nach deinen bisherigen Tauchgängen (einstellbar unter „Mein Konto“).</p>
    <div class="tabelle"><table><thead><tr><th>Nr.</th><th>Datum</th><th>Tauchplatz</th><th>Reise</th><th class="zahl">Tiefe</th><th class="zahl">Zeit</th></tr></thead><tbody>
      ${[...liste].reverse().map((t) => `<tr><td>${t.nr}</td><td>${esc(datumText(t.datum, { day: "2-digit", month: "2-digit", year: "2-digit" }))}</td><td>${esc(t.tauchplatz)}<div class="klein leise">${esc(t.ort ?? "")}</div></td><td class="klein">${esc(t.reiseName)}</td><td class="zahl">${t.maxTiefe != null ? `${String(t.maxTiefe).replace(".", ",")} m` : ""}</td><td class="zahl">${t.tauchzeitMin != null ? `${t.tauchzeitMin}′` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="leise">Noch keine Tauchgänge.</td></tr>`}
    </tbody></table></div>
    <div class="zeile"><span class="platz"></span><button class="knopf" data-aktion="dialog-zu">Schließen</button></div>
  </div>`, true);
};

// ---------- Ansicht ----------

export function erlebnisseAnsicht() {
  const tage = haefen().filter((h) => (h.art ?? (h.seetag ? "seetag" : "hafen")) !== "seetag");
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
      <div class="zeile"><h3>Bewertungen &amp; Fotos</h3><button class="knopf leise" data-aktion="teilen" data-art="bericht" data-id="">Reisebericht teilen</button></div>
      <p class="leise klein">Jede/r bewertet selbst – mit Sternen, Kommentar und Fotos. Über „Teilen“ entsteht ein Link, der nur diesen Beitrag zeigt (nicht die Reise, nicht die Kosten).</p>
      ${zeilen || hotelZeilen ? `${zeilen}${hotelZeilen ? `<div class="erlebnistag"><div class="tagkopf"><strong>Unterkünfte</strong></div>${hotelZeilen}</div>` : ""}` : `<p class="leise">Sobald Ausflüge oder Unterkünfte als „Gebucht“ markiert sind, können sie hier bewertet werden.</p>`}
    </div>
    <div class="karte-box">
      <div class="zeile"><h3>Tauchlog (${tauch.length})</h3><button class="knopf leise" data-aktion="logbuch">Mein Logbuch</button><button class="knopf" data-aktion="tauchgang-neu">+ Tauchgang</button></div>
      ${tauch.length ? `<div class="tabelle"><table><thead><tr><th>Datum</th><th>Tauchplatz</th><th>Wer</th><th class="zahl">Tiefe</th><th class="zahl">Zeit</th><th class="zahl">Wasser</th><th></th></tr></thead><tbody>
        ${tauch.map((t) => `<tr><td>${esc(datumText(t.datum))}${t.beginn ? `<div class="klein leise">${esc(t.beginn)}</div>` : ""}</td><td><strong>${esc(t.tauchplatz)}</strong>${t.sterne ? ` ${sterneText(t.sterne)}` : ""}<div class="klein leise">${esc([t.ort, t.basis].filter(Boolean).join(" · "))}</div>${t.sichtungen ? `<div class="klein">🐠 ${esc(t.sichtungen)}</div>` : ""}${fotoLeiste((t.fotos ?? []).slice(0, 4))}</td><td>${esc(name(t.taucherId))}</td><td class="zahl">${t.maxTiefe != null ? `${String(t.maxTiefe).replace(".", ",")} m` : ""}</td><td class="zahl">${t.tauchzeitMin != null ? `${t.tauchzeitMin}′` : ""}</td><td class="zahl">${t.wasserTemp != null ? `${String(t.wasserTemp).replace(".", ",")} °C` : ""}</td>
          <td><button class="link" data-aktion="tauchgang-bearbeiten" data-id="${esc(t.id)}">Bearbeiten</button> ${t.privat ? '<span class="klein leise">🔒</span>' : `<button class="link" data-aktion="teilen" data-art="tauchgang" data-id="${esc(t.id)}">Teilen</button>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="leise">Noch keine Tauchgänge auf dieser Reise.</p>`}
    </div>`;
}

