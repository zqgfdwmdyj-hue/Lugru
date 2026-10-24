// Unterwegs: Tagesbriefing (mit und ohne KI), Wecker für feste Zeiten („Alle an Bord“, Check-out,
// Abflug …) und Rückweg dorthin,
// Bordkonto und „wer schuldet wem“.
import { zustand, $, esc, datumText, personen, haefen, hafenVon, ausfluegeIn, hatKoord, geld, stationsArt, aktionen, aenderungen, neuZeichnen, dialogOeffnen, dialog, anfrage, heute, jetztMin, herunterladen, einfachesMarkdown, speichern, waehrung } from "./kern.js";
import { zeitZuMin, minZuZeit, dauerText, zahl, startpunkt, zeitplan, istKind, festeZeit, VERKEHRSMITTEL, zimmerVon, familieVon } from "./rechnen.js";
import { kalenderDatei, erinnerungenAm, rueckweg, fahrzeitSchaetzen, bordkonto, ausgleich, inReisewaehrung, AUSGABE_KATEGORIEN, dokumentHinweise } from "./unterwegs-logik.js";

const personName = (id) => personen().find((p) => p.id === id)?.name ?? "?";

/** Welcher Tag ist „heute“ (sonst der gewählte bzw. nächste Tag)? */
export function tagFuerUnterwegs() {
  const liste = haefen();
  return hafenVon(zustand.unterwegsTag) ?? liste.find((h) => h.datum === heute()) ?? liste.find((h) => h.datum > heute()) ?? liste.at(-1) ?? null;
}

const MITNEHMEN = {
  hafen: ["Bordkarte", "Kopie vom Ausweis", "Bargeld in Landeswährung / kleine Dollarscheine", "Handy geladen + Powerbank", "Sonnencreme & Wasser"],
  ort: ["Hotelkarte / Adresse", "Bargeld", "Handy geladen + Powerbank"],
  seetag: ["Bordkarte", "Sonnencreme", "Buch / Spiel für den Pool"],
  tauchen: ["Tauchschein & Logbuch", "Tauchcomputer", "Maske", "Handtuch & Wechselkleidung"],
  schnorcheln: ["Maske & Schnorchel", "Riffschonende Sonnencreme", "UV-Shirt"],
  strand: ["Badesachen", "Strandtuch", "Badeschuhe", "Riffschonende Sonnencreme"],
  natur: ["Feste Schuhe", "Regenjacke", "Mückenschutz", "Genug Wasser"],
  boot: ["Mittel gegen Seekrankheit", "Badesachen", "Windjacke"],
  ski: ["Skipass", "Helm & Skibrille", "Handschuhe", "Sonnencreme (hoher LSF)", "Taschentücher"],
  park: ["Tickets (auch offline)", "Wechselkleidung", "Sonnencreme / Regenjacke", "Proviant & Wasser"],
  tickets: ["Tickets (auch offline)", "Ausweis (für personalisierte Tickets)"],
  essen: ["Reservierungsbestätigung"],
};

/** Unterkunft in der Nacht nach diesem Tag (bzw. am Abreisetag) – oder das Schiff. */
export function unterkunftAm(datum) {
  const r = zustand.reise;
  const h = (r.hotels ?? []).filter((x) => x.status === "gebucht" && x.anreise && x.abreise && x.anreise <= datum && datum <= x.abreise).sort((a, b) => (a.abreise === datum) - (b.abreise === datum))[0];
  if (h) return { id: h.id, name: h.name, hotel: h };
  return (r.art ?? "kreuzfahrt") === "kreuzfahrt" ? { id: "schiff", name: r.schiff || "Schiff", hotel: null } : null;
}

const zimmerText = (z) => `${z.nummer ? `Nr. ${esc(z.nummer)}` : "Zimmer"}${z.deck ? ` · ${/^\d+$/.test(z.deck) ? "Deck/Etage " : ""}${esc(z.deck)}` : ""}${z.kategorie ? ` · ${esc(z.kategorie)}` : ""}${z.personen?.length ? ` – ${esc(z.personen.map(personName).join(", "))}` : ""}`;

/** Infos zur Unterkunft für unterwegs (WLAN, Code, Zeiten) – nur für Mitreisende sichtbar. */
export function unterkunftInfos(u) {
  const h = u?.hotel;
  const zimmer = zimmerVon(zustand.reise, u?.id);
  if (!h && !zimmer.length) return "";
  const zeilen = [
    h?.adresse ? `📍 ${esc(h.adresse)}` : "",
    h?.checkin || h?.checkout ? `🕑 Check-in ${esc(h.checkin || "–")} · Check-out ${esc(h.checkout || "–")}` : "",
    h?.telefon ? `📞 <a href="tel:${esc(h.telefon.replace(/[^\d+]/g, ""))}">${esc(h.telefon)}</a>` : "",
    h?.wlan ? `📶 WLAN <strong>${esc(h.wlan)}</strong>${h.wlanPasswort ? ` · Passwort <code>${esc(h.wlanPasswort)}</code>` : ""}` : "",
    h?.zugang ? `🔑 ${esc(h.zugang)}` : "",
    h?.infos ? `ℹ️ ${esc(h.infos)}` : "",
  ].filter(Boolean);
  return `<div class="unterkunftinfo"><h4>${u.hotel ? "🏨" : "🛳️"} ${esc(u.name)}</h4>
    ${zimmer.length ? `<p class="klein">🛏️ ${zimmer.map(zimmerText).join("<br>🛏️ ")}</p>` : ""}
    ${zeilen.length ? `<p class="klein">${zeilen.join("<br>")}</p>` : ""}</div>`;
}

