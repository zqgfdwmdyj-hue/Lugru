// Reine Rechen- und Lesefunktionen für Vorbereitung und Unterwegs (Browser und Server, ohne DOM):
// Packlisten-Vorlagen, Dokumente & Fristen, Kalender-Erinnerungen (ICS), Rückweg zum Schiff,
// Bordkonto und „wer schuldet wem“, Foto-Zuordnung (EXIF), Tauchcomputer-Import, Tauchstatistik.
import { zeitZuMin, minZuZeit, zahl, istKind, entfernungKm } from "./rechnen.js";

export const DOKUMENT_ARTEN = {
  ausweis: "🛂 Reisepass / Ausweis",
  einreise: "🌐 Einreise (Visum, ESTA, eTA …)",
  buchung: "🎫 Buchung / Bestätigung",
  checkin: "✅ Online-Check-in",
  versicherung: "🛡️ Versicherung",
  impfung: "💉 Impfung / Gesundheit",
  fuehrerschein: "🚗 Führerschein",
  tauchen: "🤿 Tauchschein / Logbuch / Attest",
  sonstiges: "📄 Sonstiges",
};

export const DOKUMENT_VORLAGEN = [
  { titel: "Reisepass", art: "ausweis", jePerson: true },
  { titel: "Online-Check-in Kreuzfahrt", art: "checkin", nurKreuzfahrt: true },
  { titel: "Online-Check-in Flug", art: "checkin" },
  { titel: "Reiseversicherung / Auslandskrankenversicherung", art: "versicherung" },
  { titel: "Einreiseformular / ESTA / eTA prüfen", art: "einreise" },
  { titel: "Impfungen prüfen (Auswärtiges Amt / Tropenmedizin)", art: "impfung" },
  { titel: "Tauchschein (Brevet) & Logbuch", art: "tauchen", nurTauchen: true },
  { titel: "Tauchtauglichkeit (Attest)", art: "tauchen", nurTauchen: true },
  { titel: "Kofferbanderolen ausdrucken", art: "buchung", nurKreuzfahrt: true },
];

export const AUSGABE_KATEGORIEN = {
  getraenke: "🍹 Getränke",
  essen: "🍽️ Essen",
  spa: "💆 Spa & Friseur",
  ausflug: "🗺️ Ausflug",
  trinkgeld: "💶 Trinkgeld",
  shop: "🛍️ Shop & Souvenirs",
  taxi: "🚕 Taxi & Transport",
  internet: "📶 Internet",
  sonstiges: "📦 Sonstiges",
};

// ---------- Reisezeitraum ----------

/** Erster und letzter Tag der Reise (Tage, Hotels). */
export function reiseZeitraum(reise) {
  const daten = [
    ...(reise?.haefen ?? []).map((h) => h.datum),
    ...(reise?.hotels ?? []).filter((h) => h.status === "gebucht").flatMap((h) => [h.anreise, h.abreise]),
  ].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "")).sort();
  return { von: daten[0] ?? "", bis: daten.at(-1) ?? "" };
}

const tagZahl = (iso) => Math.round(new Date(`${iso}T12:00:00Z`).getTime() / 86400_000);
export const tageZwischen = (von, bis) => tagZahl(bis) - tagZahl(von);
export const datumPlus = (iso, tage) => new Date((tagZahl(iso) + tage) * 86400_000).toISOString().slice(0, 10);

/** Countdown für die Kinder: { phase: "vorher"|"unterwegs"|"vorbei"|"leer", tage, tagNr, tageGesamt }. */
export function countdown(reise, heute) {
  const { von, bis } = reiseZeitraum(reise);
  if (!von) return { phase: "leer" };
  const gesamt = tageZwischen(von, bis) + 1;
  if (heute < von) return { phase: "vorher", tage: tageZwischen(heute, von), tageGesamt: gesamt };
  if (heute > bis) return { phase: "vorbei", tage: tageZwischen(bis, heute), tageGesamt: gesamt };
  return { phase: "unterwegs", tagNr: tageZwischen(von, heute) + 1, tageGesamt: gesamt, tage: tageZwischen(heute, bis) };
}

// ---------- Packliste ----------

