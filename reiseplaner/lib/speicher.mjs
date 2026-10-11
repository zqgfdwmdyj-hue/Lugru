// Ablage als JSON-Dateien. Schreibzugriffe auf dieselbe Datei laufen nacheinander (ein Prozess),
// geschrieben wird atomar über eine temporäre Datei.
import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "daten"));
export const REISEN_DIR = path.join(DATA_DIR, "reisen");
export const FOTO_DIR = path.join(DATA_DIR, "fotos");

await mkdir(REISEN_DIR, { recursive: true });
await mkdir(FOTO_DIR, { recursive: true });

const sperren = new Map();
/** Führt fn exklusiv für den Schlüssel aus (Warteschlange je Datei). */
export function exklusiv(schluessel, fn) {
  const vorher = sperren.get(schluessel) ?? Promise.resolve();
  const lauf = vorher.then(fn, fn);
  const ende = lauf.catch(() => {});
  sperren.set(schluessel, ende);
  ende.then(() => sperren.get(schluessel) === ende && sperren.delete(schluessel));
  return lauf;
}

export async function lesen(datei, standard) {
  try {
    return JSON.parse(await readFile(datei, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return structuredClone(standard);
    throw e;
  }
}

export async function schreiben(datei, wert) {
  const tmp = `${datei}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, JSON.stringify(wert));
  await rename(tmp, datei);
}

/** Liest, verändert (fn darf das Objekt ändern und etwas zurückgeben) und speichert. */
export function aendern(datei, standard, fn) {
  return exklusiv(datei, async () => {
    const wert = await lesen(datei, standard);
    const ergebnis = await fn(wert);
    await schreiben(datei, wert);
    return ergebnis;
  });
}

export async function loeschen(datei) {
  await unlink(datei).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
}

export const ID_RE = /^[a-z0-9-]{8,64}$/;
export const reiseDatei = (id) => path.join(REISEN_DIR, `${id}.json`);
export const beitraegeDatei = (id) => path.join(REISEN_DIR, `${id}.beitraege.json`);
export const LEERE_BEITRAEGE = { bewertungen: [], tauchgaenge: [], fotos: [] };
export const fotoDatei = (id, klein) => path.join(FOTO_DIR, `${id}${klein ? ".klein" : ""}.jpg`);
