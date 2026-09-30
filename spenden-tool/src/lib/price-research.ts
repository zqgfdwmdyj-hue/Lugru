import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DONATION_CATEGORIES, isPlaceholderName } from "@/lib/layout";
import { suggestDonationPrice } from "@/lib/pricing";
import { parseAmount } from "@/lib/numbers";
import { AI_MODE_INFO, type AiMode, isAiMode } from "@/lib/ai-modes";

// KI-Preisrecherche: Claude erkennt das Produkt auf dem Foto und sucht im Internet,
// was es aktuell im deutschen Handel kostet. Läuft im Hintergrund (siehe startPriceChecks).

const C = schema.priceChecks;

export function aiConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const Offer = z.object({
  shop: z.string().min(1),
  title: z.string().default(""),
  // „1,49“, „1.49 €“ oder 1.49 – alles wird zur Zahl
  price: z.preprocess((v) => (typeof v === "string" ? parseAmount(v) : v), z.number().positive()),
  unit: z.string().nullish(),
  url: z.string().url(),
});

const Result = z.object({
  name: z.string().min(1),
  variant: z.string().nullish(),
  category: z.string().nullish(),
  // Einzelne fehlerhafte Angebote werden aussortiert statt das ganze Ergebnis zu verwerfen.
  offers: z
    .array(z.unknown())
    .nullish()
    .transform((list) => (list ?? []).flatMap((o) => { const r = Offer.safeParse(o); return r.success ? [r.data] : []; })),
  summary: z.string().nullish(),
});
export type ResearchResult = z.infer<typeof Result>;

const SYSTEM = `Du hilfst einer ehrenamtlichen Foodsharing-Gruppe in Deutschland. Sie gibt gerettete Lebensmittel und Waren gegen eine kleine Spende ab und möchte wissen, was ein Produkt regulär im Handel kostet.

Vorgehen:
1. Erkenne das Produkt auf dem Foto so genau wie möglich: Marke, Produktname, Sorte, Packungsgröße/Inhalt. Wenn Name oder Variante schon angegeben sind, nutze sie als Hinweis.
2. Suche im Internet nach aktuellen Preisen genau dieses Produkts in dieser Packungsgröße bei deutschen Händlern (Supermärkte, Discounter, Drogerien, Online-Shops, Amazon.de). Keine Preise aus anderen Ländern.
3. Nenne die bis zu 5 günstigsten seriösen Angebote, jeweils mit direktem Link zur Produktseite. Preise in Euro inklusive Mehrwertsteuer, ohne Versand. Erfinde keine Preise oder Links – nur was du in den Suchergebnissen gefunden hast. Findest du das exakte Produkt nicht, nimm das nächstähnliche und schreibe das in die Zusammenfassung.

Antworte zum Schluss ausschließlich mit einem JSON-Objekt in einem \`\`\`json-Block:
{
  "name": "Produktname ohne Packungsgröße, z. B. \\"Bio Kimchi\\"",
  "variant": "Packungsgröße/Sorte, z. B. \\"500 g\\" oder null",
  "category": "eine von: ${DONATION_CATEGORIES.join(", ")}",
  "offers": [{ "shop": "Händler", "title": "Produkttitel beim Händler", "price": 2.49, "unit": "z. B. 1,99 €/kg oder null", "url": "https://..." }],
  "summary": "Ein bis zwei Sätze auf Deutsch: was es ist und wie verlässlich die Preise sind"
}`;

/** Den JSON-Block aus der Antwort holen und prüfen. */
export function parseResearch(text: string): ResearchResult {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const data = Result.parse(JSON.parse(raw));
  // Günstigste zuerst, doppelte Links raus
  const seen = new Set<string>();
  data.offers = data.offers.filter((o) => !seen.has(o.url) && seen.add(o.url)).sort((a, b) => a.price - b.price);
  return data;
}