function verbindungenAm(datum) {
  return (zustand.reise.verbindungen ?? []).filter((v) => v.status !== "verworfen" && (v.datum === datum || v.anDatum === datum)).sort((a, b) => String(a.abZeit).localeCompare(String(b.abZeit)));
}

export function verbindungText(v) {
  const vm = VERKEHRSMITTEL[v.art] ?? VERKEHRSMITTEL.sonstiges;
  return `${vm.name.split(" ")[0]} <strong>${esc(v.abZeit || "–")}</strong> ${esc(v.titel || vm.name)}${v.von || v.nach ? ` · ${esc(v.von || "")} → ${esc(v.nach || "")}` : ""}${v.anZeit ? ` <span class="leise">(an ${esc(v.anZeit)}${v.anDatum && v.anDatum !== v.datum ? ` am ${esc(datumText(v.anDatum))}` : ""})</span>` : ""}${v.terminal ? ` · ${esc(v.terminal)}` : ""}${v.buchungsnr ? ` · <span class="klein">Buchung ${esc(v.buchungsnr)}</span>` : ""}`;
}

function briefingOhneKi(h) {
  const art = stationsArt(h);
  const reise = zustand.reise;
  const start = startpunkt(h, reise.hotels);
  const fest = festeZeit(h, reise);
  const geplant = ausfluegeIn(h.id).filter((a) => a.status === "gebucht" || a.status === "favorit").sort((a, b) => (zeitZuMin(a.beginn) ?? 9999) - (zeitZuMin(b.beginn) ?? 9999));
  const mitnehmen = new Set(MITNEHMEN[art] ?? []);
  for (const a of geplant) for (const x of MITNEHMEN[a.kategorie] ?? []) mitnehmen.add(x);
  const spaeteste = geplant.map((a) => ({ a, z: zeitplan(a, h, reise) })).filter((x) => x.z.zurueck != null).sort((x, y) => y.z.zurueck - x.z.zurueck)[0];
  const verbindungen = verbindungenAm(h.datum);
  if (verbindungen.some((v) => v.art === "flug")) ["Ausweis / Reisepass", "Bordkarte / Boarding-Pass"].forEach((x) => mitnehmen.add(x));
  const fristen = dokumentHinweise(zustand.extras.dokumente, zustand.reise, h.datum).filter((x) => x.stufe !== "info");
  return `
    <div class="zeiten">
      <span>📅 ${esc(datumText(h.datum, { weekday: "long", day: "numeric", month: "long" }))}</span>
      <span>${art === "seetag" ? "🌊 Seetag" : `${art === "hafen" ? "⚓" : "📍"} ${esc(h.name)}${h.land ? `, ${esc(h.land)}` : ""}`}</span>
      ${art === "hafen" ? `<span>Ankunft ${esc(h.ankunft || "–")} · Abfahrt ${esc(h.abfahrt || "–")}</span>` : ""}
      ${fest ? `<span class="wichtig">⏰ ${esc(fest.titel)}${fest.kurz === "Alle an Bord" ? ` ${esc(fest.zeit)}` : ` – spätestens ${esc(fest.zeit)}`}</span>` : ""}
      ${start?.hotel ? `<span>🏨 ${esc(start.name)}</span>` : ""}
    </div>
    <div id="unterwegsWetter" class="wetter"></div>
    ${verbindungen.length ? `<h4>Unterwegs mit</h4><ul class="ablauf">${verbindungen.map((v) => `<li>${verbindungText(v)}</li>`).join("")}</ul>` : ""}
    ${verbindungen.some((v) => v.art === "flug") ? `<p><button class="knopf leise" data-aktion="zum-flug">✈️ Flug-Tag: Zeitplan, Lounge, Handgepäck, Flugstatus</button></p>` : ""}
    ${geplant.length ? `<h4>Ablauf</h4><ul class="ablauf">${geplant.map((a) => {
      const z = zeitplan(a, h, reise);
      return `<li><strong>${esc(a.beginn || "–")}</strong> ${esc(a.titel)}${a.status === "favorit" ? ' <span class="klein leise">(noch nicht gebucht)</span>' : ""}${z.zurueck != null ? ` <span class="klein leise">– zurück ca. ${minZuZeit(z.zurueck)}</span>` : ""}${z.puffer != null && z.puffer < 60 && a.quelle !== "schiff" ? ` <span class="warnung klein">⚠️ Puffer ${z.puffer < 0 ? "fehlt" : dauerText(z.puffer)}</span>` : ""}</li>`;
    }).join("")}</ul>` : `<p class="leise">Für diesen Tag ist noch nichts gebucht.</p>`}
    ${fest && (art === "hafen" || geplant.length) ? `<p class="wichtig">${fest.kurz === "Alle an Bord" ? "Spätestens zurück am Schiff" : `Spätestens zurück für „${esc(fest.kurz)}“`}: <strong>${minZuZeit(fest.min - 30)}</strong> (30 Min. Reserve vor ${esc(fest.zeit)})${spaeteste ? ` – letzter Programmpunkt endet ca. ${minZuZeit(spaeteste.z.zurueck)}` : ""}.</p>` : ""}
    ${art !== "seetag" || reise.art === "kreuzfahrt" ? unterkunftInfos(unterkunftAm(h.datum)) : ""}
    <h4>Mitnehmen</h4><p class="klein">${[...mitnehmen].map(esc).join(" · ")}</p>
    ${fristen.length ? `<h4>Erledigen</h4><ul class="hinweise">${fristen.map((f) => `<li class="${f.stufe}">${esc(f.text)}</li>`).join("")}</ul>` : ""}`;
}

