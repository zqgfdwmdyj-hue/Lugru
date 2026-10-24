// Vorbereitung: gemeinsame Packliste (abhaken für alle) und Dokumente & Fristen mit Dateien.
import { zustand, $, esc, datumText, personen, aktionen, aenderungen, neuZeichnen, dialogOeffnen, dialog, anfrage, heute, herunterladen, istKreuzfahrt } from "./kern.js";
import { PACKVORLAGEN, passendeVorlagen, vorlageEintraege, DOKUMENT_ARTEN, DOKUMENT_VORLAGEN, dokumentHinweise, reiseZeitraum, kalenderDatei, kachelnFuer, automatischePackliste, packFamilie, packErledigt } from "./unterwegs-logik.js";
import { istKind } from "./rechnen.js";

const basis = () => `/api/reisen/${zustand.reise.id}/extras`;
const familien = () => zustand.reise?.familien ?? [];
const personName = (id) => (String(id).startsWith("familie:") ? `👨‍👩‍👧 ${familien().find((f) => `familie:${f.id}` === id)?.name ?? ""}` : personen().find((p) => p.id === id)?.name ?? "");
/** Auswahl „für wen“: alle, Familien, einzelne Personen. */
const fuerOptionen = (wert, leer = "für alle") => `<option value="">${leer}</option>${familien().map((f) => `<option value="familie:${esc(f.id)}" ${wert === `familie:${f.id}` ? "selected" : ""}>👨‍👩‍👧 ${esc(f.name)}</option>`).join("")}${personen().map((p) => `<option value="${esc(p.id)}" ${wert === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}`;
/** Gehört ein Eintrag zum Filter? Familie: Einträge der Familie und ihrer Mitglieder. */
const passtZuFilter = (fuer, filter) => {
  if (!filter) return true;
  if (filter === "alle") return !fuer;
  if (filter.startsWith("familie:")) return fuer === filter || personen().some((p) => p.id === fuer && `familie:${p.familie}` === filter);
  return fuer === filter;
};

/** Für welche Familie wird gerade gepackt? Standard: die eigene (Konto ↔ Person ↔ Familie). */
function aktiveFamilie() {
  const fam = familien();
  if (!fam.length) return "";
  if (fam.some((f) => f.id === zustand.packFamilie)) return zustand.packFamilie;
  const ich = personen().find((p) => p.userId && p.userId === zustand.ich?.id);
  return fam.some((f) => f.id === ich?.familie) ? ich.familie : fam[0].id;
}

async function eintragSpeichern(liste, daten, id = null) {
  const x = await anfrage(`${basis()}/${liste}${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: daten });
  const l = zustand.extras[liste];
  const i = l.findIndex((y) => y.id === x.id);
  if (i >= 0) l[i] = x;
  else l.push(x);
  return x;
}
async function eintragEntfernen(liste, id) {
  await anfrage(`${basis()}/${liste}/${id}`, { method: "DELETE" });
  zustand.extras[liste] = zustand.extras[liste].filter((y) => y.id !== id);
}

// ---------- Ansicht ----------

