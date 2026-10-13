// Flug & Flughafen: Anreise-Tag rückwärts geplant, Lounges & Co. bewerten, Flughafen-Steckbrief, Handgepäck,
// Flugstatus, Verspätung, „Wo sind wir gerade?“ und Rückflug – plus die Flughafen-Seite im Kinder-Bereich.
import { zustand, $, esc, datumText, personen, aktionen, aenderungen, neuZeichnen, dialogOeffnen, dialog, anfrage, speichern, neueId, heute, herunterladen } from "./kern.js";
import { FLUGHAFEN_ARTEN, istKind, zahl, VERKEHRSMITTEL } from "./rechnen.js";
import { flugZeitplan, verspaetungsTipps, flugFortschritt, RUECKFLUG_CHECK, FLUG_BINGO, FLUGLINIEN, PACKVORLAGEN, kalenderDatei, vorlageEintraege } from "./unterwegs-logik.js";
import { bewertungsZeile } from "./erlebnisse.js";
import { verbindungText } from "./unterwegs.js";
import { kind, vorname, zustandKind, kinderSetzen } from "./kinderbasis.js";
import { LAENDER, mischen } from "./kinderdaten.js";

export const fluege = () =>
  (zustand.reise?.verbindungen ?? []).filter((v) => v.art === "flug" && v.status !== "verworfen" && v.datum).sort((a, b) => `${a.datum}${a.abZeit}`.localeCompare(`${b.datum}${b.abZeit}`));
const kinderDabei = () => personen().some(istKind);
const orteVon = (v) => (zustand.reise.flughafenOrte ?? []).filter((o) => o.verbindungId === v.id);
const kurz = (name) => /\(([A-Z]{3})\)/.exec(name ?? "")?.[1] ?? String(name ?? "").slice(0, 3).toUpperCase();
const flugNr = (v) => String(v.titel ?? "").replace(/\s+/g, "");
const mapsSuche = (q, ort) => `https://www.google.com/maps/search/${encodeURIComponent(q)}${Number.isFinite(ort?.lat) ? `/@${ort.lat},${ort.lng},15z` : ""}`;

/** Nächster Flug ab jetzt (oder der letzte, wenn alle vorbei sind). */
function naechsterFlug() {
  const jetzt = `${heute()}T${new Date().toTimeString().slice(0, 5)}`;
  return fluege().find((v) => `${v.datum}T${v.abZeit || "23:59"}` >= jetzt) ?? null;
}

// ---------- Ansicht „✈️ Flug“ ----------

export function flugAnsicht() {
  const liste = fluege();
  if (!liste.length) {
    return `<div class="karte-box"><h3>✈️ Flug &amp; Flughafen</h3>
      <p>Noch kein Flug eingetragen. Trage den Flug mit Uhrzeit ein – dann gibt es hier den Zeitplan für den Anreise-Tag (wann aufstehen, wann losfahren), Lounge-Bewertungen, Handgepäck-Check, Flugstatus, Tipps bei Verspätung und „Wo sind wir gerade?“.</p>
      <button class="knopf" data-aktion="verbindung-neu">+ Flug eintragen</button></div>`;
  }
  return liste.map((v, i) => flugKarte(v, { hin: i === 0 && liste.length > 1, rueck: i === liste.length - 1 && liste.length > 1 })).join("");
}