const P = (gruppe, ...texte) => texte.map((text) => ({ gruppe, text }));
export const PACKVORLAGEN = {
  basis: { name: "Grundausstattung", eintraege: [
    ...P("Dokumente", "Reisepass / Personalausweis", "Krankenkassenkarte (EHIC)", "Kreditkarte + etwas Bargeld", "Buchungsunterlagen (auch offline)"),
    ...P("Technik", "Handy + Ladekabel", "Powerbank", "Reiseadapter", "Kopfhörer"),
    ...P("Gesundheit", "Reiseapotheke", "Persönliche Medikamente", "Pflaster & Desinfektion"),
    ...P("Kleidung", "Unterwäsche & Socken", "Schlafsachen", "Bequeme Schuhe", "Leichte Jacke"),
  ] },
  warm: { name: "Sonne & Strand", eintraege: [
    ...P("Strand", "Riffschonende Sonnencreme (LSF 50)", "After-Sun", "Sonnenbrille", "Sonnenhut / Kappe", "Badesachen (2×)", "Strandtuch", "Badeschuhe", "Mückenschutz"),
    ...P("Kleidung", "Kurze Hosen & T-Shirts", "Sandalen"),
  ] },
  kreuzfahrt: { name: "Kreuzfahrt", eintraege: [
    ...P("Kreuzfahrt", "Kofferbanderolen am Koffer", "Bordkarte (am Schiff)", "Schicke Kleidung für den Abend", "Kleiner Tagesrucksack für Landgänge", "Mehrfachsteckdose (ohne Überspannungsschutz)", "Magnet-Haken für die Kabine", "Mittel gegen Seekrankheit", "Kopie Reisepass für Landgänge"),
  ] },
  tauchen: { name: "Tauchen", eintraege: [
    ...P("Tauchen", "Brevet / Tauchschein", "Logbuch", "Tauchcomputer + Ladekabel", "Maske & Schnorchel", "Flossen", "Neoprenanzug", "Antibeschlagmittel", "Ohrentropfen", "Tauchtauglichkeits-Attest", "Unterwasser-Kamera + Akku"),
  ] },
  kinder: { name: "Kinder", eintraege: [
    ...P("Kinder", "Kinderreisepass", "Kuscheltier", "Spiele & Bücher für unterwegs", "Tablet + Kopfhörer + Filme offline", "Snacks", "Schwimmflügel / Schwimmweste", "UV-Badeshirt", "Kinder-Sonnencreme", "Fieberthermometer & Kindermedikamente"),
  ] },
};

/** Welche Vorlagen passen zur Reise? */
export function passendeVorlagen(reise) {
  const v = ["basis"];
  if ((reise?.art ?? "kreuzfahrt") === "kreuzfahrt") v.push("kreuzfahrt");
  const warm = (reise?.haefen ?? []).some((h) => Number.isFinite(h.lat) && Math.abs(h.lat) < 35);
  if (warm) v.push("warm");
  if ((reise?.ausfluege ?? []).some((a) => ["tauchen", "schnorcheln"].includes(a.kategorie))) v.push("tauchen");
  if ((reise?.personen ?? []).some(istKind)) v.push("kinder");
  return v;
}

/** Einträge einer Vorlage, die noch nicht auf der Liste stehen. */
export function vorlageEintraege(schluessel, vorhanden = []) {
  const da = new Set(vorhanden.map((x) => String(x.text).trim().toLowerCase()));
  return (PACKVORLAGEN[schluessel]?.eintraege ?? []).filter((e) => !da.has(e.text.toLowerCase()));
}

// ---------- Dokumente & Fristen ----------

/**
 * Hinweise zu Dokumenten: Fristen, die bald fällig sind, und Ausweise, die vor/kurz nach der Reise ablaufen.
 * Ergebnis: [{ id, stufe: "rot"|"gelb"|"info", text, datum }], nach Dringlichkeit sortiert.
 */
export function dokumentHinweise(dokumente, reise, heute, personen = reise?.personen ?? []) {
  const { bis } = reiseZeitraum(reise);
  const name = (id) => personen.find((p) => p.id === id)?.name;
  const hinweise = [];
  for (const d of dokumente ?? []) {
    const wer = name(d.personId) ? ` (${name(d.personId)})` : "";
    if (d.frist && !d.erledigt) {
      const tage = tageZwischen(heute, d.frist);
      if (tage < 0) hinweise.push({ id: d.id, stufe: "rot", text: `${d.titel}${wer}: Frist war am ${d.frist}`, datum: d.frist });
      else if (tage <= 7) hinweise.push({ id: d.id, stufe: tage <= 1 ? "rot" : "gelb", text: `${d.titel}${wer}: ${tage === 0 ? "heute" : tage === 1 ? "morgen" : `in ${tage} Tagen`} fällig${d.fristZeit ? ` (${d.fristZeit} Uhr)` : ""}`, datum: d.frist });
      else if (tage <= 30) hinweise.push({ id: d.id, stufe: "info", text: `${d.titel}${wer}: fällig am ${d.frist}`, datum: d.frist });
    }
    if (d.gueltigBis) {
      if (d.gueltigBis < heute) hinweise.push({ id: d.id, stufe: "rot", text: `${d.titel}${wer} ist abgelaufen (${d.gueltigBis})`, datum: d.gueltigBis });
      else if (bis && d.gueltigBis < bis) hinweise.push({ id: d.id, stufe: "rot", text: `${d.titel}${wer} läuft vor Reiseende ab (${d.gueltigBis})`, datum: d.gueltigBis });
      else if (bis && d.art === "ausweis" && d.gueltigBis < datumPlus(bis, 182)) hinweise.push({ id: d.id, stufe: "gelb", text: `${d.titel}${wer}: weniger als 6 Monate nach Reiseende gültig (${d.gueltigBis}) – viele Länder verlangen das`, datum: d.gueltigBis });
    }
  }
  const rang = { rot: 0, gelb: 1, info: 2 };
  return hinweise.sort((a, b) => rang[a.stufe] - rang[b.stufe] || String(a.datum).localeCompare(String(b.datum)));
}

