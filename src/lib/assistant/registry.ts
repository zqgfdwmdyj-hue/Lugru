import "server-only";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { toolAllowed } from "./permissions";
import { inputSchema } from "./schema";
import type { ToolCtx, ToolDef, ToolOut } from "./types";
import { ALLGEMEIN } from "./tools/allgemein";
import { BESTAND } from "./tools/bestand";
import { BUERO } from "./tools/buero";
import { KEEPA } from "./tools/keepa";
import { GESCHAEFT } from "./tools/geschaeft";
import { BEARBEITEN } from "./tools/bearbeiten";
import { AMAZON_MARKT } from "./tools/amazon-markt";
import { RETOUREN_STATION } from "./tools/retouren-station";
import { B2B } from "./tools/b2b";
import { PALETTEN } from "./tools/paletten";
import { PRIVAT } from "./tools/privat";
import { WAWI } from "./tools/wawi";
import { berlinDateTime } from "./tools/common";
import { jobStand } from "@/lib/today/jobs";
import { withStand, type Datenstand } from "./stand";
export { withStand };

// Alle Werkzeuge an einer Stelle: wer darf was (Bereich, Inhaber, Privat, Ändern), Eingabe prüfen,
// ausführen und protokollieren. Claude-Konnektor und Fragefeld rufen nur hierüber auf.

export const ALL_TOOLS: ToolDef[] = [...ALLGEMEIN, ...WAWI, ...BESTAND, ...GESCHAEFT, ...BEARBEITEN, ...AMAZON_MARKT, ...RETOUREN_STATION, ...B2B, ...KEEPA, ...PALETTEN, ...BUERO, ...PRIVAT];

/** Antworten nicht beliebig groß werden lassen (Kosten, Kontext). */
const MAX_TEXT = 60_000;

export { toolAllowed };
export const toolsFor = (ctx: Pick<ToolCtx, "session" | "canWrite" | "privat">) => ALL_TOOLS.filter((t) => toolAllowed(ctx, t));
export const toolByName = (name: string) => ALL_TOOLS.find((t) => t.name === name) ?? null;

export { inputSchema };

export type ParsedCall = { ok: true; tool: ToolDef; input: unknown } | { ok: false; error: string; denied?: boolean };

/** Werkzeug finden, Freigabe und Eingabe prüfen – ohne auszuführen (für Bestätigungen). */
export function prepareCall(ctx: Pick<ToolCtx, "session" | "canWrite" | "privat">, name: string, raw: unknown): ParsedCall {
  const tool = toolByName(name);
  if (!tool || !toolAllowed(ctx, tool)) return { ok: false, denied: true, error: `Werkzeug „${name}“ ist für dieses Konto nicht freigegeben.` };
  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: `Eingabe ungültig: ${z.prettifyError(parsed.error)}` };
  return { ok: true, tool, input: parsed.data };
}

export async function runTool(ctx: ToolCtx, name: string, raw: unknown): Promise<ToolOut> {
  const call = prepareCall(ctx, name, raw);
  if (!call.ok) {
    // Ohne Recht (auch bei direktem Aufruf am Werkzeugkasten vorbei) – abweisen und protokollieren.
    if (call.denied) await logNotRun(ctx, name, raw, "Abgewiesen (nicht freigegeben)").catch((e) => console.error("[Assistent] Protokoll:", e));
    return { text: call.error, isError: true };
  }
  const { tool, input } = call;
  let out: ToolOut;
  try {
    const r = await tool.run(ctx, input);
    out = typeof r === "string" ? { text: r } : r;
  } catch (e) {
    console.error(`[Assistent] ${tool.name}:`, e);
    out = { text: `Fehler bei „${tool.title}“: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
  // Lesende Ergebnisse immer mit Quelle und Datenstand – damit Antworten sagen können, wie aktuell die Zahlen sind.
  if (!tool.write && !out.isError) out = { ...out, text: withStand(out.text, await datenstand(ctx.session.tenantId, tool).catch(() => null)) };
  if (out.text.length > MAX_TEXT) out = { ...out, text: `${out.text.slice(0, MAX_TEXT)} … (gekürzt – bitte genauer eingrenzen)` };
  await logUse(ctx, tool, input, out).catch((e) => console.error("[Assistent] Protokoll:", e));
  return out;
}

/** Quelle und Stand der Daten eines Werkzeugs: letzter erfolgreicher Hintergrund-Abruf (job_runs) oder „aktuell“. */
export async function datenstand(tenantId: string, tool: Pick<ToolDef, "quelle">): Promise<Datenstand> {
  const q = tool.quelle ?? { text: "im Seller-System erfasst" };
  const abgerufen = berlinDateTime(new Date()) ?? "";
  if (!q.jobs?.length) return { quelle: q.text, stand: "aktuell (direkt aus dem Seller-System)", abgerufen };
  const st = await jobStand(tenantId, q.jobs);
  // Amazon-Berichte kommen oft als Datei-Upload statt über die Schnittstelle – dann zählt der letzte Import.
  if (q.importe) {
    const RI = schema.reportImports;
    const [imp] = await db.select({ at: RI.createdAt, via: RI.via }).from(RI).where(eq(RI.tenantId, tenantId)).orderBy(desc(RI.createdAt)).limit(1);
    if (imp && (!st.at || imp.at > st.at)) return { quelle: q.text, stand: `zuletzt eingelesen ${berlinDateTime(imp.at)} (${imp.via === "api" ? "Schnittstelle" : "Datei-Upload"})`, abgerufen, letzter_fehler: st.fehler ?? undefined };
  }
  return { quelle: q.text, stand: st.text === "noch kein Abruf" ? "noch kein Abruf – Anbindung prüfen (Anbindungen)" : st.text, abgerufen, letzter_fehler: st.fehler ?? undefined };
}

/**
 * Nicht ausgeführte Aufrufe protokollieren: ohne Recht („Abgewiesen …“) oder vorgeschlagene Änderung, die die Person
 * abgelehnt hat („Abgelehnt …“). Nur Werkzeugname und Kurzbeschreibung, keine Inhalte.
 */
export async function logNotRun(ctx: Pick<ToolCtx, "session" | "channel">, name: string, raw: unknown, reason: string) {
  const tool = toolByName(name);
  const parsed = tool?.input.safeParse(raw ?? {});
  const what = tool ? (tool.write && parsed?.success ? (tool.summary?.(parsed.data as never) ?? tool.title) : tool.title) : `unbekanntes Werkzeug „${name.slice(0, 60)}“`;
  await db.insert(schema.assistantLog).values({
    tenantId: ctx.session.tenantId,
    userId: ctx.session.userId,
    channel: ctx.channel,
    tool: name.slice(0, 80),
    write: tool?.write ?? false,
    ok: false,
    // Bei lesenden Werkzeugen steht der Name schon in der Zeile – nur der Grund.
    summary: tool && what === tool.title ? reason : `${reason}: ${what}`,
  });
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
