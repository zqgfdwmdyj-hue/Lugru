import "server-only";
import sharp from "sharp";

// Fotos für die KI vorbereiten: Claude verkleinert ohnehin auf etwa 1568 Pixel und nimmt höchstens 5 MB an.
// Vorher selbst verkleinern spart Übertragung und Kosten und lässt auch große Fotos (z. B. ohne Verkleinerung
// im Browser hochgeladen) durch. Immer als JPEG – dann passt auch der angegebene Dateityp sicher.
const MAX_SIDE = 1568;

export async function claudeImage(image: { mimeType: string; data: Buffer }) {
  let data: Buffer = image.data;
  let mediaType = image.mimeType;
  try {
    data = await sharp(image.data, { failOn: "none" })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    mediaType = "image/jpeg";
  } catch {
    // Unlesbar für sharp: Original schicken, die KI meldet dann ggf. einen Fehler.
  }
  return { type: "base64" as const, media_type: mediaType as "image/jpeg", data: data.toString("base64") };
}
