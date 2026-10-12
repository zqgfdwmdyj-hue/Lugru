// Gemeinsame Listen einer Reise, die mehrere gleichzeitig bearbeiten: Packliste, Dokumente & Fristen,
// Ausgaben (Bordkonto, wer hat was bezahlt), Abstimmungen über Ausflüge, Tiere-Bingo der Kinder,
// KI-Briefings und Ausflug-Checks. Eigene Datei je Reise, jede Änderung einzeln und gesperrt –
// so gibt es keine Konflikte, wenn zwei gleichzeitig abhaken.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { REISEN_DIR, DATA_DIR, lesen, aendern, ID_RE } from "./speicher.mjs";
import { mkdir } from "node:fs/promises";
import { fehler } from "./konten.mjs";
import { sichereUrl } from "../public/rechnen.js";
import { DOKUMENT_ARTEN, AUSGABE_KATEGORIEN } from "../public/unterwegs-logik.js";

export const DATEI_DIR = path.join(DATA_DIR, "dateien");
await mkdir(DATEI_DIR, { recursive: true });

export const extrasDatei = (id) => path.join(REISEN_DIR, `${id}.extras.json`);
export const LEERE_EXTRAS = { packliste: [], dokumente: [], ausgaben: [], dateien: [], stimmen: {}, tiere: {}, tierFotos: {}, schatz: {}, kinder: {}, challenge: {}, geschichten: {}, briefings: {}, checks: {} };
export const LISTEN = ["packliste", "dokumente", "ausgaben"];
const ENDUNG = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3" };
export const dateiPfad = (id, typ) => path.join(DATEI_DIR, `${id}.${ENDUNG[typ] ?? "bin"}`);

export async function extrasLesen(id) {
  return { ...structuredClone(LEERE_EXTRAS), ...(await lesen(extrasDatei(id), LEERE_EXTRAS)) };
}
export function extrasAendern(id, fn) {
  return aendern(extrasDatei(id), LEERE_EXTRAS, (e) => {
    for (const [k, v] of Object.entries(LEERE_EXTRAS)) e[k] ??= structuredClone(v);
    return fn(e);
  });
}

const text = (v, max = 300) => String(v ?? "").slice(0, max);
const datum = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");
const zeit = (v) => (/^\d{2}:\d{2}$/.test(String(v ?? "")) ? String(v) : "");
const zahl = (v) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return v === "" || v == null || !Number.isFinite(n) ? null : n;
};

/** Prüft und säubert einen Eintrag. personen: gültige Personen-IDs der Reise, dateien: hochgeladene Dateien. */
export function eintragAus(liste, d, { personen = [], familien = [], dateien = [] } = {}) {
  // Person-ID oder „familie:<id>“ (Eintrag für eine ganze Familie)
  const person = (p) => (personen.includes(p) || (String(p).startsWith("familie:") && familien.includes(String(p).slice(8))) ? p : "");
  if (liste === "packliste") {
    const t = text(d.text, 200).trim();
    if (!t) throw fehler(400, "Bitte eintragen, was eingepackt werden soll.");
    return { text: t, gruppe: text(d.gruppe, 60).trim(), fuer: person(d.fuer), erledigt: d.erledigt === true };
  }
  if (liste === "dokumente") {
    const t = text(d.titel, 200).trim();
    if (!t) throw fehler(400, "Bitte einen Titel angeben.");
    return {
      titel: t,
      art: DOKUMENT_ARTEN[d.art] ? d.art : "sonstiges",
      personId: person(d.personId),
      gueltigBis: datum(d.gueltigBis),
      frist: datum(d.frist),
      fristZeit: zeit(d.fristZeit),
      notiz: text(d.notiz, 2000),
      link: sichereUrl(d.link),
      dateiId: dateien.some((x) => x.id === d.dateiId) ? d.dateiId : "",
      erledigt: d.erledigt === true,
    };
  }
  if (liste === "ausgaben") {
    const betrag = zahl(d.betrag);
    if (betrag == null || betrag < 0 || betrag > 1_000_000) throw fehler(400, "Bitte einen gültigen Betrag eingeben.");
    const fuer = (Array.isArray(d.fuer) ? d.fuer : []).filter((p) => personen.includes(p));
    return {
      datum: datum(d.datum),
      titel: text(d.titel, 200).trim() || "Ausgabe",
      betrag,
      waehrung: /^[A-Z]{3}$/.test(String(d.waehrung ?? "")) ? d.waehrung : "EUR",
      kategorie: AUSGABE_KATEGORIEN[d.kategorie] ? d.kategorie : "sonstiges",
      ort: d.ort === "bord" ? "bord" : "land",
      bezahltVon: person(d.bezahltVon),
      fuer: [...new Set(fuer)],
    };
  }
  throw fehler(404, "Unbekannte Liste.");
}

