import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { parsePrintedReading, type PrintedReading } from "@/lib/printed-price";

// Alte Fotos, auf denen der Preis schon steht (z. B. aus früheren Collagen): Preis ablesen und merken, wo er steht.
// Kleinstes Modell, keine Websuche – Bruchteil eines Cents je Foto.

const F = schema.files;
const P = schema.products;
const I = schema.eventItems;

const PROMPT = `Auf dem Foto ist ein Produkt aus einer Lebensmittelverteilung. Manche Fotos stammen aus früheren Collagen:
Dann wurde ein Spendenpreis nachträglich ins Bild geschrieben (z. B. große weiße oder farbige Schrift „60 Cent“, „Je 50 Cent“, „1 €“, „2,50 €“, oft unten im Bild, manchmal auf einem farbigen Feld).
Gesucht ist NUR so ein nachträglich ins Bild gesetzter Preis – nicht Preise, Rabatte oder Mengenangaben, die auf der Verpackung selbst gedruckt sind, und kein Preisschild im Supermarktregal.
Antworte nur mit JSON:
{"preis_text": "Text genau wie im Bild, z. B. Je 60 Cent", "preis": 0.6, "rahmen": [links, oben, rechts, unten]}
„preis“ in Euro als Zahl. „rahmen“ umschließt den ganzen Preistext (mit Zusatz wie „Je“) in Prozent von Bildbreite und -höhe (0–100).
Steht kein nachträglich eingefügter Preis im Bild: {"preis_text": null}`;

export async function readPrintedPrice(image: { mimeType: string; data: Buffer }): Promise<PrintedReading> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mimeType as "image/jpeg", data: image.data.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parsePrintedReading(text);
}

/** Fotos dieser Produkte zum Ablesen vormerken (nur noch nicht gelesene oder mit Fehler). Gibt die Datei-IDs zurück. */
export async function queuePhotoPrices(productIds: string[], opts: { again?: boolean } = {}): Promise<string[]> {
  if (productIds.length === 0) return [];
  const rows = await db
    .update(F)
    // printedScannedAt dient bis zum Ergebnis als Zeitpunkt der Vormerkung (für failStalePhotoPrices).
    .set({ printedStatus: "pending", printedScannedAt: new Date() })
    .where(
      and(
        inArray(F.id, db.select({ id: sql<string>`${P.imageFileId}` }).from(P).where(inArray(P.id, productIds))),
        opts.again ? sql`coalesce(${F.printedStatus}, '') <> 'pending'` : or(isNull(F.printedStatus), eq(F.printedStatus, "error")),
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
      .set({ printedStatus: "done", printedPrice: r.found ? r.price : null, printedPriceText: r.found ? r.text : null, printedPriceBox: r.found ? r.box : null, printedScannedAt: new Date() })
      .where(eq(F.id, fileId));
    if (r.found && r.price !== null) {
      // Preis übernehmen, wo noch keiner steht: im Produkt (Vorschlag für später) und in der Verteilung.
      await db.update(P).set({ price: r.price, updatedAt: new Date() }).where(and(eq(P.imageFileId, fileId), isNull(P.price)));
      if (eventId) {
        const ids = db.select({ id: P.id }).from(P).where(eq(P.imageFileId, fileId));
        await db.update(I).set({ price: r.price }).where(and(eq(I.eventId, eventId), inArray(I.productId, ids), isNull(I.price)));
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

/** Nach einem Neustart hängengebliebene Vormerkungen freigeben. */
export async function failStalePhotoPrices() {
  await db
    .update(F)
    .set({ printedStatus: "error" })
    .where(and(eq(F.printedStatus, "pending"), lt(F.printedScannedAt, sql`now() - interval '15 minutes'`)));
}
