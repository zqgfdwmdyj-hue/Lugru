// Reisebuch & Jahresrückblick: druckfertige Seiten (→ „Als PDF speichern“) mit Route, Tagen,
// den besten Fotos, Bewertungen und Tauchgängen – als Vorlage für ein Fotobuch.
import { zustand, esc, aktionen, anfrage, sterneText } from "./kern.js";
import { KATEGORIEN, REISEARTEN, oeffentlicheFotos, entfernungKm } from "./rechnen.js";
import { tauchStatistik, reiseZeitraum } from "./unterwegs-logik.js";
import { kinderKapitel } from "./kinder.js";

const artVon = (h) => h.art ?? (h.seetag ? "seetag" : "hafen");
const mitKoord = (o) => Number.isFinite(o?.lat) && Number.isFinite(o?.lng);
const datum = (iso, opt = { weekday: "long", day: "numeric", month: "long" }) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", opt) : "");
const vorname = (n) => String(n ?? "").split(/\s+/)[0];

/** Einfache Routenkarte als SVG (ohne Kartenkacheln, druckt scharf). */
function routeSvg(orte) {
  const p = orte.filter(mitKoord);
  if (p.length < 2) return "";
  const lats = p.map((o) => o.lat);
  const lngs = p.map((o) => o.lng);
  const [s, n, w, o] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const kos = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const breite = Math.max((o - w) * kos, 0.01);
  const hoehe = Math.max(n - s, 0.01);
  const B = 640;
  const H = Math.max(220, Math.min(520, Math.round((B * hoehe) / breite)));
  const rand = 40;
  const f = Math.min((B - 2 * rand) / breite, (H - 2 * rand) / hoehe);
  const xy = (q) => [rand + ((q.lng - w) * kos * f) + (B - 2 * rand - breite * f) / 2, H - rand - (q.lat - s) * f - (H - 2 * rand - hoehe * f) / 2];
  const punkte = p.map(xy);
  const namen = new Set();
  return `<svg class="buch-route" viewBox="0 0 ${B} ${H}" role="img" aria-label="Route">
    <rect width="${B}" height="${H}" rx="14" fill="#e8f1fa"/>
    <polyline points="${punkte.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="none" stroke="#0b5394" stroke-width="2.5" stroke-dasharray="7 6"/>
    ${p.map((q, i) => {
      const [x, y] = punkte[i];
      const neu = !namen.has(q.name);
      namen.add(q.name);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="#d0021b" stroke="#fff" stroke-width="2"/>${neu ? `<text x="${(x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="13" fill="#1c2430">${esc(q.name)}</text>` : ""}`;
    }).join("")}
  </svg>`;
}

function reiseKapitel({ reise, beitraege }, namen, opt) {
  const fotoUrl = (id, klein = false) => `/api/reisen/${reise.id}/fotos/${id}${klein ? "?klein=1" : ""}`;
  const bewertungen = (zielArt, zielId) => beitraege.bewertungen.filter((b) => b.zielArt === zielArt && b.zielId === zielId && (opt.privat || !b.privat));
  const fotosVon = (eintrag) => (opt.nurGeteilt ? oeffentlicheFotos(eintrag) : eintrag.privat && !opt.privat ? [] : eintrag.fotos ?? []);
  const tage = [...(reise.haefen ?? [])].filter((h) => h.datum).sort((a, b) => a.datum.localeCompare(b.datum));
  const orte = tage.filter((h) => artVon(h) !== "seetag" && mitKoord(h));
  const { von, bis } = reiseZeitraum(reise);
  let km = 0;
  for (let i = 1; i < orte.length; i++) km += entfernungKm(orte[i - 1], orte[i]) ?? 0;
  const laender = new Set(orte.map((h) => h.land).filter(Boolean));
  const gebucht = (reise.ausfluege ?? []).filter((a) => a.status === "gebucht");
  const tauch = [...beitraege.tauchgaenge].filter((t) => opt.privat || !t.privat).sort((a, b) => `${a.datum}${a.beginn}`.localeCompare(`${b.datum}${b.beginn}`));
  const alleFotos = new Set();

  const tagSeiten = tage.map((h, i) => {
    const ausfluege = gebucht.filter((a) => a.hafenId === h.id);
    const fotos = [
      ...beitraege.fotos.filter((f) => f.hafenId === h.id && (!opt.nurGeteilt || f.geteilt)).sort((a, b) => String(a.aufnahme?.zeit ?? "").localeCompare(String(b.aufnahme?.zeit ?? ""))).map((f) => f.id),
      ...ausfluege.flatMap((a) => bewertungen("ausflug", a.id).flatMap(fotosVon)),
      ...tauch.filter((t) => t.datum === h.datum).flatMap(fotosVon),
    ];
    const eindeutig = [...new Set(fotos)].slice(0, opt.fotosJeTag);
    eindeutig.forEach((f) => alleFotos.add(f));
    const tauchHeute = tauch.filter((t) => t.datum === h.datum);
    if (!ausfluege.length && !eindeutig.length && !tauchHeute.length && !h.notiz && opt.kompakt) return "";
    return `<section class="buch-tag">
      <div class="buch-tagkopf"><span class="buch-nr">Tag ${i + 1}</span><h3>${artVon(h) === "seetag" ? "🌊 Seetag" : esc(h.name)}${h.land ? `<span>, ${esc(h.land)}</span>` : ""}</h3><span class="buch-datum">${esc(datum(h.datum))}</span></div>
      ${eindeutig.length ? `<div class="buch-fotos n${Math.min(eindeutig.length, 6)}">${eindeutig.map((f) => `<img src="${fotoUrl(f)}" alt="" loading="eager">`).join("")}</div>` : ""}
      ${ausfluege.map((a) => {
        const bew = bewertungen("ausflug", a.id);
        return `<div class="buch-erlebnis"><h4>${esc(a.titel)} <span class="buch-kat">${esc(KATEGORIEN[a.kategorie] ?? "")}</span> ${bew.length ? sterneText(bew.reduce((s, b) => s + b.sterne, 0) / bew.length) : ""}</h4>
          ${bew.map((b) => `${b.titel || b.text ? `<blockquote>${b.titel ? `<strong>${esc(b.titel)}</strong> ` : ""}${esc(b.text ?? "")}${opt.privat && b.textPrivat ? `<br><em>${esc(b.textPrivat)}</em>` : ""}<cite>– ${esc(vorname(namen[b.autorId]))}</cite></blockquote>` : ""}`).join("")}</div>`;
      }).join("")}
      ${tauchHeute.map((t) => `<div class="buch-erlebnis"><h4>🤿 ${esc(t.tauchplatz)} ${t.sterne ? sterneText(t.sterne) : ""}</h4><p class="buch-klein">${[t.maxTiefe != null ? `${String(t.maxTiefe).replace(".", ",")} m` : "", t.tauchzeitMin ? `${t.tauchzeitMin} Min.` : "", t.wasserTemp != null ? `${String(t.wasserTemp).replace(".", ",")} °C` : "", t.sicht ? `Sicht ${t.sicht} m` : "", vorname(namen[t.taucherId])].filter(Boolean).join(" · ")}</p>${t.sichtungen ? `<p>🐠 ${esc(t.sichtungen)}</p>` : ""}${t.text ? `<p>${esc(t.text)}</p>` : ""}</div>`).join("")}
      ${opt.privat && h.notiz ? `<p class="buch-klein">${esc(h.notiz)}</p>` : ""}
    </section>`;
  }).join("");

  const hotels = (reise.hotels ?? []).filter((h) => h.status === "gebucht");
  const stat = tauchStatistik(tauch);
  return `<article class="buch-reise">
    <section class="buch-titel">
      <p class="buch-ueber">${reise.art === "kreuzfahrt" || !reise.art ? esc(reise.schiff || "Kreuzfahrt") : esc((REISEARTEN[reise.art] ?? "Urlaub").replace(/^\S+\s/, ""))}</p>
      <h2>${esc(reise.name)}</h2>
      <p class="buch-zeitraum">${esc(datum(von, { day: "numeric", month: "long", year: "numeric" }))} – ${esc(datum(bis, { day: "numeric", month: "long", year: "numeric" }))}</p>
      <p class="buch-wer">${esc((reise.personen ?? []).map((p) => vorname(p.name)).join(" · "))}</p>
      <div class="buch-zahlen">
        <span><b>${tage.length}</b>Tage</span><span><b>${new Set(orte.map((h) => h.name)).size}</b>Orte</span>${laender.size ? `<span><b>${laender.size}</b>Länder</span>` : ""}
        ${km > 20 ? `<span><b>${Math.round(km).toLocaleString("de-DE")}</b>km Luftlinie</span>` : ""}<span><b>${gebucht.length}</b>Erlebnisse</span>${tauch.length ? `<span><b>${tauch.length}</b>Tauchgänge</span>` : ""}
      </div>
      ${routeSvg(orte)}
    </section>
    ${tagSeiten}
    ${hotels.length ? `<section class="buch-tag"><div class="buch-tagkopf"><h3>🏨 Unterkünfte</h3></div>${hotels.map((ho) => {
      const bew = bewertungen("hotel", ho.id);
      const fotos = [...new Set(bew.flatMap(fotosVon))].slice(0, 3);
      return `<div class="buch-erlebnis"><h4>${esc(ho.name)} ${bew.length ? sterneText(bew.reduce((s, b) => s + b.sterne, 0) / bew.length) : ""}</h4><p class="buch-klein">${esc(ho.ort ?? "")} · ${esc(datum(ho.anreise, { day: "numeric", month: "short" }))} – ${esc(datum(ho.abreise, { day: "numeric", month: "short" }))}</p>
        ${fotos.length ? `<div class="buch-fotos n${fotos.length}">${fotos.map((f) => `<img src="${fotoUrl(f)}" alt="">`).join("")}</div>` : ""}
        ${bew.map((b) => (b.text ? `<blockquote>${esc(b.text)}<cite>– ${esc(vorname(namen[b.autorId]))}</cite></blockquote>` : "")).join("")}</div>`;
    }).join("")}</section>` : ""}
    ${tauch.length ? `<section class="buch-tag"><div class="buch-tagkopf"><h3>🤿 Logbuch dieser Reise</h3></div>
      <div class="buch-zahlen klein"><span><b>${tauch.length}</b>Tauchgänge</span><span><b>${Math.round(stat.summeMin / 60)}</b>Std. unter Wasser</span>${stat.tiefste != null ? `<span><b>${String(stat.tiefste).replace(".", ",")} m</b>tiefster</span>` : ""}${stat.waermste != null ? `<span><b>${String(stat.waermste).replace(".", ",")} °C</b>wärmstes Wasser</span>` : ""}</div>
      ${stat.arten.length ? `<p>🐠 Gesehen: ${stat.arten.slice(0, 20).map(([a, n]) => `${esc(a)}${n > 1 ? ` (${n}×)` : ""}`).join(", ")}</p>` : ""}</section>` : ""}
  </article>`;
}

function buchZeigen(daten, titel) {
  const opt = { privat: false, nurGeteilt: false, fotosJeTag: 6, kompakt: true, kinder: true, ...(zustand.buchOptionen ?? {}) };
  const zeichnen = () => {
    const kapitel = daten.reisen.map((r) => reiseKapitel(r, daten.namen ?? {}, opt)).join("")
      + (opt.kinder && daten.extras ? kinderKapitel(daten.reisen[0].reise, daten.extras, (id) => `/api/reisen/${daten.reisen[0].reise.id}/fotos/${id}`) : "");
    const jahr = daten.jahr
      ? `<section class="buch-titel buch-jahr"><p class="buch-ueber">Jahresrückblick</p><h2>Unser Jahr ${esc(daten.jahr)}</h2>
        <div class="buch-zahlen"><span><b>${daten.reisen.length}</b>Reisen</span><span><b>${new Set(daten.reisen.flatMap((r) => (r.reise.haefen ?? []).filter((h) => artVon(h) !== "seetag" && h.datum?.startsWith(daten.jahr)).map((h) => h.name))).size}</b>Orte</span><span><b>${new Set(daten.reisen.flatMap((r) => (r.reise.haefen ?? []).map((h) => h.land).filter(Boolean))).size}</b>Länder</span><span><b>${daten.reisen.reduce((s, r) => s + r.beitraege.tauchgaenge.filter((t) => t.datum?.startsWith(daten.jahr)).length, 0)}</b>Tauchgänge</span></div>
        ${routeSvg(daten.reisen.flatMap((r) => [...(r.reise.haefen ?? [])].filter((h) => artVon(h) !== "seetag" && h.datum?.startsWith(daten.jahr)).sort((a, b) => a.datum.localeCompare(b.datum))))}</section>`
      : "";
    buch.querySelector(".buch-seiten").innerHTML = jahr + (kapitel || `<p>Für ${esc(daten.jahr ?? "diese Reise")} gibt es noch keine Reisetage.</p>`);
  };
  document.querySelector("#buch")?.remove();
  const buch = document.createElement("div");
  buch.id = "buch";
  buch.className = "buch";
  buch.innerHTML = `<div class="buch-leiste">
      <strong>📖 ${esc(titel)}</strong>
      <label class="haken"><input type="checkbox" data-opt="privat" ${opt.privat ? "checked" : ""}> Private Notizen &amp; 🔒-Einträge</label>
      <label class="haken"><input type="checkbox" data-opt="nurGeteilt" ${opt.nurGeteilt ? "checked" : ""}> Nur 🌍-Fotos</label>
      <label class="haken"><input type="checkbox" data-opt="kompakt" ${opt.kompakt ? "checked" : ""}> Leere Tage weglassen</label>
      ${daten.extras ? `<label class="haken"><input type="checkbox" data-opt="kinder" ${opt.kinder ? "checked" : ""}> Kinder-Kapitel</label>` : ""}
      <label>Fotos je Tag <select data-opt="fotosJeTag">${[2, 4, 6, 9].map((n) => `<option ${opt.fotosJeTag === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <span class="platz"></span>
      <button class="knopf" data-buch="drucken">🖨️ Drucken / Als PDF speichern</button>
      <button class="knopf leise" data-buch="zu">Schließen</button>
    </div>
    <p class="buch-tipp">Tipp: Im Druckdialog „Als PDF speichern“ wählen. Das PDF lässt sich bei Fotobuch-Anbietern hochladen oder als Vorlage nutzen.</p>
    <div class="buch-seiten"></div>`;
  document.body.append(buch);
  document.body.classList.add("buchmodus");
  buch.addEventListener("change", (e) => {
    const k = e.target.dataset.opt;
    if (!k) return;
    opt[k] = e.target.type === "checkbox" ? e.target.checked : Number(e.target.value);
    zustand.buchOptionen = { ...opt };
    zeichnen();
  });
  buch.addEventListener("click", (e) => {
    const b = e.target.closest("[data-buch]");
    if (!b) return;
    if (b.dataset.buch === "drucken") window.print();
    else {
      buch.remove();
      document.body.classList.remove("buchmodus");
    }
  });
  zeichnen();
  window.scrollTo({ top: 0 });
}

aktionen["reisebuch"] = () => {
  const { meineRolle, ...reise } = zustand.reise;
  buchZeigen({ reisen: [{ reise, beitraege: zustand.beitraege }], namen: zustand.beitraege.namen ?? {}, extras: zustand.extras }, `Reisebuch: ${reise.name}`);
};

aktionen["rueckblick"] = async (el) => {
  const jahr = el.dataset.jahr || prompt("Für welches Jahr?", String(new Date().getFullYear()));
  if (!/^\d{4}$/.test(jahr ?? "")) return;
  const daten = await anfrage(`/api/rueckblick?jahr=${jahr}`);
  buchZeigen(daten, `Jahresrückblick ${jahr}`);
};