export function vorbereitungAnsicht() {
  const e = zustand.extras;
  // Beim ersten Öffnen: Packliste automatisch passend zur Reise anlegen (nur einmal je Reise)
  if (zustand.extrasVomServer === zustand.reise.id && !e.packliste.length && !e.packAuto && !packAutoLaeuft && (zustand.reise.personen?.length || zustand.reise.haefen?.length)) setTimeout(() => packAuto(true), 0);
  const hinweise = dokumentHinweise(e.dokumente, zustand.reise, heute());
  const fam = aktiveFamilie();
  const filter = zustand.packFilter ?? "";
  // Mit Familien: ohne Filter die gemeinsamen Einträge und die der eigenen Familie
  const pack = e.packliste.filter((y) => passtZuFilter(y.fuer, filter) && (!fam || filter || !packFamilie(y, zustand.reise) || packFamilie(y, zustand.reise) === fam));
  const erledigt = (x) => packErledigt(x, fam, zustand.reise);
  const fertig = pack.filter(erledigt).length;
  const andereFertig = (x) => (fam && !x.fuer ? familien().filter((f) => f.id !== fam && x.erledigtVon?.[f.id]).map((f) => f.name) : []);
  const gruppen = new Map();
  for (const x of pack) {
    const g = x.gruppe || "Sonstiges";
    if (!gruppen.has(g)) gruppen.set(g, []);
    gruppen.get(g).push(x);
  }
  const vorschlaege = passendeVorlagen(zustand.reise);
  const dringend = hinweise.filter((h) => h.stufe === "rot").length;
  const ersteOffene = [...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b, "de")).find(([, l]) => l.some((x) => !erledigt(x)))?.[0];
  return `
    ${hinweise.length ? `<div class="hinweis ${dringend ? "warnung-box" : ""}">⏰ ${hinweise.length} ${hinweise.length === 1 ? "Frist bzw. Hinweis" : "Fristen bzw. Hinweise"}${dringend ? ` (${dringend} dringend)` : ""} <button class="link" data-aktion="ansicht" data-ziel="dokumente">Dokumente &amp; Fristen →</button></div>` : ""}
    <div class="karte-box">
      <div class="zeile"><h3>🧳 Packliste</h3><span class="klein leise">${fertig}/${pack.length} eingepackt</span><span class="platz"></span>
        ${fam ? `<label class="klein">Ich packe für <select data-aktion="pack-familie">${familien().map((f) => `<option value="${esc(f.id)}" ${f.id === fam ? "selected" : ""}>👨‍👩‍👧 ${esc(f.name)}</option>`).join("")}</select></label>` : ""}
        <select data-aktion="pack-filter" aria-label="Für wen"><option value="">${fam ? "Gemeinsam + unsere Familie" : "Alle Einträge"}</option><option value="alle" ${filter === "alle" ? "selected" : ""}>Für alle gemeinsam</option>${fuerOptionen(filter, "–").replace('<option value="">–</option>', "")}</select>
      </div>
      ${pack.length ? `<div class="fortschritt"><span style="width:${Math.round((fertig / pack.length) * 100)}%"></span></div>` : ""}
      <p class="leise klein">${fam ? "Einträge „für alle“ hakt jede Familie für sich ab – was ihr einpackt, gilt nicht für die anderen Familien." : "Gemeinsam für alle Mitreisenden – wer etwas einpackt, hakt es ab."} Vorlagen passend zur Reise (★):</p>
      <div class="links"><button class="linkchip empfohlen" data-aktion="pack-auto" title="Alle passenden Vorlagen auf einmal, Pässe und Kinder-Sachen je Person">✨ Automatisch ergänzen</button>${Object.entries(PACKVORLAGEN).filter(([k]) => vorschlaege.includes(k)).map(([k, v]) => `<button class="linkchip empfohlen" data-aktion="pack-vorlage" data-id="${k}">+ ${esc(v.name)} ★</button>`).join("")}</div>
      <details class="klein weitere-vorlagen"><summary>Weitere Vorlagen (${Object.keys(PACKVORLAGEN).filter((k) => !vorschlaege.includes(k)).length})</summary>
        <div class="links">${Object.entries(PACKVORLAGEN).filter(([k]) => !vorschlaege.includes(k)).map(([k, v]) => `<button class="linkchip" data-aktion="pack-vorlage" data-id="${k}">+ ${esc(v.name)}</button>`).join("")}</div></details>
      <form class="zeile eng packneu" id="packNeu">
        <input name="text" placeholder="z. B. Schnorchelmaske" maxlength="200" required aria-label="Neuer Eintrag">
        <input name="gruppe" placeholder="Gruppe" maxlength="60" list="packGruppen" aria-label="Gruppe">
        <datalist id="packGruppen">${[...new Set(pack.map((x) => x.gruppe).filter(Boolean))].map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
        <select name="fuer" aria-label="Für wen">${fuerOptionen(filter && filter !== "alle" ? filter : "")}</select>
        <button class="knopf">+</button>
      </form>
      ${gruppen.size > 1 ? `<div class="zeile klein"><button class="link" data-aktion="pack-alle" data-offen="1">Alle aufklappen</button> · <button class="link" data-aktion="pack-alle" data-offen="">Alle zuklappen</button></div>` : ""}
      ${gruppen.size ? [...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b, "de")).map(([g, liste]) => `<details class="packgruppe" data-klappe="pack:${esc(g)}" ${zustand.klappen?.[`pack:${g}`] ?? (gruppen.size <= 2 || g === ersteOffene) ? "open" : ""}><summary><strong>${esc(g)}</strong> <span class="leise klein">${liste.filter(erledigt).length}/${liste.length}${liste.every(erledigt) ? " ✓" : ""}</span></summary>
        ${liste.map((x) => `<div class="packzeile ${erledigt(x) ? "erledigt" : ""}"><label class="haken"><input type="checkbox" data-aktion="pack-haken" data-id="${esc(x.id)}" ${erledigt(x) ? "checked" : ""}> ${esc(x.text)}</label>${x.fuer ? `<span class="klein leise">${esc(personName(x.fuer))}</span>` : ""}${andereFertig(x).length ? `<span class="klein leise" title="Schon eingepackt bei">✓ ${esc(andereFertig(x).join(", "))}</span>` : ""}<button class="link rot" data-aktion="pack-loeschen" data-id="${esc(x.id)}" aria-label="Entfernen">✕</button></div>`).join("")}</details>`).join("") : `<p class="leise">${packAutoLaeuft ? "✨ Packliste wird passend zur Reise erstellt …" : "Noch leer – wähle oben eine Vorlage oder trage selbst etwas ein."}</p>`}
      ${fertig ? `<div class="zeile"><button class="link" data-aktion="pack-zuruecksetzen">Alle Haken entfernen (für die Rückreise)</button></div>` : ""}
    </div>
    `;
}

