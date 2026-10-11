// Weitere Kinder-Funktionen: Gute-Nacht-Geschichte, Stimmen-Tagebuch, Lieblings-Ranking, Postkarte an Oma,
// Sammelalbum, Memory, Puzzle, Wimmelbild, Familien-Challenge, Rückblick-Quiz und Zahlen-Spaß.
import { zustand, $, esc, datumText, haefen, aktionen, aenderungen, neuZeichnen, anfrage, heute, fotoHochladen, fotoUrl, einfachesMarkdown, herunterladen } from "./kern.js";
import { kinder, kind, vorname, zustandKind, istSeetag, kinderSetzen } from "./kinderbasis.js";
import { geschichteOhneKi, zahlenSpass, landFuer, mischen } from "./kinderdaten.js";
import { tiereDerReise } from "./tiere.js";
import { tierBild } from "./tierbilder.js";
import { entfernungKm } from "./rechnen.js";
import { reiseZeitraum, tageZwischen } from "./unterwegs-logik.js";

const tagLabel = (h) => `${datumText(h.datum)} – ${istSeetag(h) ? "Seetag" : esc(h.name)}`;
const tagWahl = (aktion, gewaehlt, nurBisHeute = false) => `<select data-aktion="${aktion}" aria-label="Tag">${haefen().filter((h) => !nurBisHeute || h.datum <= heute()).map((h) => `<option value="${esc(h.id)}" ${h.id === gewaehlt?.id ? "selected" : ""}>${tagLabel(h)}</option>`).join("")}</select>`;
const standardTag = (id) => haefen().find((h) => h.id === id) ?? haefen().find((h) => h.datum === heute()) ?? [...haefen()].reverse().find((h) => h.datum <= heute()) ?? haefen()[0];

// ---------- Gute-Nacht-Geschichte ----------

function geschichteText(r, tag) {
  const ki = zustand.extras.geschichten?.[tag.id];
  if (ki) return { text: ki.text, ki: true };
  const gesehen = Object.entries(zustand.extras.tiere ?? {}).sort((a, b) => String(b[1]).localeCompare(String(a[1])));
  const tierHeute = gesehen.find(([, d]) => d === tag.datum)?.[0] ?? tiereDerReise({ haefen: [tag] })[0]?.name ?? gesehen[0]?.[0] ?? "";
  const erlebnis = (r.ausfluege ?? []).find((a) => a.hafenId === tag.id && a.status === "gebucht")?.titel ?? "";
  return { text: geschichteOhneKi({ kinder: kinder().filter((p) => p.typ === "kind").map(vorname), ort: tag.name, seetag: istSeetag(tag), tier: tierHeute, erlebnis, schiff: r.schiff }, tag.id), ki: false };
}

export function geschichteBox(r) {
  const tag = standardTag(zustand.geschichteTag);
  if (!tag) return "";
  const g = geschichteText(r, tag);
  return `<div class="karte-box geschichte">
    <div class="zeile"><h2>🌙 Gute-Nacht-Geschichte</h2><span class="platz"></span>${tagWahl("geschichte-tag", tag)}</div>
    <div class="geschichtetext">${einfachesMarkdown(g.text)}</div>
    <div class="zeile">
      <button class="knopf" data-aktion="vorlesen">🔊 Vorlesen</button><button class="knopf leise" data-aktion="vorlesen-stopp">⏹ Stopp</button>
      ${zustand.info.ki ? `<button class="knopf leise" data-aktion="geschichte-ki" data-id="${esc(tag.id)}">✨ ${g.ki ? "Neue Geschichte" : "Geschichte von der KI schreiben lassen"}</button>` : ""}
      <span class="klein leise" id="geschichteStatus">${g.ki ? "Von der KI geschrieben" : ""}</span>
    </div>
  </div>`;
}

aenderungen["geschichte-tag"] = (el) => {
  zustand.geschichteTag = el.value;
  neuZeichnen();
};
aktionen["vorlesen"] = () => {
  if (!("speechSynthesis" in window)) return alert("Dieses Gerät kann leider nicht vorlesen.");
  const text = $(".geschichtetext")?.innerText ?? "";
  speechSynthesis.cancel();
  // In Absätzen vorlesen (lange Texte brechen sonst bei manchen Browsern ab)
  for (const teil of text.split(/\n+/).filter((x) => x.trim())) {
    const u = new SpeechSynthesisUtterance(teil);
    u.lang = "de-DE";
    u.rate = 0.88;
    u.pitch = 1.05;
    speechSynthesis.speak(u);
  }
};
aktionen["vorlesen-stopp"] = () => window.speechSynthesis?.cancel();
aktionen["geschichte-ki"] = async (el) => {
  el.disabled = true;
  $("#geschichteStatus").textContent = "Die KI schreibt die Geschichte …";
  try {
    zustand.extras.geschichten ??= {};
    zustand.extras.geschichten[el.dataset.id] = await anfrage(`/api/reisen/${zustand.reise.id}/geschichte`, { method: "POST", body: { hafenId: el.dataset.id } });
    neuZeichnen();
  } catch (e) {
    $("#geschichteStatus").textContent = e.message;
    el.disabled = false;
  }
};

