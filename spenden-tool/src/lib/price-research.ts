import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { claudeImage } from "@/lib/ai-image";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DONATION_CATEGORIES, isPlaceholderName } from "@/lib/layout";
import { autoReadMhd } from "@/lib/mhd";
import { cleanAiText, comparability, isSecondHand, splitInternal, UNSORTED_CATEGORY } from "@/lib/price-logic";
import { autoAiMode } from "@/lib/settings";
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
  // Stück/Flaschen im Angebot (Kasten 12, Sixpack 6, Einzelflasche 1)
  menge: z.preprocess((v) => (typeof v === "string" ? parseAmount(v) : v), z.number().int().positive().max(1000).nullish().catch(null)),
  // Nur echte Webadressen – die Links landen anklickbar auf der Seite.
  url: z.string().url().refine((u) => /^https?:\/\//i.test(u)),
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
  // Zeigt das (erste) Foto die Vorder- oder Rückseite der Verpackung?
  seite: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.enum(["vorne", "hinten"]).nullish().catch(null)),
  // Zeigt das erste Foto mehrere verschiedene Produkte (z. B. Bonbons und Kaugummis)?
  mehrere: z.preprocess((v) => (v === "true" || v === "ja" ? true : v === "false" || v === "nein" ? false : v), z.boolean().nullish().catch(null)),
});
export type ResearchResult = z.infer<typeof Result>;

const SYSTEM = `Du hilfst einer ehrenamtlichen Foodsharing-Gruppe in Deutschland. Sie gibt gerettete Lebensmittel und Waren gegen eine kleine Spende ab und möchte wissen, was ein Produkt regulär im Handel kostet.

Vorgehen:
1. Erkenne das Produkt auf dem Foto so genau wie möglich: Marke, Produktname, Sorte, Packungsgröße/Inhalt. Wenn Name oder Variante schon angegeben sind, nutze sie als Hinweis.
2. Suche im Internet nach aktuellen Preisen genau dieses Produkts in dieser Packungsgröße bei deutschen Händlern (Supermärkte, Discounter, Drogerien, Online-Shops, Amazon.de). Keine Preise aus anderen Ländern.
3. Nenne die bis zu 5 günstigsten seriösen Angebote, jeweils mit direktem Link zur Produktseite. Preise in Euro inklusive Mehrwertsteuer, ohne Versand und ohne Pfand.
   „price“ ist IMMER der Preis für das ganze Angebot (z. B. den ganzen Kasten, das Sixpack, die Packung) – NIE der Grundpreis pro Liter oder Kilogramm; den Grundpreis höchstens in „unit“. „menge“ = Anzahl Stück bzw. Flaschen in diesem Angebot (1 bei Einzelstück, 12 beim Kasten mit 12 Flaschen).
   Bei Getränken: Angebote in der üblichen Gebindegröße (Flasche, Sixpack, Kasten) mit „menge“ angeben. Erfinde keine Preise oder Links – nur was du in den Suchergebnissen gefunden hast. Findest du das exakte Produkt nicht, nimm das nächstähnliche und schreibe das in die Zusammenfassung.

Antworte zum Schluss ausschließlich mit einem JSON-Objekt in einem \`\`\`json-Block:
{
  "name": "Produktname ohne Packungsgröße, z. B. \\"Bio Kimchi\\"",
  "variant": "Packungsgröße/Sorte, z. B. \\"500 g\\" oder null",
  "category": "eine von: ${DONATION_CATEGORIES.join(", ")}",
  "offers": [{ "shop": "Händler", "title": "Produkttitel beim Händler", "price": 2.49, "menge": 1, "unit": "Grundpreis z. B. 1,99 €/l oder null", "url": "https://..." }],
  "summary": "Ein bis zwei Sätze auf Deutsch: was es ist und wie verlässlich die Preise sind",
  "seite": "vorne oder hinten – zeigt das erste Foto die Vorderseite oder die Rückseite (Zutaten, Nährwerte, Barcode)?",
  "mehrere": "true, wenn auf dem ersten Foto zwei oder mehr VERSCHIEDENE Produkte zu sehen sind (z. B. Bonbons und Kaugummis, verschiedene Sorten nebeneinander) – dann beschreibe nur das größte/vorderste; false bei einem Produkt (mehrere gleiche Packungen zählen als ein Produkt)"
}
Weitere Fotos zeigen die Rückseite desselben Produkts – nutze sie für Packungsgröße, Sorte und Zutaten.`;

