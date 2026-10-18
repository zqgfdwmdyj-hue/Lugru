// Kinder-Bereich: Countdown mit Türchen, Reisepass mit Stempeln, Abzeichen, Insel-Steckbrief,
// Wörterbuch, „Wo ist unser Schiff?“, Quiz, Schatzsuche, Tiere-Bingo mit Fotos, Wartezeit-Spiele,
// Tagebuch mit Malen, Packliste mit Bildern, Sparschwein, Kinderprogramm und Sicherheitskarte.
import { zustand, $, esc, datumText, haefen, ausfluegeIn, stationsArt, aktionen, aenderungen, neuZeichnen, anfrage, heute, fotoHochladen, fotoUrl, geld, speichern, herunterladen, dialogOeffnen } from "./kern.js";
import { countdown, reiseZeitraum, datumPlus, tageZwischen, vorlageEintraege } from "./unterwegs-logik.js";
import { tiereFuer, tiereDerReise, regionFuer } from "./tiere.js";
import { tierBild } from "./tierbilder.js";
import { zeitZuMin, minZuZeit, festeZeit, zimmerVon, istKind, entfernungKm } from "./rechnen.js";
import { unterkunftAm } from "./unterwegs.js";
import { kinder, kind, vorname, zustandKind, istSeetag, kinderSetzen } from "./kinderbasis.js";
import { flughafenKinderSeite, bordkarteZeichnen, fluege } from "./flug.js";
import { geschichteBox, stimmeBox, rankingBox, kreativSeite, postkarteZeichnen, memoryBox, puzzleBox, wimmelBox, challengeBox, rueckblickBox, zahlenSpassBox, lieblingeHtml } from "./kinderextra.js";
import { LAENDER, landFuer, SPRACHEN, WOERTER, schatzAufgaben, RAETSEL, WITZE, ICH_SEHE_FARBEN, WER_FINDET, PANTOMIME, ABZEICHEN, packBild, mischen } from "./kinderdaten.js";

const BILD = { tauchen: "🤿", schnorcheln: "🐠", strand: "🏖️", boot: "⛵", natur: "🥾", sport: "🏄", stadt: "🏛️", tiere: "🐒", kultur: "🎭", essen: "🍽️", bord: "🛳️", ausflug: "🗺️", tickets: "🎟️", park: "🎢", ski: "⛷️", kinderclub: "🧒" };
const SEITEN = { heute: "☀️ Heute", flughafen: "✈️ Flughafen", pass: "🛂 Pass & Abzeichen", entdecken: "🔭 Entdecken", spiele: "🎲 Spiele", tagebuch: "📔 Tagebuch", kreativ: "🎨 Basteln & Sammeln", abend: "🌙 Abend", sachen: "🎒 Meine Sachen", eltern: "👨‍👩‍👧 Für Eltern" };
const STIMMUNGEN = ["😄", "🙂", "😐", "🙁", "😢"];

// ---------- Kennzahlen, Stempel, Abzeichen ----------

/** Besuchte Orte (Stempel): vergangene und heutige Tage an Land, jeder Ort einmal. */
export function stempelDerReise(reise, bisDatum) {
  const liste = [];
  const gesehen = new Set();
  for (const h of [...(reise.haefen ?? [])].sort((a, b) => String(a.datum).localeCompare(String(b.datum)))) {
    if (istSeetag(h) || !h.name || gesehen.has(h.name)) continue;
    gesehen.add(h.name);
    liste.push({ tag: h, land: landFuer(h), besucht: Boolean(h.datum) && h.datum <= bisDatum });
  }
  // Flughäfen bekommen einen eigenen ✈️-Stempel (zählen nicht als Land)
  for (const v of (reise.verbindungen ?? []).filter((x) => x.art === "flug" && x.status !== "verworfen" && x.datum)) {
    for (const [name, datum] of [[v.von, v.datum], [v.nach, v.anDatum || v.datum]]) {
      const n = `✈️ ${String(name ?? "").trim()}`;
      if (!name || gesehen.has(n)) continue;
      gesehen.add(n);
      liste.push({ tag: { name: String(name).replace(/\s*\([A-Z]{3}\)$/, ""), datum, land: "" }, land: null, flagge: "✈️", flughafen: true, besucht: datum <= bisDatum });
    }
  }
  return liste.sort((a, b) => String(a.tag.datum).localeCompare(String(b.tag.datum)));
}

function kennzahlen(p = kind()) {
  const r = zustand.reise;
  const stempel = stempelDerReise(r, heute()).filter((s) => s.besucht);
  const k = zustandKind(p);
  return {
    stempel: stempel.length,
    laender: new Set(stempel.map((s) => s.land?.name ?? s.tag.land).filter(Boolean)).size,
    seetage: haefen().filter((h) => istSeetag(h) && h.datum <= heute()).length,
    tiere: Object.keys(zustand.extras.tiere ?? {}).length,
    schatz: Object.keys(zustand.extras.schatz ?? {}).length,
    quizPerfekt: Object.values(k.quiz ?? {}).some((x) => x >= 5),
    tagebuch: Object.keys(k.tagebuch ?? {}).length,
  };
}

const verdient = (a, p = kind()) => Boolean(zustandKind(p).abzeichen?.[a.id]) || Boolean(a.auto?.(kennzahlen(p)));

function stempelSvg(s, i) {
  const farben = ["#c62828", "#1565c0", "#2e7d32", "#6a1b9a", "#ef6c00", "#00838f"];
  const f = farben[i % farben.length];
  const drehung = ((i * 37) % 21) - 10;
  const name = s.tag.name.length > 16 ? `${s.tag.name.slice(0, 15)}…` : s.tag.name;
  return `<div class="stempel ${s.besucht ? "" : "offen"}" style="--farbe:${f};transform:rotate(${s.besucht ? drehung : 0}deg)">
    ${s.besucht ? `<span class="stempel-flagge">${s.flagge ?? s.land?.flagge ?? "📍"}</span><span class="stempel-name">${esc(name)}</span><span class="stempel-datum">${esc(datumText(s.tag.datum, { day: "2-digit", month: "2-digit", year: "2-digit" }))}</span>` : `<span class="stempel-flagge">❔</span><span class="stempel-name">${esc(name)}</span><span class="stempel-datum">${esc(datumText(s.tag.datum, { day: "2-digit", month: "2-digit" }))}</span>`}
  </div>`;
}

// ---------- „Wo ist unser Schiff?“ ----------

function wo(r, datum) {
  const tage = [...(r.haefen ?? [])].filter((h) => h.datum).sort((a, b) => a.datum.localeCompare(b.datum));
  const orte = tage.filter((h) => !istSeetag(h) && Number.isFinite(h.lat));
  if (!orte.length) return null;
  const heuteTag = tage.find((h) => h.datum === datum);
  const vorher = [...orte].reverse().find((h) => h.datum <= datum);
  const naechster = orte.find((h) => h.datum > datum);
  let pos;
  if (heuteTag && !istSeetag(heuteTag) && Number.isFinite(heuteTag.lat)) pos = heuteTag;
  else if (vorher && naechster) {
    // Auf See: Anteil der Strecke nach vergangenen Tagen
    const anteil = (tageZwischen(vorher.datum, datum) + 0.5) / Math.max(1, tageZwischen(vorher.datum, naechster.datum));
    pos = { lat: vorher.lat + (naechster.lat - vorher.lat) * Math.min(anteil, 0.9), lng: vorher.lng + (naechster.lng - vorher.lng) * Math.min(anteil, 0.9) };
  } else pos = vorher ?? orte[0];
  return { orte, pos, naechster: naechster ?? null, km: naechster ? Math.round(entfernungKm(pos, naechster)) : null, aufSee: heuteTag ? istSeetag(heuteTag) : false };
}