// ---------- Stimmen-Tagebuch ----------

let aufnahme = null;
export function stimmeBox(datum) {
  const e = zustandKind().tagebuch?.[datum] ?? {};
  const kann = typeof MediaRecorder !== "undefined" && navigator.mediaDevices?.getUserMedia;
  return `<div class="stimmbox">
    <p class="kind-text">🎙️ Oder erzähl deinen Tag – einfach sprechen:</p>
    ${e.audioId ? `<audio controls preload="none" src="/api/reisen/${esc(zustand.reise.id)}/dateien/${esc(e.audioId)}"></audio>` : ""}
    ${kann ? `<button class="knopf ${aufnahme ? "gefahr" : ""}" data-aktion="aufnahme" data-datum="${esc(datum)}">${aufnahme ? "⏹ Aufnahme beenden" : e.audioId ? "🎙️ Neu aufnehmen" : "🎙️ Aufnehmen"}</button>` : `<span class="leise klein">Aufnehmen geht in diesem Browser leider nicht.</span>`}
    <span class="klein leise" id="aufnahmeStatus">${aufnahme ? "Aufnahme läuft … (max. 3 Minuten)" : ""}</span>
  </div>`;
}

const AUDIO_TYPEN = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
aktionen["aufnahme"] = async (el) => {
  if (aufnahme) return aufnahme.stop();
  const datum = el.dataset.datum;
  let strom;
  try {
    strom = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return alert("Das Mikrofon ist nicht freigegeben. Bitte im Browser erlauben.");
  }
  const typ = AUDIO_TYPEN.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
  const rec = new MediaRecorder(strom, typ ? { mimeType: typ } : undefined);
  const teile = [];
  rec.ondataavailable = (e) => e.data.size && teile.push(e.data);
  rec.onstop = async () => {
    strom.getTracks().forEach((t) => t.stop());
    clearTimeout(rec.timer);
    aufnahme = null;
    neuZeichnen();
    const basisTyp = (rec.mimeType || typ || "audio/webm").split(";")[0];
    const blob = new Blob(teile, { type: basisTyp });
    const status = (t) => $("#aufnahmeStatus") && ($("#aufnahmeStatus").textContent = t);
    status("Speichere …");
    try {
      const daten = await new Promise((ok) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(",")[1] ?? "");
        r.readAsDataURL(blob);
      });
      const info = await anfrage(`/api/reisen/${zustand.reise.id}/dateien`, { method: "POST", body: { name: `Tagebuch-${vorname(kind())}-${datum}.${basisTyp.split("/")[1]}`, typ: basisTyp === "audio/x-m4a" ? "audio/mp4" : basisTyp, daten } });
      zustand.extras.dateien.push(info);
      const vorher = zustandKind().tagebuch?.[datum] ?? {};
      await kinderSetzen("tagebuch", datum, { ...vorher, audioId: info.id });
      neuZeichnen();
    } catch (e) {
      status(e.message);
    }
  };
  rec.start();
  rec.timer = setTimeout(() => rec.state === "recording" && rec.stop(), 3 * 60_000);
  aufnahme = rec;
  neuZeichnen();
};

// ---------- Lieblings-Ranking ----------