/** Dokumente & Fristen (eigener Unterbereich der Vorbereitung) – mit Offline-Karten. */
export function dokumenteAnsicht() {
  const e = zustand.extras;
  const hinweise = dokumentHinweise(e.dokumente, zustand.reise, heute());
  const { von } = reiseZeitraum(zustand.reise);
  return `
    ${hinweise.length ? `<div class="karte-box hinweisbox"><h3>⏰ Fristen &amp; Hinweise</h3><ul class="hinweise">${hinweise.map((h) => `<li class="${h.stufe}">${esc(h.text)}</li>`).join("")}</ul></div>` : ""}
    <div class="karte-box">
      <div class="zeile"><h3>📄 Dokumente &amp; Fristen</h3><span class="platz"></span><button class="knopf" data-aktion="dokument-neu">+ Dokument</button></div>
      <p class="leise klein">Buchungsbestätigungen, Pässe (Ablaufdatum!), ESTA/eTA, Impfungen, Versicherung – mit Datei (PDF/Foto) und Frist. Nur für Mitreisende sichtbar.
      ${von ? `Reisebeginn: <strong>${esc(datumText(von, { day: "numeric", month: "long", year: "numeric" }))}</strong>.` : ""}</p>
      ${e.dokumente.length ? dokumenteNachPerson(e) : `<p class="leise">Noch keine Dokumente.</p>`}
      <p class="klein leise">Schnell anlegen:</p>
      <div class="links">${DOKUMENT_VORLAGEN.filter((v) => (!v.nurKreuzfahrt || istKreuzfahrt()) && (!v.nurTauchen || passendeVorlagen(zustand.reise).includes("tauchen"))).map((v, i) => `<button class="linkchip" data-aktion="dokument-vorlage" data-i="${DOKUMENT_VORLAGEN.indexOf(v)}">+ ${esc(v.titel)}${v.jePerson ? " (je Person)" : ""}</button>`).join("")}</div>
      ${e.dokumente.some((d) => d.frist && !d.erledigt) ? `<div class="zeile"><button class="knopf leise" data-aktion="fristen-kalender">📅 Fristen in den Kalender</button></div>` : ""}
    </div>
    ${offlineKartenBox()}`;
}

