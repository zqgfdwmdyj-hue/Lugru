// Einen von der KI gelesenen Plan mit einer Reise zusammenführen (ohne DOM, getestet).
import { sichereUrl, titelAehnlich } from "./rechnen.js";

const neueId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Führt den gelesenen Plan mit einer Reise zusammen (vorhandene Einträge werden ergänzt). */
/** Alle Mitreisenden – oder bei „für 3 Taucher“ die ersten drei Erwachsenen. */
function teilnehmerFuer(reise, anzahl) {
  const alle = (reise.personen ?? []).map((p) => p.id);
  if (!anzahl || anzahl >= alle.length) return alle;
  const erwachsene = (reise.personen ?? []).filter((p) => p.typ !== "kind").map((p) => p.id);
  return [...erwachsene, ...alle.filter((id) => !erwachsene.includes(id))].slice(0, anzahl);
}

/** „Business, 30 kg, Sitz 12A, Terminal 1, Buchung ABC123“ → Sitz, Terminal, Buchung und der Rest (Klasse, Gepäck). */
export function detailsAufteilen(text) {
  const teile = String(text ?? "").split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean);
  const ergebnis = { buchungsnr: "", terminal: "", sitz: "", rest: "" };
  const rest = [];
  for (const t of teile) {
    let m;
    if ((m = /^(?:buchung(?:snummer|scode)?|booking|pnr|filekey)[:\s]+(\S+)/i.exec(t))) ergebnis.buchungsnr = m[1];
    else if ((m = /^(?:sitz(?:platz)?|seat)[:\s]+(.+)/i.exec(t))) ergebnis.sitz = m[1];
    else if (/^terminal\b/i.test(t)) ergebnis.terminal = t;
    else rest.push(t);
  }
  ergebnis.rest = rest.join(", ");
  return ergebnis;
}

const klein = (x) => String(x ?? "").trim().toLowerCase();
const ohneLeer = (x) => klein(x).replace(/\s+/g, "");
const vkey = (v) => `${v.datum}|${ohneLeer(v.titel) || `${klein(v.von)}-${klein(v.nach)}`}`;
const ueberlappt = (a1, b1, a2, b2) => !a1 || !b1 || !a2 || !b2 || (a1 < b2 && a2 < b1);
const tagFuer = (reise, a) => reise.haefen?.find((h) => h.datum === a.datum) ?? (a.ort ? reise.haefen?.find((h) => klein(h.name) === klein(a.ort)) : null);

/**
 * Gleicht einen gelesenen Plan mit der Reise ab, ohne etwas zu ändern.
 * Je Eintrag: { schluessel, art: "gleich" | "aehnlich" | null, vorhanden }
 * „gleich“ = gleicher Titel am selben Tag (wird standardmäßig ergänzt), „aehnlich“ = mögliche Dublette (Entscheidung nötig).
 */
export function importAbgleich(reise, p) {
  const ergebnis = [];
  const suche = (liste, gleich, aehnlich) => liste.find(gleich) ? { art: "gleich", vorhanden: liste.find(gleich) } : liste.find(aehnlich) ? { art: "aehnlich", vorhanden: liste.find(aehnlich) } : { art: null, vorhanden: null };
  (p.ausfluege ?? []).forEach((a, i) => {
    const tag = tagFuer(reise, a);
    const amTag = tag ? (reise.ausfluege ?? []).filter((x) => x.hafenId === tag.id) : [];
    ergebnis.push({ schluessel: `ausfluege:${i}`, bereich: "Ausflug", titel: a.titel, ...suche(amTag, (x) => klein(x.titel) === klein(a.titel), (x) => titelAehnlich(x.titel, a.titel)) });
  });
  (p.hotels ?? []).forEach((h, i) => {
    const liste = reise.hotels ?? [];
    ergebnis.push({ schluessel: `hotels:${i}`, bereich: "Unterkunft", titel: h.name, ...suche(liste, (x) => klein(x.name) === klein(h.name), (x) => titelAehnlich(x.name, h.name) && ueberlappt(x.anreise, x.abreise, h.anreise, h.abreise)) });
  });
  (p.verbindungen ?? []).forEach((v, i) => {
    const liste = reise.verbindungen ?? [];
    ergebnis.push({ schluessel: `verbindungen:${i}`, bereich: "Verbindung", titel: v.titel || `${v.von} → ${v.nach}`, ...suche(liste, (x) => vkey(x) === vkey(v), (x) => x.datum === v.datum && klein(x.von).slice(0, 5) === klein(v.von).slice(0, 5) && klein(x.nach).slice(0, 5) === klein(v.nach).slice(0, 5) && klein(v.von)) });
  });
  (p.kosten ?? []).forEach((k, i) => {
    const liste = reise.kosten ?? [];
    ergebnis.push({ schluessel: `kosten:${i}`, bereich: "Kosten", titel: k.titel, ...suche(liste, (x) => klein(x.titel) === klein(k.titel), (x) => titelAehnlich(x.titel, k.titel)) });
  });
  return ergebnis;
}