function flugKarte(v, { hin, rueck }) {
  const plan = flugZeitplan(v, { kinder: kinderDabei() });
  const fort = flugFortschritt(v);
  const verspaetung = zustand.flugVerspaetung?.[v.id] ?? "";
  const tipps = verspaetungsTipps(verspaetung, { kinder: kinderDabei() });
  const checkin = v.abZeit ? new Date(new Date(`${v.datum}T${v.abZeit}:00`).getTime() - 30 * 3600_000) : null;
  const orte = orteVon(v);
  const handgepaeck = PACKVORLAGEN.handgepaeck.eintraege;
  const packliste = zustand.extras.packliste ?? [];
  const aufListe = handgepaeck.filter((x) => packliste.some((p) => p.text.toLowerCase() === x.text.toLowerCase()));
  const fragen = {
    status: `Wie ist der aktuelle Status von Flug ${v.titel || ""} am ${datumText(v.datum)} von ${v.von || "?"} nach ${v.nach || "?"}? Pünktlich, verspätet, Gate, Terminal, Gepäckband – bitte mit Quelle.`,
    steckbrief: `Erstelle einen kurzen Steckbrief für den Flughafen ${v.von || "?"}${v.terminal ? ` (${v.terminal})` : ""} für unsere Familie${kinderDabei() ? " mit Kindern" : ""}: Lounges (Zugang mit Priority Pass/Kreditkarte, Tagespreis, Öffnungszeiten), Familien-Spur bei der Sicherheitskontrolle, Spielplätze, Wickelräume, Ruheräume, Wasserspender, gutes Essen, Aussichtsterrasse und typische Wartezeiten. Nenne Quellen.`,
  };
  return `<div class="karte-box flugkarte">
    <div class="zeile"><h3>✈️ ${hin ? "Hinflug" : rueck ? "Rückflug" : "Flug"} · ${esc(datumText(v.datum, { weekday: "long", day: "numeric", month: "long" }))}</h3><span class="platz"></span><button class="link" data-aktion="verbindung-bearbeiten" data-id="${esc(v.id)}">Bearbeiten</button></div>
    <p>${verbindungText(v)}${v.sitz ? ` · Sitz ${esc(v.sitz)}` : ""}${v.gepaeck ? ` · ${esc(v.gepaeck)}` : ""}</p>

    <h4>⏰ Zeitplan für den Tag</h4>
    ${plan ? `<ul class="flugplan">${plan.schritte.map((x) => `<li class="${x.art}"><strong>${esc(x.zeit)}</strong> ${esc(x.text)}</li>`).join("")}</ul>` : `<p class="leise">Abflugzeit eintragen, dann rechnet die App rückwärts.</p>`}
    <div class="formular drei">
      <label>Anfahrt (Min.)<input type="number" min="0" max="1440" inputmode="numeric" data-flugfeld="anfahrtMin" data-id="${esc(v.id)}" value="${esc(v.anfahrtMin ?? "")}" placeholder="z. B. 90"></label>
      <label>Parken / Shuttle (Min.)<input type="number" min="0" max="300" inputmode="numeric" data-flugfeld="parkenMin" data-id="${esc(v.id)}" value="${esc(v.parkenMin ?? "")}" placeholder="z. B. 20"></label>
      <label>Am Flughafen vorher (Min.)<input type="number" min="30" max="600" inputmode="numeric" data-flugfeld="vorlaufMin" data-id="${esc(v.id)}" value="${esc(v.vorlaufMin ?? "")}" placeholder="${VERKEHRSMITTEL.flug.vorlauf}"></label>
    </div>
    ${plan ? `<div class="zeile"><button class="knopf leise" data-aktion="flug-kalender" data-id="${esc(v.id)}">📅 In den Kalender (mit Wecker)</button></div>` : ""}

    <h4>🛫 Check-in &amp; Flugstatus</h4>
    <p class="klein">${checkin ? `Online-Check-in öffnet meist 24–30 Std. vorher – ab ca. <strong>${esc(checkin.toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }))}</strong>.` : "Online-Check-in öffnet meist 24–30 Std. vor Abflug."}${v.buchungsnr ? ` Buchungsnummer: <strong>${esc(v.buchungsnr)}</strong>` : ""}</p>
    <div class="links">
      ${flugNr(v) ? `<a class="linkchip" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(`${flugNr(v)} Flugstatus ${v.datum}`)}">🔎 Flugstatus ${esc(flugNr(v))}</a>` : ""}
      ${zustand.info.ki ? `<button class="linkchip" data-aktion="ki-oeffnen" data-senden="1" data-frage="${esc(fragen.status)}">✨ Status &amp; Gate von der KI</button>` : ""}
    </div>

    <h4>🏢 Flughafen ${esc(v.von || "")}</h4>
    <div class="links">
      ${["Lounge", "Spielplatz", "Restaurant", "Aussichtsterrasse"].map((q) => `<a class="linkchip" target="_blank" rel="noopener" href="${mapsSuche(`${q} ${v.von || "Flughafen"}`, v.vonOrt)}">${{ Lounge: "🛋️", Spielplatz: "🛝", Restaurant: "🍽️", Aussichtsterrasse: "🌅" }[q]} ${q}</a>`).join("")}
      ${zustand.info.ki ? `<button class="linkchip" data-aktion="ki-oeffnen" data-senden="1" data-frage="${esc(fragen.steckbrief)}">✨ Flughafen-Steckbrief</button>` : ""}
    </div>
    <div class="zeile"><strong>Lounges &amp; Orte am Flughafen</strong><span class="platz"></span><button class="knopf leise" data-aktion="flugort-neu" data-id="${esc(v.id)}">+ Lounge / Ort</button></div>
    ${orte.length ? orte.map((o) => `<div class="flugort"><div><strong>${esc(o.name)}</strong> <span class="klein leise">${esc([FLUGHAFEN_ARTEN[o.art], o.flughafen, o.terminal, o.zugang].filter(Boolean).join(" · "))}</span> <button class="link" data-aktion="flugort-bearbeiten" data-id="${esc(o.id)}">Bearbeiten</button></div>${o.notiz ? `<div class="klein">${esc(o.notiz)}</div>` : ""}${bewertungsZeile("flughafen", o.id)}</div>`).join("") : `<p class="leise klein">Lounge, Restaurant oder Spielplatz eintragen und hinterher mit Sternen und Fotos bewerten.</p>`}

    <h4>🎒 Handgepäck-Check</h4>
    <ul class="klein spalten">${handgepaeck.map((x) => `<li>${aufListe.includes(x) ? "✓ " : ""}${esc(x.text)}</li>`).join("")}</ul>
    ${aufListe.length < handgepaeck.length ? `<button class="knopf leise" data-aktion="handgepaeck-liste">Fehlendes auf die Packliste</button>` : `<p class="klein leise">Alles steht auf der Packliste (Vorbereitung).</p>`}

    <h4>⏳ Verspätung?</h4>
    <label class="klein">Wie lange (Min.)?<input type="number" min="0" max="1440" inputmode="numeric" data-aktion="flug-verspaetung" data-id="${esc(v.id)}" value="${esc(verspaetung)}" placeholder="z. B. 90" style="max-width:8em"></label>
    ${tipps.length ? `<ul class="klein">${tipps.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}

    <h4>🌍 Im Flugzeug</h4>
    ${fort ? flugKarteSvg(v, fort) : `<p class="leise klein">Abflug- und Zielort auf der Karte sowie die Flugdauer im Flug eintragen – dann zeigt die App, wo ihr gerade seid.</p>`}
    <ul class="klein">
      <li>Beim Start und bei der Landung trinken, kauen oder gähnen – hilft gegen Druck auf den Ohren${kinderDabei() ? " (Babys: Fläschchen oder Schnuller)" : ""}.</li>
      <li>Nachtflug: bequeme Kleidung, Kuscheltier, Augenmaske – zur gewohnten Schlafenszeit Licht aus.</li>
      <li>Viel Wasser trinken, ab und zu aufstehen und die Beine bewegen.</li>
      ${kinderDabei() ? `<li>Spiele ohne Internet: <button class="link" data-aktion="kind-seite-flug">✈️ Flughafen-Seite im Kinder-Bereich</button></li>` : ""}
    </ul>
    ${rueck ? `<h4>🏠 Rückflug</h4><ul class="klein">${RUECKFLUG_CHECK.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><button class="knopf leise" data-aktion="pack-zuruecksetzen">Packliste für die Rückreise zurücksetzen</button>` : ""}
  </div>`;
}

/** Kleine Karte: Strecke als Bogen, Flugzeug an der aktuellen Stelle. */
function flugKarteSvg(v, f) {
  const w = 320;
  const h = 110;
  const x = 20 + f.anteil * (w - 40);
  const y = 80 - Math.sin(f.anteil * Math.PI) * 50;
  const pfad = Array.from({ length: 21 }, (_, i) => `${20 + (i / 20) * (w - 40)},${80 - Math.sin((i / 20) * Math.PI) * 50}`).join(" ");
  const text = f.phase === "vorher" ? "Noch nicht gestartet" : f.phase === "gelandet" ? "Gelandet 🎉" : `Noch ${Math.floor(f.restMin / 60)} Std. ${f.restMin % 60} Min.${f.km ? ` · ca. ${Math.round(f.km * (1 - f.anteil)).toLocaleString("de-DE")} km` : ""}`;
  return `<figure class="flugfortschritt"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(text)}" style="width:100%;max-width:480px;height:auto">
    <polyline points="${pfad}" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2" stroke-dasharray="4 4"/>
    <circle cx="20" cy="80" r="5" fill="#1e88c8"/><circle cx="${w - 20}" cy="80" r="5" fill="#c62828"/>
    <text x="20" y="102" font-size="12" text-anchor="middle" fill="currentColor">${esc(kurz(v.von))}</text><text x="${w - 20}" y="102" font-size="12" text-anchor="middle" fill="currentColor">${esc(kurz(v.nach))}</text>
    <text x="${x}" y="${y + 7}" font-size="22" text-anchor="middle">✈️</text></svg>
    <figcaption class="klein">${esc(text)}</figcaption></figure>`;
}

// Felder direkt in der Karte (Anfahrt, Parken, Vorlauf) – wie im Flug-Dialog
document.addEventListener("change", (e) => {
  const feld = e.target.dataset?.flugfeld;
  if (!feld) return;
  const v = zustand.reise.verbindungen.find((x) => x.id === e.target.dataset.id);
  if (!v) return;
  v[feld] = zahl(e.target.value);
  speichern();
  neuZeichnen();
});
aenderungen["flug-verspaetung"] = (el) => {
  zustand.flugVerspaetung = { ...(zustand.flugVerspaetung ?? {}), [el.dataset.id]: el.value };
  neuZeichnen();
};
aktionen["flug-kalender"] = (el) => {
  const v = zustand.reise.verbindungen.find((x) => x.id === el.dataset.id);
  const { text } = kalenderDatei({ ...zustand.reise, name: `${zustand.reise.name} – Flug`, haefen: [], ausfluege: [], verbindungen: [v] }, { dokumente: [] });
  herunterladen(`Flug-${v.titel || v.datum}.ics`, text, "text/calendar");
};
aktionen["handgepaeck-liste"] = async (el) => {
  el.disabled = true;
  const eintraege = vorlageEintraege("handgepaeck", zustand.extras.packliste).map((x) => ({ ...x, fuer: "" }));
  try {
    const r = await anfrage(`/api/reisen/${zustand.reise.id}/extras/packliste/auto`, { method: "POST", body: { eintraege } });
    zustand.extras.packliste.push(...r.neu);
    neuZeichnen();
  } catch (e) {
    alert(e.message);
    el.disabled = false;
  }
};
aktionen["kind-seite-flug"] = () => {
  zustand.kinderSeite = "flughafen";
  document.querySelector('#reiter button[data-ansicht="kinder"]')?.click();
};

// ---------- Lounges & Orte am Flughafen ----------

function flugortDialog(o) {
  const v = zustand.reise.verbindungen.find((x) => x.id === o.verbindungId);
  dialogOeffnen(`<form method="dialog" class="formular" id="flugortForm">
    <h3>${o.name ? "Ort am Flughafen bearbeiten" : "Lounge / Ort am Flughafen"}</h3>
    <div class="formular zwei">
      <label>Art<select name="art">${Object.entries(FLUGHAFEN_ARTEN).map(([k, t]) => `<option value="${k}" ${o.art === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label>Name<input name="name" required maxlength="120" value="${esc(o.name ?? "")}" placeholder="z. B. Lufthansa Business Lounge"></label>
      <label>Flughafen<select name="flughafen">${[...new Set([v?.von, v?.nach, o.flughafen].filter(Boolean))].map((f) => `<option ${o.flughafen === f ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></label>
      <label>Terminal / Bereich<input name="terminal" maxlength="60" value="${esc(o.terminal ?? "")}" placeholder="z. B. Terminal 1, Gate B"></label>
      <label>Zugang / Preis<input name="zugang" maxlength="80" value="${esc(o.zugang ?? "")}" placeholder="z. B. Priority Pass, 35 € p. P."></label>
    </div>
    <label>Notiz<input name="notiz" maxlength="300" value="${esc(o.notiz ?? "")}" placeholder="z. B. Duschen, Kinderecke, ruhig"></label>
    <p class="klein leise">Sterne, Kommentar und Fotos gibt es danach über „★ Bewerten“.</p>
    <div class="zeile">${o.name ? `<button type="button" class="knopf gefahr" data-aktion="flugort-loeschen" data-id="${esc(o.id)}">Löschen</button>` : ""}<span class="platz"></span><button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button><button class="knopf" value="ok">Speichern</button></div>
  </form>`);
  $("#flugortForm").addEventListener("submit", (e) => {
    const f = new FormData(e.target);
    const neu = !o.name;
    Object.assign(o, { art: f.get("art"), name: String(f.get("name")).trim(), flughafen: f.get("flughafen") ?? "", terminal: String(f.get("terminal")).trim(), zugang: String(f.get("zugang")).trim(), notiz: String(f.get("notiz")).trim() });
    zustand.reise.flughafenOrte ??= [];
    if (neu) zustand.reise.flughafenOrte.push(o);
    speichern();
    neuZeichnen();
  });
}
aktionen["flugort-neu"] = (el) => {
  const v = zustand.reise.verbindungen.find((x) => x.id === el.dataset.id);
  flugortDialog({ id: neueId(), verbindungId: v.id, art: "lounge", flughafen: v.von ?? "" });
};
aktionen["flugort-bearbeiten"] = (el) => flugortDialog((zustand.reise.flughafenOrte ?? []).find((o) => o.id === el.dataset.id));
aktionen["flugort-loeschen"] = (el) => {
  if (!confirm("Ort löschen? Bewertungen dazu bleiben gespeichert, sind aber nicht mehr zugeordnet.")) return;
  zustand.reise.flughafenOrte = (zustand.reise.flughafenOrte ?? []).filter((o) => o.id !== el.dataset.id);
  dialog().close();
  speichern();
  neuZeichnen();
};

// ---------- Kinder: Flughafen-Seite ----------

export function flughafenKinderSeite() {
  const v = naechsterFlug() ?? fluege().at(-1);
  if (!v) return `<div class="karte-box"><p class="kind-text">Noch kein Flug eingetragen.</p></div>`;
  const plan = flugZeitplan(v, { kinder: true });
  const p = kind();
  const k = zustandKind(p);
  const spiel = k.flugspiel ?? {};
  const start = plan ? new Date(`${v.datum}T00:00:00`).getTime() + plan.boarding * 60000 : null;
  const bis = start ? Math.round((start - Date.now()) / 60000) : null;
  const countdown = bis == null ? "" : bis > 2 * 1440 ? `Noch <strong>${Math.ceil(bis / 1440)}</strong> Mal schlafen bis zum Flug!` : bis > 0 ? `Noch <strong>${Math.floor(bis / 60)} Std. ${bis % 60} Min.</strong> bis zum Einsteigen!` : "Wir fliegen! ✈️";
  const linien = FLUGLINIEN.filter(([n]) => spiel[`linie:${n}`]).length;
  const raetsel = abflugRaetsel();
  const fort = flugFortschritt(v);
  return `<div class="karte-box kind-countdown"><div class="kind-gross">✈️</div><p class="kind-text">${countdown}</p><p class="leise">${esc(v.von || "")} → ${esc(v.nach || "")} · ${esc(datumText(v.datum))}${v.abZeit ? ` um ${esc(v.abZeit)}` : ""}</p></div>
  <div class="karte-box"><h2>🎫 Meine Bordkarte</h2>
    <canvas id="bordkarte" width="1200" height="480" class="postkarte"></canvas>
    <div class="zeile"><button class="knopf" data-aktion="bordkarte-teilen">📤 Teilen</button><button class="knopf leise" data-aktion="bordkarte-laden">💾 Speichern</button></div>
  </div>
  ${fort && fort.phase === "fliegt" ? `<div class="karte-box"><h2>🌍 Wo sind wir gerade?</h2>${flugKarteSvg(v, fort)}</div>` : ""}
  <div class="karte-box"><div class="zeile"><h2>🔍 Flughafen-Bingo</h2><span class="platz"></span><strong>${FLUG_BINGO.filter(([, n]) => spiel[`bingo:${n}`]).length} / ${FLUG_BINGO.length}</strong></div>
    <div class="bingo">${FLUG_BINGO.map(([e, n]) => `<div class="bingo-feld ${spiel[`bingo:${n}`] ? "gesehen" : ""}"><button class="bingo-knopf" data-aktion="flugspiel" data-schluessel="${esc(`bingo:${n}`)}"><span class="bingo-emoji">${e}</span><span class="bingo-name">${esc(n)}</span></button>${spiel[`bingo:${n}`] ? `<span class="bingo-haken">✓</span>` : ""}</div>`).join("")}</div>
  </div>
  <div class="karte-box"><div class="zeile"><h2>🛩️ Fluglinien sammeln</h2><span class="platz"></span><strong>${linien} / ${FLUGLINIEN.length}</strong></div>
    <p class="leise">Welche Flugzeuge seht ihr am Fenster? Antippen zum Sammeln.${linien >= 5 ? " 🏅 Flugzeug-Profi!" : ""}</p>
    <div class="links">${FLUGLINIEN.map(([n, farbe]) => `<button class="linkchip ${spiel[`linie:${n}`] ? "empfohlen" : ""}" style="--farbe:${farbe}" data-aktion="flugspiel" data-schluessel="${esc(`linie:${n}`)}">${spiel[`linie:${n}`] ? "✓ " : ""}${esc(n)}</button>`).join("")}</div>
  </div>
  ${raetsel ? `<div class="karte-box"><h2>📺 Abflugtafel-Rätsel</h2><p class="kind-text">Flug nach <strong>${esc(raetsel.stadt)}</strong> – in welchem Land landet er?</p>
    <div class="quizantworten">${raetsel.optionen.map((l) => `<button class="quizknopf" data-aktion="abflug-raten" data-richtig="${l.name === raetsel.land.name ? "1" : ""}">${l.flagge} ${esc(l.name)}</button>`).join("")}</div>
    <button class="knopf leise" data-aktion="abflug-weiter">Nächster Flug ➜</button></div>` : ""}
  <div class="karte-box"><h2>🎲 Spiele im Flugzeug</h2><p class="kind-text">Malen, Rätsel, Witze, Memory und mehr – alles ohne Internet.</p><button class="knopf" data-aktion="kind-seite" data-seite="spiele">Zu den Spielen ➜</button> <button class="knopf leise" data-aktion="kind-seite" data-seite="tagebuch">Ins Tagebuch malen</button></div>`;
}

function abflugRaetsel() {
  const mitStadt = LAENDER.filter((l) => l.hauptstadt).filter((l, i, a) => a.findIndex((x) => x.name === l.name) === i);
  if (mitStadt.length < 3) return null;
  const n = zustand.abflugRunde ?? 0;
  const [land, ...andere] = mischen(mitStadt, `abflug${n}`);
  return { land, stadt: land.hauptstadt, optionen: mischen([land, ...andere.slice(0, 2)], `opt${n}`) };
}
aktionen["abflug-raten"] = (el) => {
  el.classList.add(el.dataset.richtig ? "richtig" : "falsch");
  if (el.dataset.richtig) setTimeout(() => $(".quizantworten") && aktionen["abflug-weiter"](), 900);
};
aktionen["abflug-weiter"] = () => {
  zustand.abflugRunde = (zustand.abflugRunde ?? 0) + 1;
  neuZeichnen();
};
aktionen["flugspiel"] = async (el) => {
  const s = el.dataset.schluessel;
  const an = !zustandKind().flugspiel?.[s];
  try {
    await kinderSetzen("flugspiel", s, an);
    neuZeichnen();
  } catch (e) {
    alert(e.message);
  }
};

/** Kinder-Bordkarte als Bild (wie eine echte, mit Name, Flug, Sitz). */
export function bordkarteZeichnen() {
  const c = $("#bordkarte");
  const v = naechsterFlug() ?? fluege().at(-1);
  if (!c || !v) return;
  const p = kind();
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(0, 0, 1200, 480, 32);
  ctx.fill();
  ctx.fillStyle = "#0b5394";
  ctx.beginPath();
  ctx.roundRect(0, 0, 1200, 110, [32, 32, 0, 0]);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 46px system-ui, sans-serif";
  ctx.fillText("✈️ BOARDING PASS", 40, 72);
  ctx.font = "28px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(v.titel || "", 1160, 70);
  ctx.textAlign = "left";
  const feld = (titel, wert, x, y, gross = 44) => {
    ctx.fillStyle = "#6b7785";
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillText(titel.toUpperCase(), x, y);
    ctx.fillStyle = "#1c2430";
    ctx.font = `bold ${gross}px system-ui, sans-serif`;
    ctx.fillText(String(wert || "–").slice(0, 22), x, y + gross + 6);
  };
  feld("Passagier", vorname(p) || "Ich", 40, 160);
  feld("Von", kurz(v.von), 40, 280, 72);
  ctx.fillStyle = "#0b5394";
  ctx.font = "56px system-ui";
  ctx.fillText("✈", 230, 350);
  feld("Nach", kurz(v.nach), 330, 280, 72);
  feld("Datum", datumText(v.datum, { day: "2-digit", month: "2-digit", year: "numeric" }), 600, 160, 36);
  feld("Abflug", v.abZeit, 600, 280, 36);
  feld("Sitz", v.sitz || "Fenster 😊", 600, 380, 36);
  // Abreißteil mit „Strichcode“
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = "#c3ccd6";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(900, 120);
  ctx.lineTo(900, 460);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#1c2430";
  let x = 940;
  const name = `${vorname(p)}${v.titel}${v.datum}`;
  for (let i = 0; i < 46 && x < 1160; i++) {
    const breite = 2 + (name.charCodeAt(i % name.length) % 5);
    ctx.fillRect(x, 160, breite, 200);
    x += breite + 3;
  }
  ctx.font = "22px system-ui, sans-serif";
  ctx.fillText("Gute Reise!", 960, 410);
}
async function bordkarteBlob() {
  bordkarteZeichnen();
  return new Promise((ok) => $("#bordkarte").toBlob(ok, "image/png"));
}
aktionen["bordkarte-laden"] = async () => herunterladen(`Bordkarte-${vorname(kind())}.png`, await bordkarteBlob(), "image/png");
aktionen["bordkarte-teilen"] = async () => {
  const blob = await bordkarteBlob();
  const datei = new File([blob], "Bordkarte.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [datei] })) await navigator.share({ files: [datei] }).catch(() => {});
  else herunterladen("Bordkarte.png", blob, "image/png");
};
