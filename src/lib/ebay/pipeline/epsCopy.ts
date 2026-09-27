/** Lädt ein Bild zu eBay Picture Services hoch und liefert die eBay-URL. */
export type EpsUploader = (filename: string, data: Buffer) => Promise<string>;

/** eBays Obergrenze für ein einzelnes Bild. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Dateiname aus der Bild-URL, damit der Upload bei eBay einen sprechenden Namen bekommt. */
function filenameFor(url: string, index: number): string {
  const last = url.split('?')[0]?.split('/').pop() ?? '';
  return /\.[a-z]{3,4}$/i.test(last) ? last : `bild-${index + 1}.jpg`;
}

/**
 * Kopiert fremde Bild-URLs in den eigenen eBay-Bilderbestand (EPS).
 *
 * Ein Listing soll nicht an fremd gehosteten Dateien hängen: endet das
 * Quell-Listing oder tauscht der Verkäufer die Datei, bräche sonst das eigene
 * Bild. Läuft bewusst erst beim Veröffentlichen — für Bilder, die in der
 * Vorschau gelöscht wurden, entsteht so kein Upload.
 *
 * Ein fehlgeschlagenes Bild bricht ab (mit Nennung der URL), statt still ein
 * Listing mit weniger Bildern zu erzeugen.
 */
export async function copyImagesToEps(urls: string[], upload: EpsUploader): Promise<string[]> {
  const copied: string[] = [];
  for (const [index, url] of urls.entries()) {
    let data: Buffer;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Eine Fehlerseite kommt gern mit HTTP 200 — sonst landet HTML im Upload.
      const contentType = res.headers.get('content-type');
      if (contentType && !contentType.startsWith('image/')) {
        throw new Error(`kein Bild, sondern ${contentType}`);
      }
      data = Buffer.from(await res.arrayBuffer());
      if (data.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`zu groß (${Math.round(data.byteLength / 1024 / 1024)} MB, erlaubt sind 12 MB)`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Bild konnte nicht geladen werden (${url}): ${reason}`);
    }
    try {
      copied.push(await upload(filenameFor(url, index), data));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Bild konnte nicht zu eBay kopiert werden (${url}): ${reason}`);
    }
  }
  return copied;
}
