import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessageParam, BetaTool, BetaToolResultBlockParam, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { inputSchema, logNotRun, prepareCall, runTool, toolsFor } from "./registry";
import type { ToolCtx } from "./types";

// Fragefeld im Seller-System: Claude-API (offizielle Bibliothek) mit den gemeinsamen Werkzeugen.
// Lesen läuft sofort; Werkzeuge, die etwas ändern, warten auf „Ausführen“ im Fragefeld (Bestätigung).
// Gespräch und Wartendes liegen verschlüsselt in assistant_chats – der Verlauf wird nur angehängt.

const MAX_ROUNDS = 8;
const CH = schema.assistantChats;

export type ChatEvent =
  | { type: "chat"; id: string }
  | { type: "status"; text: string }
  | { type: "confirm"; calls: { title: string; summary: string }[] }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

type Pending = { toolUses: { id: string; name: string; input: unknown; write: boolean }[] };

function systemPrompt(ctx: ToolCtx) {
  const s = ctx.session;
  return [
    `Du bist der Assistent im Seller-System von ${s.tenantName} – einem Online-Handel (Amazon, eBay, Temu, eigenes Lager, Palettenlager für Kunden). Du hilfst ${s.name || s.email}.`,
    "Antworte auf Deutsch, kurz und konkret, gut lesbar am Handy: kurze Absätze oder Listen, keine Tabellen. Zahlen und Daten nur aus den Werkzeugen – nichts erfinden; wenn etwas fehlt, sag es.",
    "Hol dir die Daten mit den Werkzeugen. Einstieg bei allgemeinen Fragen: „ueberblick“; wenn unklar ist, wo etwas steht: „suche“. Verlinke Einträge mit den Links aus den Werkzeugen als Markdown-Link.",
    "Bei Zahlen immer Zeitraum und Datenstand nennen (Feld „datenstand“: Quelle und letzter Abruf; bei „letzter_fehler“ darauf hinweisen). Nur Funktionen beschreiben, die die Werkzeuge wirklich liefern – nichts dazuerfinden.",
    ctx.canWrite
      ? "Ändernde Werkzeuge nur nutzen, wenn die Person das ausdrücklich möchte. Die Person bestätigt jede Änderung selbst im Fragefeld; wurde sie abgelehnt, nicht erneut versuchen, sondern nachfragen."
      : "Diese Person darf über das Fragefeld nichts ändern – nur lesen. Bei Änderungswünschen sagen, wo das im Seller-System geht.",
    "Begriffe: „Prep Center“ = Versanddienstleister, der FBM-Aufträge für uns verschickt. Fragen dazu immer zuerst mit „prep_center“ beantworten (Monat, Sendungen, Stück, Kosten je Monat, wie „verschickt von“ festgelegt wird) – nicht aus Auftragslisten oder Fristen ableiten; einzelne Aufträge über „auftraege“ mit verschickt_von. „Palettenlager“ = Lager für Paletten von Kunden mit Anlieferungen/Speditions-Sendungen (Werkzeuge „paletten“, „sendungen“) – nicht verwechseln. „Sendungen“ ohne Zusatz: nachfragen oder beides prüfen.",
    "Zum Privatbereich hast du hier keinen Zugriff.",
    "Das heutige Datum steht in der <kontext>-Notiz der jeweils neuesten Nachricht (Europe/Berlin).",
  ].join("\n");
}

// Der Grundtext (system) und die frühere Unterhaltung dürfen sich zwischen zwei Anfragen eines Chats nicht ändern –
// sonst passen Claudes gespeicherte Denk-Schritte nicht mehr. Darum steht das Datum nicht im Grundtext, sondern
// als kleine Notiz an jeder neuen Nachricht (wird im Verlauf nicht angezeigt).
const KONTEXT = "<kontext>";
const contextNote = (ctx: ToolCtx) => ({ type: "text" as const, text: `${KONTEXT}Heute ist ${ctx.today} (Europe/Berlin).</kontext>` });

const STATUS: Record<string, string> = {
  ueberblick: "Schaue, was heute ansteht …",
  suche: "Suche …",
  aufgaben: "Lese Aufgaben …",
  kalender: "Lese den Kalender …",
  auftraege: "Lese Aufträge …",
  auftrag: "Lese den Auftrag …",
  prep_center: "Lese den Versand über das Prep Center …",
  produkte: "Prüfe Bestand …",
  umsatz: "Lese Umsatzzahlen …",
  paletten: "Lese das Palettenlager …",
  sendungen: "Lese Paletten-Sendungen …",
  sendung: "Lese die Sendung …",
  rechnungen_offen: "Lese Rechnungen …",
  ansprueche: "Lese Ansprüche …",
  amazon_todos: "Lese Amazon-ToDos …",
  posteingang: "Lese den Posteingang …",
  wissen: "Durchsuche das Wissen …",
};

