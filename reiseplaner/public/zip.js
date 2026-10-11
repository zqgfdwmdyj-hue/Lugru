// Minimaler ZIP-Leser für Tauchcomputer-Exporte (z. B. Oceanic+ / Apple Watch liefert eine ZIP mit .uddf).
// Liest das zentrale Verzeichnis und entpackt „gespeicherte“ oder „deflate“-Einträge mit DecompressionStream.

const MAX_GROESSE = 30 * 1024 * 1024;

/** Liefert [{ name, text }] für Einträge, deren Name zu `muster` passt. */
export async function zipTexte(puffer, muster = /\.(uddf|udcf|xml|ssrf|csv|tsv|txt)$/i) {
  const d = new DataView(puffer);
  const u8 = new Uint8Array(puffer);
  // Ende des zentralen Verzeichnisses suchen (Signatur 0x06054b50, max. 64 KB Kommentar)
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (d.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Die ZIP-Datei ist beschädigt.");
  const anzahl = d.getUint16(eocd + 10, true);
  let pos = d.getUint32(eocd + 16, true);
  const ergebnis = [];
  const dekoder = new TextDecoder();
  for (let n = 0; n < anzahl && pos + 46 <= u8.length; n++) {
    if (d.getUint32(pos, true) !== 0x02014b50) break;
    const methode = d.getUint16(pos + 10, true);
    const gepackt = d.getUint32(pos + 20, true);
    const groesse = d.getUint32(pos + 24, true);
    const nameLaenge = d.getUint16(pos + 28, true);
    const extraLaenge = d.getUint16(pos + 30, true);
    const kommentarLaenge = d.getUint16(pos + 32, true);
    const lokal = d.getUint32(pos + 42, true);
    const name = dekoder.decode(u8.subarray(pos + 46, pos + 46 + nameLaenge));
    pos += 46 + nameLaenge + extraLaenge + kommentarLaenge;
    if (name.endsWith("/") || !muster.test(name) || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
    if (groesse > MAX_GROESSE || lokal + 30 > u8.length || d.getUint32(lokal, true) !== 0x04034b50) continue;
    const start = lokal + 30 + d.getUint16(lokal + 26, true) + d.getUint16(lokal + 28, true);
    const roh = u8.subarray(start, start + gepackt);
    let daten;
    if (methode === 0) daten = roh;
    else if (methode === 8) daten = new Uint8Array(await new Response(new Blob([roh]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else continue;
    ergebnis.push({ name, text: dekoder.decode(daten) });
  }
  return ergebnis;
}
