// Übersicht einer Reise: Status, nächste Termine und offene Aufgaben – der Einstieg in jede Reise.
import { zustand, esc, datumText, personen, haefen, hatKoord, geld, stationsArt, istKreuzfahrt, aktionen, heute } from "./kern.js";
import { REISEARTEN, VERKEHRSMITTEL, reiseKosten, buchungsKonflikte, moeglicheDubletten, fehlendeNaechte, istKind } from "./rechnen.js";
import { dokumentHinweise, reiseZeitraum, tageZwischen, packErledigt, kostenPosten } from "./unterwegs-logik.js";

const kurz = (iso) => datumText(iso, { weekday: "short", day: "2-digit", month: "2-digit" });

function statusZeile(r) {
  const { von, bis } = reiseZeitraum(r);
  const h = heute();
  if (!von) return { text: "Noch keine Reisetage eingetragen", stufe: "leise" };
  if (h < von) {
    const n = tageZwischen(h, von);
    return { text: n === 1 ? "Morgen geht es los!" : `Noch ${n} Tage bis zur Abreise`, stufe: "bald" };
  }
  if (bis && h > bis) return { text: "Die Reise ist vorbei – Zeit für Erinnerungen", stufe: "vorbei" };
  const tage = haefen();
  const i = tage.findIndex((t) => t.datum === h);
  const t = tage[i];
  return { text: t ? `Tag ${i + 1} von ${tage.length} – heute ${stationsArt(t) === "seetag" ? "auf See" : `in ${t.name}`}` : "Ihr seid unterwegs", stufe: "jetzt" };
}

/** Termine ab heute (vor der Reise: ab Reisebeginn) – Ausflüge, Verbindungen, Unterkünfte, Fristen. */
function termine(r) {
  const ab = heute();
  const liste = [];
  const tagVon = (id) => haefen().find((h) => h.id === id);
  for (const a of r.ausfluege ?? []) {
    const t = tagVon(a.hafenId);
    if (a.status === "gebucht" && t?.datum >= ab) liste.push({ datum: t.datum, zeit: a.beginn || "", text: a.titel, symbol: "🎟️", ziel: { tag: t.id } });
  }
  for (const v of r.verbindungen ?? []) {
    if (v.status === "verworfen" || !(v.datum >= ab)) continue;
    liste.push({ datum: v.datum, zeit: v.abZeit || "", text: `${VERKEHRSMITTEL[v.art]?.name ?? "Verbindung"} ${v.titel || ""} ${v.von ? `${v.von} → ${v.nach}` : ""}`.trim(), symbol: "", ziel: { ansicht: "verlauf" } });
  }
  for (const h of r.hotels ?? []) {
    if (h.status !== "gebucht") continue;
    if (h.anreise >= ab) liste.push({ datum: h.anreise, zeit: h.checkin || "", text: `Anreise ${h.name}`, symbol: "🏨", ziel: { ansicht: "hotels" } });
    if (h.abreise >= ab) liste.push({ datum: h.abreise, zeit: h.checkout || "", text: `Check-out ${h.name}`, symbol: "🧳", ziel: { ansicht: "hotels" } });
  }
  for (const d of zustand.extras?.dokumente ?? []) {
    if (d.frist && !d.erledigt && d.frist >= ab) liste.push({ datum: d.frist, zeit: d.fristZeit || "", text: `Frist: ${d.titel}`, symbol: "⏰", ziel: { ansicht: "dokumente" } });
  }
  return liste.sort((a, b) => `${a.datum}${a.zeit || "99"}`.localeCompare(`${b.datum}${b.zeit || "99"}`)).slice(0, 8);
}