// ---------- Kalender-Erinnerungen (ICS) ----------

const icsText = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
function falten(zeile) {
  // RFC 5545: Zeilen höchstens 75 Bytes, Folgezeilen beginnen mit Leerzeichen
  const teile = [];
  let rest = zeile;
  const bytes = (s) => new TextEncoder().encode(s).length;
  while (bytes(rest) > 75) {
    let n = 74;
    while (bytes(rest.slice(0, n)) > (teile.length ? 74 : 75)) n--;
    teile.push(rest.slice(0, n));
    rest = rest.slice(n);
  }
  teile.push(rest);
  return teile.join("\r\n ");
}
const icsDatumZeit = (datum, zeit) => `${datum.replace(/-/g, "")}T${zeit.replace(":", "")}00`;
const alarm = (minutenVorher, text) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(text)}`, `TRIGGER:-PT${minutenVorher}M`, "END:VALARM"];

/**
 * Kalenderdatei mit Erinnerungen: „Alle an Bord“ (mit Vorwarnzeiten), gebuchte Ausflüge und Fristen.
 * Uhrzeiten ohne Zeitzone („schwebend“): Das Handy erinnert zur angezeigten Ortszeit – auch offline auf See.
 */
export function kalenderDatei(reise, { anBord = [90, 30], ausfluege = 45, dokumente = [], erstellt = new Date() } = {}) {
  const stempel = erstellt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const ereignisse = [];
  const ev = (uid, start, ende, titel, beschreibung, alarme, ort = "") => {
    ereignisse.push(["BEGIN:VEVENT", `UID:${uid}@reiseplaner`, `DTSTAMP:${stempel}`, `DTSTART:${start}`, `DTEND:${ende}`, `SUMMARY:${icsText(titel)}`, ...(ort ? [`LOCATION:${icsText(ort)}`] : []), ...(beschreibung ? [`DESCRIPTION:${icsText(beschreibung)}`] : []), ...alarme.flat(), "END:VEVENT"]);
  };
  const tage = [...(reise.haefen ?? [])].sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
  for (const h of tage) {
    if (!h.datum) continue;
    const art = h.art ?? (h.seetag ? "seetag" : "hafen");
    const anBordZeit = h.allesAnBord || (h.abfahrt ? minZuZeit(zeitZuMin(h.abfahrt) - 30) : "");
    if (art === "hafen" && zeitZuMin(anBordZeit) != null && anBord.length) {
      const ende = minZuZeit(Math.min(zeitZuMin(anBordZeit) + 15, 1439));
      ev(`anbord-${h.id}`, icsDatumZeit(h.datum, anBordZeit), icsDatumZeit(h.datum, ende), `⚓ Alle an Bord – ${h.name}`, `Das Schiff wartet nicht! Abfahrt ${h.abfahrt || "?"}. Uhrzeit = Bordzeit – prüfen, ob das Handy dieselbe Zeit zeigt.`, anBord.map((m) => alarm(m, `In ${m} Min.: Alle an Bord (${anBordZeit}) – ${h.name}`)), h.name);
    }
    if (!ausfluege && ausfluege !== 0) continue;
    for (const a of (reise.ausfluege ?? []).filter((x) => x.hafenId === h.id && x.status === "gebucht" && zeitZuMin(x.beginn) != null)) {
      const start = zeitZuMin(a.beginn);
      const ende = Math.min(start + (zahl(a.dauerMin) ?? 60), 1439);
      ev(`ausflug-${a.id}`, icsDatumZeit(h.datum, a.beginn), icsDatumZeit(h.datum, minZuZeit(ende)), `🗺️ ${a.titel}`, [a.code ? `Nr. ${a.code}` : "", a.notiz ?? ""].filter(Boolean).join("\n"), ausfluege ? [alarm(ausfluege, `In ${ausfluege} Min.: ${a.titel}`)] : [], a.ziel?.name ?? h.name);
    }
  }
  for (const d of dokumente) {
    if (!d.frist || d.erledigt) continue;
    const zeit = d.fristZeit || "09:00";
    ev(`frist-${d.id}`, icsDatumZeit(d.frist, zeit), icsDatumZeit(d.frist, minZuZeit(Math.min(zeitZuMin(zeit) + 30, 1439))), `📄 Frist: ${d.titel}`, d.notiz ?? "", [alarm(24 * 60, `Morgen fällig: ${d.titel}`), alarm(60, `In 1 Std. fällig: ${d.titel}`)]);
  }
  const zeilen = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lugru//Reiseplaner//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(reise.name)}`, ...ereignisse.flat(), "END:VCALENDAR"];
  return { text: `${zeilen.map(falten).join("\r\n")}\r\n`, anzahl: ereignisse.length };
}

