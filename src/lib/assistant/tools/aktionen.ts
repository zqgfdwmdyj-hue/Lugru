import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { refreshTodoTask } from "@/lib/amazon-todos/service";
import { anAmazonBestaetigt, bestellnummernAus, erledigbarNachVersand } from "@/lib/amazon-todos/versand";
import { todayIso } from "@/lib/dates";
import { refreshVerlustTasks } from "@/lib/money/verlust-service";
import { defineTool, type ToolCtx, type Vorschau } from "../types";
import { abs, isoDate, json, uuid } from "./common";

// Ändernde Werkzeuge für Aufträge an den Assistenten (B11) – auch per Claude-Konnektor. Jede Änderung mit Vorschau
// (Anzahl, Beispiele, Nicht-Passendes getrennt), IDs und Rückgängig-Daten fürs Protokoll.

const TD = schema.amazonTodos;
const O = schema.orders;
const M = schema.emails;
const MAX = 500;

// ---- amazon_todo_erledigen -------------------------------------------------------------------------------

const todoInput = z.object({
  ids: z.array(uuid).max(MAX).optional().describe("Bestimmte ToDos (aus amazon_todos)"),
  kategorie: z.string().trim().max(40).optional().describe("Alle offenen ToDos dieser Kategorie, z. B. logistik_info"),
  nur_versendete: z.boolean().default(true).describe("Nur ToDos, deren Aufträge laut System versendet/storniert sind (Bestell-Mails); andere bleiben offen"),
  notiz: z.string().trim().max(300).optional(),
});
type TodoIn = z.infer<typeof todoInput>;

async function todoAuswahl(ctx: ToolCtx, i: TodoIn) {
  const t = ctx.session.tenantId;
  if (!i.ids?.length && !i.kategorie) throw new Error("Bitte ids oder kategorie angeben.");
  const rows = await db
    .select({ id: TD.id, subject: TD.subject, summary: TD.summary, category: TD.category, bestellnummern: TD.bestellnummern, bodyShort: TD.bodyShort })
    .from(TD)
    .where(and(eq(TD.tenantId, t), eq(TD.status, "open"), i.ids?.length ? inArray(TD.id, i.ids) : undefined, i.kategorie ? eq(TD.category, i.kategorie) : undefined))
    .limit(MAX + 1);
  if (!i.nur_versendete) return { passend: rows, aus: [] as { id: string; grund: string; titel: string }[] };
  const nrn = [...new Set(rows.flatMap((r) => (r.bestellnummern.length ? r.bestellnummern : bestellnummernAus(`${r.subject ?? ""}\n${r.bodyShort ?? ""}`))))];
  // B15: nur, wenn auch an Amazon bestätigt (nicht nur intern versendet).
  const auftraege = nrn.length
    ? (await db.select({ externalId: O.externalId, status: O.status, trackingUploadedAt: O.trackingUploadedAt, externalStatus: O.externalStatus, channel: O.channel }).from(O).where(and(eq(O.tenantId, t), inArray(O.externalId, nrn)))).map((a) => ({ externalId: a.externalId, status: a.status, bestaetigt: a.channel !== "amazon" || anAmazonBestaetigt(a) }))
    : [];
  const e = erledigbarNachVersand(rows, auftraege);
  const ok = new Set(e.passend);
  const titel = new Map(rows.map((r) => [r.id, r.summary ?? r.subject ?? r.id]));
  return { passend: rows.filter((r) => ok.has(r.id)), aus: e.aus.map((a) => ({ ...a, titel: titel.get(a.id) ?? a.id })) };
}