export async function assistantAvailable(tenantId: string) {
  const [s, key] = await Promise.all([getSettings(tenantId), getIntegration(tenantId, "anthropic")]);
  return { enabled: s.assistant.enabled, hasKey: Boolean(key?.apiKey), apiKey: key?.apiKey ?? null, model: s.assistant.model, allowWrite: s.assistant.allowWrite };
}

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Der KI-Schlüssel wird abgelehnt – bitte unter Anbindungen → KI prüfen.";
  if (e instanceof Anthropic.PermissionDeniedError) return "Der KI-Schlüssel darf dieses Modell nicht nutzen.";
  if (e instanceof Anthropic.RateLimitError) return "Gerade zu viele Anfragen an die KI – bitte in einer Minute noch einmal.";
  if (e instanceof Anthropic.BadRequestError) return `Die KI hat die Anfrage abgelehnt: ${e.message.slice(0, 200)}`;
  if (e instanceof Anthropic.APIConnectionError) return "Keine Verbindung zur KI – bitte gleich noch einmal versuchen.";
  if (e instanceof Anthropic.APIError) return `KI-Fehler (${e.status ?? "?"}) – bitte noch einmal versuchen.`;
  return e instanceof Error ? e.message : String(e);
}

const textOf = (content: BetaContentBlock[]) =>
  content
    .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/**
 * Eine Runde im Fragefeld: neue Frage (`text`) oder Antwort auf eine Bestätigung (`confirm`). Liefert
 * Ereignisse für die Anzeige (Status, Rückfrage zur Bestätigung, Antworttext).
 */