function karteSvg(r) {
  const w = wo(r, heute());
  if (!w || w.orte.length < 2) return w ? `<p class="kind-text">📍 ${esc(w.pos.name ?? "")}</p>` : "";
  const lats = w.orte.map((o) => o.lat);
  const lngs = w.orte.map((o) => o.lng);
  const [s, n, west, ost] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const kos = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const B = 600, H = 420, rand = 46;
  const f = Math.min((B - 2 * rand) / Math.max((ost - west) * kos, 0.01), (H - 2 * rand) / Math.max(n - s, 0.01));
  const xy = (o) => [rand + (o.lng - west) * kos * f, H - rand - (o.lat - s) * f];
  const namen = new Set();
  const [sx, sy] = xy(w.pos);
  const schiff = (r.art ?? "kreuzfahrt") === "kreuzfahrt" ? "🛳️" : r.art === "roadtrip" ? "🚐" : "🧳";
  return `<svg class="kind-karte" viewBox="0 0 ${B} ${H}" role="img" aria-label="Wo wir sind">
    <rect width="${B}" height="${H}" rx="18" fill="#bfe3fb"/>
    <polyline points="${w.orte.map((o) => xy(o).map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="#0b5394" stroke-width="3" stroke-dasharray="8 7"/>
    ${w.orte.map((o) => {
      const [x, y] = xy(o);
      const erstmal = !namen.has(o.name);
      namen.add(o.name);
      const vorbei = o.datum <= heute();
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${vorbei ? "#2e7d32" : "#fff"}" stroke="#0b5394" stroke-width="3"/>${erstmal ? `<text x="${(x + 13).toFixed(1)}" y="${(y + 5).toFixed(1)}" font-size="17" font-weight="600" fill="#0d2f52">${esc(o.name)}</text>` : ""}`;
    }).join("")}
    <text x="${sx.toFixed(1)}" y="${(sy + 6).toFixed(1)}" font-size="42" text-anchor="middle">${schiff}</text>
  </svg>
  <p class="kind-text">${w.aufSee ? "🌊 Wir sind mitten auf dem Meer!" : `📍 Wir sind in <strong>${esc(w.pos.name ?? "")}</strong>.`}${w.naechster ? ` Bis <strong>${esc(w.naechster.name)}</strong> sind es noch ca. <strong>${w.km.toLocaleString("de-DE")} km</strong>.` : ""}</p>`;
}

// ---------- Türchen vor der Reise ----------

function tuerInhalt(nr, r) {
  const laender = stempelDerReise(r, "9999").map((s) => s.land).filter(Boolean);
  const uniq = [...new Map(laender.map((l) => [l.name, l])).values()];
  const tiere = tiereDerReise(r);
  const sprachen = [...new Set(uniq.map((l) => l.sprache).filter((s) => WOERTER[s] && s !== "de"))];
  const art = nr % 6;
  if (art === 1 && uniq.length) {
    const l = uniq[(nr / 6) % uniq.length | 0];
    return `${l.flagge} <strong>${esc(l.name)}</strong>: ${esc(l.fakt)}`;
  }
  if (art === 2 && tiere.length) {
    const t = tiere[(nr * 7) % tiere.length];
    return `<span class="fakt-bild">${tierBild(t)}</span> <strong>${esc(t.name)}</strong>: ${esc(t.satz)}`;
  }
  if (art === 3 && sprachen.length) {
    const s = sprachen[nr % sprachen.length];
    const w = WOERTER[s][nr % WOERTER[s].length];
    return `🗣️ Wort des Tages auf ${esc(SPRACHEN[s])}: „${esc(w[0])}“ heißt <strong>${esc(w[1])}</strong> <span class="leise">(${esc(w[2])})</span>`;
  }
  if (art === 4) {
    const [frage, antwort] = RAETSEL[nr % RAETSEL.length];
    return `🧩 ${esc(frage)}<details><summary>Lösung</summary>${esc(antwort)}</details>`;
  }
  if (art === 5) return `😂 ${esc(WITZE[nr % WITZE.length])}`;
  const pack = vorlageEintraege("kinder", [])[nr % 8];
  return `🎒 Pack-Tipp: Hast du schon an <strong>${esc(pack?.text ?? "dein Kuscheltier")}</strong> gedacht?`;
}

function tuerchen(r) {
  const { von } = reiseZeitraum(r);
  if (!von) return "";
  const offenSchluessel = `reiseplaner:tuerchen:${r.id}`;
  let offen = [];
  try {
    offen = JSON.parse(localStorage.getItem(offenSchluessel) ?? "[]");
  } catch {}
  const tueren = Array.from({ length: 24 }, (_, i) => ({ nr: i + 1, datum: datumPlus(von, i - 24) }));
  const auf = zustand.tuerAuf;
  return `<div class="karte-box">
    <h2>🚪 Vorfreude-Kalender</h2>
    <p class="leise">In den letzten 24 Tagen vor der Reise geht jeden Tag ein Türchen auf.</p>
    <div class="tuerchen">${mischen(tueren, r.id).map((t) => {
      const darf = t.datum <= heute();
      return `<button class="tuer ${darf ? "darf" : ""} ${offen.includes(t.nr) ? "offen" : ""}" ${darf ? `data-aktion="tuer" data-nr="${t.nr}"` : "disabled"} title="${esc(datumText(t.datum))}">${offen.includes(t.nr) ? "⭐" : t.nr}</button>`;
    }).join("")}</div>
    ${auf ? `<div class="kind-fakt"><strong>Türchen ${auf}:</strong> ${tuerInhalt(auf, r)}</div>` : ""}
  </div>`;
}

aktionen["tuer"] = (el) => {
  const nr = Number(el.dataset.nr);
  const schluessel = `reiseplaner:tuerchen:${zustand.reise.id}`;
  try {
    const offen = new Set(JSON.parse(localStorage.getItem(schluessel) ?? "[]"));
    offen.add(nr);
    localStorage.setItem(schluessel, JSON.stringify([...offen]));
  } catch {}
  zustand.tuerAuf = nr;
  neuZeichnen();
};

// ---------- Seiten ----------

function seiteHeute(r) {
  const c = countdown(r, heute());
  const tage = haefen();
  const heuteTag = tage.find((h) => h.datum === heute());
  const tag = heuteTag ?? (c.phase === "vorher" ? tage[0] : tage.find((h) => h.datum >= heute())) ?? null;
  const geplant = tag ? ausfluegeIn(tag.id).filter((a) => a.status === "gebucht").sort((a, b) => (zeitZuMin(a.beginn) ?? 9999) - (zeitZuMin(b.beginn) ?? 9999)) : [];
  const p = kind();
  const meine = geplant.filter((a) => !p || !(a.teilnehmer ?? []).length || a.teilnehmer.includes(p.id));
  let gross = "";
  if (c.phase === "leer") gross = `<div class="kind-gross">🗺️</div><p>Noch keine Reisetage eingetragen.</p>`;
  else if (c.phase === "vorher") gross = `<div class="kind-gross">${c.tage}</div><p class="kind-text">${c.tage === 1 ? "Nur noch <strong>einmal</strong> schlafen!" : `Noch <strong>${c.tage}</strong> Mal schlafen bis zur Reise!`}</p>`;
  else if (c.phase === "unterwegs") gross = `<div class="kind-gross">Tag ${c.tagNr}</div><p class="kind-text">von ${c.tageGesamt} Tagen – noch ${c.tage} ${c.tage === 1 ? "Tag" : "Tage"} Urlaub!</p>`;
  else gross = `<div class="kind-gross">🏠</div><p class="kind-text">Die Reise ist vorbei – schau dir deinen Pass und dein Tagebuch an!</p>`;
  const land = landFuer(tag);
  const u = tag ? unterkunftAm(tag.datum) : null;
  const zimmer = u ? zimmerVon(r, u.id).filter((z) => !p || (z.personen ?? []).includes(p.id)) : [];
  return `
    <div class="karte-box kind-countdown">${gross}</div>
    ${c.phase === "vorher" ? tuerchen(r) : ""}
    ${tag ? `<div class="karte-box kind-heute">
      <h2>${heuteTag ? "Heute" : c.phase === "vorher" ? "Der erste Tag" : "Als Nächstes"}: ${istSeetag(tag) ? "🌊 Wir sind auf dem Meer!" : `${land?.flagge ?? "📍"} ${esc(tag.name)}${tag.land ? `, ${esc(tag.land)}` : ""}`}</h2>
      <p class="leise">${esc(datumText(tag.datum, { weekday: "long", day: "numeric", month: "long" }))}${regionFuer(tag) ? ` · ${esc(regionFuer(tag).name)}` : ""}</p>
      ${meine.length ? `<div class="kind-plan">${meine.map((a) => `<div class="kind-punkt"><span class="kind-bild">${BILD[a.kategorie] ?? "🗺️"}</span><div><strong>${esc(a.beginn || "")}</strong> ${esc(a.titel)}${a.kategorie === "kinderclub" && a.dauerMin ? ` <span class="klein">– abholen um ${minZuZeit(zeitZuMin(a.beginn) + a.dauerMin)}</span>` : ""}</div></div>`).join("")}</div>` : istSeetag(tag) ? `<p class="kind-text">Pool, Kinderclub, Eis essen und nach Delfinen Ausschau halten! 🐬</p>` : ""}
      ${festeZeit(tag, r) ? `<p class="kind-text">⏰ Um <strong>${esc(festeZeit(tag, r).zeit)}</strong>: ${festeZeit(tag, r).kurz === "Alle an Bord" ? "alle wieder aufs Schiff!" : esc(festeZeit(tag, r).kurz)}</p>` : ""}
      ${zimmer.length ? `<p class="kind-text">🛏️ ${u.id === "schiff" ? "Meine Kabine" : "Mein Zimmer"}: <strong>${zimmer.map((z) => esc(z.nummer || "?")).join(", ")}</strong>${zimmer[0].deck ? ` (${u.id === "schiff" ? "Deck" : "Etage"} ${esc(zimmer[0].deck)})` : ""}</p>` : ""}
      ${land ? `<p class="kind-text">${land.flagge} „Hallo“ heißt hier <strong>${esc(WOERTER[land.sprache]?.[0]?.[1] ?? "Hallo")}</strong> – <button class="link" data-aktion="kind-seite" data-seite="entdecken">mehr über ${esc(land.name)} →</button></p>` : ""}
    </div>` : ""}
    <div class="karte-box"><h2>🗺️ Wo sind wir?</h2>${karteSvg(r)}</div>
    ${zahlenSpassBox(r)}`;
}

function seitePass(r) {
  const p = kind();
  const stempel = stempelDerReise(r, heute());
  const anzahl = stempel.filter((s) => s.besucht).length;
  const ab = ABZEICHEN.map((a) => ({ ...a, hat: verdient(a, p) }));
  return `
    <div class="karte-box kinderpass" id="kinderpass">
      <div class="pass-kopf"><span class="pass-adler">🛂</span><div><h2>Reisepass von ${esc(vorname(p))}</h2><p class="leise">${esc(r.name)} · ${anzahl} von ${stempel.length} Stempeln</p></div></div>
      <div class="stempelseite">${stempel.map(stempelSvg).join("") || `<p class="leise">Noch keine Orte eingetragen.</p>`}</div>
      <div class="zeile keindruck"><button class="knopf" data-aktion="pass-drucken">🖨️ Pass drucken</button></div>
    </div>
    <div class="karte-box">
      <h2>🏅 Abzeichen von ${esc(vorname(p))} <span class="leise klein">${ab.filter((a) => a.hat).length} / ${ab.length}</span></h2>
      <div class="abzeichenliste">${ab.map((a) => `<div class="abzeichen-feld ${a.hat ? "hat" : ""}" title="${esc(a.text)}"><span class="abzeichen-bild">${a.emoji}</span><strong>${esc(a.name)}</strong><span class="klein">${esc(a.text)}</span>${!a.auto ? `<span class="klein leise">${a.hat ? "✓ verliehen" : "von Mama/Papa"}</span>` : ""}</div>`).join("")}</div>
      <p class="leise klein">Viele Abzeichen gibt es automatisch. Die anderen verleihen die Eltern unter „Für Eltern“.</p>
    </div>`;
}

function seiteEntdecken(r) {
  const stempel = stempelDerReise(r, "9999").filter((s) => s.land);
  const laender = [...new Map(stempel.map((s) => [s.land.name, s.land])).values()];
  const heuteTag = haefen().find((h) => h.datum === heute()) ?? haefen().find((h) => h.datum > heute() && !istSeetag(h));
  const land = laender.find((l) => l.name === zustand.kindLand) ?? landFuer(heuteTag) ?? laender[0];
  const sprachen = land ? [land.sprache, land.sprache2].filter((s) => s && WOERTER[s]) : [];
  return `
    <div class="karte-box">
      <div class="zeile"><h2>🔭 Insel-Steckbrief</h2><span class="platz"></span>
        ${laender.length > 1 ? `<select data-aktion="kind-land" aria-label="Land">${laender.map((l) => `<option ${l.name === land?.name ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>` : ""}</div>
      ${land ? `<div class="steckbrief">
        <div class="steckbrief-flagge">${land.flagge}</div>
        <div>
          <h3>${esc(land.name)}</h3>
          <p>🏛️ Hauptstadt: <strong>${esc(land.hauptstadt)}</strong></p>
          <p>🗣️ Sprache: <strong>${esc(SPRACHEN[land.sprache] ?? "")}${land.sprache2 ? ` und ${esc(SPRACHEN[land.sprache2])}` : ""}</strong></p>
          <p>👋 Hallo: <strong>${esc(WOERTER[land.sprache]?.[0]?.[1] ?? "–")}</strong> · 🙏 Danke: <strong>${esc(WOERTER[land.sprache]?.[1]?.[1] ?? "–")}</strong></p>
          <p>💰 Geld: <strong>${esc(land.waehrung)}</strong></p>
          <p>🍽️ Typisches Essen: <strong>${esc(land.essen)}</strong></p>
          <p class="kind-fakt">💡 ${esc(land.fakt)}</p>
        </div>
      </div>` : `<p class="leise">Sobald die Reise Orte hat, erscheinen hier die Steckbriefe.</p>`}
    </div>
    ${sprachen.map((s) => `<div class="karte-box"><h2>🗣️ Wörterbuch ${esc(SPRACHEN[s])}</h2>
      <div class="woerter">${WOERTER[s].map(([de, fremd, laut]) => `<button class="wort" data-aktion="wort-sprechen" data-text="${esc(fremd)}" data-sprache="${esc(s)}"><span class="leise">${esc(de)}</span><strong>${esc(fremd)}</strong><em>🔊 ${esc(laut)}</em></button>`).join("")}</div>
      <p class="leise klein">Antippen zum Vorlesen (wenn das Handy eine Stimme für die Sprache hat).</p></div>`).join("")}
    <div class="karte-box"><h2>🗺️ Wo ist unser ${(r.art ?? "kreuzfahrt") === "kreuzfahrt" ? "Schiff" : "Reiseziel"}?</h2>${karteSvg(r)}</div>`;
}

// ---------- Quiz ----------

function quizFuer(tag, r) {
  if (!tag) return [];
  const saat = `${tag.id}${tag.datum}`;
  const fragen = [];
  const andereOrte = [...new Set((r.haefen ?? []).filter((h) => !istSeetag(h) && h.name !== tag.name).map((h) => h.name))];
  const frage = (text, richtig, falsch) => {
    const optionen = mischen([richtig, ...mischen(falsch.filter((x) => x && x !== richtig), saat + text).slice(0, 2)], saat + richtig);
    if (optionen.length >= 2) fragen.push({ text, richtig, optionen });
  };
  if (!istSeetag(tag)) {
    frage("Wie heißt der Ort, an dem wir heute sind?", tag.name, [...andereOrte, "Atlantis", "Entenhausen"]);
    const land = landFuer(tag);
    if (land) {
      const andere = mischen(LAENDER.filter((l) => l.name !== land.name && l.flagge !== land.flagge), saat);
      frage(`Welche Flagge gehört zu ${land.name}?`, land.flagge, andere.map((l) => l.flagge));
      frage(`Wie heißt die Hauptstadt von ${land.name}?`, land.hauptstadt, andere.map((l) => l.hauptstadt));
      if (WOERTER[land.sprache]) frage(`Was heißt „Danke“ auf ${SPRACHEN[land.sprache]}?`, WOERTER[land.sprache][1][1], Object.entries(WOERTER).filter(([k]) => k !== land.sprache).map(([, w]) => w[1]?.[1]));
      frage(`Was isst man typischerweise in ${land.name}?`, land.essen, andere.map((l) => l.essen));
    }
  } else {
    frage("Wie nennt man das Ende eines Schiffs?", "Heck", ["Bug", "Kiel"]);
    frage("Wie heißt die linke Seite des Schiffs (nach vorn geschaut)?", "Backbord", ["Steuerbord", "Achterdeck"]);
    frage("Was macht ein Lotse?", "Er hilft, das Schiff in den Hafen zu steuern", ["Er kocht für die Crew", "Er macht die Show"]);
  }
  const hier = tiereFuer(tag);
  if (hier.length) {
    const richtig = hier[(fragen.length * 3) % hier.length];
    const fremd = tiereDerReise({ haefen: [{ art: "hafen", lat: 60, lng: 10 }, { art: "hafen", lat: 47.2, lng: 10.5 }] }).filter((t) => !hier.some((x) => x.name === t.name));
    frage(istSeetag(tag) ? "Welches Tier kann man auf dem Meer entdecken?" : "Welches Tier kann man hier entdecken?", richtig.name, fremd.map((t) => t.name));
  }
  return mischen(fragen, saat).slice(0, 5);
}

function quizBox(r) {
  const tage = haefen().filter((h) => h.datum <= heute());
  const tag = haefen().find((h) => h.id === zustand.quizTag) ?? tage.at(-1) ?? haefen()[0];
  const fragen = quizFuer(tag, r);
  const antworten = zustand.quizAntworten?.[tag?.id] ?? {};
  const fertig = fragen.length && Object.keys(antworten).length === fragen.length;
  const punkte = fragen.filter((f, i) => antworten[i] === f.richtig).length;
  const bisher = zustandKind().quiz?.[tag?.datum];
  return `<div class="karte-box">
    <div class="zeile"><h2>🧠 Quiz</h2><span class="platz"></span>
      ${haefen().length ? `<select data-aktion="quiz-tag" aria-label="Tag">${haefen().map((h) => `<option value="${esc(h.id)}" ${h.id === tag?.id ? "selected" : ""}>${esc(datumText(h.datum))} – ${istSeetag(h) ? "Seetag" : esc(h.name)}</option>`).join("")}</select>` : ""}</div>
    ${bisher != null ? `<p class="leise klein">Bester Versuch: ${bisher} von 5 ⭐</p>` : ""}
    ${fragen.map((f, i) => `<div class="quizfrage"><p><strong>${i + 1}.</strong> ${esc(f.text)}</p><div class="quizantworten">${f.optionen.map((o) => {
      const gewaehlt = antworten[i] === o;
      const klasse = antworten[i] != null ? (o === f.richtig ? "richtig" : gewaehlt ? "falsch" : "") : "";
      return `<button class="quizknopf ${klasse}" data-aktion="quiz-antwort" data-tag="${esc(tag.id)}" data-i="${i}" data-wert="${esc(o)}" ${antworten[i] != null ? "disabled" : ""}>${/\p{Regional_Indicator}/u.test(o) ? `<span class="gross">${esc(o)}</span>` : esc(o)}</button>`;
    }).join("")}</div></div>`).join("")}
    ${fertig ? `<p class="kind-text">${punkte === fragen.length ? "🏆 Alles richtig! Super!" : `⭐ ${punkte} von ${fragen.length} richtig!`} <button class="link" data-aktion="quiz-neu" data-tag="${esc(tag.id)}">Nochmal</button></p>` : ""}
  </div>`;
}

aktionen["quiz-antwort"] = async (el) => {
  const { tag, i, wert } = el.dataset;
  zustand.quizAntworten ??= {};
  const a = (zustand.quizAntworten[tag] ??= {});
  a[i] = wert;
  const h = haefen().find((x) => x.id === tag);
  const fragen = quizFuer(h, zustand.reise);
  if (Object.keys(a).length === fragen.length && kind()) {
    const punkte = fragen.filter((f, n) => a[n] === f.richtig).length;
    await kinderSetzen("quiz", h.datum, Math.round((punkte / fragen.length) * 5)).catch(() => {});
  }
  neuZeichnen();
};
aktionen["quiz-neu"] = (el) => {
  delete zustand.quizAntworten?.[el.dataset.tag];
  neuZeichnen();
};
aenderungen["quiz-tag"] = (el) => {
  zustand.quizTag = el.value;
  neuZeichnen();
};

// ---------- Schatzsuche, Bingo, Wartezeit-Spiele ----------

function schatzBox() {
  const tag = haefen().find((h) => h.id === zustand.schatzTag) ?? haefen().find((h) => h.datum === heute()) ?? haefen().find((h) => h.datum > heute()) ?? haefen().at(-1);
  if (!tag) return "";
  const s = zustand.extras.schatz ?? {};
  const aufgaben = schatzAufgaben(tag);
  return `<div class="karte-box">
    <div class="zeile"><h2>💎 Schatzsuche</h2><span class="platz"></span>
      <select data-aktion="schatz-tag" aria-label="Tag">${haefen().map((h) => `<option value="${esc(h.id)}" ${h.id === tag.id ? "selected" : ""}>${esc(datumText(h.datum))} – ${istSeetag(h) ? "Seetag" : esc(h.name)}</option>`).join("")}</select></div>
    <p class="leise">${aufgaben.filter((a) => s[`${tag.id}:${a.nr}`]).length} von ${aufgaben.length} gefunden – mit Foto-Beweis!</p>
    <div class="schatzliste">${aufgaben.map((a) => {
      const k = `${tag.id}:${a.nr}`;
      const e = s[k];
      return `<div class="schatz ${e ? "gefunden" : ""}">
        <button class="schatz-haken" data-aktion="schatz" data-schluessel="${esc(k)}" aria-label="Gefunden">${e ? "✅" : "⬜"}</button>
        <span class="schatz-text">${esc(a.text)}</span>
        ${e?.fotoId ? `<a href="${fotoUrl(e.fotoId)}" target="_blank"><img src="${fotoUrl(e.fotoId, true)}" alt="" class="schatz-foto"></a>` : ""}
        <label class="kamera" title="Foto-Beweis">📷<input type="file" accept="image/*" capture="environment" hidden data-schatz="${esc(k)}"></label>
      </div>`;
    }).join("")}</div>
  </div>`;
}

aenderungen["schatz-tag"] = (el) => {
  zustand.schatzTag = el.value;
  neuZeichnen();
};
aktionen["schatz"] = async (el) => {
  const k = el.dataset.schluessel;
  zustand.extras.schatz = await anfrage(`/api/reisen/${zustand.reise.id}/schatz`, { method: "PUT", body: { schluessel: k, erledigt: !zustand.extras.schatz?.[k] } });
  neuZeichnen();
};

function bingoBox(r) {
  const tiere = tiereDerReise(r);
  if (!tiere.length) return "";
  const gesehen = zustand.extras.tiere ?? {};
  const fotos = zustand.extras.tierFotos ?? {};
  const heuteTag = haefen().find((h) => h.datum === heute());
  const heuteTiere = new Set(tiereFuer(heuteTag).map((t) => t.name));
  const auswahl = tiere.find((t) => t.name === zustand.kindTier);
  return `<div class="karte-box">
    <div class="zeile"><h2>🔍 Tiere-Bingo</h2><span class="platz"></span><strong>${tiere.filter((t) => gesehen[t.name]).length} / ${tiere.length}</strong></div>
    <p class="leise">Tippe auf ein Tier, wenn ihr es gesehen habt – mit 📷 kommt euer eigenes Foto ins Feld!${heuteTag ? " ⭐ = kann man heute sehen" : ""}</p>
    <div class="bingo">${tiere.map((t) => `<div class="bingo-feld ${gesehen[t.name] ? "gesehen" : ""} ${heuteTag && heuteTiere.has(t.name) ? "heute" : ""}">
      <button class="bingo-knopf" data-aktion="tier" data-name="${esc(t.name)}" title="${esc(t.satz)}">
        <span class="bingo-emoji">${fotos[t.name] ? `<img src="${fotoUrl(fotos[t.name], true)}" alt="" class="bingo-foto">` : tierBild(t)}</span><span class="bingo-name">${esc(t.name)}</span>
      </button>${gesehen[t.name] ? `<span class="bingo-haken">✓</span>` : ""}
      <label class="kamera bingo-kamera" title="Eigenes Foto">📷<input type="file" accept="image/*" capture="environment" hidden data-tierfoto="${esc(t.name)}"></label>
    </div>`).join("")}</div>
    ${auswahl ? `<p class="kind-fakt"><span class="fakt-bild">${tierBild(auswahl)}</span> <strong>${esc(auswahl.name)}:</strong> ${esc(auswahl.satz)}</p>` : ""}
  </div>`;
}

aktionen["tier"] = async (el) => {
  const name = el.dataset.name;
  const gesehen = !zustand.extras.tiere?.[name];
  zustand.kindTier = name;
  try {
    const x = await anfrage(`/api/reisen/${zustand.reise.id}/tiere`, { method: "PUT", body: { tier: name, gesehen } });
    zustand.extras.tiere = x.tiere ?? x;
    if (x.tierFotos) zustand.extras.tierFotos = x.tierFotos;
  } catch (e) {
    alert(e.message);
  }
  neuZeichnen();
};

// Fotos für Bingo und Schatzsuche (bleiben privat, nicht im Fotoalbum)
document.addEventListener("change", async (e) => {
  const el = e.target;
  if (!el.files?.[0] || !(el.dataset.tierfoto || el.dataset.schatz)) return;
  const datei = el.files[0];
  el.value = "";
  el.closest("label").textContent = "⏳";
  try {
    const fotoId = await fotoHochladen(datei, { art: "kinder" });
    if (el.dataset.tierfoto) {
      const x = await anfrage(`/api/reisen/${zustand.reise.id}/tiere`, { method: "PUT", body: { tier: el.dataset.tierfoto, gesehen: true, fotoId } });
      zustand.extras.tiere = x.tiere;
      zustand.extras.tierFotos = x.tierFotos;
      zustand.kindTier = el.dataset.tierfoto;
    } else {
      zustand.extras.schatz = await anfrage(`/api/reisen/${zustand.reise.id}/schatz`, { method: "PUT", body: { schluessel: el.dataset.schatz, erledigt: true, fotoId } });
    }
  } catch (err) {
    alert(err.message);
  }
  neuZeichnen();
});

function warteBox() {
  const spiel = zustand.wartespiel ?? "sehen";
  const z = (zustand.warteZaehler ?? 0) + 1;
  const n = (liste) => liste[(z * 7 + 3) % liste.length];
  let inhalt = "";
  if (spiel === "sehen") {
    const [farbe, code] = n(ICH_SEHE_FARBEN);
    inhalt = `<p class="kind-text">Ich sehe was, was du nicht siehst, und das ist <strong>${farbe}</strong>! <span class="farbklecks" style="background:${code}"></span></p>`;
  } else if (spiel === "flaggen") {
    const eigene = LAENDER.filter((l) => !(l.box && ["🇫🇷", "🇪🇸", "🇵🇹"].includes(l.flagge)));
    const optionen = mischen(eigene.filter((l, i, a) => a.findIndex((x) => x.flagge === l.flagge) === i), `fl${z}`).slice(0, 3);
    const richtig = optionen[z % 3];
    inhalt = `<div class="flaggenraten"><span class="riesenflagge">${richtig.flagge}</span><p>Welches Land ist das?</p>${optionen.map((o) => `<button class="quizknopf" data-aktion="flagge-raten" data-richtig="${o === richtig ? "1" : ""}">${esc(o.name)}</button>`).join("")}</div>`;
  } else if (spiel === "finden") inhalt = `<p class="kind-text">Wer findet zuerst … <strong>${esc(n(WER_FINDET))}</strong>? 👀</p>`;
  else if (spiel === "pantomime") inhalt = `<p class="kind-text">Mach vor, ohne zu sprechen: <strong class="verdeckt" data-aktion="aufdecken">antippen zum Aufdecken</strong><span hidden class="geheim">${esc(n(PANTOMIME))}</span> 🤫</p>`;
  else if (spiel === "raetsel") {
    const [f, a] = n(RAETSEL);
    inhalt = `<p class="kind-text">🧩 ${esc(f)}</p><details><summary>Lösung</summary><p class="kind-text">${esc(a)}</p></details>`;
  } else if (spiel === "witz") inhalt = `<p class="kind-text">😂 ${esc(n(WITZE))}</p>`;
  return `<div class="karte-box">
    <h2>⏳ Spiele für Wartezeiten</h2>
    <p class="leise">Für Tender, Bus, Flughafen und Schlange stehen – ganz ohne Internet.</p>
    <div class="spielwahl">${Object.entries({ sehen: "👀 Ich sehe was", flaggen: "🏳️ Flaggen raten", finden: "🔎 Wer findet zuerst", pantomime: "🤫 Pantomime", raetsel: "🧩 Rätsel", witz: "😂 Witze" }).map(([k, t]) => `<button class="linkchip ${spiel === k ? "empfohlen" : ""}" data-aktion="wartespiel" data-spiel="${k}">${t}</button>`).join("")}</div>
    <div class="spielkarte">${inhalt}</div>
    <button class="knopf" data-aktion="warte-weiter">Nächste Runde ➜</button>
  </div>`;
}

aktionen["wartespiel"] = (el) => {
  zustand.wartespiel = el.dataset.spiel;
  neuZeichnen();
};
aktionen["warte-weiter"] = () => {
  zustand.warteZaehler = (zustand.warteZaehler ?? 0) + 1;
  neuZeichnen();
};
aktionen["flagge-raten"] = (el) => {
  el.classList.add(el.dataset.richtig ? "richtig" : "falsch");
  if (el.dataset.richtig) setTimeout(() => $(".flaggenraten") && aktionen["warte-weiter"](), 900);
};
aktionen["aufdecken"] = (el) => {
  el.hidden = true;
  el.nextElementSibling.hidden = false;
};

// ---------- Tagebuch mit Malen ----------

function seiteTagebuch(r) {
  const p = kind();
  const k = zustandKind(p);
  const tage = haefen().filter((h) => h.datum <= heute());
  const tag = haefen().find((h) => h.id === zustand.tagebuchTag) ?? tage.at(-1) ?? haefen()[0];
  if (!tag) return `<div class="karte-box"><p class="leise">Noch keine Reisetage.</p></div>`;
  const e = k.tagebuch?.[tag.datum] ?? {};
  const fruehere = Object.entries(k.tagebuch ?? {}).filter(([d]) => d !== tag.datum).sort(([a], [b]) => b.localeCompare(a));
  return `<div class="karte-box">
    <div class="zeile"><h2>📔 Tagebuch von ${esc(vorname(p))}</h2><span class="platz"></span>
      <select data-aktion="tagebuch-tag" aria-label="Tag">${haefen().map((h) => `<option value="${esc(h.id)}" ${h.id === tag.id ? "selected" : ""}>${esc(datumText(h.datum))} – ${istSeetag(h) ? "Seetag" : esc(h.name)}${k.tagebuch?.[h.datum] ? " ✓" : ""}</option>`).join("")}</select></div>
    <p class="kind-text">Wie war dein Tag?</p>
    <div class="stimmungen">${STIMMUNGEN.map((s, i) => `<button class="stimmung ${e.stimmung === i ? "an" : ""}" data-aktion="stimmung" data-i="${i}" data-datum="${esc(tag.datum)}">${s}</button>`).join("")}</div>
    <label class="kind-text">Das Beste heute war …<textarea id="tagebuchText" rows="3" maxlength="1000" placeholder="Erzähl mal!">${esc(e.text ?? "")}</textarea></label>
    ${stimmeBox(tag.datum)}
    <p class="kind-text">🎨 Mal ein Bild von deinem Tag:</p>
    ${e.bildId ? `<img class="tagebuchbild" src="${fotoUrl(e.bildId)}" alt="Bild von ${esc(vorname(p))}">` : ""}
    <div class="malen">
      <canvas id="malflaeche" width="800" height="560"></canvas>
      <div class="malfarben">${["#212121", "#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#ec407a", "#6d4c41", "#ffffff"].map((f, i) => `<button class="malfarbe ${i === 0 ? "an" : ""}" style="background:${f}" data-farbe="${f}" aria-label="Farbe"></button>`).join("")}
        <button class="knopf leise" data-aktion="mal-dick">✏️/🖌️</button><button class="knopf leise" data-aktion="mal-loeschen">🧽 Neu</button></div>
    </div>
    <div class="zeile"><button class="knopf" data-aktion="tagebuch-speichern" data-datum="${esc(tag.datum)}">💾 Speichern</button><span class="klein leise" id="tagebuchStatus"></span></div>
  </div>
  ${fruehere.length ? `<div class="karte-box"><h2>Frühere Tage</h2>${fruehere.map(([d, x]) => `<div class="tagebuch-eintrag"><strong>${esc(datumText(d))}</strong> ${x.stimmung != null ? STIMMUNGEN[x.stimmung] : ""} <span>${esc(x.text ?? "")}</span>${x.bildId ? `<img src="${fotoUrl(x.bildId, true)}" alt="">` : ""}${x.audioId ? `<audio controls preload="none" src="/api/reisen/${esc(zustand.reise.id)}/dateien/${esc(x.audioId)}"></audio>` : ""}</div>`).join("")}</div>` : ""}`;
}

let malDick = false;
let malFarbe = "#212121";
let gemalt = false;
function malenStarten() {
  const c = $("#malflaeche");
  if (!c || c.dataset.bereit) return;
  c.dataset.bereit = "1";
  gemalt = false;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  let letzter = null;
  const punkt = (e) => {
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  c.addEventListener("pointerdown", (e) => {
    c.setPointerCapture(e.pointerId);
    letzter = punkt(e);
  });
  c.addEventListener("pointermove", (e) => {
    if (!letzter) return;
    const p = punkt(e);
    ctx.strokeStyle = malFarbe;
    ctx.lineWidth = malDick ? 22 : 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...letzter);
    ctx.lineTo(...p);
    ctx.stroke();
    letzter = p;
    gemalt = true;
  });
  const ende = () => (letzter = null);
  c.addEventListener("pointerup", ende);
  c.addEventListener("pointercancel", ende);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".malfarbe");
  if (!b) return;
  malFarbe = b.dataset.farbe;
  document.querySelectorAll(".malfarbe").forEach((x) => x.classList.toggle("an", x === b));
});
aktionen["mal-dick"] = () => (malDick = !malDick);
aktionen["mal-loeschen"] = () => {
  const c = $("#malflaeche");
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  gemalt = false;
};
aenderungen["tagebuch-tag"] = (el) => {
  zustand.tagebuchTag = el.value;
  neuZeichnen();
};
aktionen["stimmung"] = async (el) => {
  const vorher = zustandKind().tagebuch?.[el.dataset.datum] ?? {};
  await kinderSetzen("tagebuch", el.dataset.datum, { ...vorher, text: $("#tagebuchText")?.value ?? vorher.text, stimmung: Number(el.dataset.i) });
  neuZeichnen();
};
aktionen["tagebuch-speichern"] = async (el) => {
  const datum = el.dataset.datum;
  const vorher = zustandKind().tagebuch?.[datum] ?? {};
  el.disabled = true;
  $("#tagebuchStatus").textContent = "Speichere …";
  try {
    let bildId = vorher.bildId ?? "";
    if (gemalt) {
      const blob = await new Promise((ok) => $("#malflaeche").toBlob(ok, "image/jpeg", 0.9));
      bildId = await fotoHochladen(new File([blob], "bild.jpg", { type: "image/jpeg" }), { art: "kinder" });
    }
    await kinderSetzen("tagebuch", datum, { stimmung: vorher.stimmung ?? null, text: $("#tagebuchText").value, bildId, audioId: vorher.audioId ?? "" });
    neuZeichnen();
  } catch (e) {
    el.disabled = false;
    $("#tagebuchStatus").textContent = e.message;
  }
};

