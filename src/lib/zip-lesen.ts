import { inflateRawSync } from "node:zlib";

/**
 * Schlanker ZIP-Leser (gespeichert oder Deflate, ohne ZIP64) – für Word-/ODT-Dateien und ZIP-Ordner aus Google
 * Drive. Grenzen gegen „ZIP-Bomben“: höchstens 500 Einträge, je Eintrag 50 MB, zusammen 200 MB entpackt.
 */
export function leseZip(buf: Uint8Array, o: { maxEintraege?: number; maxJe?: number; maxGesamt?: number } = {}): { name: string; daten: Buffer; geaendert: string | null }[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const maxEintraege = o.maxEintraege ?? 500;
  const maxJe = o.maxJe ?? 50 * 1024 * 1024;
  let rest = o.maxGesamt ?? 200 * 1024 * 1024;
  let ende = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      ende = i;
      break;
    }
  }
  if (ende < 0) throw new Error("Keine gültige ZIP-Datei.");
  const anzahl = b.readUInt16LE(ende + 10);
  if (anzahl > maxEintraege) throw new Error(`Zu viele Dateien im ZIP (${anzahl}, höchstens ${maxEintraege}).`);
  let p = b.readUInt32LE(ende + 16);
  const out: { name: string; daten: Buffer; geaendert: string | null }[] = [];
  for (let n = 0; n < anzahl && p + 46 <= b.length; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) break;
    const flags = b.readUInt16LE(p + 8);
    const methode = b.readUInt16LE(p + 10);
    const tag = b.readUInt16LE(p + 14);
    const gepackt = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const kommentarLen = b.readUInt16LE(p + 32);
    const lokal = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1");
    p += 46 + nameLen + extraLen + kommentarLen;
    if (name.endsWith("/") || lokal + 30 > b.length || b.readUInt32LE(lokal) !== 0x04034b50) continue;
    const start = lokal + 30 + b.readUInt16LE(lokal + 26) + b.readUInt16LE(lokal + 28);
    const roh = b.subarray(start, start + gepackt);
    let daten: Buffer;
    if (methode === 0) daten = Buffer.from(roh);
    else if (methode === 8) {
      try {
        daten = inflateRawSync(roh, { maxOutputLength: Math.max(1, Math.min(maxJe, rest)) });
      } catch {
        throw new Error(`Datei im ZIP zu groß oder beschädigt: ${name}`);
      }
    } else continue;
    if (daten.length > maxJe) throw new Error(`Datei im ZIP zu groß: ${name}`);
    rest -= daten.length;
    if (rest < 0) throw new Error("ZIP entpackt zu groß (höchstens 200 MB).");
    // DOS-Datum (Änderungsdatum der Datei) – bei Google-Drive-Downloads ungefähr das Datum des Dokuments.
    const jahr = 1980 + (tag >> 9);
    const monat = (tag >> 5) & 15;
    const t = tag & 31;
    const geaendert = monat >= 1 && monat <= 12 && t >= 1 && jahr > 1980 ? `${jahr}-${String(monat).padStart(2, "0")}-${String(t).padStart(2, "0")}` : null;
    out.push({ name, daten, geaendert });
  }
  return out;
}