export function unterwegsAnsicht() {
  const tage = haefen();
  const h = tagFuerUnterwegs();
  const briefing = h ? zustand.extras.briefings?.[h.id] : null;
  return `
    <div class="karte-box">
      <div class="zeile"><h3>☀️ Tagesbriefing</h3><span class="platz"></span>
        ${tage.length ? `<select data-aktion="unterwegs-tag" aria-label="Tag">${tage.map((t) => `<option value="${esc(t.id)}" ${t.id === h?.id ? "selected" : ""}>${esc(datumText(t.datum))} – ${stationsArt(t) === "seetag" ? "Seetag" : esc(t.name)}${t.datum === heute() ? " (heute)" : ""}</option>`).join("")}</select>` : ""}
      </div>
      ${h ? briefingOhneKi(h) : `<p class="leise">Noch keine Tage eingetragen.</p>`}
      ${h && zustand.info.ki ? `<div class="kibriefing">${briefing ? `<div class="briefingtext">${einfachesMarkdown(briefing.text)}</div><p class="klein leise">KI-Briefing von ${esc(new Date(briefing.zeit).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }))}</p>` : ""}
        <button class="knopf ${briefing ? "leise" : ""}" data-aktion="ki-briefing" data-id="${esc(h.id)}" data-neu="${briefing ? "1" : ""}">✨ ${briefing ? "KI-Briefing neu erstellen" : "KI-Briefing mit aktuellen Tipps"}</button> <span class="klein leise" id="briefingStatus"></span></div>` : ""}
    </div>

    <div class="karte-box">
      <h3>⏰ ${istKreuzfahrtReise() ? "Alle-an-Bord-Wecker" : "Wecker für feste Zeiten"}</h3>
      <p class="leise klein">Am zuverlässigsten über den Kalender des Handys: Die Erinnerungen klingeln auch ohne Internet und wenn die App geschlossen ist –
      für „Alle an Bord“, Check-out, eigene feste Zeiten, Abflüge/Züge/Fähren und gebuchte Ausflüge und Reservierungen.
      ${istKreuzfahrtReise() ? "Uhrzeiten gelten als <strong>Bordzeit</strong> – prüft an Bord, ob das Handy dieselbe Zeit zeigt (Zeitzonen!)." : "Uhrzeiten gelten als Ortszeit."}</p>
      <div class="formular drei">
        <label>Erinnern vor festen Zeiten<select id="weckerVorher"><option value="90,30">90 und 30 Min.</option><option value="120,60,30">120, 60 und 30 Min.</option><option value="60,15">60 und 15 Min.</option></select></label>
        <label>Gebuchte Ausflüge<select id="weckerAusflug"><option value="45">45 Min. vorher</option><option value="30">30 Min. vorher</option><option value="60">60 Min. vorher</option><option value="">keine Erinnerung</option></select></label>
      </div>
      <div class="zeile">
        <button class="knopf" data-aktion="wecker-kalender">📅 Erinnerungen in den Kalender</button>
        <button class="knopf leise" data-aktion="wecker-app">🔔 ${weckerAn() ? "Hinweise in der App sind an" : "Zusätzlich Hinweise in der App"}</button>
      </div>
      ${h && festeZeit(h, zustand.reise) ? `<h4>🧭 Schaffen wir es rechtzeitig? <span class="leise klein">(${esc(festeZeit(h, zustand.reise).titel)})</span></h4>
        <p class="leise klein">Nimmt deinen Standort (GPS), berechnet den Weg ${festeZeit(h, zustand.reise).kurz === "Alle an Bord" ? "zum Schiff" : "zum Ziel"} und sagt, wann ihr spätestens losmüsst – mit 20 Min. Reserve.</p>
        <div class="zeile"><button class="knopf" data-aktion="rueckweg" data-id="${esc(h.id)}">📍 Rückweg jetzt prüfen</button><label class="haken klein"><input type="checkbox" id="rueckwegFuss"> zu Fuß</label></div>
        <div id="rueckwegErgebnis"></div>` : ""}
    </div>

    ${ticketsBox(h)}
    <div class="karte-box zeile">
      <span>💳 Unterwegs etwas bezahlt?</span><span class="platz"></span>
      <button class="knopf" data-aktion="ausgabe-neu" data-ort="bord">+ Ausgabe</button>
      <button class="link" data-aktion="ansicht" data-ziel="ausgaben">${istKreuzfahrtReise() ? "Bordkonto" : "Urlaubskasse"} &amp; Abrechnung →</button>
    </div>`;
}