// ---------- Meine Sachen: Packliste mit Bildern, Sparschwein ----------

function seiteSachen() {
  const p = kind();
  const meine = zustand.extras.packliste.filter((x) => x.fuer === p?.id);
  const k = zustandKind(p);
  const ausgegeben = (k.kasse.ausgaben ?? []).reduce((s, x) => s + x.betrag, 0);
  const rest = k.kasse.start != null ? k.kasse.start - ausgegeben : null;
  return `<div class="karte-box">
    <div class="zeile"><h2>🎒 Meine Packliste</h2><span class="platz"></span><strong>${meine.filter((x) => x.erledigt).length} / ${meine.length}</strong></div>
    ${meine.length ? `<div class="kindpack">${meine.map((x) => `<button class="kindpack-feld ${x.erledigt ? "erledigt" : ""}" data-aktion="kind-pack" data-id="${esc(x.id)}"><span class="kindpack-bild">${packBild(x.text)}</span><span>${esc(x.text)}</span>${x.erledigt ? `<span class="bingo-haken">✓</span>` : ""}</button>`).join("")}</div>`
      : `<p class="leise">Noch nichts auf deiner Liste.</p>`}
    <div class="zeile"><button class="knopf leise" data-aktion="kind-pack-fuellen">✨ Meine Liste mit Kinder-Sachen füllen</button></div>
  </div>
  <div class="karte-box sparschwein">
    <h2>🐷 Sparschwein von ${esc(vorname(p))}</h2>
    ${k.kasse.start == null ? `<p class="leise">Wie viel Taschengeld hast du für die Reise?</p>` : `<div class="kind-gross ${rest < 0 ? "rot" : ""}">${geld(rest)}</div><p class="kind-text">noch übrig von ${geld(k.kasse.start)}</p>
      <div class="fortschritt ${rest < 0 ? "voll" : ""}"><span style="width:${Math.max(0, Math.min(100, Math.round((rest / (k.kasse.start || 1)) * 100)))}%"></span></div>`}
    <div class="zeile"><label>Taschengeld <input class="budget-klein" data-aktion="kasse-start" inputmode="decimal" value="${esc(k.kasse.start ?? "")}" placeholder="z. B. 30"></label></div>
    <form class="zeile eng" id="kasseNeu"><input name="titel" placeholder="Was hast du gekauft?" maxlength="100" required><input name="betrag" inputmode="decimal" placeholder="€" required class="betrag"><button class="knopf">+</button></form>
    ${(k.kasse.ausgaben ?? []).length ? `<ul class="kasse">${[...k.kasse.ausgaben].reverse().map((x) => `<li>${esc(x.titel)} <span class="leise klein">${esc(datumText(x.datum))}</span><strong>${geld(x.betrag)}</strong><button class="link rot" data-aktion="kasse-weg" data-id="${esc(x.id)}" aria-label="Entfernen">✕</button></li>`).join("")}</ul>` : ""}
  </div>`;
}