export async function* chatTurn(ctx: ToolCtx, opts: { chatId?: string | null; text?: string; confirm?: boolean }): AsyncGenerator<ChatEvent> {
  const s = ctx.session;
  const avail = await assistantAvailable(s.tenantId);
  if (!avail.enabled) return yield { type: "error", message: "Das Fragefeld ist ausgeschaltet (Einstellungen → Claude & KI-Assistent)." };
  if (!avail.apiKey) return yield { type: "error", message: "Für das Fragefeld fehlt der KI-Schlüssel (Anbindungen → KI)." };

  // Gespräch laden oder anlegen (nur eigene).
  let chat = opts.chatId
    ? (await db.select().from(CH).where(and(eq(CH.tenantId, s.tenantId), eq(CH.userId, s.userId), eq(CH.id, opts.chatId))))[0]
    : undefined;
  if (opts.chatId && !chat) return yield { type: "error", message: "Gespräch nicht gefunden." };
  const messages = (chat?.messages ?? []) as BetaMessageParam[];
  let pending = (chat?.pending ?? null) as Pending | null;
  let inTok = chat?.inputTokens ?? 0;
  let outTok = chat?.outputTokens ?? 0;

  // Offene Bestätigung beantworten (oder durch eine neue Frage verwerfen).
  if (pending) {
    const results: BetaToolResultBlockParam[] = [];
    for (const u of pending.toolUses) {
      if (u.write && opts.confirm !== true) {
        await logNotRun(ctx, u.name, u.input, opts.text ? "Nicht ausgeführt (neue Nachricht statt Bestätigung)" : "Abgelehnt (Vorschlag nicht bestätigt)").catch((e) => console.error("[Assistent] Protokoll:", e));
        results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: opts.text ? "Nicht ausgeführt – die Person hat stattdessen eine neue Nachricht geschrieben." : "Nicht ausgeführt – die Person hat die Änderung abgelehnt." });
        continue;
      }
      if (u.write) yield { type: "status", text: "Führe die Änderung aus …" };
      const out = await runTool(ctx, u.name, u.input);
      results.push({ type: "tool_result", tool_use_id: u.id, content: out.text, ...(out.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: opts.text ? [...results, contextNote(ctx), { type: "text", text: opts.text }] : results });
    pending = null;
  } else if (opts.text) {
    messages.push({ role: "user", content: [contextNote(ctx), { type: "text", text: opts.text }] });
  } else {
    return yield { type: "error", message: "Bitte eine Frage eingeben." };
  }

  if (!chat) {
    [chat] = await db.insert(CH).values({ tenantId: s.tenantId, userId: s.userId, title: (opts.text ?? "").slice(0, 120), messages, pending: null }).returning();
    yield { type: "chat", id: chat.id };
  }
  const save = async () => {
    await db.update(CH).set({ messages, pending, inputTokens: inTok, outputTokens: outTok, updatedAt: new Date() }).where(eq(CH.id, chat!.id));
  };
  await save();

  const tools = toolsFor(ctx);
  const apiTools: BetaTool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: inputSchema(t) as BetaTool["input_schema"] }));
  const client = new Anthropic({ apiKey: avail.apiKey, timeout: 120_000, maxRetries: 2 });
  // Rückfall bei Ablehnung durch die Sicherheitsfilter: Opus/Sonnet über die API (Haiku hat keinen).
  const fallback = /^claude-(opus|sonnet)-/.test(avail.model);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let res;
    try {
      res = await client.beta.messages.create({
        model: avail.model,
        max_tokens: 16000,
        system: systemPrompt(ctx),
        tools: apiTools,
        messages,
        output_config: { effort: "medium" },
        // Passt ein gespeicherter Denk-Schritt nicht mehr zur Unterhaltung (z. B. nach einem Update mit geändertem
        // Grundtext oder neuen Werkzeugen), wird nur dieser verworfen – statt die ganze Anfrage abzulehnen.
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        cache_control: { type: "ephemeral" },
        betas: ["thinking-binding-controls-2026-08-01", ...(fallback ? ["server-side-fallback-2026-07-01"] : [])],
        ...(fallback ? { fallbacks: "default" as const } : {}),
      });
    } catch (e) {
      await save();
      return yield { type: "error", message: friendlyError(e) };
    }
    inTok += res.usage.input_tokens ?? 0;
    outTok += res.usage.output_tokens ?? 0;
    if (res.stop_reason === "refusal") {
      await save();
      return yield { type: "error", message: "Diese Anfrage kann der Assistent nicht beantworten. Bitte anders formulieren." };
    }
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") {
      await save();
      continue;
    }
    const uses = res.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      await save();
      if (res.stop_reason === "max_tokens") return yield { type: "error", message: "Die Antwort wurde zu lang – bitte die Frage eingrenzen." };
      yield { type: "text", text: textOf(res.content) || "(keine Antwort)" };
      return yield { type: "done" };
    }
    if (res.stop_reason === "max_tokens") {
      // Abgeschnittene Werkzeug-Eingabe nie ausführen.
      messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result" as const, tool_use_id: u.id, is_error: true, content: "Eingabe abgeschnitten – bitte kürzer." })) });
      await save();
      continue;
    }
    const prepared = uses.map((u) => ({ use: u, call: prepareCall(ctx, u.name, u.input) }));
    const writes = prepared.filter((p) => p.call.ok && p.call.tool.write);
    if (writes.length) {
      pending = { toolUses: prepared.map((p) => ({ id: p.use.id, name: p.use.name, input: p.use.input, write: p.call.ok && p.call.tool.write })) };
      await save();
      const said = textOf(res.content);
      if (said) yield { type: "text", text: said };
      yield {
        type: "confirm",
        calls: writes.map((p) => (p.call.ok ? { title: p.call.tool.title, summary: p.call.tool.summary?.(p.call.input as never) ?? "" } : { title: p.use.name, summary: "" })),
      };
      return yield { type: "done" };
    }
    // Nur lesen: gleich ausführen (alle Ergebnisse in einer Nachricht).
    const results: BetaToolResultBlockParam[] = [];
    for (const p of prepared) {
      yield { type: "status", text: STATUS[p.use.name] ?? "Arbeite …" };
      const out = await runTool(ctx, p.use.name, p.use.input);
      results.push({ type: "tool_result", tool_use_id: p.use.id, content: out.text, ...(out.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
    await save();
  }
  await save();
  yield { type: "error", message: "Das war zu viel auf einmal – bitte die Frage aufteilen." };
}

/** Sichtbarer Verlauf eines Gesprächs (nur Fragen und Antworten, keine Werkzeugdaten). */
export function visibleTranscript(messages: BetaMessageParam[]) {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const text = typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text" && !(b as { text: string }).text.startsWith(KONTEXT)).map((b) => (b as { text: string }).text).join("\n");
      if (text.trim()) out.push({ role: "user", text });
    } else if (m.role === "assistant" && Array.isArray(m.content)) {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
      if (text) out.push({ role: "assistant", text });
    }
  }
  return out;
}