/** Erinnerungen für einen Tag (für Hinweise, solange die App offen ist): [{ zeit (Min.), text }] */
export function erinnerungenAm(reise, datum, { anBord = [90, 30], ausfluege = 45 } = {}) {
  const liste = [];
  for (const h of (reise.haefen ?? []).filter((x) => x.datum === datum)) {
    const anBordMin = zeitZuMin(h.allesAnBord || "");
    if ((h.art ?? "hafen") === "hafen" && anBordMin != null) for (const m of anBord) liste.push({ zeit: anBordMin - m, text: `⚓ In ${m} Min. „Alle an Bord“ (${h.allesAnBord}) – ${h.name}` });
    for (const a of (reise.ausfluege ?? []).filter((x) => x.hafenId === h.id && x.status === "gebucht" && zeitZuMin(x.beginn) != null)) {
      liste.push({ zeit: zeitZuMin(a.beginn) - ausfluege, text: `🗺️ In ${ausfluege} Min.: ${a.titel} (${a.beginn})` });
    }
  }
  return liste.sort((a, b) => a.zeit - b.zeit);
}

// ---------- Rückweg zum Schiff ----------

/** Grobe Fahrzeit ohne Netz: Luftlinie × 1,4 bei 35 km/h (zu Fuß 4,5 km/h). */
export function fahrzeitSchaetzen(von, nach, zuFuss = false) {
  const km = entfernungKm(von, nach);
  if (km == null) return null;
  return { km: km * 1.4, min: Math.round(((km * 1.4) / (zuFuss ? 4.5 : 35)) * 60) };
}

/**
 * Wann müssen wir los? jetztMin: Minuten seit Mitternacht (Ortszeit), fahrMin: Weg zum Hafen.
 * Ergebnis: { losUm, restMin, status: "ok"|"knapp"|"los"|"zuSpaet", zielZeit }
 */
export function rueckweg(hafen, jetztMin, fahrMin, reserveMin = 20) {
  const ziel = zeitZuMin(hafen?.allesAnBord || "") ?? (zeitZuMin(hafen?.abfahrt || "") != null ? zeitZuMin(hafen.abfahrt) - 30 : null);
  if (ziel == null || fahrMin == null) return null;
  const los = ziel - Math.round(fahrMin) - reserveMin;
  const rest = los - jetztMin;
  const status = jetztMin + Math.round(fahrMin) > ziel ? "zuSpaet" : rest <= 0 ? "los" : rest <= 30 ? "knapp" : "ok";
  return { losUm: minZuZeit(Math.max(los, 0)), restMin: rest, status, zielZeit: minZuZeit(ziel) };
}

// ---------- Ausgaben: Bordkonto und „wer schuldet wem“ ----------

/** Betrag in Reisewährung (Dollar über den Kurs der Reise, Standard 0,89 €/$). */
export function inReisewaehrung(ausgabe, reise) {
  const ziel = reise?.waehrung || "EUR";
  const w = ausgabe.waehrung || ziel;
  if (w === ziel) return Number(ausgabe.betrag) || 0;
  const kurs = zahl(reise?.kurse?.[w]) ?? (w === "USD" && ziel === "EUR" ? 0.89 : null);
  return kurs == null ? Number(ausgabe.betrag) || 0 : (Number(ausgabe.betrag) || 0) * kurs;
}

const r2 = (n) => Math.round(n * 100) / 100;

/** Bordkonto: Summe, je Tag, je Kategorie, Rest-Budget. */
export function bordkonto(ausgaben, reise) {
  const liste = (ausgaben ?? []).filter((a) => a.ort === "bord");
  const ergebnis = { summe: 0, jeTag: {}, jeKategorie: {}, budget: zahl(reise?.bordBudget), rest: null, anzahl: liste.length };
  for (const a of liste) {
    const b = inReisewaehrung(a, reise);
    ergebnis.summe += b;
    ergebnis.jeTag[a.datum || "ohne Datum"] = r2((ergebnis.jeTag[a.datum || "ohne Datum"] ?? 0) + b);
    ergebnis.jeKategorie[a.kategorie] = r2((ergebnis.jeKategorie[a.kategorie] ?? 0) + b);
  }
  ergebnis.summe = r2(ergebnis.summe);
  if (ergebnis.budget != null) ergebnis.rest = r2(ergebnis.budget - ergebnis.summe);
  return ergebnis;
}