aktionen["kind-pack"] = async (el) => {
  const x = zustand.extras.packliste.find((y) => y.id === el.dataset.id);
  const neu = await anfrage(`/api/reisen/${zustand.reise.id}/extras/packliste/${x.id}`, { method: "PUT", body: { ...x, erledigt: !x.erledigt } });
  Object.assign(x, neu);
  neuZeichnen();
};
aktionen["kind-pack-fuellen"] = async (el) => {
  const p = kind();
  const vorhanden = zustand.extras.packliste.filter((x) => x.fuer === p.id);
  const basis = ["Kuscheltier", "Lieblingsbuch", "Spiele für unterwegs", "Malsachen", "Badesachen", "Sonnenhut", "Sonnenbrille", "Schlafanzug", "Zahnbürste", "Kopfhörer", "Rucksack", "Lieblingssnack"];
  el.disabled = true;
  for (const text of basis.filter((t) => !vorhanden.some((v) => v.text.toLowerCase() === t.toLowerCase()))) {
    const neu = await anfrage(`/api/reisen/${zustand.reise.id}/extras/packliste`, { method: "POST", body: { text, gruppe: `Sachen von ${vorname(p)}`, fuer: p.id } }).catch(() => null);
    if (neu) zustand.extras.packliste.push(neu);
  }
  neuZeichnen();
};
aenderungen["kasse-start"] = async (el) => {
  await kinderSetzen("kasse", "", { start: el.value.replace(",", ".") });
  neuZeichnen();
};
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "kasseNeu") return;
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await kinderSetzen("kasseAusgabe", "", { titel: f.get("titel"), betrag: String(f.get("betrag")).replace(",", "."), datum: heute() });
    neuZeichnen();
  } catch (err) {
    alert(err.message);
  }
});
aktionen["kasse-weg"] = async (el) => {
  await kinderSetzen("kasseAusgabe", el.dataset.id, null);
  neuZeichnen();
};

