// Text aus Word-Dateien (.docx) lesen – ohne Zusatzpakete: ZIP-Verzeichnis lesen,
// word/document.xml entpacken und Absätze als Zeilen zurückgeben.
import { inflateRawSync } from "node:zlib";

function eintrag(zip, name) {
  // Ende des zentralen Verzeichnisses suchen
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Keine gültige Word-Datei.");
  const anzahl = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < anzahl; n++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) break;
    const methode = zip.readUInt16LE(pos + 10);
    const groesse = zip.readUInt32LE(pos + 20);
    const nameLaenge = zip.readUInt16LE(pos + 28);
    const extraLaenge = zip.readUInt16LE(pos + 30);
    const kommentarLaenge = zip.readUInt16LE(pos + 32);
    const lokal = zip.readUInt32LE(pos + 42);
    const eintragName = zip.toString("utf8", pos + 46, pos + 46 + nameLaenge);
    if (eintragName === name) {
      const lNameLaenge = zip.readUInt16LE(lokal + 26);
      const lExtraLaenge = zip.readUInt16LE(lokal + 28);
      const start = lokal + 30 + lNameLaenge + lExtraLaenge;
      const daten = zip.subarray(start, start + groesse);
      if (methode === 0) return daten;
      if (methode === 8) return inflateRawSync(daten);
      throw new Error("Unbekannte Kompression in der Word-Datei.");
    }
    pos += 46 + nameLaenge + extraLaenge + kommentarLaenge;
  }
  return null;
}

export function docxText(buffer) {
  const xml = eintrag(buffer, "word/document.xml");
  if (!xml) throw new Error("Die Word-Datei enthält keinen Text.");
  return xml
    .toString("utf8")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