/**
 * Wer schuldet wem? Nur Ausgaben mit „bezahlt von“. „für“ leer = alle Erwachsenen (Kinder zahlen nicht).
 * Ergebnis: { saldo: {personId: +bekommt/−schuldet}, zahlungen: [{ von, an, betrag }], summe }
 */
export function ausgleich(ausgaben, reise) {
  const personen = reise?.personen ?? [];
  const ids = new Set(personen.map((p) => p.id));
  const erwachsene = personen.filter((p) => !istKind(p)).map((p) => p.id);
  const saldo = Object.fromEntries(personen.map((p) => [p.id, 0]));
  let summe = 0;
  for (const a of ausgaben ?? []) {
    if (!ids.has(a.bezahltVon)) continue;
    const fuer = (a.fuer ?? []).filter((p) => ids.has(p));
    const teilen = fuer.length ? fuer : erwachsene.length ? erwachsene : [...ids];
    const b = inReisewaehrung(a, reise);
    summe += b;
    saldo[a.bezahltVon] += b;
    for (const p of teilen) saldo[p] -= b / teilen.length;
  }
  for (const k of Object.keys(saldo)) saldo[k] = r2(saldo[k]);
  // Gierig ausgleichen: größter Schuldner zahlt an größten Gläubiger
  const glaeubiger = Object.entries(saldo).filter(([, v]) => v > 0.004).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const schuldner = Object.entries(saldo).filter(([, v]) => v < -0.004).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const zahlungen = [];
  while (glaeubiger.length && schuldner.length) {
    const g = glaeubiger[0];
    const s = schuldner[0];
    const betrag = r2(Math.min(g.v, s.v));
    if (betrag > 0) zahlungen.push({ von: s.id, an: g.id, betrag });
    g.v = r2(g.v - betrag);
    s.v = r2(s.v - betrag);
    if (g.v <= 0.004) glaeubiger.shift();
    if (s.v <= 0.004) schuldner.shift();
  }
  return { saldo, zahlungen, summe: r2(summe) };
}

// ---------- Fotos: Aufnahmedatum und Ort lesen, Tag/Ausflug zuordnen ----------

/** Liest Aufnahmezeit und GPS aus einem JPEG (EXIF). Ergebnis: { datum, zeit, lat, lng } oder {}. */
export function exifLesen(puffer) {
  try {
    const v = new DataView(puffer instanceof ArrayBuffer ? puffer : puffer.buffer.slice(puffer.byteOffset, puffer.byteOffset + puffer.byteLength));
    if (v.getUint16(0) !== 0xffd8) return {};
    let o = 2;
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o);
      const laenge = v.getUint16(o + 2);
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return tiffLesen(v, o + 10);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      o += 2 + laenge;
    }
  } catch {}
  return {};
}

function tiffLesen(v, start) {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o) => v.getUint16(start + o, le);
  const u32 = (o) => v.getUint32(start + o, le);
  const ifd = (o) => {
    const tags = {};
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      tags[u16(e)] = { typ: u16(e + 2), anzahl: u32(e + 4), wert: e + 8 };
    }
    return tags;
  };
  const ascii = (t) => {
    if (!t) return "";
    const o = t.anzahl > 4 ? u32(t.wert) : t.wert;
    let s = "";
    for (let i = 0; i < t.anzahl - 1; i++) s += String.fromCharCode(v.getUint8(start + o + i));
    return s;
  };
  const rationale = (t) => {
    if (!t) return null;
    const o = u32(t.wert);
    return Array.from({ length: t.anzahl }, (_, i) => u32(o + i * 8) / (u32(o + i * 8 + 4) || 1));
  };
  const ifd0 = ifd(u32(4));
  const exif = ifd0[0x8769] ? ifd(u32(ifd0[0x8769].wert)) : {};
  const ergebnis = {};
  const zeitText = ascii(exif[0x9003]) || ascii(ifd0[0x0132]);
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(zeitText);
  if (m) Object.assign(ergebnis, { datum: `${m[1]}-${m[2]}-${m[3]}`, zeit: `${m[4]}:${m[5]}` });
  if (ifd0[0x8825]) {
    const gps = ifd(u32(ifd0[0x8825].wert));
    const grad = (r) => (r ? r[0] + (r[1] ?? 0) / 60 + (r[2] ?? 0) / 3600 : null);
    const lat = grad(rationale(gps[2]));
    const lng = grad(rationale(gps[4]));
    if (lat != null && lng != null && (lat || lng)) {
      // Richtungsangabe steht bei einem Zeichen direkt im Eintrag
      const ref = (t) => (t ? String.fromCharCode(v.getUint8(start + t.wert)) : "");
      ergebnis.lat = Math.round((ref(gps[1]) === "S" ? -lat : lat) * 1e6) / 1e6;
      ergebnis.lng = Math.round((ref(gps[3]) === "W" ? -lng : lng) * 1e6) / 1e6;
    }
  }
  return ergebnis;
}