/** Dokumente je Person (gemeinsame zuerst), darin nach nächster Frist bzw. Ablaufdatum; Erledigtes ans Ende. */
function dokumenteNachPerson(e) {
  const naechstes = (d) => [d.frist, d.gueltigBis].filter(Boolean).sort()[0] || "9999";
  const gruppen = new Map([["", []]]);
  for (const p of personen()) gruppen.set(p.id, []);
  for (const d of e.dokumente) {
    const k = gruppen.has(d.personId ?? "") ? d.personId ?? "" : d.personId;
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(d);
  }
  return [...gruppen.entries()].filter(([, l]) => l.length).map(([id, liste]) => `<h4>${id ? esc(personName(id)) : "Für alle"} <span class="leise klein">(${liste.filter((d) => !d.erledigt).length} offen)</span></h4>
    <div class="tabelle"><table class="dokumente"><tbody>
    ${liste.sort((a, b) => a.erledigt - b.erledigt || naechstes(a).localeCompare(naechstes(b))).map((d) => {
      const datei = e.dateien.find((f) => f.id === d.dateiId);
      return `<tr class="${d.erledigt ? "erledigt" : ""}"><td><input type="checkbox" data-aktion="dokument-haken" data-id="${esc(d.id)}" ${d.erledigt ? "checked" : ""} aria-label="Erledigt"></td>
        <td><strong>${esc(d.titel)}</strong><div class="klein leise">${esc(DOKUMENT_ARTEN[d.art] ?? "")}</div>${d.notiz ? `<div class="klein">${esc(d.notiz)}</div>` : ""}
          <div class="klein">${datei ? `<a href="/api/reisen/${esc(zustand.reise.id)}/dateien/${esc(datei.id)}" target="_blank" rel="noopener">📎 ${esc(datei.name)}</a>` : ""}${d.link ? ` <a href="${esc(d.link)}" target="_blank" rel="noopener">Link ↗</a>` : ""}</div></td>
        <td class="klein">${d.frist ? `⏰ ${esc(datumText(d.frist))}${d.fristZeit ? ` ${esc(d.fristZeit)}` : ""}` : ""}${d.gueltigBis ? `<div>gültig bis ${esc(datumText(d.gueltigBis, { day: "2-digit", month: "2-digit", year: "numeric" }))}</div>` : ""}</td>
        <td><button class="link" data-aktion="dokument-bearbeiten" data-id="${esc(d.id)}">Bearbeiten</button></td></tr>`;
    }).join("")}</tbody></table></div>`).join("");
}

// ---------- Offline-Karten ----------

const KACHEL_CACHE = "reiseplaner-kacheln-v1";
const kartenOrte = () => [...(zustand.reise.haefen ?? []), ...(zustand.reise.hotels ?? []), ...(zustand.reise.ausfluege ?? []).map((a) => a.ziel)].filter((o) => Number.isFinite(o?.lat) && Number.isFinite(o?.lng));

function offlineKartenBox() {
  const orte = kartenOrte();
  const gespeichert = zustand.kachelnGespeichert;
  if ("caches" in window) caches.open(KACHEL_CACHE).then((c) => c.keys()).then((k) => {
    zustand.kachelnGespeichert = k.length;
    const el = $("#kachelZahl");
    if (el) el.textContent = String(k.length);
  }).catch(() => {});
  return `<div class="karte-box">
    <h3>🗺️ Karten offline</h3>
    <p class="klein">Auf dem Gerät gespeichert: <strong id="kachelZahl">${gespeichert ?? "…"}</strong> Kartenausschnitte.</p>
    ${zustand.info.kartenOffline
      ? `<p class="leise klein">Speichert die Karten rund um alle ${orte.length} Orte der Reise (ca. 2 km Umkreis, bis Straßenebene) – damit die Karte auf See und im Ausland ohne Roaming funktioniert. Am besten im WLAN.</p>
         <div class="zeile"><button class="knopf" data-aktion="karten-offline" ${orte.length ? "" : "disabled"}>⬇️ Karten der Reise speichern</button><span class="klein leise" id="kartenStatus"></span></div>`
      : `<p class="leise klein">Jeder Kartenausschnitt, den ihr einmal angesehen habt, bleibt auf diesem Gerät gespeichert und funktioniert danach auch ohne Internet. Tipp: Vor der Reise im WLAN die Karte jedes Tages einmal öffnen und rund um Hafen bzw. Hotel etwas hineinzoomen.</p>
         <p class="leise klein">Ganze Gebiete auf einmal herunterladen erlaubt der Kartendienst (OpenStreetMap) nicht – deshalb speichert die App nur, was ihr euch anseht.</p>`}
  </div>`;
}