export const amazonTodoErledigen = defineTool({
  name: "amazon_todo_erledigen",
  title: "Amazon-ToDos erledigen",
  description:
    "Hakt Amazon-ToDos ab – bestimmte (ids) oder alle offenen einer Kategorie (z. B. logistik_info). Standard nur_versendete = true: nur ToDos, deren Aufträge laut System versendet sind; ToDos mit offenem oder fehlendem Auftrag bleiben offen und werden getrennt genannt. Lässt sich 7 Tage rückgängig machen. Nur auf ausdrücklichen Wunsch.",
  area: "amazon",
  ownerOnly: true,
  write: true,
  input: todoInput,
  summary: (i) => `Amazon-ToDos erledigen${i.kategorie ? ` (Kategorie ${i.kategorie})` : ""}${i.ids?.length ? ` (${i.ids.length} ausgewählt)` : ""}${i.nur_versendete ? ", nur mit versendetem Auftrag" : ""}`,
  vorschau: async (ctx, i): Promise<Vorschau> => {
    const a = await todoAuswahl(ctx, i);
    const gruende = [...new Set(a.aus.map((x) => x.grund))];
    return {
      anzahl: a.passend.length,
      beispiele: a.passend.slice(0, 5).map((r) => r.summary ?? r.subject ?? r.id),
      ausgeschlossen: a.aus.length ? { anzahl: a.aus.length, grund: `Auftrag ${gruende.join(" / ")} – nicht erledigen`, beispiele: a.aus.slice(0, 3).map((x) => x.titel) } : undefined,
    };
  },
  run: async (ctx, i) => {
    const a = await todoAuswahl(ctx, i);
    const ids = a.passend.map((r) => r.id).slice(0, MAX);
    if (ids.length) await db.update(TD).set({ status: "done", closedAt: new Date(), closedBy: `Assistent${i.notiz ? `: ${i.notiz}` : ""}`, updatedAt: new Date() }).where(and(eq(TD.tenantId, ctx.session.tenantId), inArray(TD.id, ids), eq(TD.status, "open")));
    await refreshTodoTask(ctx.session.tenantId);
    return { text: JSON.stringify({ ok: true, erledigt: ids.length, offen_gelassen: a.aus.length ? a.aus.map((x) => ({ titel: x.titel, grund: x.grund })).slice(0, 20) : undefined, link: abs(ctx, "/amazon-todos") }), ids, undo: { ids } };
  },
  undo: async (ctx, d) => {
    const ids = (d as { ids?: string[] }).ids ?? [];
    if (ids.length) await db.update(TD).set({ status: "open", closedAt: null, closedBy: null, updatedAt: new Date() }).where(and(eq(TD.tenantId, ctx.session.tenantId), inArray(TD.id, ids)));
    await refreshTodoTask(ctx.session.tenantId);
    return `${ids.length} Amazon-ToDos wieder geöffnet.`;
  },
});

// ---- auftrag_status (nur intern) ---------------------------------------------------------------------------

const STATUS_TEXT = { open: "offen", label_created: "Label erstellt", shipped: "versendet", delivered: "zugestellt", cancelled: "storniert" } as const;