/** Tickets & Treffpunkte des Tages: gebuchte Ausflüge mit Buchungsnr., Treffpunkt und Link, Verbindungen mit Sitz/Terminal. */
function ticketsBox(h) {
  if (!h) return "";
  const gebucht = zustand.reise.ausfluege.filter((a) => a.hafenId === h.id && a.status === "gebucht").sort((x, y) => String(x.beginn || "99").localeCompare(String(y.beginn || "99")));
  const verb = verbindungenAm(h.datum);
  if (!gebucht.length && !verb.length) return "";
  return `<div class="karte-box">
    <h3>🎟️ Tickets &amp; Treffpunkte – ${esc(datumText(h.datum))}</h3>
    <ul class="tickets">
      ${verb.map((v) => `<li>${verbindungText(v)}${[v.buchungsnr && `Buchung <strong>${esc(v.buchungsnr)}</strong>`, v.terminal && esc(v.terminal), v.sitz && `Sitz ${esc(v.sitz)}`].filter(Boolean).length ? `<div class="klein">${[v.buchungsnr && `Buchung <strong>${esc(v.buchungsnr)}</strong>`, v.terminal && esc(v.terminal), v.sitz && `Sitz ${esc(v.sitz)}`].filter(Boolean).join(" · ")}</div>` : ""}</li>`).join("")}
      ${gebucht.map((a) => `<li><strong>${esc(a.beginn || "–")}</strong> ${esc(a.titel)}
        <div class="klein">${[a.code && `Buchung <strong>${esc(a.code)}</strong>`, a.ziel?.name && `📍 Treffpunkt: ${esc(a.ziel.name)}`, a.oeffnungszeiten && `🕑 ${esc(a.oeffnungszeiten)}`].filter(Boolean).join(" · ") || "<span class='leise'>Keine Buchungsnummer oder kein Treffpunkt eingetragen</span>"}
        ${a.ziel && Number.isFinite(a.ziel.lat) ? ` · <a href="https://www.google.com/maps/dir/?api=1&destination=${a.ziel.lat},${a.ziel.lng}" target="_blank" rel="noopener">Weg ↗</a>` : ""}${a.link ? ` · <a href="${esc(a.link)}" target="_blank" rel="noopener">Angebot ↗</a>` : ""}</div></li>`).join("")}
    </ul>
    <p class="klein leise">Tickets als Datei (PDF, Foto) liegen unter „Vorbereitung → Dokumente“.</p>
  </div>`;
}

