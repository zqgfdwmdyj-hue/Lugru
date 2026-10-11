// Weltkarte: rote Stecknadeln für alle Orte, an denen ihr wart – plus Steuerung des öffentlichen Reisetagebuchs.
import { zustand, $, esc, aktionen, aenderungen, neuZeichnen, dialogOeffnen, anfrage, ortsSuche, ortAuslesen } from "./kern.js";

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
  const admin = zustand.ich?.admin;
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
      <div class="zeile"><h3>Öffentliches Reisetagebuch</h3><a class="knopf leise" href="/tagebuch" target="_blank" rel="noopener">Ansehen ↗</a></div>
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
      <p class="leise klein">Orte aus Urlauben vor dem Reiseplaner – sie bekommen ebenfalls eine rote Stecknadel (auch im öffentlichen Tagebuch).</p>
      ${w.orte.length ? `<div class="tabelle"><table><tbody>${w.orte.map((o) => `<tr><td><button class="link" data-aktion="flieg" data-lat="${o.lat}" data-lng="${o.lng}" data-zoom="10">📍 ${esc(o.name)}</button></td><td class="leise">${esc(o.land)}</td><td>${esc(o.jahr)}</td><td class="klein">${esc(o.notiz)}</td><td>${admin ? `<button class="link rot" data-aktion="ort-loeschen" data-id="${esc(o.id)}">Entfernen</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
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

aktionen["ort-neu"] = () => {
  dialogOeffnen(`<form method="dialog" class="formular" id="ortForm">
    <h3>Ort nachtragen</h3>
    ${ortsSuche("ort", null, "Ort suchen, z. B. „Hurghada“ oder „Malediven“")}
    <div class="formular drei">
      <label>Name<input name="name" placeholder="wird aus der Suche übernommen"></label>
      <label>Land<input name="land"></label>
      <label>Jahr<input name="jahr" inputmode="numeric" maxlength="4" placeholder="z. B. 2019"></label>
    </div>
    <label>Notiz (öffentlich sichtbar)<input name="notiz" maxlength="300" placeholder="z. B. Erster Tauchurlaub"></label>
    <div class="zeile"><span class="platz"></span><button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button><button class="knopf" value="ok">Speichern</button></div>
  </form>`);
  const form = $("#ortForm");
  form.addEventListener("input", () => {
    const o = ortAuslesen(form, "ort");
    if (!o) return;
    if (!form.name.value) form.name.value = o.name.split(",")[0].trim();
    if (!form.land.value && o.land) form.land.value = o.land;
  });
  form.addEventListener("submit", async () => {
    const o = ortAuslesen(form, "ort");
    if (!o) return alert("Bitte den Ort suchen und auswählen.");
    try {
      const neu = await anfrage("/api/weltkarte/orte", { method: "POST", body: { ...o, name: form.name.value || o.name, land: form.land.value, jahr: form.jahr.value, notiz: form.notiz.value } });
      zustand.weltkarte.orte.push(neu);
      neuZeichnen();
    } catch (e) {
      alert(e.message);
    }
  });
};

aktionen["ort-loeschen"] = async (el) => {
  if (!confirm("Ort entfernen?")) return;
  await anfrage(`/api/weltkarte/orte/${el.dataset.id}`, { method: "DELETE" });
  zustand.weltkarte.orte = zustand.weltkarte.orte.filter((o) => o.id !== el.dataset.id);
  neuZeichnen();
};