const RECOGNIZE_SYSTEM = `Du hilfst einer ehrenamtlichen Foodsharing-Gruppe in Deutschland. Erkenne das Produkt auf dem Foto: Marke, Produktname, Sorte, Packungsgröße. Keine Preissuche.

Antworte ausschließlich mit einem JSON-Objekt in einem \`\`\`json-Block:
{ "name": "Produktname ohne Packungsgröße", "variant": "Packungsgröße/Sorte oder null", "category": "eine von: ${DONATION_CATEGORIES.join(", ")}", "offers": [], "summary": "ein kurzer Satz, was es ist" }`;

const LOCATION = { type: "approximate" as const, country: "DE", timezone: "Europe/Berlin" };

async function research(mode: AiMode, product: { name: string; variant: string | null }, image: { mimeType: string; data: Buffer } | null) {
  const client = new Anthropic();
  const info = AI_MODE_INFO[mode];
  const known = !isPlaceholderName(product.name) ? `Bekannt: ${product.name}${product.variant ? ` (${product.variant})` : ""}.` : "Name noch unbekannt.";
  if (mode === "erkennen" && !image) throw new Error("Zum Erkennen wird ein Foto gebraucht.");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (image) {
    content.push({ type: "image", source: { type: "base64", media_type: image.mimeType as "image/jpeg", data: image.data.toString("base64") } });
  }
  content.push({
    type: "text",
    text:
      mode === "erkennen"
        ? `Welches Produkt ist das? ${known}`
        : `${image ? "Das Foto zeigt ein Spendenprodukt." : "Kein Foto vorhanden."} ${known} Finde den günstigsten aktuellen Preis im deutschen Handel.${mode === "sparsam" ? " Du hast höchstens zwei Suchen – wähle die Suchbegriffe gezielt (Marke, Name, Größe)." : ""}`,
  });

  // Je Stufe: Modell, Suche und Einstellungen. Haiku kennt nur die einfache Websuche und kein effort.
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming =
    mode === "genau"
      ? {
          model: info.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
          system: SYSTEM,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: info.searches, user_location: LOCATION }],
          messages: [],
        }
      : {
          model: info.model,
          max_tokens: 8000,
          system: mode === "erkennen" ? RECOGNIZE_SYSTEM : SYSTEM,
          ...(mode === "sparsam" ? { tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: info.searches, user_location: LOCATION }] } : {}),
          messages: [],
        };

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;
  for (let round = 0; round < 5; round++) {
    const response = await client.beta.messages.create({ ...params, messages });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    searches += response.usage.server_tool_use?.web_search_requests ?? 0;
    if (response.stop_reason === "refusal") throw new Error("Die KI hat die Anfrage abgelehnt.");
    if (response.stop_reason === "max_tokens") throw new Error("Antwort der KI war zu lang – bitte „genau“ versuchen.");
    if (response.stop_reason === "pause_turn") {
      // Suche läuft noch – dieselbe Unterhaltung erneut senden, der Server macht weiter.
      messages.splice(1, messages.length - 1, { role: "assistant", content: response.content });
      continue;
    }
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    return { result: parseResearch(text), inputTokens, outputTokens, searches };
  }
  throw new Error("Die Recherche hat zu lange gedauert.");
}