/** Ausgaben unterwegs: Urlaubskasse/Bordkonto, Abrechnung zwischen Personen/Familien, alle Ausgaben (im Bereich „Kosten“). */
export function ausgabenAnsicht() {
  const k = bordkonto(zustand.extras.ausgaben, zustand.reise);
  const familien = (zustand.reise.familien ?? []).length > 1;
  const nachFamilie = familien && zustand.ausgleichNachFamilie !== false;
  const a = ausgleich(zustand.extras.ausgaben, zustand.reise, { nachFamilie });
  const einheitName = (id) => (id.startsWith("person:") ? personName(id.slice(7)) : (zustand.reise.familien ?? []).find((f) => f.id === id)?.name ?? personName(id));
  const ausgaben = [...zustand.extras.ausgaben].sort((x, y) => String(y.datum).localeCompare(String(x.datum)) || String(y.erstellt).localeCompare(String(x.erstellt)));
  const zeigeAlle = zustand.alleAusgaben;
  return `
    <div class="karte-box">
      <div class="zeile"><h3>💳 ${istKreuzfahrtReise() ? "Bordkonto" : "Urlaubskasse"}</h3><span class="platz"></span><button class="knopf" data-aktion="ausgabe-neu" data-ort="bord">+ ${istKreuzfahrtReise() ? "Ausgabe an Bord" : "Ausgabe"}</button></div>
      <div class="kacheln">
        <div class="kachel"><span>Ausgegeben</span><strong>${geld(k.summe)}</strong></div>
        <div class="kachel"><span>Budget</span><strong><input class="budget" data-aktion="bord-budget" inputmode="decimal" value="${esc(zustand.reise.bordBudget ?? "")}" placeholder="z. B. 500" aria-label="Budget"></strong></div>
        <div class="kachel ${k.rest != null && k.rest < 0 ? "rot" : ""}"><span>${k.rest != null && k.rest < 0 ? "Über Budget" : "Noch übrig"}</span><strong>${k.rest != null ? geld(Math.abs(k.rest)) : "–"}</strong></div>
      </div>
      ${k.budget ? `<div class="fortschritt ${k.summe > k.budget ? "voll" : ""}"><span style="width:${Math.min(100, Math.round((k.summe / k.budget) * 100))}%"></span></div>` : ""}
      ${k.anzahl ? `<div class="zwei-spalten">
        <div><h4>Je Kategorie</h4><table class="klein"><tbody>${Object.entries(k.jeKategorie).sort((x, y) => y[1] - x[1]).map(([kat, s]) => `<tr><td>${esc(AUSGABE_KATEGORIEN[kat] ?? kat)}</td><td class="zahl">${geld(s)}</td></tr>`).join("")}</tbody></table></div>
        <div><h4>Je Tag</h4><table class="klein"><tbody>${Object.entries(k.jeTag).sort().map(([d, s]) => `<tr><td>${esc(d.includes("-") ? datumText(d) : d)}</td><td class="zahl">${geld(s)}</td></tr>`).join("")}</tbody></table></div>
      </div>` : `<p class="leise klein">Tipp: Belege an Bord gleich abfotografieren und hier eintragen – so gibt es am Ende keine Überraschung auf der Abrechnung.</p>`}
    </div>

    <div class="karte-box">
      <div class="zeile"><h3>🤝 Kosten teilen – wer schuldet wem?</h3><span class="platz"></span><button class="knopf" data-aktion="ausgabe-neu" data-ort="land">+ Ausgabe</button></div>
      <p class="leise klein">Bei jeder Ausgabe angeben, wer bezahlt hat und für wen. Ohne Auswahl wird auf alle Erwachsenen verteilt (Kinder zahlen nicht mit).</p>
      ${familien ? `<label class="haken klein"><input type="checkbox" data-aktion="ausgleich-familie" ${nachFamilie ? "checked" : ""}> Zwischen Familien abrechnen (statt Person an Person)</label>` : ""}
      ${a.zahlungen.length ? `<ul class="ausgleich">${a.zahlungen.map((z) => `<li><strong>${esc(einheitName(z.von))}</strong> → <strong>${esc(einheitName(z.an))}</strong>: ${geld(z.betrag)}</li>`).join("")}</ul>` : a.summe ? `<p>✅ Alles ausgeglichen.</p>` : ""}
      ${a.summe ? `<table class="klein"><tbody>${Object.entries(a.saldo).filter(([, v]) => v).map(([id, v]) => `<tr><td>${esc(einheitName(id))}</td><td class="zahl ${v < 0 ? "rot" : "gruen"}">${v > 0 ? "+" : ""}${geld(v)}</td></tr>`).join("")}</tbody></table>` : ""}
    </div>

    <div class="karte-box">
      <div class="zeile"><h3>Alle Ausgaben (${ausgaben.length})</h3><span class="platz"></span>${zustand.reise.waehrung !== "USD" ? `<label class="klein">1 $ = <input class="kurs" data-aktion="usd-kurs" inputmode="decimal" value="${esc(String(zustand.reise.kurse?.USD ?? 0.89).replace(".", ","))}"> ${esc(waehrung())}</label>` : ""}</div>
      ${ausgaben.length ? `<div class="tabelle"><table><thead><tr><th>Datum</th><th>Was</th><th>Bezahlt von</th><th>Für</th><th class="zahl">Betrag</th><th></th></tr></thead><tbody>
        ${(zeigeAlle ? ausgaben : ausgaben.slice(0, 15)).map((x) => `<tr><td class="klein">${esc(datumText(x.datum))}</td><td>${esc(x.titel)} <div class="klein leise">${esc(AUSGABE_KATEGORIEN[x.kategorie] ?? "")}${x.ort === "bord" ? " · an Bord" : ""}${x.buchung ? ` · 🔗 ${esc(buchungName(x.buchung))}` : ""}</div></td>
          <td class="klein">${x.bezahltVon ? esc(personName(x.bezahltVon)) : "–"}</td><td class="klein">${x.fuer?.length ? esc(x.fuer.map(personName).join(", ")) : x.bezahltVon ? "alle Erw." : "–"}</td>
          <td class="zahl">${geld(inReisewaehrung(x, zustand.reise))}${x.waehrung && x.waehrung !== waehrung() ? `<div class="klein leise">${esc(String(x.betrag).replace(".", ","))} ${esc(x.waehrung)}</div>` : ""}</td>
          <td><button class="link" data-aktion="ausgabe-bearbeiten" data-id="${esc(x.id)}">Bearbeiten</button></td></tr>`).join("")}
      </tbody></table></div>${!zeigeAlle && ausgaben.length > 15 ? `<button class="link" data-aktion="alle-ausgaben">Alle ${ausgaben.length} zeigen</button>` : ""}` : `<p class="leise">Noch keine Ausgaben.</p>`}
    </div>`;
}

