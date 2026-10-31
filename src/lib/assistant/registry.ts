import "server-only";
import { z } from "zod";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { toolAllowed } from "./permissions";
import { inputSchema } from "./schema";
import type { Stufe, ToolCtx, ToolDef, ToolOut } from "./types";
import { ALLGEMEIN } from "./tools/allgemein";
import { BESTAND } from "./tools/bestand";
import { BUERO } from "./tools/buero";
import { KEEPA } from "./tools/keepa";
import { GESCHAEFT } from "./tools/geschaeft";
import { BEARBEITEN } from "./tools/bearbeiten";
import { AMAZON_MARKT } from "./tools/amazon-markt";
import { RETOUREN_STATION } from "./tools/retouren-station";
import { B2B } from "./tools/b2b";
import { FINANZEN } from "./tools/finanzen";
import { ECHTHEIT } from "./tools/echtheit";
import { AMAZON_BUSINESS } from "./tools/amazon-business";
import { CALLS } from "./tools/calls";
import { PALETTEN } from "./tools/paletten";
import { PRIVAT } from "./tools/privat";
import { WAWI } from "./tools/wawi";
import { HERZSTUECK } from "./tools/herzstueck";
import { BQOOL } from "./tools/bqool";
import { VA } from "./tools/va";
import { DEAL_EINGANG } from "./tools/deal-eingang";
import { AMAZON_FAELLE } from "./tools/amazon-faelle";
import { AKTIONEN } from "./tools/aktionen";
import { MOBIL } from "./tools/mobil";
import { RECHT } from "./tools/recht";
import { berlinDateTime } from "./tools/common";
import { jobStand } from "@/lib/today/jobs";
import { withStand, type Datenstand } from "./stand";
export { withStand };

// Alle Werkzeuge an einer Stelle: wer darf was (Bereich, Inhaber, Privat, Ändern), Eingabe prüfen,
// ausführen und protokollieren. Claude-Konnektor und Fragefeld rufen nur hierüber auf.

export const ALL_TOOLS: ToolDef[] = [...ALLGEMEIN, ...WAWI, ...BESTAND, ...GESCHAEFT, ...BEARBEITEN, ...AMAZON_MARKT, ...RETOUREN_STATION, ...B2B, ...FINANZEN, ...ECHTHEIT, ...AMAZON_BUSINESS, ...CALLS, ...KEEPA, ...PALETTEN, ...BUERO, ...PRIVAT, ...HERZSTUECK, ...BQOOL, ...VA, ...DEAL_EINGANG, ...AMAZON_FAELLE, ...AKTIONEN, ...MOBIL, ...RECHT];

/** Antworten nicht beliebig groß werden lassen (Kosten, Kontext). */
const MAX_TEXT = 60_000;

export { toolAllowed };

/** Stufe eines ändernden Werkzeugs: Einstellung, sonst Standard des Werkzeugs (fest oder je Eingabe), sonst grün. */
export function stufeVon(tool: ToolDef, input: unknown, stufen?: Record<string, Stufe>): Stufe {
  const fest = stufen?.[tool.name];
  if (fest) return fest;
  if (typeof tool.stufe === "function") {
    try {
      return tool.stufe(input as never);
    } catch {
      return "gelb";
    }
  }
  return tool.stufe ?? "gruen";
}

/** Rot im Fragefeld: Werkzeug, das der Assistent im Seller-System nie ausführt (Preise, Zahlungen, Löschen …). */
const rotImFragefeld = (ctx: Pick<ToolCtx, "channel" | "stufen">, t: ToolDef) => ctx.channel === "app" && t.write && (ctx.stufen?.[t.name] ?? (typeof t.stufe === "string" ? t.stufe : null)) === "rot";

export const toolsFor = (ctx: Pick<ToolCtx, "session" | "canWrite" | "privat"> & Partial<Pick<ToolCtx, "channel" | "stufen">>) => ALL_TOOLS.filter((t) => toolAllowed(ctx, t) && !rotImFragefeld({ channel: ctx.channel ?? "claude", stufen: ctx.stufen }, t));
export const toolByName = (name: string) => ALL_TOOLS.find((t) => t.name === name) ?? null;

export const ROT_TEXT = (t: ToolDef, baseUrl = "") =>
  `„${t.title}“ macht der Assistent im Seller-System nicht (Preise, Repricer-Uploads, Zahlungen, Löschen, Marktplatz-Angebote und Privatbereiche anderer nur von Hand)${t.seite ? ` – bitte selbst auf der Seite: ${baseUrl}${t.seite}` : ""}.`;

export { inputSchema };

export type ParsedCall = { ok: true; tool: ToolDef; input: unknown } | { ok: false; error: string; denied?: boolean };

