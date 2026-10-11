// Unterkünfte: Hotels sammeln, vergleichen, buchen – und mit den Reisetagen verknüpfen.
import { zustand, $, esc, neueId, datumText, personen, hatKoord, geld, linkHtml, aktionen, speichern, neuZeichnen, dialogOeffnen, dialog, ortsSuche, ortAuslesen, sterneText } from "./kern.js";
import { STATUS, VERPFLEGUNG, zahl, hotelKosten, naechte, istKind, QUELLEN } from "./rechnen.js";
import { bewertungsZeile } from "./erlebnisse.js";

export const hotels = () => zustand.reise?.hotels ?? [];

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

export function hotelsAnsicht() {
  const liste = [...hotels()].sort((a, b) => String(a.anreise).localeCompare(String(b.anreise)) || (a.status === "verworfen") - (b.status === "verworfen"));
  const orte = [...new Set(liste.map((h) => h.ort).filter(Boolean))];
  const zeitraeume = new Map();
  for (const h of liste) {
    const k = `${h.anreise ?? ""}|${h.abreise ?? ""}|${h.ort ?? ""}`;
    if (!zeitraeume.has(k)) zeitraeume.set(k, []);
    zeitraeume.get(k).push(h);
  }
  const ersterOrt = orte[0] ?? zustand.reise?.haefen?.find((x) => x.art === "ort")?.name ?? "";
  return `
    <div class="karte-box">
      <div class="zeile"><h3>Unterkünfte</h3><button class="knopf" data-aktion="hotel-neu">+ Unterkunft</button></div>
      <p class="leise klein">Sammle Hotels oder Ferienwohnungen, vergleiche Preis, Lage und Ausstattung und markiere die gebuchte. Gebuchte Unterkünfte werden zum Startpunkt der Ausflüge an diesen Tagen und zählen in die Kosten.</p>
      <label class="klein">Suche bei Anbietern für <input id="hotelSuchort" value="${esc(ersterOrt)}" placeholder="Ort, z. B. Hurghada"></label>
      <div id="hotelLinks">${suchLinks(ersterOrt, liste[0]?.anreise, liste[0]?.abreise)}</div>
    </div>
    ${
      liste.length
        ? [...zeitraeume.values()]
            .map((gruppe) => {
              const h0 = gruppe[0];
              const aktive = gruppe.filter((h) => h.status !== "verworfen");
              const guenstig = aktive.length > 1 ? [...aktive].sort((a, b) => hotelKosten(a, personen()).summe - hotelKosten(b, personen()).summe)[0].id : null;
              return `<div class="karte-box">
              <h3>${esc(h0.ort || "Ohne Ort")} <span class="leise klein">${h0.anreise ? `${esc(datumText(h0.anreise))} – ${esc(datumText(h0.abreise))} · ${naechte(h0.anreise, h0.abreise)} Nächte` : ""}</span></h3>
              <div class="ausfluege">${gruppe.map((h) => hotelKarte(h, h.id === guenstig)).join("")}</div>
            </div>`;
            })
            .join("")
        : `<div class="karte-box"><p class="leise">Noch keine Unterkunft eingetragen.</p></div>`
    }`;
}

function hotelKarte(h, guenstig) {
  const k = hotelKosten(h, personen());
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
      <div><span>Gesamt</span><strong>${geld(k.summe)}</strong><em>${k.naechte} Nächte${zahl(h.zimmer) > 1 ? ` · ${h.zimmer} Zimmer` : ""}</em></div>
      <div><span>Pro Nacht</span><strong>${k.proNacht != null ? geld(k.proNacht) : "–"}</strong></div>
      <div><span>Pro Person/Nacht</span><strong>${k.proPersonNacht != null ? geld(k.proPersonNacht) : "–"}</strong></div>
      <div><span>Gästebewertung</span><strong>${h.gaeste != null ? String(h.gaeste).replace(".", ",") : "–"}</strong><em>${esc(h.gaesteQuelle ?? "")}</em></div>
    </div>
    ${merkmale.length ? `<p class="klein">${merkmale.map(esc).join(" · ")}</p>` : ""}
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
    <label>Notiz<textarea name="notiz" rows="3">${esc(h.notiz ?? "")}</textarea></label>
    <div class="zeile">
      ${neu ? "" : `<button type="button" class="knopf gefahr" data-aktion="hotel-loeschen" data-id="${esc(h.id)}">Löschen</button>`}
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
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
    };
  };
  const vorschau = () => {
    const k = hotelKosten(lesen(), personen());
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
  const h = hotels()[0];
  $("#hotelLinks").innerHTML = suchLinks(e.target.value, h?.anreise, h?.abreise);
});

export function hotelStatusAendern(id, status) {
  const h = hotels().find((x) => x.id === id);
  h.status = status;
  speichern();
  neuZeichnen();
}