/** Den JSON-Block aus der Antwort holen und prüfen. */
export function parseResearch(text: string): ResearchResult {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const data = Result.parse(JSON.parse(raw));
  // Günstigste zuerst, doppelte Links raus
  const seen = new Set<string>();
  data.offers = data.offers.filter((o) => !seen.has(o.url) && seen.add(o.url)).sort((a, b) => a.price - b.price);
  // Technische Markierungen der Websuche (<cite …>) nicht speichern.
  data.summary = data.summary ? cleanAiText(data.summary) : data.summary;
  data.name = cleanAiText(data.name);
  data.variant = data.variant ? cleanAiText(data.variant) : data.variant;
  for (const o of data.offers) o.title = cleanAiText(o.title);
  return data;
}

const RECOGNIZE_SYSTEM = `Du hilfst einer ehrenamtlichen Foodsharing-Gruppe in Deutschland. Erkenne das Produkt auf dem Foto: Marke, Produktname, Sorte, Packungsgröße. Keine Preissuche.

Antworte ausschließlich mit einem JSON-Objekt in einem \`\`\`json-Block:
{ "name": "Produktname ohne Packungsgröße", "variant": "Packungsgröße/Sorte oder null", "category": "eine von: ${DONATION_CATEGORIES.join(", ")}", "offers": [], "summary": "ein kurzer Satz, was es ist", "seite": "vorne oder hinten (Rückseite mit Zutaten/Nährwerten/Barcode)", "mehrere": "true, wenn auf dem ersten Foto zwei oder mehr VERSCHIEDENE Produkte zu sehen sind (mehrere gleiche Packungen = false)" }
Weitere Fotos zeigen die Rückseite desselben Produkts – nutze sie für Packungsgröße und Sorte.`;

const LOCATION = { type: "approximate" as const, country: "DE", timezone: "Europe/Berlin" };