/** Werkzeug finden, Freigabe und Eingabe prüfen – ohne auszuführen (für Bestätigungen). */
export function prepareCall(ctx: Pick<ToolCtx, "session" | "canWrite" | "privat"> & Partial<Pick<ToolCtx, "channel" | "stufen" | "baseUrl">>, name: string, raw: unknown): ParsedCall {
  const tool = toolByName(name);
  if (!tool || !toolAllowed(ctx, tool)) return { ok: false, denied: true, error: `Werkzeug „${name}“ ist für dieses Konto nicht freigegeben.` };
  if (rotImFragefeld({ channel: ctx.channel ?? "claude", stufen: ctx.stufen }, tool)) return { ok: false, denied: true, error: ROT_TEXT(tool, ctx.baseUrl ?? "") };
  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: `Eingabe ungültig: ${z.prettifyError(parsed.error)}` };
  // Rot im Fragefeld (auch je nach Eingabe bzw. per Einstellung): nie ausführen, nur auf die Seite verweisen.
  if (ctx.channel === "app" && tool.write && stufeVon(tool, parsed.data, ctx.stufen) === "rot") return { ok: false, denied: true, error: ROT_TEXT(tool, ctx.baseUrl ?? "") };
  return { ok: true, tool, input: parsed.data };
}

export async function runTool(ctx: ToolCtx, name: string, raw: unknown, meta: { auftrag?: string | null } = {}): Promise<ToolOut> {
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
  await logUse(ctx, tool, input, out, meta.auftrag ?? null).catch((e) => console.error("[Assistent] Protokoll:", e));
  // IDs und Rückgängig-Daten nur ins Protokoll, nicht an Claude.
  return { text: out.text, ...(out.isError ? { isError: true } : {}) };
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

async function logUse(ctx: ToolCtx, tool: ToolDef, input: unknown, out: ToolOut, auftrag: string | null) {
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
    ...(tool.write
      ? {
          // Privat: keine Inhalte im Protokoll (Auftragstext nur bei geschäftlichen Änderungen).
          auftrag: tool.privat ? null : auftrag?.slice(0, 2000) ?? null,
          ids: (out.ids ?? []).slice(0, 500),
          stufe: stufeVon(tool, input, ctx.stufen),
          undo: !out.isError && tool.undo && out.undo !== undefined ? out.undo : null,
        }
      : {}),
  });
}

export const RUECKGAENGIG_TAGE = 7;

/**
 * Änderung des Assistenten rückgängig machen (grüne Aktionen mit Rückgängig-Daten, höchstens 7 Tage, einmal).
 * Eigene Einträge – der Inhaber auch die der anderen.
 */
export async function rueckgaengig(ctx: ToolCtx, logId: string): Promise<{ ok: boolean; meldung: string }> {
  const L = schema.assistantLog;
  const seit = new Date(Date.now() - RUECKGAENGIG_TAGE * 86_400_000);
  const [row] = await db.select().from(L).where(and(eq(L.tenantId, ctx.session.tenantId), eq(L.id, logId), eq(L.write, true), eq(L.ok, true), isNull(L.rueckgaengigAm), gte(L.createdAt, seit)));
  if (!row) return { ok: false, meldung: "Nicht (mehr) rückgängig zu machen – älter als 7 Tage, schon zurückgenommen oder nicht gefunden." };
  if (ctx.session.role !== "owner" && row.userId !== ctx.session.userId) return { ok: false, meldung: "Nur eigene Änderungen." };
  const tool = toolByName(row.tool);
  if (!tool?.undo || row.undo === null || row.undo === undefined) return { ok: false, meldung: "Für diese Änderung gibt es kein Rückgängig." };
  if (row.stufe && row.stufe !== "gruen") return { ok: false, meldung: "Nur einfache (grüne) Änderungen lassen sich mit einem Klick zurücknehmen." };
  // Privat: nur die Person selbst (auch der Inhaber nicht für andere) und nur mit vollem Privat-Zugang.
  if (tool.privat && (row.userId !== ctx.session.userId || !ctx.session.privateAccess || ctx.session.privateScope !== "voll")) return { ok: false, meldung: "Private Änderungen kann nur die Person zurücknehmen, die sie gemacht hat." };
  let text: string;
  try {
    text = await tool.undo(ctx, row.undo);
  } catch (e) {
    // Abgelehnt (z. B. Eintrag inzwischen anders vorhanden): nicht als zurückgenommen markieren.
    return { ok: false, meldung: e instanceof Error ? e.message : "Nicht zurückgenommen." };
  }
  await db.update(L).set({ rueckgaengigAm: new Date() }).where(eq(L.id, row.id));
  await db.insert(L).values({ tenantId: ctx.session.tenantId, userId: ctx.session.userId, channel: ctx.channel, tool: row.tool, write: true, ok: true, summary: `Rückgängig: ${row.summary ?? tool.title}`, ids: row.ids });
  return { ok: true, meldung: text };
}
