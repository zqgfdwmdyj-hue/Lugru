import "server-only";
import { z } from "zod";
import { db, schema } from "@/db";
import { toolAllowed } from "./permissions";
import { inputSchema } from "./schema";
import type { ToolCtx, ToolDef, ToolOut } from "./types";
import { ALLGEMEIN } from "./tools/allgemein";
import { BESTAND } from "./tools/bestand";
import { BUERO } from "./tools/buero";
import { PALETTEN } from "./tools/paletten";
import { PRIVAT } from "./tools/privat";
import { WAWI } from "./tools/wawi";

// Alle Werkzeuge an einer Stelle: wer darf was (Bereich, Inhaber, Privat, Ändern), Eingabe prüfen,
// ausführen und protokollieren. Claude-Konnektor und Fragefeld rufen nur hierüber auf.

export const ALL_TOOLS: ToolDef[] = [...ALLGEMEIN, ...WAWI, ...BESTAND, ...PALETTEN, ...BUERO, ...PRIVAT];

/** Antworten nicht beliebig groß werden lassen (Kosten, Kontext). */
const MAX_TEXT = 60_000;

export { toolAllowed };
export const toolsFor = (ctx: Pick<ToolCtx, "session" | "canWrite" | "privat">) => ALL_TOOLS.filter((t) => toolAllowed(ctx, t));
export const toolByName = (name: string) => ALL_TOOLS.find((t) => t.name === name) ?? null;

export { inputSchema };

export type ParsedCall = { ok: true; tool: ToolDef; input: unknown } | { ok: false; error: string };

/** Werkzeug finden, Freigabe und Eingabe prüfen – ohne auszuführen (für Bestätigungen). */
export function prepareCall(ctx: Pick<ToolCtx, "session" | "canWrite" | "privat">, name: string, raw: unknown): ParsedCall {
  const tool = toolByName(name);
  if (!tool || !toolAllowed(ctx, tool)) return { ok: false, error: `Werkzeug „${name}“ ist für dieses Konto nicht freigegeben.` };
  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: `Eingabe ungültig: ${z.prettifyError(parsed.error)}` };
  return { ok: true, tool, input: parsed.data };
}

export async function runTool(ctx: ToolCtx, name: string, raw: unknown): Promise<ToolOut> {
  const call = prepareCall(ctx, name, raw);
  if (!call.ok) return { text: call.error, isError: true };
  const { tool, input } = call;
  let out: ToolOut;
  try {
    const r = await tool.run(ctx, input);
    out = typeof r === "string" ? { text: r } : r;
  } catch (e) {
    console.error(`[Assistent] ${tool.name}:`, e);
    out = { text: `Fehler bei „${tool.title}“: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
  if (out.text.length > MAX_TEXT) out = { ...out, text: `${out.text.slice(0, MAX_TEXT)} … (gekürzt – bitte genauer eingrenzen)` };
  await logUse(ctx, tool, input, out).catch((e) => console.error("[Assistent] Protokoll:", e));
  return out;
}

async function logUse(ctx: ToolCtx, tool: ToolDef, input: unknown, out: ToolOut) {
  // Lesende Abrufe nur mit Namen; Änderungen mit Kurzbeschreibung (Privat nur die Art, nie Inhalte).
  const summary = tool.write ? (tool.summary?.(input as never) ?? tool.title) : null;
  await db.insert(schema.assistantLog).values({
    tenantId: ctx.session.tenantId,
    userId: ctx.session.userId,
    channel: ctx.channel,
    tool: tool.name,
    write: tool.write,
    ok: !out.isError,
    summary: summary ? `${summary}${out.isError ? ` – nicht ausgeführt: ${out.text.slice(0, 200)}` : ""}` : null,
  });
}