/** Offene Aufgaben – jeweils mit Sprung an die Stelle, wo man sie erledigt. */
export function offeneAufgaben(r) {
  const aufgaben = [];
  const tage = haefen();
  const kosten = reiseKosten(r);
  const ohneKarte = tage.filter((h) => stationsArt(h) !== "seetag" && !hatKoord(h));
  if (!tage.length) aufgaben.push({ stufe: "rot", text: istKreuzfahrt() ? "Route eintragen (Häfen und Seetage)" : "Reisetage eintragen", ziel: { ansicht: "verlauf" } });
  for (const l of fehlendeNaechte(r)) {
    aufgaben.push({ stufe: l.nurGeplant ? "gelb" : "rot", text: `${l.nurGeplant ? "Unterkunft noch nicht gebucht" : "Keine Unterkunft"} für ${l.naechte} ${l.naechte === 1 ? "Nacht" : "Nächte"} (${kurz(l.von)} – ${kurz(l.bis)})`, ziel: { ansicht: "hotels" } });
  }
  const ohneAnBord = tage.filter((h) => stationsArt(h) === "hafen" && !h.allesAnBord);
  if (ohneAnBord.length) aufgaben.push({ stufe: "gelb", text: `„Alle an Bord“ fehlt an ${ohneAnBord.length} ${ohneAnBord.length === 1 ? "Hafentag" : "Hafentagen"} (Puffer werden geschätzt)`, ziel: { ansicht: "verlauf" } });
  const konflikte = buchungsKonflikte(r);
  if (konflikte.size) {
    const erster = (r.ausfluege ?? []).find((a) => konflikte.has(a.id));
    aufgaben.push({ stufe: "rot", text: `${Math.ceil(konflikte.size / 2)} Buchungskonflikt${konflikte.size > 2 ? "e" : ""}: überschneidende oder doppelt gebuchte Ausflüge`, ziel: { tag: erster?.hafenId } });
  }
  const dubletten = moeglicheDubletten(r.ausfluege);
  if (dubletten.length) aufgaben.push({ stufe: "gelb", text: `${dubletten.length} mögliche ${dubletten.length === 1 ? "Dublette" : "Dubletten"} prüfen`, ziel: { tag: dubletten[0][0].hafenId } });
  const offenGebucht = kosten.offen.filter((o) => o.status === "gebucht");
  if (offenGebucht.length) aufgaben.push({ stufe: "gelb", text: `${offenGebucht.length} ${offenGebucht.length === 1 ? "Buchung hat" : "Buchungen haben"} keinen Preis (${offenGebucht.slice(0, 3).map((o) => o.titel).join(", ")}${offenGebucht.length > 3 ? " …" : ""}) – die Kosten sind unvollständig`, ziel: { ansicht: "kosten" } });
  const notizZahlung = kostenPosten(r, zustand.extras?.ausgaben ?? []).posten.filter((x) => x.notizZahlung);
  if (notizZahlung.length) aufgaben.push({ stufe: "gelb", text: `${notizZahlung.length} ${notizZahlung.length === 1 ? "Posten" : "Posten"}: Notiz erwähnt eine Zahlung, eingetragen ist aber noch nichts – bitte prüfen`, ziel: { ansicht: "kosten" } });
  if (ohneKarte.length) aufgaben.push({ stufe: "info", text: `${ohneKarte.length} ${ohneKarte.length === 1 ? "Ort hat" : "Orte haben"} noch keinen Kartenpunkt`, ziel: { ansicht: "verlauf" } });
  const kinderOhneAlter = personen().filter((p) => istKind(p) && !p.alter && p.alter !== 0);
  if (kinderOhneAlter.length) aufgaben.push({ stufe: "info", text: `Alter fehlt bei ${kinderOhneAlter.map((p) => p.name).join(", ")} (für Kinderpreise)`, ziel: { ansicht: "personen" } });
  for (const h of dokumentHinweise(zustand.extras?.dokumente ?? [], r, heute()).filter((x) => x.stufe !== "info").slice(0, 3)) aufgaben.push({ stufe: h.stufe, text: h.text, ziel: { ansicht: "dokumente" } });
  const pack = zustand.extras?.packliste ?? [];
  const { von } = reiseZeitraum(r);
  if (pack.length && von && tageZwischen(heute(), von) <= 14 && tageZwischen(heute(), von) >= 0) {
    const fam = personen().find((p) => p.userId === zustand.ich?.id)?.familie ?? "";
    const offen = pack.filter((x) => !packErledigt(x, fam, r)).length;
    if (offen) aufgaben.push({ stufe: "info", text: `${offen} Dinge auf der Packliste noch nicht eingepackt`, ziel: { ansicht: "vorbereitung" } });
  }
  const rang = { rot: 0, gelb: 1, info: 2 };
  return aufgaben.sort((a, b) => rang[a.stufe] - rang[b.stufe]);
}

/** „2 Buchungen und 1 Favorit ohne Preis“ – Ideen zählen nie in die Kosten. */
const offenText = (g, f) => {
  const teile = [g && `${g} ${g === 1 ? "Buchung" : "Buchungen"}`, f && `${f} ${f === 1 ? "Favorit" : "Favoriten"}`].filter(Boolean);
  return teile.length ? `<span class="preis-offen">${teile.join(" und ")} ohne Preis</span>` : "";
};

aktionen["kosten-offen"] = (el) => {
  // Nur Favoriten ohne Preis? Dann Favoriten einrechnen, damit sie in der Liste erscheinen
  zustand.kostenMitFavoriten = Boolean(el.dataset.favoriten) || zustand.kostenMitFavoriten;
  aktionen.ansicht({ dataset: { ziel: "kosten" } });
};