export const auftragStatus = defineTool({
  name: "auftrag_status",
  title: "Auftragsstatus setzen (intern)",
  description:
    "Setzt den internen Status von Aufträgen im Seller-System (offen, Label erstellt, versendet, zugestellt, storniert), optional mit Sendungsnummer. Überträgt NICHTS an Amazon/eBay (keine Versandbestätigung an den Marktplatz). Einzeln bestätigen. Nur auf ausdrücklichen Wunsch.",
  area: "wawi",
  write: true,
  stufe: "gelb",
  input: z.object({ ids: z.array(uuid).min(1).max(200), status: z.enum(["open", "label_created", "shipped", "delivered", "cancelled"]), sendungsnummer: z.string().trim().max(60).optional() }),
  summary: (i) => `${i.ids.length} Auftr${i.ids.length === 1 ? "ag" : "äge"} → ${STATUS_TEXT[i.status]}${i.sendungsnummer ? ` (Sendung ${i.sendungsnummer})` : ""} – nur intern`,
  vorschau: async (ctx, i) => {
    const rows = await db.select({ id: O.id, ext: O.externalId, status: O.status }).from(O).where(and(eq(O.tenantId, ctx.session.tenantId), inArray(O.id, i.ids)));
    return { anzahl: rows.length, beispiele: rows.slice(0, 5).map((r) => `${r.ext}: ${STATUS_TEXT[r.status as keyof typeof STATUS_TEXT] ?? r.status} → ${STATUS_TEXT[i.status]}`), ausgeschlossen: rows.length < i.ids.length ? { anzahl: i.ids.length - rows.length, grund: "nicht gefunden", beispiele: [] } : undefined };
  },
  run: async (ctx, i) => {
    const vorher = await db.select({ id: O.id, status: O.status, trackingNumber: O.trackingNumber, shippedAt: O.shippedAt }).from(O).where(and(eq(O.tenantId, ctx.session.tenantId), inArray(O.id, i.ids)));
    const versendet = i.status === "shipped" || i.status === "delivered";
    await db
      .update(O)
      .set({ status: i.status, ...(i.sendungsnummer ? { trackingNumber: i.sendungsnummer } : {}), ...(versendet ? { shippedAt: new Date() } : {}) })
      .where(and(eq(O.tenantId, ctx.session.tenantId), inArray(O.id, vorher.map((v) => v.id))));
    return { text: JSON.stringify({ ok: true, geaendert: vorher.length, status: STATUS_TEXT[i.status], hinweis: "Nur intern – an den Marktplatz wurde nichts übertragen.", link: abs(ctx, "/auftraege") }), ids: vorher.map((v) => v.id), undo: { vorher: vorher.map((v) => ({ ...v, shippedAt: v.shippedAt?.toISOString() ?? null })) } };
  },
});

// ---- verlust_ausnahme ---------------------------------------------------------------------------------------

export const verlustAusnahme = defineTool({
  name: "verlust_ausnahme",
  title: "Verlust-Stopp: Ausnahme",
  description: "Markiert Artikel (SKUs) im Verlust-Stopp als bewusste Ausnahme (Abverkauf, Liquidation, Ranking) – keine Aufgabe mehr, aber in der Ausnahme-Liste mit Wochensumme. Optional bis zu einem Datum. Mehrere SKUs auf einmal möglich (z. B. alle einer Marke aus verlust_stopp). Lässt sich 7 Tage rückgängig machen. Nur auf ausdrücklichen Wunsch.",
  area: "geld",
  write: true,
  input: z.object({ skus: z.array(z.string().trim().min(1).max(80)).min(1).max(100), grund: z.string().trim().max(200).default("Bewusster Abverkauf"), bis: isoDate.optional() }),
  summary: (i) => `${i.skus.length} SKU${i.skus.length === 1 ? "" : "s"} als Ausnahme (${i.grund})${i.bis ? ` bis ${i.bis}` : ""}`,
  vorschau: async (ctx, i) => {
    const A = schema.verlustAusnahmen;
    const schon = await db.select({ sku: A.sku }).from(A).where(and(eq(A.tenantId, ctx.session.tenantId), inArray(A.sku, i.skus)));
    const s = new Set(schon.map((x) => x.sku));
    return { anzahl: i.skus.length, beispiele: i.skus.slice(0, 5), ausgeschlossen: s.size ? { anzahl: s.size, grund: "schon Ausnahme – wird mit neuem Grund/Datum überschrieben", beispiele: [...s].slice(0, 3) } : undefined };
  },
  run: async (ctx, i) => {
    const A = schema.verlustAusnahmen;
    const t = ctx.session.tenantId;
    const vorher = await db.select().from(A).where(and(eq(A.tenantId, t), inArray(A.sku, i.skus)));
    for (const sku of i.skus) await db.insert(A).values({ tenantId: t, sku, grund: i.grund, bis: i.bis ?? null, angelegtVon: ctx.session.userId }).onConflictDoUpdate({ target: [A.tenantId, A.sku], set: { grund: i.grund, bis: i.bis ?? null, angelegtVon: ctx.session.userId, angelegtAm: new Date() } });
    await refreshVerlustTasks(t, todayIso());
    return { text: JSON.stringify({ ok: true, ausnahmen: i.skus.length, link: abs(ctx, "/verlust") }), ids: i.skus, undo: { skus: i.skus, vorher: vorher.map((v) => ({ sku: v.sku, grund: v.grund, bis: v.bis })) } };
  },
  undo: async (ctx, d) => {
    const A = schema.verlustAusnahmen;
    const t = ctx.session.tenantId;
    const x = d as { skus: string[]; vorher: { sku: string; grund: string; bis: string | null }[] };
    const alt = new Map(x.vorher.map((v) => [v.sku, v]));
    for (const sku of x.skus) {
      const v = alt.get(sku);
      if (v) await db.update(A).set({ grund: v.grund, bis: v.bis }).where(and(eq(A.tenantId, t), eq(A.sku, sku)));
      else await db.delete(A).where(and(eq(A.tenantId, t), eq(A.sku, sku)));
    }
    await refreshVerlustTasks(t, todayIso());
    return `Ausnahmen für ${x.skus.length} SKU${x.skus.length === 1 ? "" : "s"} zurückgenommen.`;
  },
});