// ---------- Für Eltern: Sicherheitskarte, Kids-Club, Abzeichen, Kinderprogramm ----------

function sicherheitsDaten(p) {
  const r = zustand.reise;
  const u = unterkunftAm(haefen().find((h) => h.datum >= heute())?.datum ?? heute()) ?? unterkunftAm(reiseZeitraum(r).von);
  const zimmer = u ? zimmerVon(r, u.id).find((z) => (z.personen ?? []).includes(p.id)) : null;
  const n = r.notfall ?? {};
  return { name: p.name, unterkunft: u?.name ?? "", schiff: u?.id === "schiff", zimmer: zimmer ? `${zimmer.nummer}${zimmer.deck ? ` (${u?.id === "schiff" ? "Deck" : "Etage"} ${zimmer.deck})` : ""}` : "", eltern: [[n.name1, n.telefon1], [n.name2, n.telefon2]].filter(([, t]) => t), treffpunkt: n.treffpunkt ?? "", hinweis: n.hinweis ?? "", armband: zustandKind(p).kidsclub?.armband ?? "" };
}

function seiteEltern(r) {
  const p = kind();
  const k = zustandKind(p);
  const n = r.notfall ?? {};
  const d = sicherheitsDaten(p);
  const programm = (r.ausfluege ?? []).filter((a) => a.kategorie === "kinderclub");
  return `<div class="karte-box">
    <h2>🆘 Sicherheitskarte für ${esc(vorname(p))}</h2>
    <p class="leise klein">Ausdrucken für die Hosentasche oder als Sperrbildschirm aufs Kinder-Handy. Die Daten bleiben in eurer Reise (nur Mitreisende).</p>
    <div class="formular zwei">
      <label>Name Elternteil 1<input data-notfall="name1" value="${esc(n.name1 ?? "")}"></label><label>Handy 1<input data-notfall="telefon1" type="tel" value="${esc(n.telefon1 ?? "")}" placeholder="+49 …"></label>
      <label>Name Elternteil 2<input data-notfall="name2" value="${esc(n.name2 ?? "")}"></label><label>Handy 2<input data-notfall="telefon2" type="tel" value="${esc(n.telefon2 ?? "")}"></label>
      <label>Treffpunkt, wenn wir uns verlieren<input data-notfall="treffpunkt" value="${esc(n.treffpunkt ?? "")}" placeholder="z. B. Rezeption Deck 5 / Eingang Hotel"></label>
      <label>Wichtiger Hinweis<input data-notfall="hinweis" value="${esc(n.hinweis ?? "")}" placeholder="z. B. Allergie: Nüsse"></label>
    </div>
    <div class="sicherheitskarte" id="sicherheitskarte">
      <div class="sk-kopf">🆘 Ich heiße <strong>${esc(d.name)}</strong></div>
      ${d.unterkunft ? `<p>${d.schiff ? "🛳️ Schiff" : "🏨 Unterkunft"}: <strong>${esc(d.unterkunft)}</strong>${d.zimmer ? ` · ${d.schiff ? "Kabine" : "Zimmer"} <strong>${esc(d.zimmer)}</strong>` : ""}</p>` : ""}
      ${d.eltern.map(([name, tel]) => `<p>📞 ${esc(name || "Eltern")}: <strong>${esc(tel)}</strong></p>`).join("") || `<p class="leise">Bitte oben Handynummern eintragen.</p>`}
      ${d.treffpunkt ? `<p>📍 Treffpunkt: <strong>${esc(d.treffpunkt)}</strong></p>` : ""}
      ${d.armband ? `<p>🧒 Kids-Club-Armband: <strong>${esc(d.armband)}</strong></p>` : ""}
      ${d.hinweis ? `<p>⚠️ ${esc(d.hinweis)}</p>` : ""}
      <p class="sk-fuss">Please call my parents · Llame a mis padres · Appelez mes parents</p>
    </div>
    <div class="zeile keindruck"><button class="knopf" data-aktion="karte-drucken">🖨️ Drucken</button><button class="knopf leise" data-aktion="karte-bild">📱 Als Sperrbildschirm-Bild</button></div>
  </div>
  <div class="karte-box">
    <h2>🧒 Kinderclub &amp; Kinderprogramm</h2>
    <div class="formular drei">
      <label>Kids-Club-Gruppe<input data-kidsclub="gruppe" value="${esc(k.kidsclub?.gruppe ?? "")}" placeholder="z. B. Delfine (6–8 J.)"></label>
      <label>Armband-/Karten-Nr.<input data-kidsclub="armband" value="${esc(k.kidsclub?.armband ?? "")}"></label>
      <label>Hinweis für Betreuer<input data-kidsclub="hinweis" value="${esc(k.kidsclub?.hinweis ?? "")}" placeholder="z. B. kann noch nicht schwimmen"></label>
    </div>
    <p class="leise klein">Zeiten vom Kinderclub, Kinderdisco, Basteln … – mit Erinnerung zum Abholen (im Kalender unter „Unterwegs“).</p>
    ${programm.length ? `<ul class="ablauf">${programm.sort((a, b) => `${haefen().find((h) => h.id === a.hafenId)?.datum}${a.beginn}`.localeCompare(`${haefen().find((h) => h.id === b.hafenId)?.datum}${b.beginn}`)).map((a) => `<li>${esc(datumText(haefen().find((h) => h.id === a.hafenId)?.datum))} <strong>${esc(a.beginn || "")}</strong> ${esc(a.titel)}${a.dauerMin && a.beginn ? ` – abholen ${minZuZeit(zeitZuMin(a.beginn) + a.dauerMin)}` : ""} <button class="link" data-aktion="ausflug-bearbeiten" data-id="${esc(a.id)}">Bearbeiten</button></li>`).join("")}</ul>` : ""}
    <button class="knopf" data-aktion="kinderprogramm-neu">+ Kinderprogramm</button>
  </div>
  <div class="karte-box">
    <h2>🏅 Abzeichen verleihen an ${esc(vorname(p))}</h2>
    <div class="teilnehmer">${ABZEICHEN.filter((a) => !a.auto).map((a) => `<label class="haken"><input type="checkbox" data-aktion="abzeichen" data-id="${a.id}" ${k.abzeichen?.[a.id] ? "checked" : ""}> ${a.emoji} ${esc(a.name)} <span class="leise klein">– ${esc(a.text)}</span></label>`).join("")}</div>
  </div>`;
}

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.notfall && zustand.reise) {
    zustand.reise.notfall = { ...(zustand.reise.notfall ?? {}), [el.dataset.notfall]: el.value.slice(0, 120) };
    speichern();
    neuZeichnen();
  } else if (el.dataset.kidsclub && kind()) {
    const k = zustandKind();
    kinderSetzen("kidsclub", "", { ...k.kidsclub, [el.dataset.kidsclub]: el.value }).then(neuZeichnen).catch((err) => alert(err.message));
  }
});
aenderungen["abzeichen"] = async (el) => {
  await kinderSetzen("abzeichen", el.dataset.id, el.checked).catch((err) => alert(err.message));
  neuZeichnen();
};

