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
export const LEERE_EXTRAS = { packliste: [], dokumente: [], ausgaben: [], dateien: [], stimmen: {}, tiere: {}, briefings: {}, checks: {} };
export const LISTEN = ["packliste", "dokumente", "ausgaben"];
export const dateiPfad = (id, typ) => path.join(DATEI_DIR, `${id}.${typ === "application/pdf" ? "pdf" : typ === "image/png" ? "png" : "jpg"}`);

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
export function eintragAus(liste, d, { personen = [], dateien = [] } = {}) {
  const person = (p) => (personen.includes(p) ? p : "");
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

/** Tiere-Bingo: gesehen am Datum (oder entfernen). */
export function tierSetzen(reiseId, tier, gesehen) {
  const name = text(tier, 80).trim();
  if (!name) throw fehler(400, "Kein Tier angegeben.");
  return extrasAendern(reiseId, (e) => {
    if (gesehen) e.tiere[name] = new Date().toISOString().slice(0, 10);
    else delete e.tiere[name];
    return e.tiere;
  });
}
