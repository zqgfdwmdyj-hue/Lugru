import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { claudeImage } from "@/lib/ai-image";
import { normalizeMhd } from "@/lib/mhd-parse";

// MHD vom Foto ablesen: kleinstes Modell, keine Websuche – kostet einen Bruchteil eines Cents.

const PROMPT = `Auf dem Foto ist ein aufgedrucktes Haltbarkeitsdatum einer Verpackung (MHD, „mindestens haltbar bis“, „zu verbrauchen bis“, „best before“, „EXP“, „BBE“).
Lies das Datum ab. Chargennummern (L…), Uhrzeiten und Preise ignorieren.
Antworte nur mit JSON: {"text": "das Datum genau wie aufgedruckt", "datum": "JJJJ-MM-TT"}
Steht nur Monat und Jahr da, nimm den letzten Tag des Monats. Ist kein Datum lesbar: {"text": null, "datum": null}`;

export type MhdReading = { date: string | null; raw: string | null; inputTokens: number; outputTokens: number };

export async function readBestBefore(image: { mimeType: string; data: Buffer }): Promise<MhdReading> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
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
  let raw: string | null = null;
  let date: string | null = null;
  try {
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { text?: string | null; datum?: string | null };
    raw = json.text ?? null;
    // Erst das Datum der KI prüfen, sonst den abgelesenen Text selbst auswerten.
    date = normalizeMhd(json.datum) ?? normalizeMhd(json.text);
  } catch {
    date = normalizeMhd(text);
  }
  return { date, raw, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}

/**
 * MHD automatisch für Lebensmittel: Für Einträge ohne MHD, bei denen eins nötig ist, die Fotos des Produkts
 * (zuerst Rückseiten/Infofotos, dann das Hauptfoto) ablesen. Gefundenes Datum wird als „foto-ki“ markiert (bitte
 * kurz prüfen); ohne Ergebnis „foto-ki-leer“, damit dieselben Fotos nicht immer wieder gelesen werden.
 */
export async function autoReadMhd(productIds: string[], eventId?: string | null): Promise<number> {
  if (productIds.length === 0 || !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) return 0;
  const { db, schema } = await import("@/db");
  const { and, eq, inArray, isNull, or, ne, sql } = await import("drizzle-orm");
  const { mhdRelevant } = await import("@/lib/price-logic");
  const I = schema.eventItems;
  const P = schema.products;
  const rows = await db
    .select({ item: I, product: P })
    .from(I)
    .innerJoin(P, eq(P.id, I.productId))
    .where(
      and(
        inArray(I.productId, productIds),
        isNull(I.bestBefore),
        or(isNull(I.bestBeforeSource), ne(I.bestBeforeSource, "foto-ki-leer")),
        eventId ? eq(I.eventId, eventId) : sql`true`,
      ),
    );
  let found = 0;
  for (const r of rows.filter((x) => mhdRelevant(x.product))) {
    const extra = await db.select({ fileId: schema.productPhotos.fileId }).from(schema.productPhotos).where(eq(schema.productPhotos.productId, r.product.id));
    const fileIds = [...extra.map((e) => e.fileId), r.product.imageFileId].filter((f): f is string => !!f).slice(0, 3);
    let date: string | null = null;
    let from: string | null = null;
    for (const fid of fileIds) {
      const [file] = await db.select({ mimeType: schema.files.mimeType, data: schema.files.data }).from(schema.files).where(eq(schema.files.id, fid));
      if (!file) continue;
      try {
        const reading = await readBestBefore(file);
        if (reading.date) {
          date = reading.date;
          from = fid;
          break;
        }
      } catch (e) {
        console.error("MHD automatisch lesen fehlgeschlagen", fid, e);
      }
    }
    // Nur setzen, wenn inzwischen niemand selbst ein MHD eingetragen hat.
    await db
      .update(I)
      .set(date ? { bestBefore: date, bestBeforeSource: "foto-ki", bestBeforeFileId: r.item.bestBeforeFileId ?? from } : { bestBeforeSource: "foto-ki-leer" })
      .where(and(eq(I.id, r.item.id), isNull(I.bestBefore)));
    if (date) found++;
  }
  return found;
}