/** Nach dem Zeichnen: Wetter für den Tag nachladen. */
export async function nachUnterwegs() {
  const h = tagFuerUnterwegs();
  const el = $("#unterwegsWetter");
  if (!h || !el) return;
  const ort = stationsArt(h) === "seetag" ? null : startpunkt(h, zustand.reise.hotels);
  if (!hatKoord(ort) || !h.datum) return;
  const tage = (new Date(`${h.datum}T12:00:00`) - new Date()) / 86400_000;
  if (tage > 15 || tage < -1) return;
  try {
    const p = new URLSearchParams({ latitude: ort.lat, longitude: ort.lng, daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max", timezone: "auto", start_date: h.datum, end_date: h.datum });
    const d = (await fetch(`https://api.open-meteo.com/v1/forecast?${p}`).then((x) => x.json())).daily;
    if (!d?.time?.length || !$("#unterwegsWetter")) return;
    const c = d.weather_code[0];
    const symbol = c === 0 ? "☀️" : c <= 2 ? "🌤️" : c <= 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 67 ? "🌧️" : c <= 77 ? "🌨️" : c <= 82 ? "🌦️" : "⛈️";
    const text = `${symbol} ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])} °C, Regen ${d.precipitation_probability_max[0] ?? "–"} %, Wind ${Math.round(d.wind_speed_10m_max[0])} km/h, UV ${Math.round(d.uv_index_max[0] ?? 0)}`;
    $("#unterwegsWetter").textContent = text;
    $("#unterwegsWetter").dataset.text = text;
  } catch {}
}

aenderungen["ausgleich-familie"] = (el) => {
  zustand.ausgleichNachFamilie = el.checked;
  neuZeichnen();
};
const istKreuzfahrtReise = () => (zustand.reise?.art ?? "kreuzfahrt") === "kreuzfahrt";

aenderungen["unterwegs-tag"] = (el) => {
  zustand.unterwegsTag = el.value;
  neuZeichnen();
};

aktionen["ki-briefing"] = async (el) => {
  el.disabled = true;
  $("#briefingStatus").textContent = "Die KI schreibt das Briefing (mit Websuche, ca. 30–60 Sek.) …";
  try {
    const b = await anfrage(`/api/reisen/${zustand.reise.id}/briefing`, { method: "POST", body: { hafenId: el.dataset.id, neu: Boolean(el.dataset.neu), wetter: $("#unterwegsWetter")?.dataset.text ?? "" } });
    zustand.extras.briefings[el.dataset.id] = b;
    neuZeichnen();
  } catch (e) {
    $("#briefingStatus").textContent = e.message;
    el.disabled = false;
  }
};

// ---------- Wecker ----------

const WECKER = "reiseplaner:wecker";
const weckerAn = () => {
  try {
    return localStorage.getItem(WECKER) === "an" && "Notification" in window && Notification.permission === "granted";
  } catch {
    return false;
  }
};

aktionen["wecker-kalender"] = () => {
  const anBord = $("#weckerVorher").value.split(",").map(Number);
  const ausfluege = $("#weckerAusflug").value === "" ? null : Number($("#weckerAusflug").value);
  const { text, anzahl } = kalenderDatei(zustand.reise, { anBord, ausfluege, dokumente: zustand.extras.dokumente });
  if (!anzahl) return alert("Keine Termine gefunden – feste Zeiten („Alle an Bord“, Check-out, Abflug …) eintragen und Ausflüge als „Gebucht“ markieren.");
  herunterladen(`${zustand.reise.name}-Erinnerungen.ics`, text, "text/calendar");
  alert(`${anzahl} Termine mit Erinnerungen gespeichert.\n\niPhone: Datei öffnen → „Alle hinzufügen“.\nAndroid: Datei mit Google Kalender öffnen.\n\nWenn sich Zeiten ändern: alte Termine löschen und neu laden.`);
};

let weckerTimer = [];
/** Plant Hinweise für heute, solange die App geöffnet ist. */
export function weckerPlanen() {
  weckerTimer.forEach(clearTimeout);
  weckerTimer = [];
  if (!weckerAn() || !zustand.reise) return;
  const jetzt = jetztMin();
  for (const e of erinnerungenAm(zustand.reise, heute())) {
    const inMin = e.zeit - jetzt;
    if (inMin < 0 || inMin > 24 * 60) continue;
    weckerTimer.push(setTimeout(async () => {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) reg.showNotification("Reiseplaner", { body: e.text, icon: "/icon.svg", tag: e.text, requireInteraction: true });
        else new Notification("Reiseplaner", { body: e.text });
      } catch {}
    }, inMin * 60_000));
  }
}

aktionen["wecker-app"] = async () => {
  if (!("Notification" in window)) return alert("Dieser Browser kann keine Hinweise anzeigen. Bitte die Kalender-Erinnerungen nutzen.");
  if (weckerAn()) {
    if (!confirm("Hinweise in der App ausschalten?")) return;
    localStorage.setItem(WECKER, "aus");
  } else {
    const erlaubnis = await Notification.requestPermission();
    if (erlaubnis !== "granted") return alert("Hinweise wurden nicht erlaubt. Die Kalender-Erinnerungen funktionieren trotzdem.");
    localStorage.setItem(WECKER, "an");
    alert("Hinweise sind an – solange der Reiseplaner geöffnet ist (auch im Hintergrund). Für Erinnerungen bei geschlossener App bitte zusätzlich den Kalender nutzen.");
  }
  weckerPlanen();
  neuZeichnen();
};

