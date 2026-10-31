// Einfaches ZIP ohne Kompression (Fotos sind schon komprimiert) – für Fall-Pakete. Reine Logik, keine Abhängigkeit.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS-Datum/-Zeit (lokale Zeit wird nicht gebraucht – UTC genügt für ein Fall-Paket). */
function dos(d: Date) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

export type ZipEintrag = { name: string; daten: Uint8Array; datum?: Date };

/** Baut ein ZIP-Archiv (Methode „stored“, Dateinamen in UTF-8). */
export function zipErstellen(eintraege: ZipEintrag[]): Uint8Array {
  const teile: Uint8Array[] = [];
  const zentral: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const e of eintraege) {
    const name = enc.encode(e.name);
    const crc = crc32(e.daten);
    const { time, date } = dos(e.datum ?? new Date());
    const lokal = new DataView(new ArrayBuffer(30));
    lokal.setUint32(0, 0x04034b50, true);
    lokal.setUint16(4, 20, true);
    lokal.setUint16(6, 0x0800, true); // UTF-8
    lokal.setUint16(8, 0, true);
    lokal.setUint16(10, time, true);
    lokal.setUint16(12, date, true);
    lokal.setUint32(14, crc, true);
    lokal.setUint32(18, e.daten.length, true);
    lokal.setUint32(22, e.daten.length, true);
    lokal.setUint16(26, name.length, true);
    lokal.setUint16(28, 0, true);
    teile.push(new Uint8Array(lokal.buffer), name, e.daten);

    const z = new DataView(new ArrayBuffer(46));
    z.setUint32(0, 0x02014b50, true);
    z.setUint16(4, 20, true);
    z.setUint16(6, 20, true);
    z.setUint16(8, 0x0800, true);
    z.setUint16(10, 0, true);
    z.setUint16(12, time, true);
    z.setUint16(14, date, true);
    z.setUint32(16, crc, true);
    z.setUint32(20, e.daten.length, true);
    z.setUint32(24, e.daten.length, true);
    z.setUint16(28, name.length, true);
    z.setUint32(42, offset, true);
    zentral.push(new Uint8Array(z.buffer), name);
    offset += 30 + name.length + e.daten.length;
  }
  const zentralLaenge = zentral.reduce((n, b) => n + b.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, eintraege.length, true);
  ende.setUint16(10, eintraege.length, true);
  ende.setUint32(12, zentralLaenge, true);
  ende.setUint32(16, offset, true);
  const alle = [...teile, ...zentral, new Uint8Array(ende.buffer)];
  const out = new Uint8Array(alle.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of alle) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