const zielAttribute = (ziel) => (ziel?.tag ? `data-aktion="zu-tag" data-id="${esc(ziel.tag)}"` : `data-aktion="ansicht" data-ziel="${esc(ziel?.ansicht ?? "plan")}"`);

export function uebersichtAnsicht() {
  const r = zustand.reise;
  const { von, bis } = reiseZeitraum(r);
  const s = statusZeile(r);
  const k = reiseKosten(r);
  const aktiv = (r.ausfluege ?? []).filter((a) => a.status !== "verworfen");
  const gebucht = aktiv.filter((a) => a.status === "gebucht");
  const aufgaben = offeneAufgaben(r);
  const offenGebucht = k.offen.filter((o) => o.status === "gebucht");
  const offenFavorit = k.offen.filter((o) => o.status === "favorit");
  const liste = termine(r);
  const heuteTag = haefen().find((h) => h.datum === heute());
  return `
    <div class="karte-box uebersichtkopf status-${s.stufe}">
      <div class="klein leise">${esc(REISEARTEN[r.art ?? "kreuzfahrt"] ?? "")}${r.schiff && istKreuzfahrt() ? ` · ${esc(r.schiff)}` : ""}</div>
      <h2>${esc(r.name)}</h2>
      ${von ? `<div>${esc(datumText(von, { day: "numeric", month: "long", year: "numeric" }))}${bis && bis !== von ? ` – ${esc(datumText(bis, { day: "numeric", month: "long", year: "numeric" }))}` : ""} · ${personen().length} ${personen().length === 1 ? "Person" : "Personen"}</div>` : ""}
      <p class="status"><strong>${esc(s.text)}</strong></p>
      ${heuteTag ? `<div class="zeile"><button class="knopf" data-aktion="ansicht" data-ziel="unterwegs">☀️ Heute: Tagesbriefing &amp; Rückweg</button><button class="knopf leise" data-aktion="zu-tag" data-id="${esc(heuteTag.id)}">Tagesplan</button></div>` : ""}
      ${s.stufe === "vorbei" ? `<div class="zeile"><button class="knopf" data-aktion="ansicht" data-ziel="erlebnisse">📸 Erinnerungen &amp; Bewertungen</button></div>` : ""}
    </div>
    <div class="kacheln">
      <button class="kachel" data-aktion="ansicht" data-ziel="plan"><span>Tage</span><strong>${haefen().length}</strong><em>${haefen().filter((h) => stationsArt(h) === "seetag").length ? `${haefen().filter((h) => stationsArt(h) === "seetag").length} Seetage` : ""}</em></button>
      <button class="kachel" data-aktion="ansicht" data-ziel="plan"><span>Ausflüge gebucht</span><strong>${gebucht.length}</strong><em>${aktiv.length - gebucht.length} Ideen/Favoriten</em></button>
      <button class="kachel" data-aktion="kosten-offen" data-favoriten="${offenGebucht.length ? "" : "1"}"><span>Kosten gebucht</span><strong>${geld(k.gebucht)}</strong><em>${offenText(offenGebucht.length, offenFavorit.length) || `geplant ${geld(k.geplant)}`}</em></button>
    </div>
    <div class="karte-box">
      <h3>✅ Offene Aufgaben ${aufgaben.length ? `<span class="leise klein">(${aufgaben.length})</span>` : ""}</h3>
      ${aufgaben.length ? `<ul class="aufgaben">${aufgaben.map((a) => `<li class="${a.stufe}"><button class="link" ${zielAttribute(a.ziel)}>${esc(a.text)} →</button></li>`).join("")}</ul>` : `<p class="leise">Nichts offen – alles eingetragen. 🎉</p>`}
    </div>
    <div class="karte-box">
      <h3>📅 Nächste Termine</h3>
      ${liste.length ? `<ul class="termine">${liste.map((t) => `<li><button class="link" ${zielAttribute(t.ziel)}><span class="termin-datum">${esc(kurz(t.datum))}${t.zeit ? ` ${esc(t.zeit)}` : ""}</span> ${t.symbol} ${esc(t.text)}</button></li>`).join("")}</ul>` : `<p class="leise">Keine anstehenden Termine. Gebuchte Ausflüge, Flüge, Unterkünfte und Fristen erscheinen hier.</p>`}
    </div>`;
}

aktionen["zu-tag"] = (el) => {
  if (el.dataset.id) zustand.hafenId = el.dataset.id;
  aktionen.ansicht({ dataset: { ziel: "plan" } });
};