aktionen["rueckweg"] = async (el) => {
  const tag = hafenVon(el.dataset.id);
  const fest = festeZeit(tag, zustand.reise);
  const h = fest?.ort && hatKoord(fest.ort) ? fest.ort : unterkunftAm(tag.datum)?.hotel && hatKoord(unterkunftAm(tag.datum).hotel) ? unterkunftAm(tag.datum).hotel : tag;
  const ziel = $("#rueckwegErgebnis");
  if (!hatKoord(h)) return (ziel.innerHTML = `<p class="warnung">Für „${esc(fest?.titel ?? tag.name)}“ fehlt der Kartenpunkt (beim Tag, der Unterkunft oder der Verbindung eintragen).</p>`);
  if (!navigator.geolocation) return (ziel.innerHTML = `<p class="warnung">Standort wird von diesem Browser nicht unterstützt.</p>`);
  ziel.innerHTML = `<p class="leise">Standort wird bestimmt …</p>`;
  const zuFuss = $("#rueckwegFuss").checked;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const ich = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      let weg = null;
      let quelle = "Straße";
      try {
        weg = await anfrage(`/api/route?von=${ich.lat},${ich.lng}&nach=${h.lat},${h.lng}&modus=${zuFuss ? "fuss" : "auto"}`);
      } catch {
        weg = fahrzeitSchaetzen(ich, h, zuFuss);
        quelle = "geschätzt (Luftlinie, ohne Netz)";
      }
      const r = rueckweg(fest, jetztMin(), zuFuss ? weg.min : weg.min * 1.2 + 10); // Auto: Verkehr + Taxi finden
      if (!r) return (ziel.innerHTML = `<p class="warnung">Für diesen Tag ist keine feste Zeit eingetragen.</p>`);
      const farbe = { ok: "gruen", knapp: "gelb", los: "rot", zuSpaet: "rot" }[r.status];
      const text = {
        ok: `Alles entspannt – ihr müsst spätestens um <strong>${r.losUm}</strong> los (noch ${dauerText(r.restMin)}).`,
        knapp: `Bald aufbrechen: spätestens um <strong>${r.losUm}</strong> (in ${dauerText(r.restMin)}).`,
        los: `<strong>Jetzt losfahren!</strong> Mit Reserve hättet ihr um ${r.losUm} los gemusst.`,
        zuSpaet: fest.kurz === "Alle an Bord" ? `<strong>Sehr knapp oder zu spät!</strong> Sofort los und die Reederei/Hafenagentur anrufen (Nummer auf der Bordkarte bzw. im Tagesprogramm).` : `<strong>Sehr knapp oder zu spät!</strong> Sofort los und Bescheid geben (Airline, Vermieter, Fähre …).`,
      }[r.status];
      ziel.innerHTML = `<div class="ampel ${farbe}"><p>${text}</p><p class="klein">Weg ${fest.kurz === "Alle an Bord" ? "zum Schiff" : `nach ${esc(h.name ?? "Ziel")}`}: ca. ${Math.round(weg.min)} Min. (${String((weg.km ?? 0).toFixed(1)).replace(".", ",")} km, ${quelle}) · ${esc(fest.kurz)} ${esc(r.zielZeit)} · Standort ±${Math.round(pos.coords.accuracy)} m</p>
        <a class="knopf leise" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${ich.lat},${ich.lng}&destination=${h.lat},${h.lng}&travelmode=${zuFuss ? "walking" : "driving"}">Weg in Google Maps ↗</a></div>`;
    },
    (e) => {
      ziel.innerHTML = `<p class="warnung">Standort nicht verfügbar (${esc(e.message)}). Bitte Standortfreigabe für den Browser erlauben.</p>`;
    },
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
  );
};

// ---------- Ausgaben ----------

/** Gebuchte Posten, mit denen eine Ausgabe verknüpft werden kann. */
function buchungsAuswahl() {
  const r = zustand.reise;
  return [
    ...(r.ausfluege ?? []).filter((a) => a.status === "gebucht").map((a) => [`ausflug:${a.id}`, `Ausflug: ${a.titel}`]),
    ...(r.hotels ?? []).filter((x) => x.status === "gebucht").map((x) => [`hotel:${x.id}`, `Unterkunft: ${x.name}`]),
    ...(r.zimmer ?? []).filter((z) => z.unterkunft === "schiff" && zahl(z.preis)).map((z) => [`kabine:${z.id}`, `Kabine ${z.nummer || ""}`]),
    ...(r.verbindungen ?? []).filter((v) => v.status === "gebucht").map((v) => [`verbindung:${v.id}`, `Verbindung: ${v.titel || `${v.von} → ${v.nach}`}`]),
    ...(r.kosten ?? []).filter((k) => k.status === "gebucht").map((k) => [`kosten:${k.id}`, `Kosten: ${k.titel || "Posten"}`]),
  ];
}
export const buchungName = (schluessel) => buchungsAuswahl().find(([k]) => k === schluessel)?.[1] ?? "Buchung (entfernt)";

