import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { claudeImage } from "@/lib/ai-image";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { parsePrintedReading, type PrintedReading } from "@/lib/printed-price";

// Alte Fotos, auf denen der Preis schon steht (z. B. aus früheren Collagen): Preis ablesen und merken, wo er steht.
// Kleinstes Modell, keine Websuche – Bruchteil eines Cents je Foto.

const F = schema.files;
const P = schema.products;
const I = schema.eventItems;

/** Version des Lesers – Fotos, die ein älterer Leser ohne Ergebnis gelesen hat, werden einmal neu gelesen. */
export const READER_VERSION = 2;

const PROMPT = `Auf dem Foto ist ein Produkt aus einer Lebensmittelverteilung. Viele Fotos stammen aus früheren Collagen:
Dann wurde ein Spendenpreis nachträglich ins Bild geschrieben – typisch: „1,50 €“, „40 Cent“, „Je 50 Cent“, „2 €“, „0,80 €“,
in großer, fetter weißer, gelber, roter oder schwarzer Schrift, oft mit Schatten oder Umrandung, oft unten oder oben im Bild,
manchmal auf einem farbigen Feld oder Streifen, manchmal mit dunklem Verlauf dahinter. Er sieht aus wie nachträglich darübergelegt,
nicht wie Teil des Verpackungsdesigns.
Gesucht ist NUR so ein nachträglich ins Bild gesetzter Preis – keine Preise, Rabatte, Gewichte oder Mengenangaben, die auf der
Verpackung selbst gedruckt sind, und kein Preisschild im Supermarktregal. Prüfe das ganze Bild sorgfältig, auch die Ränder.
Antworte nur mit JSON:
{"preis_text": "Text genau wie im Bild, z. B. Je 60 Cent", "preis": 0.6, "rahmen": [links, oben, rechts, unten]}
„preis“ in Euro als Zahl. „rahmen“ umschließt den ganzen Preistext (mit Zusatz wie „Je“) in Prozent von Bildbreite und -höhe (0–100).
Steht kein nachträglich eingefügter Preis im Bild: {"preis_text": null}`;

export async function readPrintedPrice(image: { mimeType: string; data: Buffer }): Promise<PrintedReading> {
  const client = new Anthropic();
  const response = await client.messages.create({
    // Größeres Modell: das kleinste hat eingebrannte Preise auf manchen Fotos übersehen (→ doppelte Preise).
    model: "claude-sonnet-5-5",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: await claudeImage(image) },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parsePrintedReading(text);
}

/** Fotos dieser Produkte zum Ablesen vormerken (nur noch nicht gelesene oder mit Fehler). Gibt die Datei-IDs zurück. */
export async function queuePhotoPrices(productIds: string[], opts: { again?: boolean; retry?: boolean } = {}): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await db
    .update(F)
    // printedScannedAt dient bis zum Ergebnis als Zeitpunkt der Vormerkung (für failStalePhotoPrices).
    .set({ printedStatus: "pending", printedScannedAt: new Date() })
    .where(
      and(
        inArray(F.id, db.select({ id: sql<string>`${P.imageFileId}` }).from(P).where(inArray(P.id, productIds))),
        opts.again
          ? sql`coalesce(${F.printedStatus}, '') <> 'pending'`
          : opts.retry
            ? // auch: von einem älteren Leser ohne Ergebnis gelesen
              or(isNull(F.printedStatus), eq(F.printedStatus, "error"), and(eq(F.printedStatus, "done"), isNull(F.printedPriceText), sql`coalesce(${F.printedReader}, 1) < ${READER_VERSION}`))
            : or(isNull(F.printedStatus), eq(F.printedStatus, "error")),
        // Als „Erkennung falsch“ markierte Fotos nie wieder lesen.
        eq(F.printedRejected, false),
      ),
    )
    .returning({ id: F.id });
  return rows.map((r) => r.id);
}