export function eintragHinzufuegen(reiseId, liste, eintrag, vonId) {
  return extrasAendern(reiseId, (e) => {
    if (e[liste].length >= 2000) throw fehler(400, "Die Liste ist voll.");
    const neu = { id: randomUUID(), ...eintrag, vonId, erstellt: new Date().toISOString() };
    e[liste].push(neu);
    return neu;
  });
}

export function eintragAendern(reiseId, liste, eid, eintrag) {
  return extrasAendern(reiseId, (e) => {
    const x = e[liste].find((y) => y.id === eid);
    if (!x) throw fehler(404, "Eintrag nicht gefunden.");
    return Object.assign(x, eintrag, { geaendert: new Date().toISOString() });
  });
}

export function eintragLoeschen(reiseId, liste, eid) {
  return extrasAendern(reiseId, (e) => {
    e[liste] = e[liste].filter((y) => y.id !== eid);
  });
}

/** Stimme einer Person für einen Ausflug: 1 (dafür), -1 (dagegen), 0 (keine). */
export function stimmeSetzen(reiseId, ausflugId, personId, wert) {
  if (!ID_RE.test(String(ausflugId)) && !/^[\w-]{1,80}$/.test(String(ausflugId))) throw fehler(400, "Ungültiger Ausflug.");
  return extrasAendern(reiseId, (e) => {
    const s = (e.stimmen[ausflugId] ??= {});
    if (wert === 1 || wert === -1) s[personId] = wert;
    else delete s[personId];
    if (!Object.keys(s).length) delete e.stimmen[ausflugId];
    return e.stimmen[ausflugId] ?? {};
  });
}

/** Tiere-Bingo: gesehen am Datum (oder entfernen), optional mit eigenem Foto. */
export function tierSetzen(reiseId, tier, gesehen, fotoId = undefined) {
  const name = text(tier, 80).trim();
  if (!name) throw fehler(400, "Kein Tier angegeben.");
  return extrasAendern(reiseId, (e) => {
    if (gesehen) e.tiere[name] ??= new Date().toISOString().slice(0, 10);
    else {
      delete e.tiere[name];
      delete e.tierFotos[name];
    }
    if (gesehen && fotoId !== undefined) {
      if (fotoId) e.tierFotos[name] = fotoId;
      else delete e.tierFotos[name];
    }
    return { tiere: e.tiere, tierFotos: e.tierFotos };
  });
}

export const CHALLENGES = ["essen", "tiere", "sprache", "baden", "foto", "helfen"];
/** Familien-Challenge: Punkte je Person und Kategorie (+1/−1). */
export async function challengeSetzen(reiseId, kategorie, personId, delta) {
  if (!CHALLENGES.includes(kategorie)) throw fehler(400, "Unbekannte Challenge.");
  const d = Math.sign(Number(delta) || 0);
  return extrasAendern(reiseId, (e) => {
    const c = (e.challenge[kategorie] ??= {});
    c[personId] = Math.max(0, Math.min(999, (c[personId] ?? 0) + d));
    return e.challenge;
  });
}

/** Schatzsuche (für die ganze Familie): Aufgabe erledigt, optional mit Foto-Beweis. */
export function schatzSetzen(reiseId, schluessel, erledigt, fotoId = "") {
  if (!/^[\w-]{1,80}:\d{1,2}$/.test(String(schluessel))) throw fehler(400, "Ungültige Aufgabe.");
  return extrasAendern(reiseId, (e) => {
    if (erledigt) e.schatz[schluessel] = { datum: new Date().toISOString().slice(0, 10), fotoId: fotoId || e.schatz[schluessel]?.fotoId || "" };
    else delete e.schatz[schluessel];
    return e.schatz;
  });
}