function ausgabeDialog(id, vorlage = {}) {
  const x = id ? zustand.extras.ausgaben.find((y) => y.id === id) : { datum: tagFuerUnterwegs()?.datum ?? heute(), waehrung: waehrung(), kategorie: vorlage.ort === "bord" ? "getraenke" : "essen", fuer: [], bezahltVon: personen().find((p) => p.userId === zustand.ich?.id)?.id ?? "", ...vorlage };
  const erwachsene = personen().filter((p) => !istKind(p));
  dialogOeffnen(`<form method="dialog" class="formular" id="ausgabeForm">
    <h3>${id ? "Ausgabe bearbeiten" : x.ort === "bord" ? "Ausgabe an Bord" : "Ausgabe"}</h3>
    <div class="formular drei">
      <label>Was<input name="titel" value="${esc(x.titel ?? "")}" maxlength="200" placeholder="z. B. Cocktails Pooldeck" required></label>
      <label>Betrag<input name="betrag" inputmode="decimal" value="${esc(x.betrag != null ? String(x.betrag).replace(".", ",") : "")}" required></label>
      <label>Währung<select name="waehrung">${[...new Set([waehrung(), "EUR", "USD"])].map((w) => `<option ${x.waehrung === w ? "selected" : ""}>${w}</option>`).join("")}</select></label>
      <label>Datum<input type="date" name="datum" value="${esc(x.datum ?? "")}"></label>
      <label>Kategorie<select name="kategorie">${Object.entries(AUSGABE_KATEGORIEN).map(([k, t]) => `<option value="${k}" ${x.kategorie === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label>Wo<select name="ort"><option value="bord" ${x.ort === "bord" ? "selected" : ""}>${istKreuzfahrtReise() ? "An Bord (Bordkonto)" : "Urlaubskasse"}</option><option value="land" ${x.ort !== "bord" ? "selected" : ""}>${istKreuzfahrtReise() ? "An Land / sonst" : "Sonstiges (nur abrechnen)"}</option></select></label>
    </div>
    <label>Zahlung für eine Buchung? <select name="buchung"><option value="">– nein, zusätzliche Ausgabe –</option>${buchungsAuswahl().map(([k, t]) => `<option value="${esc(k)}" ${x.buchung === k ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
    <p class="klein leise">Verknüpfte Zahlungen zählen bei der Buchung als „bezahlt“ und nicht zusätzlich – so wird nichts doppelt gerechnet.</p>
    <label>Bezahlt von<select name="bezahltVon"><option value="">– niemand Bestimmtes (nur Bordkonto) –</option>${personen().map((p) => `<option value="${esc(p.id)}" ${x.bezahltVon === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    <fieldset><legend>Für wen? (leer = alle Erwachsenen: ${esc(erwachsene.map((p) => p.name).join(", "))})</legend>
      <div class="teilnehmer">${personen().map((p) => `<label class="haken"><input type="checkbox" name="fuer" value="${esc(p.id)}" ${(x.fuer ?? []).includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("")}</div>
    </fieldset>
    <div class="zeile">
      <span class="platz"></span>
      <button type="button" class="knopf leise" data-aktion="dialog-zu">Abbrechen</button>
      <button class="knopf" value="ok">Speichern</button>
    </div>
    ${id ? `<details class="gefahr-klein"><summary class="klein leise">Weitere Aktionen</summary><button type="button" class="knopf gefahr" data-aktion="ausgabe-loeschen" data-id="${esc(id)}">Löschen</button></details>` : ""}
  </form>`);
  $("#ausgabeForm").addEventListener("submit", async (ev) => {
    const f = new FormData(ev.target);
    const daten = { titel: f.get("titel"), betrag: zahl(f.get("betrag")), waehrung: f.get("waehrung"), datum: f.get("datum"), kategorie: f.get("kategorie"), ort: f.get("ort"), bezahltVon: f.get("bezahltVon"), fuer: f.getAll("fuer"), buchung: f.get("buchung") };
    try {
      const neu = await anfrage(`/api/reisen/${zustand.reise.id}/extras/ausgaben${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: daten });
      const l = zustand.extras.ausgaben;
      const i = l.findIndex((y) => y.id === neu.id);
      if (i >= 0) l[i] = neu;
      else l.push(neu);
      neuZeichnen();
    } catch (e) {
      alert(e.message);
    }
  });
}

aktionen["ausgabe-neu"] = (el) => ausgabeDialog(null, { ort: el.dataset.ort });
aktionen["ausgabe-bearbeiten"] = (el) => ausgabeDialog(el.dataset.id);
aktionen["ausgabe-loeschen"] = async (el) => {
  if (!confirm("Ausgabe löschen?")) return;
  await anfrage(`/api/reisen/${zustand.reise.id}/extras/ausgaben/${el.dataset.id}`, { method: "DELETE" });
  zustand.extras.ausgaben = zustand.extras.ausgaben.filter((y) => y.id !== el.dataset.id);
  dialog().close();
  neuZeichnen();
};
aktionen["alle-ausgaben"] = () => {
  zustand.alleAusgaben = true;
  neuZeichnen();
};
aenderungen["bord-budget"] = (el) => {
  zustand.reise.bordBudget = zahl(el.value);
  speichern();
  neuZeichnen();
};
aenderungen["usd-kurs"] = (el) => {
  const k = zahl(el.value);
  if (k == null || k <= 0) return alert("Bitte einen gültigen Kurs eingeben, z. B. 0,89.");
  zustand.reise.kurse = { ...(zustand.reise.kurse ?? {}), USD: k };
  speichern();
  neuZeichnen();
};


aktionen["zum-flug"] = () => aktionen.ansicht({ dataset: { ziel: "flug" } });