aktionen["karten-offline"] = async (el) => {
  if (!("caches" in window)) return alert("Dieser Browser kann keine Karten offline speichern.");
  const vorlage = zustand.info.kacheln;
  const kacheln = kachelnFuer(kartenOrte());
  const status = (t) => $("#kartenStatus") && ($("#kartenStatus").textContent = t);
  el.disabled = true;
  const cache = await caches.open(KACHEL_CACHE);
  let fertig = 0;
  let fehler = 0;
  const url = ({ z, x, y }) => vorlage.replace("{z}", z).replace("{x}", x).replace("{y}", y).replace("{s}", "a").replace("{r}", "");
  const warteschlange = [...kacheln];
  const arbeiter = async () => {
    while (warteschlange.length) {
      const k = warteschlange.shift();
      const anfrageKachel = new Request(url(k), { mode: "cors" });
      try {
        if (!(await cache.match(anfrageKachel))) {
          const antwort = await fetch(anfrageKachel);
          if (!antwort.ok) throw new Error(String(antwort.status));
          await cache.put(anfrageKachel, antwort);
        }
      } catch {
        fehler++;
      }
      fertig++;
      if (fertig % 20 === 0) status(`${fertig} von ${kacheln.length} …`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, arbeiter));
  zustand.kachelnGespeichert = (await cache.keys()).length;
  status(`Fertig: ${kacheln.length - fehler} Ausschnitte gespeichert${fehler ? `, ${fehler} fehlgeschlagen` : ""}.`);
  const zahl = $("#kachelZahl");
  if (zahl) zahl.textContent = String(zustand.kachelnGespeichert);
  el.disabled = false;
};

// ---------- Packliste ----------

document.addEventListener("submit", async (ev) => {
  if (ev.target.id !== "packNeu") return;
  ev.preventDefault();
  const f = new FormData(ev.target);
  try {
    await eintragSpeichern("packliste", { text: f.get("text"), gruppe: f.get("gruppe"), fuer: f.get("fuer") });
    neuZeichnen();
    $("#packNeu input[name=text]")?.focus();
  } catch (e) {
    alert(e.message);
  }
});

let packAutoLaeuft = false;
async function packAuto(still = false) {
  const eintraege = automatischePackliste(zustand.reise, zustand.extras.packliste);
  if (!eintraege.length) {
    zustand.extras.packAuto = true;
    if (!still) alert("Alles Passende steht schon auf der Liste.");
    return;
  }
  packAutoLaeuft = true;
  if (still) neuZeichnen();
  try {
    const r = await anfrage(`${basis()}/packliste/auto`, { method: "POST", body: { eintraege } });
    zustand.extras.packliste.push(...r.neu);
    zustand.extras.packAuto = true;
  } catch (err) {
    if (!still) alert(err.message);
  } finally {
    packAutoLaeuft = false;
    neuZeichnen();
  }
}
aktionen["pack-auto"] = () => packAuto(false);

aktionen["pack-vorlage"] = async (el) => {
  const neu = vorlageEintraege(el.dataset.id, zustand.extras.packliste);
  if (!neu.length) return alert("Alles aus dieser Vorlage steht schon auf der Liste.");
  el.disabled = true;
  const kinder = personen().filter(istKind);
  for (const x of neu) {
    // Kinder-Vorlage: Einträge wie „Kinderreisepass“ gibt es je Kind
    const fuerJe = el.dataset.id === "kinder" && /reisepass|kuscheltier/i.test(x.text) && kinder.length ? kinder.map((k) => k.id) : [""];
    for (const fuer of fuerJe) await eintragSpeichern("packliste", { ...x, fuer }).catch(() => {});
  }
  neuZeichnen();
};

aenderungen["pack-haken"] = async (el) => {
  const x = zustand.extras.packliste.find((y) => y.id === el.dataset.id);
  try {
    const neu = await anfrage(`${basis()}/packliste/${x.id}/haken`, { method: "PUT", body: { haushalt: aktiveFamilie(), erledigt: el.checked } });
    Object.assign(x, neu);
    neuZeichnen();
  } catch (e) {
    el.checked = !el.checked;
    alert(e.message);
  }
};
aenderungen["pack-familie"] = (el) => {
  zustand.packFamilie = el.value;
  neuZeichnen();
};
aenderungen["pack-filter"] = (el) => {
  zustand.packFilter = el.value;
  neuZeichnen();
};
aktionen["pack-loeschen"] = async (el) => {
  await eintragEntfernen("packliste", el.dataset.id);
  neuZeichnen();
};
aktionen["pack-zuruecksetzen"] = async () => {
  const fam = aktiveFamilie();
  if (!confirm(fam ? "Alle Haken eurer Familie entfernen? (z. B. zum Packen für die Rückreise)" : "Alle Haken entfernen? (z. B. zum Packen für die Rückreise)")) return;
  for (const x of zustand.extras.packliste.filter((y) => packErledigt(y, fam, zustand.reise) && (!fam || !packFamilie(y, zustand.reise) || packFamilie(y, zustand.reise) === fam))) {
    Object.assign(x, await anfrage(`${basis()}/packliste/${x.id}/haken`, { method: "PUT", body: { haushalt: fam, erledigt: false } }));
  }
  neuZeichnen();
};

// ---------- Dokumente ----------

function dateiZuBase64(datei) {
  return new Promise((ok, fehler) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fehler(new Error("Datei konnte nicht gelesen werden."));
    r.readAsDataURL(datei);
  });
}