async function scanOne(fileId: string, eventId: string | null) {
  const [file] = await db.select({ mimeType: F.mimeType, data: F.data }).from(F).where(and(eq(F.id, fileId), eq(F.printedStatus, "pending")));
  if (!file) return;
  try {
    const r = await readPrintedPrice(file);
    await db
      .update(F)
      .set({ printedStatus: "done", printedPrice: r.found ? r.price : null, printedPriceText: r.found ? r.text : null, printedPriceBox: r.found ? r.box : null, printedReader: READER_VERSION, printedScannedAt: new Date() })
      .where(eq(F.id, fileId));
    if (r.found && r.price !== null) {
      // Preis übernehmen, wo noch keiner steht: im Produkt (Vorschlag für später) und in der Verteilung.
      if (r.price < 20) await db.update(P).set({ price: r.price, priceConfirmed: false, updatedAt: new Date() }).where(and(eq(P.imageFileId, fileId), isNull(P.price)));
      if (eventId) {
        const ids = db.select({ id: P.id }).from(P).where(eq(P.imageFileId, fileId));
        // Aus dem Foto gelesen = noch unbestätigt (erscheint unter „Prüfen“). Unplausible Werte (z. B. „50 €“ statt
        // „50 Cent“) gar nicht erst eintragen.
        if (r.price < 20) await db.update(I).set({ price: r.price, priceSource: "foto", priceConfirmed: false }).where(and(eq(I.eventId, eventId), inArray(I.productId, ids), isNull(I.price)));
      }
    }
  } catch (e) {
    console.error("Preis im Foto lesen fehlgeschlagen", fileId, e);
    await db.update(F).set({ printedStatus: "error", printedScannedAt: new Date() }).where(eq(F.id, fileId));
  }
}

/** Arbeitet die vorgemerkten Fotos ab, höchstens drei gleichzeitig. */
export async function runPhotoPrices(fileIds: string[], eventId: string | null) {
  const queue = [...fileIds];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await scanOne(id, eventId);
    }),
  );
}

/** Nach einem Neustart hängengebliebene Vormerkungen freigeben (wie failStaleChecks: nur wenn nichts mehr vorangeht). */
export async function failStalePhotoPrices() {
  await db
    .update(F)
    .set({ printedStatus: "error" })
    .where(
      and(
        eq(F.printedStatus, "pending"),
        lt(F.printedScannedAt, sql`now() - interval '15 minutes'`),
        sql`not exists (select 1 from files x where x.printed_status = 'done' and x.printed_scanned_at > now() - interval '5 minutes')`,
      ),
    );
}

/**
 * Vor Collage/Social Media: noch nicht geprüfte Fotos im Hintergrund lesen – sonst könnte ein eingebrannter Preis
 * doppelt erscheinen. Jedes Foto nur einmal (Fotos mit „Erkennung falsch“ nie wieder).
 */
export async function readUnreadPhotos(eventId: string, productIds: string[]) {
  if (productIds.length === 0 || !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) return 0;
  await failStalePhotoPrices();
  const fileIds = await queuePhotoPrices(productIds, { retry: true });
  if (fileIds.length) after(() => runPhotoPrices(fileIds, eventId));
  return fileIds.length;
}

/**
 * Mehrere Fotos eines Produkts („Alle Fotos = ein Produkt“): Die KI sucht die Vorderseite aus (Marke und Name groß,
 * wie im Regal) – die wird Titelbild, alle anderen bleiben Infofotos. Kleinstes Modell, Bruchteil eines Cents.
 */
export async function pickFrontPhoto(productId: string): Promise<void> {
  const [p] = await db.select({ imageFileId: P.imageFileId }).from(P).where(eq(P.id, productId));
  if (!p?.imageFileId) return;
  const PP = schema.productPhotos;
  const extra = await db.select({ fileId: PP.fileId }).from(PP).where(eq(PP.productId, productId));
  const ids = [p.imageFileId, ...extra.map((e) => e.fileId)].slice(0, 5);
  if (ids.length < 2) return;
  const files = await db.select({ id: F.id, mimeType: F.mimeType, data: F.data }).from(F).where(inArray(F.id, ids));
  const ordered = ids.map((id) => files.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f);
  const content: Anthropic.ContentBlockParam[] = [];
  for (const [i, f] of ordered.entries()) {
    content.push({ type: "text", text: `Bild ${i + 1}:` });
    content.push({ type: "image", source: await claudeImage(f) });
  }
  content.push({ type: "text", text: `Alle Bilder zeigen dasselbe Produkt von verschiedenen Seiten. Welches Bild zeigt die Vorderseite (Marke und Produktname groß, so wie das Produkt im Regal steht – nicht Zutaten, Nährwerte oder Barcode)? Antworte nur mit JSON: {"vorne": Nummer des Bildes}` });
  const response = await new Anthropic().messages.create({ model: "claude-haiku-4-5", max_tokens: 50, messages: [{ role: "user", content }] });
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const m = /"vorne"\s*:\s*(\d+)/.exec(text);
  const idx = m ? Number(m[1]) - 1 : 0;
  if (!(idx > 0 && idx < ordered.length)) return;
  const front = ordered[idx].id;
  // Bisheriges Titelbild wird Infofoto, das gewählte wird Titelbild.
  await db.delete(PP).where(and(eq(PP.productId, productId), eq(PP.fileId, front)));
  await db.insert(PP).values({ productId, fileId: p.imageFileId, role: "info" }).onConflictDoNothing();
  await db.update(P).set({ imageFileId: front, updatedAt: new Date() }).where(eq(P.id, productId));
}
