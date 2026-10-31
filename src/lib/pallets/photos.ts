import "server-only";
import { storeFile } from "@/lib/orders/service";

// Fotos aus Formularen (Palette, Sendung) prüfen und verschlüsselt ablegen.

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_PHOTOS = 8;

/** Hochgeladene Fotos (Feld „photos“) prüfen und speichern – gibt die Datei-IDs zurück. */
export async function storePhotos(tenantId: string, fd: FormData, fallbackName = "palette.jpg"): Promise<string[]> {
  const files = fd.getAll("photos").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && f.size > 0);
  if (files.length > MAX_PHOTOS) throw new Error(`Höchstens ${MAX_PHOTOS} Fotos auf einmal.`);
  const ids: string[] = [];
  for (const f of files) {
    if (!PHOTO_TYPES.has(f.type)) throw new Error(`„${f.name}“: bitte ein Foto (JPG, PNG oder WebP).`);
    if (f.size > 8 * 1024 * 1024) throw new Error(`„${f.name}“ ist größer als 8 MB.`);
    // Dateiname nur mit einfachen Zeichen – er landet später im Download-Header.
    const name = (f.name || fallbackName).normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-120) || fallbackName;
    ids.push(await storeFile(tenantId, name, f.type, Buffer.from(await f.arrayBuffer())));
  }
  return ids;
}