function dokumentDialog(id, vorlage = {}) {
  const d = id ? zustand.extras.dokumente.find((x) => x.id === id) : { art: "sonstiges", ...vorlage };
  const datei = zustand.extras.dateien.find((f) => f.id === d.dateiId);
  dialogOeffnen(`<form method="dialog" class="formular" id="dokForm">
    <h3>${id ? "Dokument bearbeiten" : "Dokument hinzufügen"}</h3>
    <label>Titel<input name="titel" required maxlength="200" value="${esc(d.titel ?? "")}" placeholder="z. B. Reisepass, Buchungsbestätigung Flug"></label>
    <div class="formular drei">
      <label>Art<select name="art">${Object.entries(DOKUMENT_ARTEN).map(([k, t]) => `<option value="${k}" ${d.art === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label>Für<select name="personId">${fuerOptionen(d.personId ?? "", "alle")}</select></label>
      <label>Gültig bis<input type="date" name="gueltigBis" value="${esc(d.gueltigBis ?? "")}"></label>
      <label>Frist (z. B. Online-Check-in)<input type="date" name="frist" value="${esc(d.frist ?? "")}"></label>
      <label>Uhrzeit der Frist<input type="time" name="fristZeit" value="${esc(d.fristZeit ?? "")}"></label>
      <label>Link<input type="url" name="link" value="${esc(d.link ?? "")}" placeholder="https://…"></label>
    </div>
    <label>Notiz<textarea name="notiz" rows="2" placeholder="z. B. Buchungsnummer, Hotline, was zu tun ist">${esc(d.notiz ?? "")}</textarea></label>
    <fieldset><legend>Datei (PDF, JPEG, PNG – max. 15 MB)</legend>
      <div id="dokDatei">${datei ? `📎 <a href="/api/reisen/${esc(zustand.reise.id)}/dateien/${esc(datei.id)}" target="_blank" rel="noopener">${esc(datei.name)}</a> <button type="button" class="link rot" data-aktion="dok-datei-weg">entfernen</button>` : `<span class="leise klein">keine</span>`}</div>
      <input type="hidden" name="dateiId" value="${esc(d.dateiId ?? "")}">
      <label class="knopf leise">📎 Datei wählen<input type="file" accept="application/pdf,image/jpeg,image/png" hidden id="dokDateiWahl"></label>
      <span class="klein leise" id="dokStatus"></span>
    </fieldset>
    <label class="haken"><input type="checkbox" name="erledigt" ${d.erledigt ? "checked" : ""}> Erledigt</label>
    <div class="zeile">
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
    ${id ? `<details class="gefahr-klein"><summary class="klein leise">Weitere Aktionen</summary><button type="button" class="knopf gefahr" data-aktion="dokument-loeschen" data-id="${esc(id)}">Löschen</button></details>` : ""}
  </form>`);
  const form = $("#dokForm");
  $("#dokDateiWahl").addEventListener("change", async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    if (f.size > 15_000_000) return alert("Die Datei ist größer als 15 MB.");
    $("#dokStatus").textContent = "Lade hoch …";
    try {
      const info = await anfrage(`/api/reisen/${zustand.reise.id}/dateien`, { method: "POST", body: { name: f.name, typ: f.type, daten: await dateiZuBase64(f) } });
      zustand.extras.dateien.push(info);
      form.dateiId.value = info.id;
      $("#dokDatei").innerHTML = `📎 ${esc(info.name)}`;
      $("#dokStatus").textContent = "Hochgeladen ✓";
      if (!form.titel.value) form.titel.value = f.name.replace(/\.[a-z0-9]+$/i, "");
    } catch (e) {
      $("#dokStatus").textContent = e.message;
    }
  });
  form.addEventListener("submit", async () => {
    const f = Object.fromEntries(new FormData(form));
    try {
      await eintragSpeichern("dokumente", { ...f, erledigt: f.erledigt === "on" }, id);
      neuZeichnen();
    } catch (e) {
      alert(e.message);
    }
  });
}

aktionen["dok-datei-weg"] = () => {
  const form = $("#dokForm");
  form.dateiId.value = "";
  $("#dokDatei").innerHTML = `<span class="leise klein">keine (wird beim Speichern entfernt)</span>`;
};
aktionen["dokument-neu"] = () => dokumentDialog(null);
aktionen["dokument-bearbeiten"] = (el) => dokumentDialog(el.dataset.id);
aktionen["dokument-vorlage"] = async (el) => {
  const v = DOKUMENT_VORLAGEN[Number(el.dataset.i)];
  if (v.jePerson) {
    el.disabled = true;
    for (const p of personen()) {
      if (zustand.extras.dokumente.some((d) => d.titel === v.titel && d.personId === p.id)) continue;
      await eintragSpeichern("dokumente", { titel: v.titel, art: v.art, personId: p.id });
    }
    return neuZeichnen();
  }
  dokumentDialog(null, { titel: v.titel, art: v.art });
};
aenderungen["dokument-haken"] = async (el) => {
  const d = zustand.extras.dokumente.find((x) => x.id === el.dataset.id);
  await eintragSpeichern("dokumente", { ...d, erledigt: el.checked }, d.id).catch((e) => alert(e.message));
  neuZeichnen();
};
aktionen["dokument-loeschen"] = async (el) => {
  if (!confirm("Dokument löschen? (Die hochgeladene Datei bleibt erhalten, bis sie entfernt wird.)")) return;
  const d = zustand.extras.dokumente.find((x) => x.id === el.dataset.id);
  await eintragEntfernen("dokumente", el.dataset.id);
  if (d?.dateiId && !zustand.extras.dokumente.some((x) => x.dateiId === d.dateiId) && confirm("Auch die Datei löschen?")) {
    await anfrage(`/api/reisen/${zustand.reise.id}/dateien/${d.dateiId}`, { method: "DELETE" }).catch(() => {});
    zustand.extras.dateien = zustand.extras.dateien.filter((f) => f.id !== d.dateiId);
  }
  dialog().close();
  neuZeichnen();
};
aktionen["pack-alle"] = (el) => {
  zustand.klappen ??= {};
  for (const d of document.querySelectorAll("details.packgruppe")) {
    d.open = Boolean(el.dataset.offen);
    zustand.klappen[d.dataset.klappe] = d.open;
  }
};

aktionen["fristen-kalender"] = () => {
  const { text, anzahl } = kalenderDatei({ name: `${zustand.reise.name} – Fristen`, haefen: [], ausfluege: [] }, { anBord: [], ausfluege: null, dokumente: zustand.extras.dokumente });
  herunterladen(`${zustand.reise.name}-Fristen.ics`, text, "text/calendar");
  alert(`${anzahl} Fristen als Kalenderdatei gespeichert. Öffnen → „Zum Kalender hinzufügen“.`);
};