/**
 * Ordnet ein Foto einem Tag und (wenn möglich) einem Ausflug zu.
 * Tag: gleiches Datum (sonst Hotel-Aufenthalt). Ausflug: Aufnahmezeit im Zeitraum des Ausflugs,
 * sonst der nächste Ausflugsort im Umkreis von 5 km. Ergebnis: { hafenId, ausflugId, grund }
 */
export function fotoZuordnen(aufnahme, reise) {
  if (!aufnahme?.datum) return { hafenId: "", ausflugId: "", grund: "" };
  const tag = (reise.haefen ?? []).find((h) => h.datum === aufnahme.datum);
  if (!tag) return { hafenId: "", ausflugId: "", grund: "" };
  const kandidaten = (reise.ausfluege ?? []).filter((a) => a.hafenId === tag.id && a.status !== "verworfen");
  const gebuchtZuerst = (a, b) => (b.status === "gebucht") - (a.status === "gebucht");
  const z = zeitZuMin(aufnahme.zeit ?? "");
  if (z != null) {
    const passend = kandidaten.filter((a) => {
      const s = zeitZuMin(a.beginn ?? "");
      return s != null && z >= s - 15 && z <= s + (zahl(a.dauerMin) ?? 120) + 30;
    }).sort(gebuchtZuerst);
    if (passend.length === 1 || (passend.length > 1 && passend[0].status === "gebucht" && passend[1].status !== "gebucht")) return { hafenId: tag.id, ausflugId: passend[0].id, grund: "zeit" };
  }
  if (Number.isFinite(aufnahme.lat) && Number.isFinite(aufnahme.lng)) {
    const nah = kandidaten
      .filter((a) => Number.isFinite(a.ziel?.lat))
      .map((a) => ({ a, km: entfernungKm(aufnahme, a.ziel) }))
      .filter((x) => x.km != null && x.km <= 5)
      .sort((x, y) => x.km - y.km || gebuchtZuerst(x.a, y.a));
    if (nah.length) return { hafenId: tag.id, ausflugId: nah[0].a.id, grund: "ort" };
  }
  return { hafenId: tag.id, ausflugId: "", grund: "tag" };
}

// ---------- Tauchen: Statistik und Import vom Tauchcomputer ----------

export const ARTEN_MEER = ["Meeresschildkröte", "Mantarochen", "Adlerrochen", "Stachelrochen", "Walhai", "Hammerhai", "Riffhai", "Ammenhai", "Delfin", "Napoleon", "Barrakuda", "Muräne", "Zackenbarsch", "Papageifisch", "Kaiserfisch", "Feuerfisch", "Clownfisch", "Seepferdchen", "Oktopus", "Sepia", "Languste", "Nacktschnecke", "Kofferfisch", "Igelfisch", "Trompetenfisch", "Tarpon", "Wrack"];

/** Zerlegt „Schildkröte, 2 Mantas; Muräne“ in einzelne Arten. */
export const sichtungenListe = (text) => String(text ?? "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);

export function tauchStatistik(liste) {
  const mit = (k) => liste.map((t) => zahl(t[k])).filter((x) => x != null);
  const max = (k) => (mit(k).length ? Math.max(...mit(k)) : null);
  const min = (k) => (mit(k).length ? Math.min(...mit(k)) : null);
  const summeMin = mit("tauchzeitMin").reduce((s, x) => s + x, 0);
  const arten = new Map();
  for (const t of liste) for (const s of sichtungenListe(t.sichtungen)) {
    const k = s.replace(/^\d+\s*(x|×)?\s*/i, "");
    arten.set(k, (arten.get(k) ?? 0) + 1);
  }
  const orte = new Map();
  for (const t of liste) if (t.tauchplatz) orte.set(t.tauchplatz, (orte.get(t.tauchplatz) ?? 0) + 1);
  const finde = (k, wert) => liste.find((t) => zahl(t[k]) === wert);
  return {
    anzahl: liste.length,
    summeMin,
    tiefste: max("maxTiefe"),
    tiefsterPlatz: finde("maxTiefe", max("maxTiefe"))?.tauchplatz ?? "",
    laengste: max("tauchzeitMin"),
    laengsterPlatz: finde("tauchzeitMin", max("tauchzeitMin"))?.tauchplatz ?? "",
    mittelTiefe: mit("maxTiefe").length ? Math.round((mit("maxTiefe").reduce((s, x) => s + x, 0) / mit("maxTiefe").length) * 10) / 10 : null,
    waermste: max("wasserTemp"),
    kaelteste: min("wasserTemp"),
    besteSicht: max("sicht"),
    plaetze: orte.size,
    arten: [...arten.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")),
    orte: [...orte.entries()].sort((a, b) => b[1] - a[1]),
  };
}

const tagWert = (block, name) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim() : "";
};
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(tag);
  return m ? m[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'") : "";
};
const entities = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const einsNach = (n, stellen = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** stellen) / 10 ** stellen);