function druckeNur(id) {
  document.body.dataset.druck = id;
  const weg = () => {
    delete document.body.dataset.druck;
    window.removeEventListener("afterprint", weg);
  };
  window.addEventListener("afterprint", weg);
  window.print();
}
aktionen["karte-drucken"] = () => druckeNur("sicherheitskarte");
aktionen["pass-drucken"] = () => druckeNur("kinderpass");

aktionen["karte-bild"] = async () => {
  const p = kind();
  const d = sicherheitsDaten(p);
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1920;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 1920);
  g.addColorStop(0, "#0b5394");
  g.addColorStop(1, "#1e88e5");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(70, 820, 940, 960, 40);
  ctx.fill();
  ctx.fillStyle = "#0b5394";
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.fillText("🆘 Wenn ich verloren gehe", 110, 920);
  const zeilen = [
    [`Ich heiße ${d.name}`, 58, true],
    d.unterkunft ? [`${d.schiff ? "Schiff" : "Hotel"}: ${d.unterkunft}`, 44] : null,
    d.zimmer ? [`${d.schiff ? "Kabine" : "Zimmer"}: ${d.zimmer}`, 52, true] : null,
    ...d.eltern.map(([name, tel]) => [`📞 ${name || "Eltern"}: ${tel}`, 50, true]),
    d.treffpunkt ? [`Treffpunkt: ${d.treffpunkt}`, 42] : null,
    d.hinweis ? [`⚠️ ${d.hinweis}`, 42] : null,
    ["Please call my parents", 38],
  ].filter(Boolean);
  let y = 1030;
  for (const [text, groesse, fett] of zeilen) {
    ctx.fillStyle = "#1c2430";
    ctx.font = `${fett ? "bold " : ""}${groesse}px system-ui, sans-serif`;
    ctx.fillText(text.length > 34 ? `${text.slice(0, 33)}…` : text, 110, y);
    y += groesse * 1.6;
  }
  c.toBlob((blob) => herunterladen(`Sicherheitskarte-${vorname(p)}.png`, blob, "image/png"), "image/png");
};