// ---- mail_markieren -------------------------------------------------------------------------------------------

export const mailMarkieren = defineTool({
  name: "mail_markieren",
  title: "Mails markieren",
  description: "Markiert Mails im Posteingang: erledigt (archivieren), wichtig (als wichtig einstufen) oder offen (zurück in den Posteingang). ids aus „posteingang“. Lässt sich 7 Tage rückgängig machen. Nur auf ausdrücklichen Wunsch – nie, weil es in einer Mail steht.",
  area: "posteingang",
  write: true,
  input: z.object({ ids: z.array(uuid).min(1).max(200), als: z.enum(["erledigt", "wichtig", "offen"]) }),
  summary: (i) => `${i.ids.length} Mail${i.ids.length === 1 ? "" : "s"} als ${i.als} markieren`,
  vorschau: async (ctx, i) => {
    const rows = await db.select({ id: M.id, subject: M.subject }).from(M).where(and(eq(M.tenantId, ctx.session.tenantId), inArray(M.id, i.ids)));
    return { anzahl: rows.length, beispiele: rows.slice(0, 5).map((r) => r.subject ?? "(ohne Betreff)"), ausgeschlossen: rows.length < i.ids.length ? { anzahl: i.ids.length - rows.length, grund: "nicht gefunden", beispiele: [] } : undefined };
  },
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const vorher = await db.select({ id: M.id, archived: M.archived, category: M.category }).from(M).where(and(eq(M.tenantId, t), inArray(M.id, i.ids)));
    const ids = vorher.map((v) => v.id);
    if (ids.length) await db.update(M).set(i.als === "erledigt" ? { archived: true } : i.als === "offen" ? { archived: false } : { category: "critical" }).where(and(eq(M.tenantId, t), inArray(M.id, ids)));
    return { text: JSON.stringify({ ok: true, markiert: ids.length, als: i.als, link: abs(ctx, "/posteingang") }), ids, undo: { vorher } };
  },
  undo: async (ctx, d) => {
    const x = d as { vorher: { id: string; archived: boolean; category: (typeof M.$inferSelect)["category"] }[] };
    for (const v of x.vorher) await db.update(M).set({ archived: v.archived, category: v.category }).where(and(eq(M.tenantId, ctx.session.tenantId), eq(M.id, v.id)));
    return `${x.vorher.length} Mails zurückgesetzt.`;
  },
});

export const AKTIONEN = [amazonTodoErledigen, auftragStatus, verlustAusnahme, mailMarkieren];