/**
 * Führt den gelesenen Plan mit der Reise zusammen. `entscheidungen[schluessel]`:
 * "aktualisieren" (nur leere Felder ergänzen, nie überschreiben), "zusaetzlich" (neuer Eintrag) oder "ueberspringen".
 * Ohne Entscheidung: gleicher Eintrag → aktualisieren, ähnlicher → zusätzlich anlegen (nichts wird verschmolzen).
 */
export function planZusammenfuehren(reise, p, { personenErsetzen = false, entscheidungen = {} } = {}) {
  reise.haefen ??= [];
  reise.hotels ??= [];
  reise.ausfluege ??= [];
  reise.kosten ??= [];
  reise.verbindungen ??= [];
  const zaehler = { tage: 0, hotels: 0, ausfluege: 0, verbindungen: 0, kosten: 0, aktualisiert: 0, uebersprungen: 0, aenderungen: [] };
  const abgleich = new Map(importAbgleich(reise, p).map((x) => [x.schluessel, x]));
  // Was passiert mit Eintrag i? → { tun: "neu" | "aktualisieren" | "ueberspringen", vorhanden }
  const entscheiden = (schluessel) => {
    const x = abgleich.get(schluessel);
    if (!x?.art) return { tun: "neu" };
    const wahl = entscheidungen[schluessel] ?? (x.art === "gleich" ? "aktualisieren" : "zusaetzlich");
    if (wahl === "ueberspringen") return { tun: "ueberspringen" };
    if (wahl === "aktualisieren") return { tun: "aktualisieren", vorhanden: x.vorhanden };
    return { tun: "neu" };
  };
  const fuellen = (ziel, quelle, titel) => {
    const felder = [];
    for (const [k, v] of Object.entries(quelle)) {
      if (v === "" || v == null) continue;
      if (ziel[k] === "" || ziel[k] == null) {
        ziel[k] = v;
        felder.push(k);
      }
    }
    if (felder.length) {
      zaehler.aktualisiert++;
      zaehler.aenderungen.push({ titel: titel ?? ziel.titel ?? ziel.name ?? "", felder });
    }
  };
  if (personenErsetzen && p.personen.length) {
    reise.personen = p.personen.map((x) => ({ id: neueId(), name: x.name, typ: x.typ, alter: x.alter ?? "" }));
  }
    for (const s of p.stationen) {
    if (!s.datum) continue;
    const vorhanden = reise.haefen.find((h) => h.datum === s.datum);
    const daten = { datum: s.datum, art: s.art, seetag: s.art === "seetag", name: s.art === "seetag" ? s.name || "Seetag" : s.name, land: s.land, ankunft: s.ankunft, abfahrt: s.abfahrt, allesAnBord: s.allesAnBord, notiz: s.notiz };
    if (vorhanden) fuellen(vorhanden, daten, `Tag ${s.datum}`);
    else {
      reise.haefen.push({ id: neueId(), lat: null, lng: null, ...daten });
      zaehler.tage++;
    }
  }
  for (const [i, h] of p.hotels.entries()) {
    const { tun, vorhanden } = entscheiden(`hotels:${i}`);
    const daten = { ...h, link: sichereUrl(h.link), zimmer: 1 };
    if (tun === "ueberspringen") zaehler.uebersprungen++;
    else if (tun === "aktualisieren") fuellen(vorhanden, daten);
    else {
      reise.hotels.push({ id: neueId(), lat: null, lng: null, ...daten });
      zaehler.hotels++;
    }
  }
  for (const [i, a] of p.ausfluege.entries()) {
    const { tun, vorhanden } = entscheiden(`ausfluege:${i}`);
    if (tun === "ueberspringen") {
      zaehler.uebersprungen++;
      continue;
    }
    let station = reise.haefen.find((h) => h.datum === a.datum) ?? (a.ort ? reise.haefen.find((h) => h.name?.toLowerCase() === a.ort.toLowerCase()) : null);
    if (!station) {
      if (!a.datum) continue;
      station = { id: neueId(), datum: a.datum, art: "ort", name: a.ort || "Tag", lat: null, lng: null };
      reise.haefen.push(station);
      zaehler.tage++;
    }
    const daten = {
      titel: a.titel, kategorie: a.kategorie, quelle: a.quelle, status: a.status, beginn: a.beginn, dauerMin: a.dauerMin,
      preisErw: a.preisErw, preisKind: a.preisKind, preisGruppe: a.preisGruppe ?? null, kostenlosBis: a.kostenlosBis ?? null,
      link: sichereUrl(a.link), notiz: a.notiz,
    };
    if (tun === "aktualisieren") {
      // Gesamtpreis ergänzt? Dann gilt er für die Gruppe.
      if (daten.preisGruppe != null && vorhanden.preisGruppe == null) vorhanden.preisArt = "gruppe";
      fuellen(vorhanden, daten);
    } else {
      reise.ausfluege.push({
        id: neueId(), hafenId: station.id, interesse: a.interesse ?? 3, verkehr: "auto", ...daten,
        preisArt: a.preisArt === "gruppe" || (a.preisGruppe != null && a.preisErw == null) ? "gruppe" : "person",
        teilnehmer: teilnehmerFuer(reise, a.anzahl),
      });
      zaehler.ausfluege++;
    }
  }
  // Flüge, Züge … als Verbindungen (mit Zeiten) – gleiche Verbindung (Datum + Nummer/Strecke) nur einmal
  for (const [i, v] of (p.verbindungen ?? []).entries()) {
    if (!v.datum) continue;
    const { tun, vorhanden } = entscheiden(`verbindungen:${i}`);
    const d = detailsAufteilen(v.details ?? [v.klasse, v.gepaeck].filter(Boolean).join(", "));
    const daten = {
      art: v.art || "flug", titel: v.titel ?? "", von: v.von ?? "", nach: v.nach ?? "", datum: v.datum, abZeit: v.abZeit ?? "", anDatum: v.anDatum && v.anDatum !== v.datum ? v.anDatum : "",
      anZeit: v.anZeit ?? "", buchungsnr: v.buchungsnr || d.buchungsnr, terminal: v.terminal || d.terminal, sitz: v.sitz || d.sitz, gepaeck: d.rest, preis: v.preis ?? null, notiz: v.notiz ?? "",
    };
    if (tun === "ueberspringen") zaehler.uebersprungen++;
    else if (tun === "aktualisieren") fuellen(vorhanden, daten);
    else {
      reise.verbindungen.push({ id: neueId(), status: v.status || "gebucht", personen: (reise.personen ?? []).map((x) => x.id), vonOrt: null, nachOrt: null, ...daten });
      zaehler.verbindungen++;
    }
  }
  for (const [i, k] of p.kosten.entries()) {
    const { tun, vorhanden } = entscheiden(`kosten:${i}`);
    if (tun === "ueberspringen") zaehler.uebersprungen++;
    else if (tun === "aktualisieren") fuellen(vorhanden, { betrag: k.betrag, status: k.status });
    else {
      reise.kosten.push({ id: neueId(), ...k });
      zaehler.kosten++;
    }
  }
  return zaehler;
}