// ---------- Ansicht ----------

export function kinderAnsicht() {
  const r = zustand.reise;
  const sichtbar = Object.fromEntries(Object.entries(SEITEN).filter(([k]) => k !== "flughafen" || fluege().length));
  const seite = sichtbar[zustand.kinderSeite] ? zustand.kinderSeite : "heute";
  const ks = kinder();
  const p = kind();
  if (!p) return `<div class="karte-box"><p>Unter „Reisende“ zuerst die Mitreisenden (und Kinder) eintragen.</p></div>`;
  const inhalt = {
    heute: () => seiteHeute(r),
    pass: () => seitePass(r),
    entdecken: () => seiteEntdecken(r),
    spiele: () => `${quizBox(r)}${memoryBox()}${puzzleBox()}${wimmelBox()}${schatzBox()}${bingoBox(r)}${warteBox()}`,
    tagebuch: () => seiteTagebuch(r),
    kreativ: () => kreativSeite(r),
    flughafen: () => flughafenKinderSeite(),
    abend: () => `${geschichteBox(r)}${challengeBox()}${rankingBox(r)}${rueckblickBox(r)}`,
    sachen: () => seiteSachen(),
    eltern: () => seiteEltern(r),
  }[seite]();
  setTimeout(malenStarten, 0);
  if (seite === "kreativ") setTimeout(postkarteZeichnen, 0);
  if (seite === "flughafen") setTimeout(bordkarteZeichnen, 0);
  return `<div class="kinder">
    ${ks.length > 1 ? `<div class="kindwahl">${ks.map((k) => `<button class="kindknopf ${k.id === p?.id ? "an" : ""}" data-aktion="kind-waehlen" data-id="${esc(k.id)}">${esc(vorname(k))}</button>`).join("")}</div>` : ""}
    <nav class="kinderseiten">${Object.entries(sichtbar).map(([k, t]) => `<button class="${k === seite ? "an" : ""}" data-aktion="kind-seite" data-seite="${k}">${t}</button>`).join("")}</nav>
    ${inhalt}
  </div>`;
}