async function runOne(checkId: string) {
  const [claimed] = await db.update(C).set({ status: "running" }).where(and(eq(C.id, checkId), eq(C.status, "pending"))).returning();
  if (!claimed) return;
  try {
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, claimed.productId));
    if (!product) throw new Error("Produkt nicht gefunden.");
    const [file] = product.imageFileId ? await db.select().from(schema.files).where(eq(schema.files.id, product.imageFileId)) : [];
    const mode = isAiMode(claimed.mode) ? claimed.mode : "genau";
    const { result, inputTokens, outputTokens, searches } = await research(mode, product, file ? { mimeType: file.mimeType, data: file.data } : null);
    const lowest = result.offers[0]?.price ?? null;
    await db
      .update(C)
      .set({
        status: "done",
        recognizedName: result.name,
        recognizedVariant: result.variant ?? null,
        recognizedCategory: result.category && (DONATION_CATEGORIES as readonly string[]).includes(result.category) ? result.category : null,
        offers: result.offers.slice(0, 5).map((o) => ({ ...o, unit: o.unit ?? null })),
        lowestPrice: lowest,
        suggestedPrice: suggestDonationPrice(lowest),
        summary: result.summary ?? null,
        inputTokens,
        outputTokens,
        searches,
        finishedAt: new Date(),
      })
      .where(eq(C.id, checkId));
    // Noch namenlose Produkte (nach dem Foto-Upload) bekommen den erkannten Namen direkt.
    if (isPlaceholderName(product.name)) {
      await db
        .update(schema.products)
        .set({
          name: result.name,
          variant: product.variant ?? result.variant ?? null,
          category: result.category && (DONATION_CATEGORIES as readonly string[]).includes(result.category) ? result.category : product.category,
          updatedAt: new Date(),
        })
        .where(eq(schema.products.id, product.id));
    }
  } catch (e) {
    const message =
      e instanceof Anthropic.AuthenticationError ? "API-Schlüssel ungültig (ANTHROPIC_API_KEY prüfen)."
      : e instanceof Anthropic.RateLimitError ? "Zu viele Anfragen – bitte später erneut versuchen."
      : e instanceof Anthropic.APIError ? `KI-Dienst meldet Fehler ${e.status}.`
      : e instanceof z.ZodError || e instanceof SyntaxError ? "Antwort der KI war unvollständig – bitte erneut versuchen."
      : e instanceof Error ? e.message
      : "Unbekannter Fehler";
    console.error("Preisrecherche fehlgeschlagen", checkId, e);
    await db.update(C).set({ status: "error", error: message, finishedAt: new Date() }).where(eq(C.id, checkId));
  }
}

/**
 * Legt Recherchen an. Laufende/wartende für dieselben Produkte werden nicht doppelt angelegt.
 * Mit skipRecent werden Produkte übersprungen, für die es schon ein Ergebnis aus den letzten 60 Tagen gibt –
 * wiederkehrende Produkte kosten so nur beim ersten Mal.
 */
export async function queuePriceChecks(productIds: string[], mode: AiMode, opts: { skipRecent?: boolean } = {}): Promise<string[]> {
  if (productIds.length === 0) return [];
  const busy = await db.select({ productId: C.productId }).from(C).where(and(inArray(C.productId, productIds), inArray(C.status, ["pending", "running"])));
  const skip = new Set(busy.map((b) => b.productId));
  if (opts.skipRecent) {
    // Ein Preis-Ergebnis zählt für jede Stufe, ein reines Erkennen nur fürs Erkennen.
    const recent = await db
      .select({ productId: C.productId, mode: C.mode })
      .from(C)
      .where(and(inArray(C.productId, productIds), eq(C.status, "done"), sql`${C.createdAt} > now() - interval '60 days'`));
    for (const r of recent) if (mode === "erkennen" || r.mode !== "erkennen") skip.add(r.productId);
  }
  const todo = productIds.filter((id) => !skip.has(id));
  if (todo.length === 0) return [];
  const rows = await db.insert(C).values(todo.map((productId) => ({ productId, mode }))).returning({ id: C.id });
  return rows.map((r) => r.id);
}

/** Arbeitet Recherchen ab, höchstens drei gleichzeitig. */
export async function runPriceChecks(ids: string[]) {
  const queue = [...ids];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await runOne(id);
    }),
  );
}

/** Nach einem Neustart hängengebliebene Recherchen als Fehler markieren. */
export async function failStaleChecks() {
  await db
    .update(C)
    .set({ status: "error", error: "Abgebrochen (Server neu gestartet?) – bitte erneut starten.", finishedAt: new Date() })
    .where(and(inArray(C.status, ["pending", "running"]), lt(C.createdAt, sql`now() - interval '15 minutes'`)));
}