async function research(mode: AiMode, product: { name: string; variant: string | null }, image: { mimeType: string; data: Buffer } | null, backs: { mimeType: string; data: Buffer }[] = []) {
  const client = new Anthropic();
  const info = AI_MODE_INFO[mode];
  const known = !isPlaceholderName(product.name) ? `Bekannt: ${product.name}${product.variant ? ` (${product.variant})` : ""}.` : "Name noch unbekannt.";
  if (mode === "erkennen" && !image) throw new Error("Zum Erkennen wird ein Foto gebraucht.");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (image) {
    content.push({ type: "image", source: await claudeImage(image) });
  }
  // Rückseiten (Infofotos) – höchstens zwei, für Gewicht, Sorte und Zutaten.
  for (const b of backs.slice(0, 2)) content.push({ type: "image", source: await claudeImage(b) });
  content.push({
    type: "text",
    text:
      mode === "erkennen"
        ? `Welches Produkt ist das? ${known}`
        : `${image ? "Das Foto zeigt ein Spendenprodukt." : "Kein Foto vorhanden."} ${known} Finde den günstigsten aktuellen Preis im deutschen Handel.${mode === "sparsam" ? " Du hast höchstens zwei Suchen – wähle die Suchbegriffe gezielt (Marke, Name, Größe)." : mode === "minimal" ? " Du hast genau eine Suche – nimm Marke, Produktname und Größe als Suchbegriff." : ""}`,
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
          ...(mode === "sparsam" || mode === "minimal" ? { tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: info.searches, user_location: LOCATION }] } : {}),
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
    const backFiles = await db
      .select({ mimeType: schema.files.mimeType, data: schema.files.data })
      .from(schema.productPhotos)
      .innerJoin(schema.files, eq(schema.files.id, schema.productPhotos.fileId))
      .where(eq(schema.productPhotos.productId, product.id))
      .limit(2);
    const { result, inputTokens, outputTokens, searches } = await research(mode, product, file ? { mimeType: file.mimeType, data: file.data } : null, backFiles);
    // Vergleichspreis nur aus Neuware; B-Ware bleibt in der Liste, gekennzeichnet.
    const lowest = result.offers.find((o) => !isSecondHand(o.title, o.shop))?.price ?? null;
    await db
      .update(C)
      .set({
        status: "done",
        recognizedName: result.name,
        recognizedVariant: result.variant ?? null,
        recognizedCategory: result.category && (DONATION_CATEGORIES as readonly string[]).includes(result.category) ? result.category : null,
        recognizedSide: result.seite ?? null,
        multipleProducts: result.mehrere === true,
        offers: result.offers.slice(0, 5).map(({ menge, ...o }) => ({ ...o, unit: o.unit ?? null, count: menge ?? null })),
        lowestPrice: lowest,
        suggestedPrice: suggestDonationPrice(lowest),
        summary: result.summary ?? null,
        inputTokens,
        outputTokens,
        searches,
        finishedAt: new Date(),
      })
      .where(eq(C.id, checkId));
    const aiCategory = result.category && (DONATION_CATEGORIES as readonly string[]).includes(result.category) ? result.category : null;
    // Noch namenlose Produkte (nach dem Foto-Upload) bekommen den erkannten Namen direkt – als „unbestätigt“ markiert.
    if (isPlaceholderName(product.name)) {
      const unsure = result.summary && /unbekannt|unsicher|alternativ|ähnlich|nicht (?:exakt|genau|eindeutig)|vermutlich|nächst|möglicherweise/i.test(result.summary);
      // Unsicherheiten („Marke nicht identifiziert“, „genaue Packungsgröße unbekannt“) gehören nicht in Name/Variante,
      // sondern als interne Prüfnotiz ans Produkt.
      const n = splitInternal(result.name);
      const v = splitInternal(result.variant);
      const notes = [...n.notes, ...v.notes];
      await db
        .update(schema.products)
        .set({
          name: n.clean || result.name,
          variant: product.variant ?? (v.clean || null),
          ...(notes.length ? { note: [product.note, `KI: ${notes.join("; ")}`].filter(Boolean).join("\n") } : {}),
          // Kategorie nur ersetzen, wenn noch keine zugeordnet ist.
          category: aiCategory && product.category === UNSORTED_CATEGORY ? aiCategory : product.category,
          reviewNote: `Name${!product.variant && result.variant ? " und Variante" : ""} von der KI erkannt${notes.length ? ` – ${notes.join("; ")}` : unsure ? ` – ${cleanAiText(result.summary).slice(0, 200)}` : ""}`,
          updatedAt: new Date(),
        })
        // Nur, wenn inzwischen niemand selbst einen Namen eingetragen hat.
        .where(and(eq(schema.products.id, product.id), eq(schema.products.name, product.name)));
    } else if (aiCategory && product.category === UNSORTED_CATEGORY) {
      await db.update(schema.products).set({ category: aiCategory, updatedAt: new Date() }).where(and(eq(schema.products.id, product.id), eq(schema.products.category, UNSORTED_CATEGORY)));
    }
    // Felder ausfüllen, damit nur noch kontrolliert werden muss: Preisvorschlag als „unbestätigt“ in kommende
    // Verteilungen eintragen (nur ohne Preis, nicht bei Preis im Foto, nicht bei anderer Packungsgröße).
    if (!result.mehrere && (await autoAiMode())) await fillSuggestedPrice(product.id).catch((err) => console.error("Preis vorausfüllen", err));
    // Jetzt ist bekannt, was es ist: bei Lebensmitteln das MHD automatisch von den Fotos lesen.
    await autoReadMhd([product.id]).catch((err) => console.error("MHD automatisch", err));
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

/** Preisvorschlag der letzten Recherche in kommende Verteilungen eintragen – unbestätigt, zum Kontrollieren. */
async function fillSuggestedPrice(productId: string) {
  const [c] = await db.select().from(C).where(and(eq(C.productId, productId), eq(C.status, "done"))).orderBy(desc(C.createdAt)).limit(1);
  if (!c || c.suggestedPrice === null) return;
  const [p] = await db
    .select({ variant: schema.products.variant, printed: schema.files.printedPriceText })
    .from(schema.products)
    .leftJoin(schema.files, eq(schema.files.id, schema.products.imageFileId))
    .where(eq(schema.products.id, productId));
  if (!p || p.printed) return;
  if (comparability(p.variant, c).level === "abweichend") return;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const I = schema.eventItems;
  const E = schema.events;
  const items = await db
    .select({ id: I.id })
    .from(I)
    .innerJoin(E, eq(E.id, I.eventId))
    .where(and(eq(I.productId, productId), sql`${I.price} is null`, sql`${E.eventDate} >= ${today}`));
  if (items.length === 0) return;
  await db.update(I).set({ price: c.suggestedPrice, priceSource: "ki", priceConfirmed: false }).where(inArray(I.id, items.map((i) => i.id)));
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

/**
 * Nach einem Neustart hängengebliebene Recherchen als Fehler markieren: älter als 15 Minuten, und in den letzten
 * 5 Minuten ist keine einzige Recherche fertig geworden (sonst arbeitet die Warteschlange noch – große Aufträge
 * im Modus „genau“ dauern länger als 15 Minuten).
 */
export async function failStaleChecks() {
  await db
    .update(C)
    .set({ status: "error", error: "Abgebrochen (Server neu gestartet?) – bitte erneut starten.", finishedAt: new Date() })
    .where(
      and(
        inArray(C.status, ["pending", "running"]),
        lt(C.createdAt, sql`now() - interval '15 minutes'`),
        sql`not exists (select 1 from price_checks x where x.finished_at > now() - interval '5 minutes')`,
      ),
    );
}