aktionen["kind-waehlen"] = (el) => {
  zustand.kind = el.dataset.id;
  neuZeichnen();
};
aktionen["kind-seite"] = (el) => {
  zustand.kinderSeite = el.dataset.seite;
  neuZeichnen();
  window.scrollTo({ top: 0 });
};
aenderungen["kind-land"] = (el) => {
  zustand.kindLand = el.value;
  neuZeichnen();
};
const STIMMEN = { en: "en-US", fr: "fr-FR", es: "es-ES", it: "it-IT", pt: "pt-PT", el: "el-GR", hr: "hr-HR", tr: "tr-TR", ar: "ar-SA", nl: "nl-NL", no: "nb-NO", da: "da-DK", sv: "sv-SE", is: "is-IS", th: "th-TH", pap: "nl-NL", de: "de-DE" };
aktionen["wort-sprechen"] = (el) => {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(el.dataset.text.replace(/\s*\(.*\)$/, ""));
  u.lang = STIMMEN[el.dataset.sprache] ?? "en-US";
  u.rate = 0.85;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
};

// ---------- Kinder-Kapitel fürs Reisebuch ----------

export function kinderKapitel(reise, extras, fotoAdresse) {
  const ks = (reise.personen ?? []).filter(istKind);
  if (!ks.length) return "";
  const stempel = stempelDerReise(reise, "9999").filter((s) => s.tag.datum <= heute());
  const tiere = tiereDerReise(reise).filter((t) => extras.tiere?.[t.name]);
  return ks.map((p) => {
    const k = { abzeichen: {}, tagebuch: {}, ...(extras.kinder?.[p.id] ?? {}) };
    const eintraege = Object.entries(k.tagebuch ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const manuell = ABZEICHEN.filter((a) => k.abzeichen?.[a.id]);
    return `<section class="buch-tag buch-kinder">
      <div class="buch-tagkopf"><h3>🧒 Die Reise von ${esc(vorname(p))}</h3></div>
      ${stempel.length ? `<div class="stempelseite">${stempel.map((s, i) => stempelSvg({ ...s, besucht: true }, i)).join("")}</div>` : ""}
      ${manuell.length ? `<p>🏅 ${manuell.map((a) => `${a.emoji} ${esc(a.name)}`).join(" · ")}</p>` : ""}
      ${tiere.length ? `<p>🔍 Entdeckt: ${tiere.map((t) => esc(t.name)).join(", ")}</p>` : ""}
      ${lieblingeHtml(k, fotoAdresse)}
      ${eintraege.map(([d, x]) => `<div class="buch-erlebnis"><h4>${esc(datumText(d, { weekday: "long", day: "numeric", month: "long" }))} ${x.stimmung != null ? STIMMUNGEN[x.stimmung] : ""}</h4>${x.text ? `<blockquote>${esc(x.text)}</blockquote>` : ""}${x.bildId ? `<img class="buch-kinderbild" src="${fotoAdresse(x.bildId)}" alt="">` : ""}</div>`).join("")}
    </section>`;
  }).join("");
}
