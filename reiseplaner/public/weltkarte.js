// Weltkarte: rote Stecknadeln für alle Orte, an denen ihr wart – plus Steuerung des öffentlichen Reisetagebuchs.
import { zustand, $, esc, aktionen, aenderungen, neuZeichnen, dialogOeffnen, anfrage, ortsSuche, ortAuslesen, ortFinden, dialog, neueId } from "./kern.js";
import { REISEARTEN } from "./rechnen.js";

export async function weltkarteLaden() {
  try {
    zustand.weltkarte = await anfrage("/api/weltkarte");
  } catch {
    zustand.weltkarte = null;
  }
}

/** Alle Stecknadeln: besuchte Häfen/Orte (ohne Hotels doppelt) und von Hand eingetragene Orte. */
export function weltkartePins() {
  const w = zustand.weltkarte;
  if (!w) return [];
  return [
    ...w.besucht.map((o) => ({ name: o.name, land: o.land, lat: o.lat, lng: o.lng, info: [o.reise, o.datum].filter(Boolean).join(" · "), hotel: o.art === "hotel" })),
    ...w.orte.map((o) => ({ name: o.name, land: o.land, lat: o.lat, lng: o.lng, info: [o.jahr, o.notiz].filter(Boolean).join(" · "), hotel: false })),
  ];
}

function laenderGruppen(pins) {
  const gruppen = new Map();
  for (const p of pins.filter((x) => !x.hotel)) {
    const land = p.land || "Weitere Orte";
    if (!gruppen.has(land)) gruppen.set(land, new Map());
    gruppen.get(land).set(p.name, p);
  }
  return [...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b, "de"));
}

