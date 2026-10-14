// KI: Reisepläne (z. B. aus ChatGPT) einlesen und Assistent mit Änderungsvorschlägen.
import { zustand, $, esc, geld, neueId, datumText, personen, hafenVon, aktionen, speichern, neuZeichnen, anfrage, haefen, ausfluegeIn, istKreuzfahrt } from "./kern.js";
import { KATEGORIEN, QUELLEN, STATUS, VERPFLEGUNG, sichereUrl, zahl } from "./rechnen.js";
import { planZusammenfuehren } from "./zusammenfuehren.js";
import { reiseplanAusText } from "./reiseplan-text.js";

// ---------- Text der KI hübsch, aber sicher darstellen ----------

export function kiText(text) {
  let h = esc(text);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, v, u) => `${v}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/^#{1,4}\s*(.+)$/gm, "<strong>$1</strong>");
  h = h.replace(/^\s*[-*]\s+(.+)$/gm, "• $1");
  return h.replace(/\n/g, "<br>");
}

// ---------- Import ----------

export function kiImportBox() {
  const ki = zustand.info.ki;
  return `<div class="karte-box">
    <h3>📋 Reiseplan einlesen</h3>
    <p class="leise klein">Ganzen Plan einfügen – z. B. aus ChatGPT oder eigenen Notizen (Tage mit Datum, Liegezeiten, Ausflüge mit „GEBUCHT“/„ALTERNATIVE“, Zeiten und Preisen).
    „Erkennen“ arbeitet ohne KI und versteht Gesamtpreise („Preis gesamt für 6 Personen“), Preise pro Person, Kinderpreise und Dollar mit Euro-Angabe.
    ${ki ? "Mit KI gehen zusätzlich freie Texte, PDF, Word-Dateien und Screenshots." : "Mit hinterlegtem <code>ANTHROPIC_API_KEY</code> gehen zusätzlich freie Texte, PDF, Word und Screenshots."}
    Du siehst vorher, was übernommen wird – erneutes Einlesen ergänzt, statt zu verdoppeln.</p>
    <textarea id="kiText" rows="8" placeholder="21.03.2027 – Castries, St. Lucia&#10;Liegezeit: 07:30–19:00&#10;AUSFLUG GEBUCHT:&#10;TUI Cruises – Delfinbeobachtung&#10;Zeit: 08:15–11:45&#10;Preis gesamt für 6 Personen: 275 €"></textarea>
    <div class="zeile">
      ${ki ? `<label class="knopf leise">📎 Dateien wählen<input type="file" id="kiDateien" multiple accept=".pdf,.docx,.txt,.md,.csv,.html,.ics,image/*" hidden></label><span id="kiDateiNamen" class="klein leise"></span>` : ""}
      <span class="platz"></span>
      <button class="knopf ${ki ? "leise" : ""}" data-aktion="text-plan">Erkennen (ohne KI)</button>
      ${ki ? `<button class="knopf" data-aktion="ki-import">✨ Mit KI einlesen</button>` : ""}
    </div>
    <div id="kiVorschau"></div>
  </div>`;
}

aktionen["text-plan"] = () => {
  const text = $("#kiText").value;
  if (!text.trim()) return alert("Bitte zuerst den Reiseplan einfügen.");
  importPlan = reiseplanAusText(text);
  if (!importPlan.stationen.length && !importPlan.ausfluege.length) {
    $("#kiVorschau").innerHTML = `<p class="warnung">Keine Tage erkannt. Jeder Tag braucht eine Zeile wie „21.03.2027 – Castries, St. Lucia“.${zustand.info.ki ? " Oder „Mit KI einlesen“ verwenden." : ""}</p>`;
    return;
  }
  vorschauZeigen();
};

document.addEventListener("change", (e) => {
  if (e.target.id === "kiDateien") $("#kiDateiNamen").textContent = [...e.target.files].map((f) => f.name).join(", ");
});

const base64 = (datei) =>
  new Promise((ok, fehl) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fehl(r.error);
    r.readAsDataURL(datei);
  });

let importPlan = null;

aktionen["ki-import"] = async (el) => {
  const dateien = [...($("#kiDateien")?.files ?? [])];
  const groesse = dateien.reduce((s, d) => s + d.size, 0);
  if (groesse > 28_000_000) return alert("Die Dateien sind zusammen zu groß (max. ca. 28 MB).");
  el.disabled = true;
  $("#kiVorschau").innerHTML = `<p class="leise">Die KI liest den Plan … das kann bei großen Dateien eine Minute dauern.</p>`;
  try {
    const body = { text: $("#kiText").value, dateien: await Promise.all(dateien.map(async (d) => ({ name: d.name, typ: d.type, daten: await base64(d) }))) };
    importPlan = await anfrage("/api/ki/import", { method: "POST", body });
    vorschauZeigen();
  } catch (e) {
    $("#kiVorschau").innerHTML = `<p class="warnung">${esc(e.message)}</p>`;
  } finally {
    el.disabled = false;
  }
};

function vorschauZeigen() {
  const p = importPlan;
  const liste = (titel, eintraege, zeile) => (eintraege.length ? `<h4>${titel} (${eintraege.length})</h4><ul class="klein">${eintraege.map((x) => `<li>${zeile(x)}</li>`).join("")}</ul>` : "");
  $("#kiVorschau").innerHTML = `
    <div class="importvorschau">
      <p><strong>${esc(p.name || "Reise")}</strong> · ${esc({ kreuzfahrt: "Kreuzfahrt", hotel: "Hotelurlaub", rundreise: "Rundreise" }[p.art] ?? "")}${p.schiff ? ` · ${esc(p.schiff)}` : ""}</p>
      ${p.hinweise ? `<p class="hinweis klein">ℹ️ ${esc(p.hinweise)}</p>` : ""}
      ${liste("Tage", p.stationen, (s) => `${esc(datumText(s.datum))} ${s.art === "seetag" ? "🌊 Seetag" : esc(s.name)}${s.ankunft ? ` · ${esc(s.ankunft)}–${esc(s.abfahrt)}` : ""}`)}
      ${liste("Unterkünfte", p.hotels, (h) => `${esc(h.name)} <span class="leise">${esc(h.ort)} ${esc(datumText(h.anreise))}–${esc(datumText(h.abreise))}${h.preis != null ? ` · ${h.preis} €` : ""}</span>`)}
      ${liste("Ausflüge", p.ausfluege, (a) => `${esc(datumText(a.datum))} ${esc(a.titel)} <span class="leise">${esc(STATUS[a.status] ?? "")} · ${esc(QUELLEN[a.quelle]?.name ?? "")}${a.beginn ? ` · ${esc(a.beginn)}` : ""}${a.dauerMin ? ` · ${Math.round(a.dauerMin / 6) / 10} Std.` : ""}${a.preisGruppe != null ? ` · ${esc(geld(a.preisGruppe))} gesamt` : a.preisErw != null ? ` · ${esc(geld(a.preisErw))} p. P.${a.preisKind != null ? `, Kind ${esc(geld(a.preisKind))}` : ""}${a.kostenlosBis ? `, Kinder unter ${esc(a.kostenlosBis)} frei` : ""}` : " · <em>ohne Preis</em>"}</span>`)}
      ${liste("Verbindungen", p.verbindungen ?? [], (v) => `${esc(datumText(v.datum))} ${{ flug: "✈️", zug: "🚆", faehre: "⛴️", bus: "🚌", mietwagen: "🚗", transfer: "🚐" }[v.art] ?? "🧭"} ${esc(v.titel)} <span class="leise">${esc(v.von)} → ${esc(v.nach)}${v.abZeit ? ` · ${esc(v.abZeit)}${v.anZeit ? `–${esc(v.anZeit)}` : ""}` : ""}${v.anDatum && v.anDatum !== v.datum ? ` (an ${esc(datumText(v.anDatum))})` : ""}${v.details ? ` · ${esc(v.details)}` : ""}</span>`)}
      ${liste("Weitere Kosten", p.kosten, (k) => `${esc(k.titel)}${k.betrag != null ? ` · ${k.betrag} €` : ""}`)}
      ${liste("Personen", p.personen, (x) => `${esc(x.name)} <span class="leise">${x.typ === "kind" ? `Kind${x.alter ? `, ${x.alter}` : ""}` : "Erwachsen"}</span>`)}
      <div class="zeile">
        ${zustand.reise ? `<button class="knopf" data-aktion="ki-uebernehmen">In „${esc(zustand.reise.name)}“ übernehmen</button>` : ""}
        <button class="knopf leise" data-aktion="ki-neue-reise">Als neue Reise anlegen</button>
        ${p.personen.length && zustand.reise ? `<label class="haken klein"><input type="checkbox" id="kiPersonen" ${zustand.reise.personen.length <= 1 ? "checked" : ""}> Personen aus dem Plan übernehmen (${p.personen.length})</label>` : ""}
      </div>
    </div>`;
}

/** Häfen/Orte ohne Kartenpunkt über die Ortssuche finden (eine Anfrage pro Sekunde, Ergebnisse im Zwischenspeicher). */
export async function koordinatenErgaenzen(reise, fortschritt = () => {}) {
  const offen = (reise.haefen ?? []).filter((h) => (h.art ?? (h.seetag ? "seetag" : "hafen")) !== "seetag" && h.lat == null && h.name);
  const gefunden = new Map();
  let n = 0;
  for (const h of offen) {
    const suche = [h.name, h.land].filter(Boolean).join(", ");
    fortschritt(`Suche Orte auf der Karte … ${++n}/${offen.length} (${suche})`);
    if (!gefunden.has(suche)) {
      const treffer = await anfrage(`/api/geo?q=${encodeURIComponent(suche)}`).catch(() => []);
      const ersatz = treffer[0] ? treffer : await anfrage(`/api/geo?q=${encodeURIComponent(h.name)}`).catch(() => []);
      gefunden.set(suche, ersatz[0] ?? null);
    }
    const t = gefunden.get(suche);
    if (t) Object.assign(h, { lat: t.lat, lng: t.lng, ortName: t.name.split(",").slice(0, 3).join(","), land: h.land || t.name.split(",").at(-1).trim() });
  }
  // Flughäfen/Bahnhöfe der Verbindungen (für Zeitplan, Karte und „Wo sind wir gerade?“)
  for (const v of reise.verbindungen ?? []) {
    for (const [feld, name] of [["vonOrt", v.von], ["nachOrt", v.nach]]) {
      if (v[feld] || !name) continue;
      const code = /\(([A-Z]{3})\)/.exec(name)?.[1];
      const suche = v.art === "flug" ? `${code ? `${code} ` : ""}Flughafen ${name.replace(/\s*\([A-Z]{3}\)/, "")}` : name;
      fortschritt(`Suche ${name} auf der Karte …`);
      if (!gefunden.has(suche)) {
        const treffer = await anfrage(`/api/geo?q=${encodeURIComponent(suche)}`).catch(() => []);
        gefunden.set(suche, treffer[0] ?? null);
      }
      const t = gefunden.get(suche);
      if (t) v[feld] = { lat: t.lat, lng: t.lng, name: t.name.split(",").slice(0, 2).join(",") };
    }
  }
  return offen.filter((h) => h.lat == null).map((h) => h.name);
}

aktionen["ki-uebernehmen"] = async (el) => {
  const z = planZusammenfuehren(zustand.reise, importPlan, { personenErsetzen: $("#kiPersonen")?.checked });
  el.disabled = true;
  const fehlend = await koordinatenErgaenzen(zustand.reise, (t) => ($("#kiVorschau").innerHTML = `<p class="leise">${esc(t)}</p>`));
  speichern();
  alert(`Übernommen: ${z.tage} Tage, ${z.hotels} Unterkünfte, ${z.ausfluege} Ausflüge, ${z.verbindungen} Verbindungen (Flüge …), ${z.kosten} Kosten${z.aktualisiert ? `, ${z.aktualisiert} Einträge ergänzt` : ""}.${fehlend.length ? `\n\nNicht auf der Karte gefunden: ${[...new Set(fehlend)].join(", ")} – bitte unter „Route & Häfen“ suchen.` : ""}`);
  neuZeichnen();
};

aktionen["ki-neue-reise"] = async () => {
  const p = importPlan;
  const reise = { name: p.name || "Neue Reise", art: p.art, schiff: p.schiff, waehrung: "EUR", personen: p.personen.map((x) => ({ id: neueId(), name: x.name, typ: x.typ, alter: x.alter ?? "" })), haefen: [], hotels: [], ausfluege: [], kosten: [], verbindungen: [] };
  if (!reise.personen.length) reise.personen = [{ id: neueId(), name: zustand.ich?.name ?? "Ich", typ: "erwachsen", userId: zustand.ich?.id }];
  planZusammenfuehren(reise, { ...p, personen: [] });
  await koordinatenErgaenzen(reise, (t) => ($("#kiVorschau").innerHTML = `<p class="leise">${esc(t)}</p>`));
  const neu = await anfrage("/api/reisen", { method: "POST", body: reise });
  location.href = `/?reise=${neu.id}`;
};

// ---------- Assistent ----------

const ANGEWENDET = () => `reiseplaner:ki-angewendet:${zustand.reise?.id}`;
const angewendet = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(ANGEWENDET()) ?? "[]"));
  } catch {
    return new Set();
  }
};
function merkeAngewendet(id) {
  const s = angewendet();
  s.add(id);
  try {
    localStorage.setItem(ANGEWENDET(), JSON.stringify([...s].slice(-500)));
  } catch {}
}

let verlauf = [];

export function kiKnopf() {
  return zustand.info.ki && zustand.reise ? `<button class="kiknopf" data-aktion="ki-oeffnen" aria-label="KI-Assistent">✨ KI</button>` : "";
}

aktionen["ki-oeffnen"] = async (el) => {
  const panel = $("#kiPanel");
  panel.hidden = false;
  document.body.classList.add("ki-offen");
  if (el?.dataset.frage) $("#kiFrage").value = el.dataset.frage;
  $("#kiFrage").focus();
  try {
    verlauf = await anfrage(`/api/reisen/${zustand.reise.id}/chat`);
  } catch {
    verlauf = [];
  }
  chatZeichnen();
  // Fertige Aufträge (z. B. „3 passende Ausflüge“, „Plan B“) direkt abschicken
  if (el?.dataset.senden) fragen();
};

aktionen["ki-schliessen"] = () => {
  $("#kiPanel").hidden = true;
  document.body.classList.remove("ki-offen");
};

aktionen["ki-neu"] = async () => {
  if (!confirm("Neues Gespräch beginnen? Der bisherige Verlauf wird gelöscht.")) return;
  await anfrage(`/api/reisen/${zustand.reise.id}/chat`, { method: "DELETE" });
  verlauf = [];
  chatZeichnen();
};

const BEISPIELE = [
  "Welcher Ausflug ist an welchem Tag am sinnvollsten für uns mit den Kindern?",
  "Haben wir irgendwo zu wenig Zeitpuffer bis „Alle an Bord“?",
  "Schlag uns gute Tauchplätze für die Reise vor.",
  "Wie können wir die Kosten senken?",
];

function chatZeichnen() {
  const el = $("#kiVerlauf");
  const schon = angewendet();
  el.innerHTML = verlauf.length
    ? verlauf
        .map((n) => {
          if (n.rolle === "hinweis") return `<p class="klein leise">${esc(n.text)}</p>`;
          if (n.rolle === "nutzer") return `<div class="nachricht nutzer">${esc(n.text)}</div>`;
          return `<div class="nachricht ki">${kiText(n.text)}${(n.vorschlaege ?? []).map((v) => vorschlagKarte(v, schon.has(v.id))).join("")}</div>`;
        })
        .join("")
    : `<p class="leise klein">Frag zum Beispiel:</p>${BEISPIELE.map((b) => `<button class="treffer" data-aktion="ki-beispiel">${esc(b)}</button>`).join("")}`;
  el.scrollTop = el.scrollHeight;
}

function vorschlagKarte(v, erledigt) {
  const d = v.daten ?? {};
  let titel = "";
  let details = "";
  if (v.typ === "ausflug_vorschlagen") {
    const h = hafenVon(d.stationId);
    titel = `Neuer Ausflug: ${d.titel}`;
    details = [h ? `${datumText(h.datum)} ${h.name}` : "", QUELLEN[d.quelle]?.name, d.beginn, d.dauerMin ? `${Math.round(d.dauerMin / 6) / 10} Std.` : "", d.preisErw != null ? `${d.preisErw} €` : ""].filter(Boolean).join(" · ");
  } else if (v.typ === "aenderung_vorschlagen") {
    const ziel = d.zielArt === "ausflug" ? zustand.reise.ausfluege.find((a) => a.id === d.zielId)?.titel : d.zielArt === "hotel" ? zustand.reise.hotels?.find((h) => h.id === d.zielId)?.name : hafenVon(d.zielId)?.name;
    titel = `Ändern: ${ziel ?? "?"}`;
    details = (d.aenderungen ?? []).map((a) => `${a.feld} → ${a.feld === "status" ? STATUS[a.wert] ?? a.wert : a.wert}`).join(", ");
  } else if (v.typ === "station_vorschlagen") {
    titel = `Neuer Tag: ${d.art === "seetag" ? "Seetag" : d.name}`;
    details = [datumText(d.datum), d.ankunft && `${d.ankunft}–${d.abfahrt}`].filter(Boolean).join(" · ");
  } else if (v.typ === "hotel_vorschlagen") {
    titel = `Unterkunft: ${d.name}`;
    details = [d.ort, d.anreise && `${datumText(d.anreise)}–${datumText(d.abreise)}`, d.preis != null && `${d.preis} € ${d.preisArt === "nacht" ? "/Nacht" : "gesamt"}`, VERPFLEGUNG[d.verpflegung]].filter(Boolean).join(" · ");
  }
  return `<div class="vorschlag">
    <strong>${esc(titel)}</strong><div class="klein">${esc(details)}</div>
    ${d.begruendung ? `<div class="klein leise">${esc(d.begruendung)}</div>` : ""}
    ${erledigt ? `<span class="klein leise">✓ übernommen</span>` : `<button class="knopf leise" data-aktion="ki-vorschlag" data-id="${esc(v.id)}">Übernehmen</button>`}
  </div>`;
}

aktionen["ki-beispiel"] = (el) => {
  $("#kiFrage").value = el.textContent;
  $("#kiFrage").focus();
};

async function fragen() {
  const frage = $("#kiFrage").value.trim();
  if (!frage) return;
  $("#kiFrage").value = "";
  verlauf.push({ rolle: "nutzer", text: frage });
  verlauf.push({ rolle: "ki", text: "… denkt nach (bei Websuche bis zu einer Minute)" });
  chatZeichnen();
  $("#kiSenden").disabled = true;
  try {
    const r = await anfrage(`/api/reisen/${zustand.reise.id}/chat`, { method: "POST", body: { frage } });
    verlauf[verlauf.length - 1] = { rolle: "ki", text: r.antwort, vorschlaege: r.vorschlaege };
  } catch (e) {
    verlauf[verlauf.length - 1] = { rolle: "hinweis", text: `Fehler: ${e.message}` };
  } finally {
    $("#kiSenden").disabled = false;
    chatZeichnen();
  }
}

document.addEventListener("submit", (e) => {
  if (e.target.id !== "kiForm") return;
  e.preventDefault();
  fragen();
});
document.addEventListener("keydown", (e) => {
  if (e.target.id === "kiFrage" && e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    fragen();
  }
});

const ZAHLENFELDER = new Set(["dauerMin", "preisErw", "preisKind", "kostenlosBis", "preisGruppe", "zusatzkosten", "interesse", "preis"]);

aktionen["ki-vorschlag"] = async (el) => {
  const v = verlauf.flatMap((n) => n.vorschlaege ?? []).find((x) => x.id === el.dataset.id);
  if (!v) return;
  const d = v.daten;
  const r = zustand.reise;
  try {
    if (v.typ === "ausflug_vorschlagen") {
      const h = hafenVon(d.stationId);
      if (!h) throw new Error("Den Tag aus dem Vorschlag gibt es nicht mehr.");
      const a = {
        id: neueId(), hafenId: h.id, titel: d.titel, kategorie: KATEGORIEN[d.kategorie] ? d.kategorie : "ausflug", quelle: QUELLEN[d.quelle] ? d.quelle : "sonstige", status: "idee",
        beginn: /^\d{2}:\d{2}$/.test(d.beginn) ? d.beginn : "", dauerMin: zahl(d.dauerMin), preisArt: "person", preisErw: zahl(d.preisErw), preisKind: zahl(d.preisKind),
        link: sichereUrl(d.link), notiz: [d.notiz, d.begruendung && `KI: ${d.begruendung}`].filter(Boolean).join("\n"), interesse: 3, verkehr: "auto", teilnehmer: personen().map((p) => p.id),
      };
      if (d.zielName) {
        const treffer = await anfrage(`/api/geo?q=${encodeURIComponent(`${d.zielName}`)}`).catch(() => []);
        if (treffer[0]) a.ziel = { lat: treffer[0].lat, lng: treffer[0].lng, name: d.zielName };
      }
      r.ausfluege.push(a);
      zustand.hafenId = h.id;
    } else if (v.typ === "aenderung_vorschlagen") {
      const liste = d.zielArt === "ausflug" ? r.ausfluege : d.zielArt === "hotel" ? r.hotels ?? [] : r.haefen;
      const ziel = liste.find((x) => x.id === d.zielId);
      if (!ziel) throw new Error("Das Ziel des Vorschlags gibt es nicht mehr.");
      for (const { feld, wert } of d.aenderungen) {
        if (feld === "status" && !STATUS[wert]) continue;
        if (feld === "link") ziel.link = sichereUrl(wert);
        else ziel[feld] = ZAHLENFELDER.has(feld) ? zahl(wert) : wert;
      }
    } else if (v.typ === "station_vorschlagen") {
      r.haefen.push({ id: neueId(), datum: d.datum, art: d.art, seetag: d.art === "seetag", name: d.art === "seetag" ? "Seetag" : d.name, land: d.land, ankunft: d.ankunft, abfahrt: d.abfahrt, allesAnBord: d.allesAnBord, notiz: d.notiz, lat: null, lng: null });
    } else if (v.typ === "hotel_vorschlagen") {
      r.hotels ??= [];
      r.hotels.push({ id: neueId(), status: "idee", zimmer: 1, ...d, link: sichereUrl(d.link), notiz: [d.notiz, d.begruendung && `KI: ${d.begruendung}`].filter(Boolean).join("\n"), lat: null, lng: null });
    }
    merkeAngewendet(v.id);
    speichern();
    neuZeichnen();
    chatZeichnen();
  } catch (e) {
    alert(e.message);
  }
};

export function kiPanel() {
  return `<aside id="kiPanel" class="kipanel" hidden aria-label="KI-Assistent">
    <div class="kipanel-kopf"><strong>✨ Reise-Assistent</strong><span class="platz"></span><button class="link" data-aktion="ki-neu">Neues Gespräch</button><button class="link" data-aktion="ki-schliessen" aria-label="Schließen">✕</button></div>
    <div id="kiVerlauf" class="kiverlauf"></div>
    <form id="kiForm" class="kiform"><textarea id="kiFrage" rows="2" placeholder="Frag etwas zur Reise …"></textarea><button class="knopf" id="kiSenden">Senden</button></form>
    <p class="klein leise">Die KI sieht die Reisedaten (ohne Fotos) und kann im Web suchen. Änderungen schlägt sie nur vor.</p>
  </aside>`;
}

