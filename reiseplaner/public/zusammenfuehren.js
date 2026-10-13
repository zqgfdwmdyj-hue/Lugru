// Einen von der KI gelesenen Plan mit einer Reise zusammenführen (ohne DOM, getestet).
import { sichereUrl } from "./rechnen.js";

const neueId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Führt den gelesenen Plan mit einer Reise zusammen (vorhandene Einträge werden ergänzt). */
/** Alle Mitreisenden – oder bei „für 3 Taucher“ die ersten drei Erwachsenen. */
function teilnehmerFuer(reise, anzahl) {
  const alle = (reise.personen ?? []).map((p) => p.id);
  if (!anzahl || anzahl >= alle.length) return alle;
  const erwachsene = (reise.personen ?? []).filter((p) => p.typ !== "kind").map((p) => p.id);
  return [...erwachsene, ...alle.filter((id) => !erwachsene.includes(id))].slice(0, anzahl);
}

export function planZusammenfuehren(reise, p, { personenErsetzen = false } = {}) {
  reise.haefen ??= [];
  reise.hotels ??= [];
  reise.ausfluege ??= [];
  reise.kosten ??= [];
  reise.verbindungen ??= [];
  const zaehler = { tage: 0, hotels: 0, ausfluege: 0, verbindungen: 0, kosten: 0, aktualisiert: 0 };
  const fuellen = (ziel, quelle) => {
    let geaendert = false;
    for (const [k, v] of Object.entries(quelle)) {
      if (v === "" || v == null) continue;
      if (ziel[k] === "" || ziel[k] == null) {
        ziel[k] = v;
        geaendert = true;
      }
    }
    if (geaendert) zaehler.aktualisiert++;
  };
  if (personenErsetzen && p.personen.length) {
    reise.personen = p.personen.map((x) => ({ id: neueId(), name: x.name, typ: x.typ, alter: x.alter ?? "" }));
  }
    for (const s of p.stationen) {
    if (!s.datum) continue;
    const vorhanden = reise.haefen.find((h) => h.datum === s.datum);
    const daten = { datum: s.datum, art: s.art, seetag: s.art === "seetag", name: s.art === "seetag" ? s.name || "Seetag" : s.name, land: s.land, ankunft: s.ankunft, abfahrt: s.abfahrt, allesAnBord: s.allesAnBord, notiz: s.notiz };
    if (vorhanden) fuellen(vorhanden, daten);
    else {
      reise.haefen.push({ id: neueId(), lat: null, lng: null, ...daten });
      zaehler.tage++;
    }
  }
  for (const h of p.hotels) {
    const vorhanden = reise.hotels.find((x) => x.name.toLowerCase() === h.name.toLowerCase());
    const daten = { ...h, link: sichereUrl(h.link), zimmer: 1 };
    if (vorhanden) fuellen(vorhanden, daten);
    else {
      reise.hotels.push({ id: neueId(), lat: null, lng: null, ...daten });
      zaehler.hotels++;
    }
  }
  for (const a of p.ausfluege) {
    let station = reise.haefen.find((h) => h.datum === a.datum) ?? (a.ort ? reise.haefen.find((h) => h.name?.toLowerCase() === a.ort.toLowerCase()) : null);
    if (!station) {
      if (!a.datum) continue;
      station = { id: neueId(), datum: a.datum, art: "ort", name: a.ort || "Tag", lat: null, lng: null };
      reise.haefen.push(station);
      zaehler.tage++;
    }
    const vorhanden = reise.ausfluege.find((x) => x.hafenId === station.id && x.titel.toLowerCase() === a.titel.toLowerCase());
    const daten = {
      titel: a.titel, kategorie: a.kategorie, quelle: a.quelle, status: a.status, beginn: a.beginn, dauerMin: a.dauerMin,
      preisErw: a.preisErw, preisKind: a.preisKind, preisGruppe: a.preisGruppe ?? null, kostenlosBis: a.kostenlosBis ?? null,
      link: sichereUrl(a.link), notiz: a.notiz,
    };
    if (vorhanden) {
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
  const vkey = (v) => `${v.datum}|${String(v.titel ?? "").replace(/\s+/g, "").toLowerCase() || `${v.von}-${v.nach}`.toLowerCase()}`;
  for (const v of p.verbindungen ?? []) {
    if (!v.datum) continue;
    const daten = {
      art: v.art || "flug", titel: v.titel ?? "", von: v.von ?? "", nach: v.nach ?? "", datum: v.datum, abZeit: v.abZeit ?? "", anDatum: v.anDatum && v.anDatum !== v.datum ? v.anDatum : "",
      anZeit: v.anZeit ?? "", buchungsnr: v.buchungsnr ?? "", terminal: v.terminal ?? "", sitz: v.sitz ?? "",
      gepaeck: [v.klasse, v.gepaeck].filter(Boolean).join(", "), preis: v.preis ?? null, notiz: v.notiz ?? "",
    };
    const vorhanden = reise.verbindungen.find((x) => vkey(x) === vkey(daten));
    if (vorhanden) fuellen(vorhanden, daten);
    else {
      reise.verbindungen.push({ id: neueId(), status: v.status || "gebucht", personen: (reise.personen ?? []).map((x) => x.id), vonOrt: null, nachOrt: null, ...daten });
      zaehler.verbindungen++;
    }
  }
  for (const k of p.kosten) {
    if (reise.kosten.some((x) => x.titel.toLowerCase() === k.titel.toLowerCase())) continue;
    reise.kosten.push({ id: neueId(), ...k });
    zaehler.kosten++;
  }
  return zaehler;
}