const STIMMUNGEN = 5;
/**
 * Kinder-Bereich je Kind: Abzeichen, Quiz-Punkte, Tagebuch, Sparschwein, Kids-Club.
 * d = { bereich, schluessel, wert }. fotoIds: vorhandene Fotos der Reise (für Bilder).
 */
export function kinderAendern(reiseId, personId, d, fotoIds = new Set(), audioIds = new Set()) {
  const datumOk = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x ?? ""));
  const { bereich, schluessel, wert } = d ?? {};
  return extrasAendern(reiseId, (e) => {
    const k = (e.kinder[personId] ??= { abzeichen: {}, quiz: {}, tagebuch: {}, kasse: { start: null, ausgaben: [] }, kidsclub: {} });
    k.abzeichen ??= {};
    k.quiz ??= {};
    k.tagebuch ??= {};
    k.kasse ??= { start: null, ausgaben: [] };
    k.kidsclub ??= {};
    if (bereich === "abzeichen") {
      if (!/^[a-z0-9-]{1,40}$/.test(String(schluessel))) throw fehler(400, "Ungültiges Abzeichen.");
      if (wert) k.abzeichen[schluessel] = new Date().toISOString().slice(0, 10);
      else delete k.abzeichen[schluessel];
    } else if (bereich === "quiz") {
      if (!datumOk(schluessel)) throw fehler(400, "Ungültiges Datum.");
      const punkte = Math.max(0, Math.min(10, Math.round(Number(wert) || 0)));
      k.quiz[schluessel] = Math.max(k.quiz[schluessel] ?? 0, punkte);
    } else if (bereich === "tagebuch") {
      if (!datumOk(schluessel)) throw fehler(400, "Ungültiges Datum.");
      if (!wert) delete k.tagebuch[schluessel];
      else {
        const stimmung = Number.isInteger(wert.stimmung) && wert.stimmung >= 0 && wert.stimmung < STIMMUNGEN ? wert.stimmung : null;
        k.tagebuch[schluessel] = { stimmung, text: text(wert.text, 1000), bildId: fotoIds.has(wert.bildId) ? wert.bildId : "", audioId: audioIds.has(wert.audioId) ? wert.audioId : "" };
      }
    } else if (bereich === "kasse") {
      const start = zahl(wert?.start);
      k.kasse.start = start != null && start >= 0 && start <= 10_000 ? start : null;
    } else if (bereich === "kasseAusgabe") {
      if (wert) {
        const betrag = zahl(wert.betrag);
        if (betrag == null || betrag < 0 || betrag > 10_000) throw fehler(400, "Bitte einen gültigen Betrag eingeben.");
        if (k.kasse.ausgaben.length >= 500) throw fehler(400, "Zu viele Einträge.");
        k.kasse.ausgaben.push({ id: randomUUID(), titel: text(wert.titel, 100).trim() || "Ausgabe", betrag, datum: datumOk(wert.datum) ? wert.datum : "" });
      } else k.kasse.ausgaben = k.kasse.ausgaben.filter((x) => x.id !== schluessel);
    } else if (bereich === "kidsclub") {
      k.kidsclub = { gruppe: text(wert?.gruppe, 60), armband: text(wert?.armband, 30), hinweis: text(wert?.hinweis, 300) };
    } else if (bereich === "fund") {
      // Sammelalbum: Fundstücke mit Foto
      k.funde ??= [];
      if (wert) {
        if (!fotoIds.has(wert.fotoId)) throw fehler(400, "Bitte ein Foto vom Fundstück machen.");
        if (k.funde.length >= 300) throw fehler(400, "Das Sammelalbum ist voll.");
        k.funde.push({ id: randomUUID(), titel: text(wert.titel, 80).trim() || "Fundstück", fotoId: wert.fotoId, ort: text(wert.ort, 80), datum: datumOk(wert.datum) ? wert.datum : "" });
      } else k.funde = k.funde.filter((x) => x.id !== schluessel);
    } else if (bereich === "ranking") {
      k.ranking = { ort: text(wert?.ort, 80), essen: text(wert?.essen, 100), erlebnis: text(wert?.erlebnis, 120), tier: text(wert?.tier, 60) };
    } else throw fehler(400, "Unbekannter Bereich.");
    return k;
  });
}