/** UDDF (Standardformat vieler Tauchcomputer-Programme, z. B. Shearwater, Suunto, Subsurface-Export). */
function uddfLesen(xml) {
  const plaetze = {};
  for (const m of xml.matchAll(/<site\b([^>]*)>([\s\S]*?)<\/site>/gi)) {
    plaetze[attr(m[1], "id")] = {
      name: entities(tagWert(m[2], "name")),
      ort: entities(tagWert(m[2], "location")),
      lat: zahl(tagWert(m[2], "latitude")),
      lng: zahl(tagWert(m[2], "longitude")),
    };
  }
  const tauchgaenge = [];
  for (const m of xml.matchAll(/<dive\b[^>]*>([\s\S]*?)<\/dive>/gi)) {
    const b = m[1];
    const vorher = /<informationbeforedive\b[^>]*>([\s\S]*?)<\/informationbeforedive>/i.exec(b)?.[1] ?? "";
    const nachher = /<informationafterdive\b[^>]*>([\s\S]*?)<\/informationafterdive>/i.exec(b)?.[1] ?? "";
    const dt = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(tagWert(vorher, "datetime"));
    const ref = [...vorher.matchAll(/<link\b([^>]*)\/?>/gi)].map((x) => attr(x[1], "ref")).find((r) => plaetze[r]);
    const platz = plaetze[ref] ?? {};
    const kelvin = zahl(tagWert(nachher, "lowesttemperature"));
    const druck = (n) => {
      const pa = zahl(tagWert(b, n));
      return pa == null ? null : Math.round(pa > 1000 ? pa / 1e5 : pa);
    };
    tauchgaenge.push({
      datum: dt?.[1] ?? "",
      beginn: dt?.[2] ?? "",
      tauchplatz: platz.name || "",
      ort: platz.ort || "",
      lat: platz.lat ?? null,
      lng: platz.lng ?? null,
      maxTiefe: einsNach(zahl(tagWert(nachher, "greatestdepth"))),
      mittelTiefe: einsNach(zahl(tagWert(nachher, "averagedepth"))),
      tauchzeitMin: zahl(tagWert(nachher, "diveduration")) != null ? Math.round(zahl(tagWert(nachher, "diveduration")) / 60) : null,
      wasserTemp: kelvin != null ? einsNach(kelvin > 200 ? kelvin - 273.15 : kelvin) : null,
      sicht: zahl(tagWert(nachher, "visibility")),
      druckStart: druck("tankpressurebegin"),
      druckEnde: druck("tankpressureend"),
    });
  }
  return tauchgaenge;
}

/** Subsurface-Logbuch (.ssrf/.xml) – kann auch Daten von Garmin-, Suunto- und Shearwater-Computern enthalten. */
function subsurfaceLesen(xml) {
  const plaetze = {};
  for (const m of xml.matchAll(/<site\b([^>]*?)\/?>/gi)) {
    const gps = attr(m[1], "gps").split(/\s+/).map(Number);
    plaetze[attr(m[1], "uuid")] = { name: attr(m[1], "name"), lat: Number.isFinite(gps[0]) ? gps[0] : null, lng: Number.isFinite(gps[1]) ? gps[1] : null };
  }
  const minuten = (s) => {
    const m = /(\d+):(\d{2})/.exec(s);
    return m ? Math.round(Number(m[1]) + Number(m[2]) / 60) : zahl(String(s).replace(/[^\d.,]/g, ""));
  };
  const tauchgaenge = [];
  for (const m of xml.matchAll(/<dive\b([^>]*)>([\s\S]*?)<\/dive>/gi)) {
    const kopf = m[1];
    const b = m[2];
    const tiefe = /<depth\b([^>]*)\/?>/i.exec(b)?.[1] ?? "";
    const temp = /<temperature\b([^>]*)\/?>/i.exec(b)?.[1] ?? "";
    const platz = plaetze[attr(kopf, "divesiteid")] ?? {};
    const zylinder = /<cylinder\b([^>]*)\/?>/i.exec(b)?.[1] ?? "";
    tauchgaenge.push({
      datum: attr(kopf, "date"),
      beginn: attr(kopf, "time").slice(0, 5),
      tauchplatz: platz.name || tagWert(b, "location") || "",
      ort: "",
      lat: platz.lat ?? null,
      lng: platz.lng ?? null,
      maxTiefe: einsNach(zahl(attr(tiefe, "max").replace(/[^\d.]/g, ""))),
      mittelTiefe: einsNach(zahl(attr(tiefe, "mean").replace(/[^\d.]/g, ""))),
      tauchzeitMin: minuten(attr(kopf, "duration")),
      wasserTemp: einsNach(zahl(attr(temp, "water").replace(/[^\d.-]/g, ""))),
      buddy: entities(tagWert(b, "buddy")),
      guide: entities(tagWert(b, "divemaster")),
      text: entities(tagWert(b, "notes")),
      druckStart: zahl(attr(zylinder, "start").replace(/[^\d.]/g, "")),
      druckEnde: zahl(attr(zylinder, "end").replace(/[^\d.]/g, "")),
    });
  }
  return tauchgaenge;
}