export function rankingBox(r) {
  const p = kind();
  const k = zustandKind(p).ranking ?? {};
  const orte = [...new Set(haefen().filter((h) => !istSeetag(h) && h.datum <= heute()).map((h) => h.name))];
  const erlebnisse = [...new Set((r.ausfluege ?? []).filter((a) => a.status === "gebucht" && haefen().find((h) => h.id === a.hafenId)?.datum <= heute()).map((a) => a.titel))];
  const tiere = Object.keys(zustand.extras.tiere ?? {});
  const wahl = (feld, liste, platzhalter) => liste.length
    ? `<select data-ranking="${feld}"><option value="">${platzhalter}</option>${liste.map((x) => `<option ${k[feld] === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`
    : `<input data-ranking="${feld}" value="${esc(k[feld] ?? "")}" placeholder="${esc(platzhalter)}" maxlength="100">`;
  // Siegertreppchen: Lieblingsorte aller Kinder
  const stimmen = new Map();
  for (const c of kinder()) {
    const o = zustandKind(c).ranking?.ort;
    if (o) stimmen.set(o, [...(stimmen.get(o) ?? []), vorname(c)]);
  }
  const top = [...stimmen.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  const reihenfolge = [top[1], top[0], top[2]];
  return `<div class="karte-box">
    <h2>🏆 Meine Lieblinge der Reise</h2>
    <div class="formular zwei ranking">
      <label>📍 Lieblingsort${wahl("ort", orte, "– wähle –")}</label>
      <label>🍽️ Bestes Essen<input data-ranking="essen" value="${esc(k.essen ?? "")}" placeholder="z. B. Mango-Eis" maxlength="100"></label>
      <label>⭐ Bestes Erlebnis${wahl("erlebnis", erlebnisse, "– wähle –")}</label>
      <label>🐾 Lieblingstier${wahl("tier", tiere, "– wähle –")}</label>
    </div>
    ${top.length ? `<h3>Siegertreppchen der Lieblingsorte</h3><div class="treppchen">${reihenfolge.map((t, i) => (t ? `<div class="stufe stufe${[2, 1, 3][i]}"><span class="stufe-name">${esc(t[0])}</span><span class="klein">${esc(t[1].join(", "))}</span><div class="sockel">${[2, 1, 3][i]}</div></div>` : `<div class="stufe leer"></div>`)).join("")}</div>` : ""}
  </div>`;
}

document.addEventListener("change", async (e) => {
  const feld = e.target.dataset?.ranking;
  if (!feld || !kind()) return;
  const k = zustandKind().ranking ?? {};
  await kinderSetzen("ranking", "", { ...k, [feld]: e.target.value }).catch((err) => alert(err.message));
  neuZeichnen();
});

// ---------- Kreativ: Postkarte an Oma, Sammelalbum ----------

let postkartenBild = null; // Data-URL eines lokal gewählten Fotos (wird nicht hochgeladen)

export function kreativSeite(r) {
  const p = kind();
  const k = zustandKind(p);
  const tag = standardTag(null);
  const land = landFuer(tag);
  const bilder = Object.entries(k.tagebuch ?? {}).filter(([, x]) => x.bildId).map(([d, x]) => ({ id: x.bildId, d }));
  return `<div class="karte-box">
    <h2>💌 Postkarte an Oma &amp; Opa</h2>
    <div class="formular zwei">
      <label>Bild<select id="pkQuelle"><option value="foto">📷 Foto wählen / aufnehmen</option>${bilder.map((b) => `<option value="${esc(b.id)}">🎨 Mein Bild vom ${esc(datumText(b.d))}</option>`).join("")}</select></label>
      <label>Grüße aus<input id="pkOrt" value="${esc(istSeetag(tag) ? "dem Meer" : tag?.name ?? "")}" maxlength="40"></label>
    </div>
    <label class="knopf leise" id="pkFotoKnopf">📷 Foto<input type="file" accept="image/*" hidden id="pkFoto"></label>
    <label>Text<textarea id="pkText" rows="3" maxlength="300">Liebe Oma, lieber Opa,
hier ist es wunderschön! Viele Grüße von ${esc(vorname(p))}</textarea></label>
    <canvas id="postkarte" width="1500" height="1000" class="postkarte"></canvas>
    <div class="zeile"><button class="knopf" data-aktion="pk-teilen">📤 Senden / Teilen</button><button class="knopf leise" data-aktion="pk-laden">💾 Speichern</button></div>
    <p class="klein leise">Die Karte wird nur auf deinem Gerät erstellt – zum Verschicken per WhatsApp, E-Mail oder zum Drucken.${land ? ` Mit Briefmarke aus ${esc(land.name)} ${land.flagge}.` : ""}</p>
  </div>
  <div class="karte-box">
    <div class="zeile"><h2>🐚 Mein Sammelalbum</h2><span class="platz"></span><strong>${k.funde.length}</strong></div>
    <p class="leise">Muscheln, Steine, Tickets, Federn … fotografieren und sammeln!</p>
    <form class="zeile eng" id="fundNeu"><input name="titel" placeholder="Was hast du gefunden?" maxlength="80" required><label class="knopf">📷 Foto<input type="file" accept="image/*" capture="environment" hidden name="foto"></label></form>
    <span class="klein leise" id="fundStatus"></span>
    ${k.funde.length ? `<div class="funde">${[...k.funde].reverse().map((f) => `<figure class="fund"><img src="${fotoUrl(f.fotoId, true)}" alt=""><figcaption><strong>${esc(f.titel)}</strong><span class="klein leise">${esc(f.ort)}${f.datum ? ` · ${esc(datumText(f.datum))}` : ""}</span></figcaption><button class="link rot" data-aktion="fund-weg" data-id="${esc(f.id)}" aria-label="Entfernen">✕</button></figure>`).join("")}</div>` : ""}
  </div>`;
}

function zeilenUmbruch(ctx, text, breite) {
  const zeilen = [];
  for (const absatz of String(text).split("\n")) {
    let zeile = "";
    for (const wort of absatz.split(" ")) {
      const probe = zeile ? `${zeile} ${wort}` : wort;
      if (ctx.measureText(probe).width > breite && zeile) {
        zeilen.push(zeile);
        zeile = wort;
      } else zeile = probe;
    }
    zeilen.push(zeile);
  }
  return zeilen;
}

async function bildLaden(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

export async function postkarteZeichnen() {
  const c = $("#postkarte");
  if (!c) return;
  const ctx = c.getContext("2d");
  const quelle = $("#pkQuelle").value;
  $("#pkFotoKnopf").hidden = quelle !== "foto";
  ctx.fillStyle = "#fffdf6";
  ctx.fillRect(0, 0, 1500, 1000);
  // Bild links
  let img = null;
  try {
    if (quelle === "foto" && postkartenBild) img = await bildLaden(postkartenBild);
    else if (quelle !== "foto") img = await bildLaden(fotoUrl(quelle));
  } catch {}
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(40, 40, 860, 920, 24);
  ctx.clip();
  if (img) {
    const f = Math.max(860 / img.width, 920 / img.height);
    ctx.drawImage(img, 40 + (860 - img.width * f) / 2, 40 + (920 - img.height * f) / 2, img.width * f, img.height * f);
  } else {
    const g = ctx.createLinearGradient(0, 40, 0, 960);
    g.addColorStop(0, "#4fc3f7");
    g.addColorStop(1, "#0277bd");
    ctx.fillStyle = g;
    ctx.fillRect(40, 40, 860, 920);
    ctx.font = "260px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("🏝️", 470, 600);
    ctx.textAlign = "left";
  }
  ctx.restore();
  // „Grüße aus …“ auf dem Bild
  ctx.font = "bold 64px Georgia, serif";
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillText(`Grüße aus ${$("#pkOrt").value}`.slice(0, 26), 84, 904);
  ctx.fillStyle = "#fff";
  ctx.fillText(`Grüße aus ${$("#pkOrt").value}`.slice(0, 26), 80, 900);
  // Briefmarke
  const land = landFuer(standardTag(null));
  ctx.strokeStyle = "#c62828";
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 4;
  ctx.strokeRect(1270, 60, 180, 210);
  ctx.setLineDash([]);
  ctx.font = "110px system-ui";
  ctx.fillText(land?.flagge ?? "✈️", 1300, 200);
  ctx.font = "bold 24px system-ui";
  ctx.fillStyle = "#c62828";
  ctx.fillText((land?.name ?? "Urlaub").slice(0, 12).toUpperCase(), 1285, 250);
  // Linien und Text rechts
  ctx.strokeStyle = "#d7ccc8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(950, 80);
  ctx.lineTo(950, 920);
  ctx.stroke();
  ctx.fillStyle = "#263238";
  ctx.font = "40px 'Comic Sans MS', 'Segoe Print', system-ui, sans-serif";
  const zeilen = zeilenUmbruch(ctx, $("#pkText").value, 480).slice(0, 11);
  zeilen.forEach((z, i) => ctx.fillText(z, 985, 360 + i * 54));
  ctx.font = "22px system-ui";
  ctx.fillStyle = "#8d6e63";
  ctx.fillText(new Date().toLocaleDateString("de-DE"), 985, 930);
}

async function postkarteBlob() {
  await postkarteZeichnen();
  return new Promise((ok) => $("#postkarte").toBlob(ok, "image/jpeg", 0.92));
}
document.addEventListener("input", (e) => {
  if (["pkText", "pkOrt"].includes(e.target.id)) postkarteZeichnen();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "pkQuelle") postkarteZeichnen();
  if (e.target.id === "pkFoto" && e.target.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      postkartenBild = r.result;
      postkarteZeichnen();
    };
    r.readAsDataURL(e.target.files[0]);
  }
});
aktionen["pk-laden"] = async () => herunterladen(`Postkarte-${$("#pkOrt").value || "Urlaub"}.jpg`, await postkarteBlob(), "image/jpeg");
aktionen["pk-teilen"] = async () => {
  const blob = await postkarteBlob();
  const datei = new File([blob], "Postkarte.jpg", { type: "image/jpeg" });
  if (navigator.canShare?.({ files: [datei] })) await navigator.share({ files: [datei], text: $("#pkText").value }).catch(() => {});
  else herunterladen("Postkarte.jpg", blob, "image/jpeg");
};

document.addEventListener("change", async (e) => {
  if (e.target.name !== "foto" || e.target.closest("form")?.id !== "fundNeu" || !e.target.files[0]) return;
  const form = e.target.closest("form");
  if (!form.titel.value.trim()) {
    e.target.value = "";
    return alert("Schreib zuerst, was du gefunden hast.");
  }
  $("#fundStatus").textContent = "Lade hoch …";
  try {
    const fotoId = await fotoHochladen(e.target.files[0], { art: "kinder" });
    const tag = standardTag(null);
    await kinderSetzen("fund", "", { titel: form.titel.value, fotoId, ort: istSeetag(tag) ? "auf dem Meer" : tag?.name ?? "", datum: heute() });
    neuZeichnen();
  } catch (err) {
    $("#fundStatus").textContent = err.message;
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "fundNeu") e.preventDefault();
});
aktionen["fund-weg"] = async (el) => {
  if (!confirm("Fundstück entfernen?")) return;
  await kinderSetzen("fund", el.dataset.id, null);
  neuZeichnen();
};

// ---------- Memory ----------

let memory = null;
function memoryNeu() {
  const fotos = zustand.beitraege.fotos.filter((f) => f.art !== "kinder").slice(-8).map((f) => ({ id: f.id, html: `<img src="${fotoUrl(f.id, true)}" alt="">` }));
  const tiere = tiereDerReise(zustand.reise).map((t) => ({ id: t.name, html: `<span class="memory-tier">${tierBild(t)}</span>` }));
  const motive = [...fotos, ...tiere].slice(0, 8);
  while (motive.length < 6) motive.push({ id: `e${motive.length}`, html: `<span class="memory-tier">${["🐬", "🌴", "⛵", "🐢", "🦀", "🐠"][motive.length]}</span>` });
  memory = { karten: mischen([...motive, ...motive].map((m, i) => ({ ...m, nr: i })), String(Date.now())), offen: [], gefunden: new Set(), zuege: 0 };
}
export function memoryBox() {
  if (!memory) memoryNeu();
  const fertig = memory.gefunden.size === memory.karten.length / 2;
  return `<div class="karte-box">
    <div class="zeile"><h2>🃏 Memory</h2><span class="platz"></span><span class="klein">${memory.zuege} Züge</span><button class="knopf leise" data-aktion="memory-neu">Neu mischen</button></div>
    <p class="leise">Mit euren Urlaubsfotos und den Tieren der Reise.</p>
    <div class="memory">${memory.karten.map((k, i) => {
      const sichtbar = memory.offen.includes(i) || memory.gefunden.has(k.id);
      return `<button class="memory-karte ${sichtbar ? "auf" : ""} ${memory.gefunden.has(k.id) ? "gefunden" : ""}" data-aktion="memory" data-i="${i}" ${sichtbar ? "disabled" : ""}>${sichtbar ? k.html : "❓"}</button>`;
    }).join("")}</div>
    ${fertig ? `<p class="kind-text">🎉 Geschafft in ${memory.zuege} Zügen!</p>` : ""}
  </div>`;
}
aktionen["memory-neu"] = () => {
  memoryNeu();
  neuZeichnen();
};
aktionen["memory"] = (el) => {
  const i = Number(el.dataset.i);
  if (memory.offen.length >= 2) return;
  memory.offen.push(i);
  if (memory.offen.length === 2) {
    memory.zuege++;
    const [a, b] = memory.offen.map((n) => memory.karten[n]);
    if (a.id === b.id) {
      memory.gefunden.add(a.id);
      memory.offen = [];
    } else setTimeout(() => {
      memory.offen = [];
      neuZeichnen();
    }, 1100);
  }
  neuZeichnen();
};

// ---------- Puzzle ----------

let puzzle = null;
export function puzzleBox() {
  const fotos = zustand.beitraege.fotos.filter((f) => f.art !== "kinder" || zustand.beitraege.fotos.length < 3);
  if (!fotos.length) return `<div class="karte-box"><h2>🧩 Puzzle</h2><p class="leise">Sobald es Urlaubsfotos gibt (z. B. im Fotoalbum unter „Erlebnisse“), wird hier daraus ein Puzzle.</p></div>`;
  if (!puzzle || !fotos.some((f) => f.id === puzzle.foto)) puzzleNeu(fotos.at(-1).id, 3);
  const n = puzzle.n;
  const geloest = puzzle.teile.every((t, i) => t === i);
  return `<div class="karte-box">
    <div class="zeile"><h2>🧩 Puzzle</h2><span class="platz"></span>
      <select data-aktion="puzzle-groesse"><option value="3" ${n === 3 ? "selected" : ""}>3 × 3</option><option value="4" ${n === 4 ? "selected" : ""}>4 × 4</option></select>
      <button class="knopf leise" data-aktion="puzzle-anderes">Anderes Foto</button></div>
    <p class="leise">Tippe zwei Teile an, um sie zu tauschen.</p>
    <div class="puzzle" style="--n:${n}">${puzzle.teile.map((t, i) => `<button class="puzzle-teil ${puzzle.gewaehlt === i ? "an" : ""}" data-aktion="puzzle" data-i="${i}" style="background-image:url('${fotoUrl(puzzle.foto)}');background-position:${((t % n) / (n - 1)) * 100}% ${(Math.floor(t / n) / (n - 1)) * 100}%"></button>`).join("")}</div>
    ${geloest ? `<p class="kind-text">🎉 Super, das Bild ist fertig!</p>` : ""}
  </div>`;
}
function puzzleNeu(foto, n) {
  let teile = mischen([...Array(n * n).keys()], `${foto}${Date.now()}`);
  if (teile.every((t, i) => t === i)) teile = teile.reverse();
  puzzle = { foto, n, teile, gewaehlt: null };
}
aktionen["puzzle"] = (el) => {
  const i = Number(el.dataset.i);
  if (puzzle.gewaehlt == null) puzzle.gewaehlt = i;
  else {
    const j = puzzle.gewaehlt;
    [puzzle.teile[i], puzzle.teile[j]] = [puzzle.teile[j], puzzle.teile[i]];
    puzzle.gewaehlt = null;
  }
  neuZeichnen();
};
aktionen["puzzle-anderes"] = () => {
  const fotos = zustand.beitraege.fotos;
  const i = fotos.findIndex((f) => f.id === puzzle.foto);
  puzzleNeu(fotos[(i + 1) % fotos.length].id, puzzle.n);
  neuZeichnen();
};
aenderungen["puzzle-groesse"] = (el) => {
  puzzleNeu(puzzle.foto, Number(el.value));
  neuZeichnen();
};

// ---------- Wimmelbild ----------

const WIMMEL = ["🐟", "🐠", "🐡", "🦀", "🐚", "🌴", "🐬", "⛵", "🏝️", "🌊", "🪸", "🦑", "🐙", "🦞", "🏖️", "☀️", "🌺", "🥥"];
const ZIELE = [["🛳️", "das Schiff"], ["🐢", "die Schildkröte"], ["🦩", "den Flamingo"], ["🧜‍♀️", "die Meerjungfrau"], ["🏴‍☠️", "die Piratenflagge"], ["🦈", "den Hai"]];
let wimmel = null;
function wimmelNeu() {
  const runde = (wimmel?.runde ?? -1) + 1;
  const [ziel, name] = ZIELE[runde % ZIELE.length];
  const felder = Array.from({ length: 80 }, (_, i) => WIMMEL[(i * 7 + runde * 13 + ((i * i) % 11)) % WIMMEL.length]);
  felder[(runde * 37 + 23) % 80] = ziel;
  wimmel = { runde, ziel, name, felder, start: Date.now(), gefunden: null };
}
export function wimmelBox() {
  if (!wimmel) wimmelNeu();
  return `<div class="karte-box">
    <div class="zeile"><h2>🔎 Wimmelbild</h2><span class="platz"></span><button class="knopf leise" data-aktion="wimmel-neu">Nächstes Bild</button></div>
    <p class="kind-text">Finde ${wimmel.name} ${wimmel.ziel}!</p>
    <div class="wimmel">${wimmel.felder.map((e, i) => `<button class="wimmel-feld ${wimmel.gefunden != null && e === wimmel.ziel ? "treffer" : ""}" data-aktion="wimmel" data-i="${i}">${e}</button>`).join("")}</div>
    ${wimmel.gefunden != null ? `<p class="kind-text">🎉 Gefunden in ${wimmel.gefunden} Sekunden!</p>` : ""}
  </div>`;
}
aktionen["wimmel"] = (el) => {
  if (wimmel.felder[Number(el.dataset.i)] === wimmel.ziel && wimmel.gefunden == null) {
    wimmel.gefunden = Math.round((Date.now() - wimmel.start) / 1000);
    neuZeichnen();
  } else {
    el.classList.add("daneben");
    setTimeout(() => el.classList.remove("daneben"), 400);
  }
};
aktionen["wimmel-neu"] = () => {
  wimmelNeu();
  neuZeichnen();
};

// ---------- Familien-Challenge ----------

export const CHALLENGE_NAMEN = { essen: "🍽️ Neues Essen probiert", tiere: "🐾 Tiere entdeckt", sprache: "🗣️ Fremde Wörter benutzt", baden: "🏊 Im Meer/Pool gewesen", foto: "📸 Bestes Foto des Tages", helfen: "🤝 Geholfen" };
export function challengeBox() {
  const c = zustand.extras.challenge ?? {};
  const ps = zustand.reise.personen ?? [];
  const summe = (pid) => Object.values(c).reduce((s, x) => s + (x?.[pid] ?? 0), 0);
  const fuehrend = Math.max(0, ...ps.map((p) => summe(p.id)));
  return `<div class="karte-box">
    <h2>🏅 Familien-Challenge</h2>
    <p class="leise">Wer sammelt die meisten Punkte? Plus antippen, wenn jemand etwas geschafft hat.</p>
    <div class="tabelle"><table class="challenge"><thead><tr><th></th>${ps.map((p) => `<th>${summe(p.id) === fuehrend && fuehrend ? "👑 " : ""}${esc(vorname(p))}</th>`).join("")}</tr></thead><tbody>
      ${Object.entries(CHALLENGE_NAMEN).map(([k, t]) => `<tr><td>${esc(t)}</td>${ps.map((p) => `<td class="punkte"><button class="mini" data-aktion="challenge" data-k="${k}" data-p="${esc(p.id)}" data-d="-1" aria-label="minus">−</button><strong>${c[k]?.[p.id] ?? 0}</strong><button class="mini plus" data-aktion="challenge" data-k="${k}" data-p="${esc(p.id)}" data-d="1" aria-label="plus">+</button></td>`).join("")}</tr>`).join("")}
    </tbody><tfoot><tr><th>Gesamt</th>${ps.map((p) => `<th>${summe(p.id)}</th>`).join("")}</tr></tfoot></table></div>
  </div>`;
}
let challengeKette = Promise.resolve();
aktionen["challenge"] = (el) => {
  const { k, p, d } = el.dataset;
  const c = (zustand.extras.challenge ??= {});
  c[k] ??= {};
  c[k][p] = Math.max(0, (c[k][p] ?? 0) + Number(d));
  neuZeichnen();
  challengeKette = challengeKette.then(() => anfrage(`/api/reisen/${zustand.reise.id}/challenge`, { method: "PUT", body: { kategorie: k, personId: p, delta: Number(d) } }).catch((e) => alert(e.message)));
};

// ---------- Rückblick-Quiz für den letzten Abend ----------

export function rueckblickFragen(r) {
  const tage = [...(r.haefen ?? [])].filter((h) => h.datum && h.datum <= heute()).sort((a, b) => a.datum.localeCompare(b.datum));
  const orte = [...new Set(tage.filter((h) => !istSeetag(h)).map((h) => h.name))];
  const fragen = [];
  const optionen = (richtig, andere) => mischen([richtig, ...mischen(andere.filter((x) => x && x !== richtig), richtig).slice(0, 2)], `${richtig}r`);
  tage.forEach((h, i) => {
    if (!istSeetag(h) && orte.length > 2) fragen.push({ frage: `Wo waren wir an Tag ${i + 1} (${datumText(h.datum)})?`, antwort: h.name, optionen: optionen(h.name, orte) });
  });
  if (orte.length) fragen.push({ frage: "An wie vielen verschiedenen Orten waren wir?", antwort: String(orte.length), optionen: optionen(String(orte.length), [String(orte.length + 2), String(Math.max(1, orte.length - 1))]) });
  const seetage = tage.filter(istSeetag).length;
  if (seetage) fragen.push({ frage: "Wie viele Seetage hatten wir?", antwort: String(seetage), optionen: optionen(String(seetage), [String(seetage + 1), String(seetage + 3)]) });
  const tiere = Object.entries(zustand.extras.tiere ?? {}).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  if (tiere.length >= 2) fragen.push({ frage: "Welches Tier haben wir als Erstes entdeckt?", antwort: tiere[0][0], optionen: optionen(tiere[0][0], tiere.slice(1).map((t) => t[0])) });
  for (const a of (r.ausfluege ?? []).filter((x) => x.status === "gebucht")) {
    const h = tage.find((t) => t.id === a.hafenId);
    if (h && orte.length > 2) fragen.push({ frage: `Wo haben wir „${a.titel}“ gemacht?`, antwort: h.name, optionen: optionen(h.name, orte) });
  }
  for (const k of kinder()) {
    const o = zustandKind(k).ranking?.ort;
    if (o && orte.length > 2) fragen.push({ frage: `Was ist der Lieblingsort von ${vorname(k)}?`, antwort: o, optionen: optionen(o, orte) });
  }
  const bew = zustand.beitraege.bewertungen.filter((b) => b.zielArt === "ausflug");
  if (bew.length >= 2) {
    const best = [...bew].sort((a, b) => b.sterne - a.sterne)[0];
    const titel = (b) => r.ausfluege.find((a) => a.id === b.zielId)?.titel;
    if (titel(best)) fragen.push({ frage: "Welcher Ausflug bekam die beste Bewertung?", antwort: titel(best), optionen: optionen(titel(best), bew.map(titel)) });
  }
  if (r.schiff && (r.art ?? "kreuzfahrt") === "kreuzfahrt") fragen.push({ frage: "Wie hieß unser Schiff?", antwort: r.schiff, optionen: optionen(r.schiff, ["Titanic", "Black Pearl", "Mein Schiff 4", "AIDAnova", "Queen Mary 2"]) });
  return mischen(fragen, r.id).slice(0, 15);
}

export function rueckblickBox(r) {
  const fragen = rueckblickFragen(r);
  if (fragen.length < 3) return "";
  const s = (zustand.rueckblick ??= { nr: 0, aufgedeckt: false, punkte: {} });
  const f = fragen[s.nr % fragen.length];
  const ps = r.personen ?? [];
  return `<div class="karte-box">
    <div class="zeile"><h2>🎉 Rückblick-Quiz für den letzten Abend</h2><span class="platz"></span><span class="klein">Frage ${(s.nr % fragen.length) + 1} / ${fragen.length}</span></div>
    <p class="leise">Alle raten laut – dann auflösen und Punkte vergeben.</p>
    <div class="spielkarte"><p class="kind-text"><strong>${esc(f.frage)}</strong></p>
      <div class="quizantworten">${f.optionen.map((o) => `<span class="quizknopf ${s.aufgedeckt && o === f.antwort ? "richtig" : ""}">${esc(o)}</span>`).join("")}</div></div>
    <div class="zeile">${s.aufgedeckt ? `<button class="knopf" data-aktion="rb-weiter">Nächste Frage ➜</button>` : `<button class="knopf" data-aktion="rb-aufdecken">Auflösen</button>`}</div>
    <div class="rb-punkte">${ps.map((p) => `<button class="kindknopf" data-aktion="rb-punkt" data-p="${esc(p.id)}">${esc(vorname(p))}: <strong>${s.punkte[p.id] ?? 0}</strong> ＋</button>`).join("")}</div>
  </div>`;
}
aktionen["rb-aufdecken"] = () => {
  zustand.rueckblick.aufgedeckt = true;
  neuZeichnen();
};
aktionen["rb-weiter"] = () => {
  zustand.rueckblick.nr++;
  zustand.rueckblick.aufgedeckt = false;
  neuZeichnen();
};
aktionen["rb-punkt"] = (el) => {
  const p = zustand.rueckblick.punkte;
  p[el.dataset.p] = (p[el.dataset.p] ?? 0) + 1;
  neuZeichnen();
};

// ---------- Zahlen-Spaß ----------

export function zahlenSpassBox(r) {
  const orte = [...(r.haefen ?? [])].filter((h) => !istSeetag(h) && Number.isFinite(h.lat) && h.datum).sort((a, b) => a.datum.localeCompare(b.datum));
  const bisher = orte.filter((h) => h.datum <= heute());
  const strecke = (liste) => liste.reduce((s, h, i) => s + (i ? entfernungKm(liste[i - 1], h) ?? 0 : 0), 0);
  const { von, bis } = reiseZeitraum(r);
  const vorher = !von || heute() < von;
  const fakten = zahlenSpass({ km: strecke(vorher ? orte : bisher), tage: von ? tageZwischen(von, bis) + 1 : 0, orte: new Set(orte.map((h) => h.name)).size, laender: new Set(orte.map((h) => landFuer(h)?.name ?? h.land).filter(Boolean)).size, schiff: (r.art ?? "kreuzfahrt") === "kreuzfahrt" ? r.schiff : "" });
  if (!fakten.length) return "";
  return `<div class="karte-box"><h2>🔢 Zahlen-Spaß</h2>${vorher ? `<p class="leise">So lang wird unsere Reise (Luftlinie zwischen den Orten):</p>` : ""}<ul class="zahlenspass">${fakten.map((f) => `<li>${vorher ? f.replace("Wir sind schon ca.", "Wir fahren ca.").replace(" unterwegs –", " –") : f}</li>`).join("")}</ul></div>`;
}

// ---------- Kinder-Kapitel: Lieblinge und Fundstücke ----------

export function lieblingeHtml(k, fotoAdresse) {
  const r = k.ranking ?? {};
  const zeilen = [r.ort && `📍 Lieblingsort: <strong>${esc(r.ort)}</strong>`, r.essen && `🍽️ Bestes Essen: <strong>${esc(r.essen)}</strong>`, r.erlebnis && `⭐ Bestes Erlebnis: <strong>${esc(r.erlebnis)}</strong>`, r.tier && `🐾 Lieblingstier: <strong>${esc(r.tier)}</strong>`].filter(Boolean);
  return `${zeilen.length ? `<p>${zeilen.join("<br>")}</p>` : ""}${(k.funde ?? []).length ? `<div class="buch-fotos n${Math.min(k.funde.length, 6)}">${k.funde.slice(0, 6).map((f) => `<img src="${fotoAdresse(f.fotoId)}" alt="${esc(f.titel)}">`).join("")}</div>` : ""}`;
}