export function weltkarteAnsicht() {
  const w = zustand.weltkarte;
  if (!w) return `<div class="karte-box"><p class="leise">Lade Weltkarte …</p></div>`;
  const pins = weltkartePins();
  const gruppen = laenderGruppen(pins);
  const admin = true; // Weltkarte und Tagebuch gehören dem eigenen Konto – jede/r bearbeitet die eigene
  return `
    <div class="kacheln">
      <div class="kachel"><span>Länder</span><strong>${gruppen.filter(([l]) => l !== "Weitere Orte").length}</strong></div>
      <div class="kachel"><span>Orte</span><strong>${new Set(pins.filter((p) => !p.hotel).map((p) => p.name)).size}</strong></div>
      <div class="kachel"><span>Reisen</span><strong>${w.reisen.length}</strong></div>
    </div>
    <div class="karte-box">
      <h3>Länder &amp; Inseln</h3>
      <p class="leise klein">Klick auf ein Land oder einen Ort – die Karte fliegt hin. Rote Stecknadeln: dort wart ihr (vergangene Reisetage und von Hand eingetragene Orte).</p>
      ${gruppen.length ? `<div class="laender">${gruppen.map(([land, orte]) => {
        const erste = [...orte.values()][0];
        return `<details><summary><button class="link ohne" data-aktion="flieg" data-lat="${erste.lat}" data-lng="${erste.lng}" data-zoom="6"><strong>${esc(land)}</strong></button> <span class="leise klein">(${orte.size})</span></summary>
          <div class="orteliste">${[...orte.values()].map((o) => `<button class="link" data-aktion="flieg" data-lat="${o.lat}" data-lng="${o.lng}" data-zoom="11">📍 ${esc(o.name)}</button>`).join("")}</div></details>`;
      }).join("")}</div>` : `<p class="leise">Noch keine Orte. Sobald Reisetage vorbei sind und auf der Karte stehen, erscheinen sie hier – frühere Reisen kannst du unten nachtragen.</p>`}
    </div>
    <div class="karte-box">
      <div class="zeile"><h3>Mein öffentliches Reisetagebuch</h3><a class="knopf leise" href="${esc(w.url)}" target="_blank" rel="noopener">Ansehen ↗</a></div>
      <p class="leise klein">Jede/r hat eine eigene Weltkarte und ein eigenes Tagebuch mit eigenem Link – hier steht nur, was zu deinem Konto gehört.</p>
      <p class="leise klein">Für alle mit dem Link, ohne Anmeldung: Karte mit roten Stecknadeln, besuchte Orte, gebuchte Ausflüge und Unterkünfte mit Bewertungen und Fotos, Tauchgänge.
      Es erscheinen nur Reisen, die hier freigegeben sind, und nur vergangene Tage. Nie Kosten, Planungen, Notizen, Nachnamen oder als 🔒 privat markierte Bewertungen.</p>
      <div class="linkfeld"><input readonly value="${esc(w.url)}" onclick="this.select()"><button class="knopf leise" data-aktion="link-kopieren" data-url="${esc(w.url)}">Kopieren</button></div>
      <h4>Freigegebene Reisen</h4>
      <div class="freigaben">${w.reisen.map((r) => `<label class="haken"><input type="checkbox" data-aktion="reise-oeffentlich" data-id="${esc(r.id)}" ${r.oeffentlich ? "checked" : ""} ${r.planer ? "" : "disabled"}> ${esc(r.name)}${r.planer ? "" : ' <span class="leise klein">(nur Planer/innen)</span>'}</label>`).join("") || `<p class="leise">Noch keine Reisen.</p>`}</div>
      ${admin ? `<div class="formular zwei">
        <label>Titel<input id="tagebuchTitel" value="${esc(w.titel)}" maxlength="120"></label>
        <label>Kurzer Text<input id="tagebuchText" value="${esc(w.text)}" maxlength="300" placeholder="z. B. Familie auf Reisen – Tauchen, Inseln, Abenteuer"></label>
      </div><div class="zeile"><button class="knopf leise" data-aktion="tagebuch-speichern">Titel speichern</button></div>` : ""}
    </div>
    <div class="karte-box">
      <div class="zeile"><h3>Frühere Reisen nachtragen</h3>${admin ? `<button class="knopf" data-aktion="ort-neu">+ Ort</button>` : ""}</div>
      <p class="leise klein">Orte aus Urlauben vor dem Reiseplaner – sie bekommen ebenfalls eine rote Stecknadel (auch im öffentlichen Tagebuch). Mit „📸 Als Reise anlegen“ wird daraus eine richtige Reise, in der ihr Fotos, Bewertungen, Tauchgänge (auch vom Tauchcomputer) und ein Tagebuch nachtragen könnt.</p>
      ${w.orte.length ? `<div class="tabelle"><table><tbody>${w.orte.map((o) => `<tr><td><button class="link" data-aktion="flieg" data-lat="${o.lat}" data-lng="${o.lng}" data-zoom="10">📍 ${esc(o.name)}</button></td><td class="leise">${esc(o.land)}</td><td>${esc(o.jahr)}</td><td class="klein">${esc(o.notiz)}</td><td>${admin ? `<button class="link" data-aktion="ort-als-reise" data-id="${esc(o.id)}">📸 Als Reise anlegen</button> <button class="link" data-aktion="ort-bearbeiten" data-id="${esc(o.id)}">Bearbeiten</button> <button class="link rot" data-aktion="ort-loeschen" data-id="${esc(o.id)}">Entfernen</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
    </div>`;
}

aenderungen["reise-oeffentlich"] = async (el) => {
  try {
    await anfrage(`/api/reisen/${el.dataset.id}/oeffentlich`, { method: "PUT", body: { oeffentlich: el.checked } });
    const r = zustand.weltkarte?.reisen.find((x) => x.id === el.dataset.id);
    if (r) r.oeffentlich = el.checked;
    if (zustand.reise?.id === el.dataset.id) zustand.reise.oeffentlich = el.checked;
  } catch (e) {
    el.checked = !el.checked;
    alert(e.message);
  }
};

aktionen["tagebuch-speichern"] = async (el) => {
  const e = await anfrage("/api/weltkarte", { method: "PUT", body: { titel: $("#tagebuchTitel").value, text: $("#tagebuchText").value } });
  Object.assign(zustand.weltkarte, { titel: e.titel, text: e.text });
  el.textContent = "Gespeichert ✓";
};

aktionen["ort-neu"] = () => ortDialog(null);
aktionen["ort-bearbeiten"] = (el) => ortDialog(zustand.weltkarte.orte.find((o) => o.id === el.dataset.id));

function ortDialog(alt) {
  dialogOeffnen(`<form method="dialog" class="formular" id="ortForm">
    <h3>${alt ? "Ort bearbeiten" : "Ort nachtragen"}</h3>
    ${ortsSuche("ort", alt ? { lat: alt.lat, lng: alt.lng, name: alt.name } : null, "Ort suchen, z. B. „Hurghada“ oder „Malediven“")}
    <div class="formular drei">
      <label>Name<input name="name" placeholder="wird aus der Suche übernommen" value="${esc(alt?.name ?? "")}"></label>
      <label>Land<input name="land" value="${esc(alt?.land ?? "")}"></label>
      <label>Jahr<input name="jahr" inputmode="numeric" maxlength="4" placeholder="z. B. 2019" value="${esc(alt?.jahr ?? "")}"></label>
    </div>
    <label>Notiz (öffentlich sichtbar)<input name="notiz" maxlength="300" placeholder="z. B. Erster Tauchurlaub" value="${esc(alt?.notiz ?? "")}"></label>
    <div class="zeile"><span class="platz"></span><button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button><button class="knopf" value="ok">Speichern</button></div>
  </form>`);
  const form = $("#ortForm");
  form.addEventListener("input", () => {
    const o = ortAuslesen(form, "ort");
    if (!o) return;
    if (!form.name.value) form.name.value = o.name.split(",")[0].trim();
    if (!form.land.value && o.land) form.land.value = o.land;
  });
  form.addEventListener("submit", async (e) => {
    let o = ortAuslesen(form, "ort");
    if (!o) {
      // Nichts ausgewählt: selbst suchen – Suchtext, dann „Name, Land“, Name, Land
      e.preventDefault();
      const knopf = form.querySelector("button[value=ok]");
      knopf.disabled = true;
      knopf.textContent = "Suche Ort …";
      const name = form.name.value.trim();
      const land = form.land.value.trim();
      o = await ortFinden([$(".ortsq", form).value, name && land && name !== land ? `${name}, ${land}` : "", name, land]);
      knopf.disabled = false;
      knopf.textContent = "Speichern";
      if (!o) return alert("Diesen Ort finden wir nicht. Bitte anders schreiben (z. B. „Griechenland“ oder „Kreta“) oder Koordinaten aus Google Maps einfügen.");
      dialog().close();
    }
    try {
      const daten = { ...o, name: form.name.value || o.name, land: form.land.value, jahr: form.jahr.value, notiz: form.notiz.value };
      if (alt) Object.assign(alt, await anfrage(`/api/weltkarte/orte/${alt.id}`, { method: "PUT", body: daten }));
      else zustand.weltkarte.orte.push(await anfrage("/api/weltkarte/orte", { method: "POST", body: daten }));
      neuZeichnen();
    } catch (e) {
      alert(e.message);
    }
  });
}

// Früheren Urlaub als richtige Reise anlegen – dann gibt es Fotos, Bewertungen, Tauchlog, Tagebuch, Reisebuch
aktionen["ort-als-reise"] = (el) => {
  const o = zustand.weltkarte.orte.find((x) => x.id === el.dataset.id);
  if (!o) return;
  const jahrMin = o.jahr ? `${o.jahr}-01-01` : "";
  const jahrMax = o.jahr ? `${o.jahr}-12-31` : "";
  dialogOeffnen(`<form method="dialog" class="formular" id="alsReiseForm">
    <h3>📸 ${esc(o.name)}${o.jahr ? ` ${esc(o.jahr)}` : ""} als Reise anlegen</h3>
    <p class="leise klein">Danach könnt ihr unter „Erlebnisse &amp; Tauchlog“ Fotos, Bewertungen und Tauchgänge nachtragen (z. B. den Export der Apple Watch / Oceanic+), im Kinder-Bereich das Tagebuch und daraus ein Reisebuch machen.</p>
    <div class="formular zwei">
      <label>Name der Reise<input name="name" required maxlength="200" value="${esc(`${o.name}${o.jahr ? ` ${o.jahr}` : ""}`)}"></label>
      <label>Art<select name="art">${Object.entries(REISEARTEN).map(([k, v]) => `<option value="${k}" ${k === (/tauch/i.test(o.notiz) ? "hotel" : "rundreise") ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      <label>Von<input type="date" name="von" required min="${jahrMin}" max="${jahrMax}"></label>
      <label>Bis<input type="date" name="bis" min="${jahrMin}" max="${jahrMax}"></label>
    </div>
    ${zustand.reisen?.length ? `<label>Reisende übernehmen aus<select name="vorlage"><option value="">– nur ich –</option>${zustand.reisen.map((r) => `<option value="${esc(r.id)}" ${r.id === zustand.reise?.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>` : ""}
    <label class="haken"><input type="checkbox" name="oeffentlich" checked> Im öffentlichen Tagebuch zeigen (wie bisher die Stecknadel)</label>
    <label class="haken"><input type="checkbox" name="entfernen" checked> Ort hier aus der Liste nehmen – die Reise zeigt ihn jetzt</label>
    <div class="zeile"><span class="platz"></span><button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button><button class="knopf" value="ok">Reise anlegen</button></div>
  </form>`);
  $("#alsReiseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.bis.value && f.bis.value < f.von.value) return alert("„Bis“ liegt vor „Von“.");
    f.querySelector("button[value=ok]").disabled = true;
    try {
      let personen = [{ id: neueId(), name: zustand.ich?.name ?? "Ich", typ: "erwachsen", userId: zustand.ich?.id }];
      if (f.vorlage?.value) {
        const v = await anfrage(`/api/reisen/${f.vorlage.value}`);
        // Verknüpfung mit Konten nur für mich behalten – die anderen sind (noch) keine Mitglieder der neuen Reise
        if (v.personen?.length) personen = v.personen.map(({ userId, ...p }) => (userId === zustand.ich?.id ? { ...p, userId } : p));
      }
      const tag = (datum) => ({ id: neueId(), datum, art: "ort", name: o.name, land: o.land, lat: o.lat, lng: o.lng, notiz: o.notiz ?? "" });
      const haefen = [tag(f.von.value), ...(f.bis.value && f.bis.value !== f.von.value ? [tag(f.bis.value)] : [])];
      const reise = await anfrage("/api/reisen", { method: "POST", body: { name: f.name.value, art: f.art.value, personen, familien: [], haefen, ausfluege: [], hotels: [], kosten: [], verbindungen: [], zimmer: [] } });
      if (f.oeffentlich.checked) await anfrage(`/api/reisen/${reise.id}/oeffentlich`, { method: "PUT", body: { oeffentlich: true } }).catch(() => {});
      if (f.entfernen.checked) await anfrage(`/api/weltkarte/orte/${o.id}`, { method: "DELETE" }).catch(() => {});
      location.assign(`/?reise=${encodeURIComponent(reise.id)}&ansicht=erlebnisse`);
    } catch (err) {
      alert(err.message);
      f.querySelector("button[value=ok]").disabled = false;
    }
  });
};

aktionen["ort-loeschen"] = async (el) => {
  if (!confirm("Ort entfernen?")) return;
  await anfrage(`/api/weltkarte/orte/${el.dataset.id}`, { method: "DELETE" });
  zustand.weltkarte.orte = zustand.weltkarte.orte.filter((o) => o.id !== el.dataset.id);
  neuZeichnen();
};