function csvLesen(text) {
  const zeilen = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((z) => z.trim());
  if (zeilen.length < 2) return [];
  const kopf = zeilen[0];
  const trenner = ["\t", ";", ","].sort((a, b) => kopf.split(b).length - kopf.split(a).length)[0];
  const teile = (z) => {
    const ergebnis = [];
    let feld = "";
    let q = false;
    for (let i = 0; i < z.length; i++) {
      const c = z[i];
      if (q) {
        if (c === '"' && z[i + 1] === '"') (feld += '"'), i++;
        else if (c === '"') q = false;
        else feld += c;
      } else if (c === '"') q = true;
      else if (c === trenner) ergebnis.push(feld), (feld = "");
      else feld += c;
    }
    ergebnis.push(feld);
    return ergebnis.map((x) => x.trim());
  };
  const namen = teile(kopf).map((k) => k.toLowerCase());
  const spalte = (...muster) => namen.findIndex((n) => muster.some((m) => m.test(n)));
  const s = {
    datum: spalte(/^dat(e|um)/, /date/),
    zeit: spalte(/^(time|zeit|uhrzeit|start)/),
    tiefe: spalte(/max.*(depth|tiefe)/, /^(depth|tiefe)/),
    mittel: spalte(/(avg|average|mittel|ø).*(depth|tiefe)/),
    dauer: spalte(/(duration|dauer|dive ?time|tauchzeit|bottom ?time)/),
    temp: spalte(/(water|wasser).*temp/, /(min|mindest).*temp/, /^temp/),
    platz: spalte(/(site|tauchplatz|platz|location|ort)/),
    sicht: spalte(/(visib|sicht)/),
  };
  if (s.datum < 0) return [];
  const datumAus = (w) => {
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(w);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(w);
    if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(w);
    if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return "";
  };
  const dauerAus = (w) => {
    const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(w);
    if (m) return m[3] != null ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]);
    const n = zahl(w.replace(/[^\d.,]/g, ""));
    return n == null ? null : /s(ec)?\b/i.test(w) || n > 600 ? Math.round(n / 60) : Math.round(n);
  };
  return zeilen.slice(1).map(teile).map((z) => {
    const w = (i) => (i >= 0 ? z[i] ?? "" : "");
    const dt = w(s.datum);
    const zeit = /(\d{1,2}):(\d{2})/.exec(w(s.zeit) || dt.split(/[T ]/)[1] || "");
    return {
      datum: datumAus(dt),
      beginn: zeit ? `${zeit[1].padStart(2, "0")}:${zeit[2]}` : "",
      tauchplatz: w(s.platz),
      ort: "",
      maxTiefe: einsNach(zahl(w(s.tiefe).replace(/[^\d.,]/g, ""))),
      mittelTiefe: einsNach(zahl(w(s.mittel).replace(/[^\d.,]/g, ""))),
      tauchzeitMin: dauerAus(w(s.dauer)),
      wasserTemp: einsNach(zahl(w(s.temp).replace(/[^\d.,-]/g, ""))),
      sicht: zahl(w(s.sicht).replace(/[^\d.,]/g, "")),
    };
  }).filter((t) => t.datum);
}

/** Erkennt das Format (UDDF, Subsurface, CSV) und liefert Tauchgänge für das Logbuch. */
export function tauchImport(text, dateiname = "") {
  const t = String(text ?? "");
  let liste;
  if (/<uddf\b/i.test(t)) liste = uddfLesen(t);
  else if (/<divelog\b|<dives\b|<dive\s[^>]*\bdate=/i.test(t)) liste = subsurfaceLesen(t);
  else if (/\.(csv|txt|tsv)$/i.test(dateiname) || !/^\s*</.test(t)) liste = csvLesen(t);
  else liste = [];
  return liste.filter((x) => x.datum).sort((a, b) => `${a.datum} ${a.beginn}`.localeCompare(`${b.datum} ${b.beginn}`));
}

/** Gibt es diesen Tauchgang schon (gleiches Datum, Beginn ±10 Min. bzw. gleiche Tiefe)? */
export function tauchgangDoppelt(neu, vorhandene) {
  return vorhandene.some((t) => {
    if (t.datum !== neu.datum) return false;
    const a = zeitZuMin(t.beginn ?? "");
    const b = zeitZuMin(neu.beginn ?? "");
    if (a != null && b != null) return Math.abs(a - b) <= 10;
    return zahl(t.maxTiefe) != null && zahl(t.maxTiefe) === zahl(neu.maxTiefe);
  });
}
