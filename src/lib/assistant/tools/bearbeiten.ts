import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { defineTool } from "../types";
import { abs, json, uuid } from "./common";
import { markiereEingereicht } from "@/lib/claims/eingereicht";

// Ändernde Werkzeuge für Posteingang und Ansprüche. Wie alle ändernden Werkzeuge: im Fragefeld erst als Vorschlag
// (Ausführen/Ablehnen), im Claude-Konnektor nur mit Freigabe „ändern“; alles steht im Protokoll.

export const posteingangArchivieren = defineTool({
  name: "posteingang_archivieren",
  title: "Mails archivieren",
  description: "Archiviert Mails im Posteingang (sie verschwinden aus der offenen Liste, bleiben aber gespeichert und auffindbar). ids aus „posteingang“. Für „Das ist erledigt, weg damit“.",
  area: "posteingang",
  write: true,
  input: z.object({ ids: z.array(uuid).min(1).max(50) }),
  summary: (i) => `${i.ids.length} Mail${i.ids.length === 1 ? "" : "s"} archivieren`,
  run: async (ctx, i) => {
    const M = schema.emails;
    const done = await db.update(M).set({ archived: true }).where(and(eq(M.tenantId, ctx.session.tenantId), inArray(M.id, i.ids), eq(M.archived, false))).returning({ id: M.id });
    const ids = done.map((d) => d.id);
    return { text: JSON.stringify({ ok: true, archiviert: done.length, nicht_gefunden_oder_schon_archiviert: i.ids.length - done.length || undefined, link: abs(ctx, "/posteingang") }), ids, undo: { ids } };
  },
  vorschau: async (ctx, i) => {
    const M = schema.emails;
    const rows = await db.select({ subject: M.subject, archived: M.archived }).from(M).where(and(eq(M.tenantId, ctx.session.tenantId), inArray(M.id, i.ids)));
    const offen = rows.filter((r) => !r.archived);
    return { anzahl: offen.length, beispiele: offen.slice(0, 5).map((r) => r.subject ?? "(ohne Betreff)"), ausgeschlossen: rows.length - offen.length ? { anzahl: rows.length - offen.length, grund: "schon archiviert", beispiele: [] } : undefined };
  },
  undo: async (ctx, d) => {
    const M = schema.emails;
    const ids = (d as { ids?: string[] }).ids ?? [];
    if (ids.length) await db.update(M).set({ archived: false }).where(and(eq(M.tenantId, ctx.session.tenantId), inArray(M.id, ids)));
    return `${ids.length} Mails zurück im Posteingang.`;
  },
});

export const posteingangEntwurf = defineTool({
  name: "posteingang_entwurf",
  title: "Antwort-Entwurf",
  description:
    "Legt zu einer Mail einen Antwort-Entwurf an (Text, optional Betreff und Empfänger; sonst „Re: …“ an den Absender). Der Entwurf erscheint an der Mail im Seller-System – gesendet wird erst, wenn du ihn dort prüfst und auf „Senden“ tippst, nie automatisch. Vorher mit „mail“ den ganzen Text lesen. Keine Inhalte aus dem Wissen mit „insider“ (z. B. aus den Wochen-Calls) verwenden – die bleiben intern.",
  area: "posteingang",
  write: true,
  input: z.object({
    id: uuid.describe("Mail aus „posteingang“ bzw. „mail“"),
    text: z.string().trim().min(1).max(20_000),
    betreff: z.string().trim().min(1).max(300).optional(),
    an: z.string().trim().email().max(200).optional().describe("Nur wenn nicht an den Absender"),
  }),
  summary: (i) => `Antwort-Entwurf${i.an ? ` an ${i.an}` : ""}: „${i.text.slice(0, 80)}${i.text.length > 80 ? " …" : ""}“`,
  run: async (ctx, i) => {
    const M = schema.emails;
    const [m] = await db.select({ id: M.id, from: M.fromAddress, subject: M.subject }).from(M).where(and(eq(M.tenantId, ctx.session.tenantId), eq(M.id, i.id)));
    if (!m) return { text: "Mail nicht gefunden.", isError: true };
    const to = i.an ?? m.from;
    if (!to) return { text: "Die Mail hat keinen Absender – bitte „an“ angeben.", isError: true };
    const subject = i.betreff ?? (/^(re|aw|antw):/i.test(m.subject ?? "") ? (m.subject ?? "") : `Re: ${m.subject ?? ""}`.trim());
    const [d] = await db
      .insert(schema.emailDrafts)
      .values({ tenantId: ctx.session.tenantId, emailId: m.id, to, subject, body: i.text, via: ctx.channel === "claude" ? "claude" : "app", createdBy: ctx.session.userId })
      .returning({ id: schema.emailDrafts.id });
    return json({ ok: true, entwurf_id: d.id, an: to, betreff: subject, meldung: "Entwurf gespeichert – nicht gesendet. Zum Senden im Seller-System an der Mail prüfen und „Senden“ tippen.", link: abs(ctx, `/posteingang/${m.id}#entwurf`) });
  },
});

export const anspruchEingereicht = defineTool({
  name: "anspruch_eingereicht",
  title: "Anspruch als eingereicht markieren",
  description: "Markiert einen Erstattungsanspruch als bei Amazon eingereicht (optional mit Fallnummer und Notiz), damit Status und Frist-Überwachung stimmen. id aus „ansprueche“. Nur nachdem der Fall wirklich in Seller Central eingereicht wurde.",
  area: "amazon",
  write: true,
  input: z.object({ id: uuid, fallnummer: z.string().trim().min(3).max(40).optional().describe("Amazon-Fallnummer (Case-ID)"), notiz: z.string().trim().max(500).optional() }),
  summary: (i) => `Anspruch als eingereicht markieren${i.fallnummer ? ` (Fall ${i.fallnummer})` : ""}`,
  run: async (ctx, i) => {
    const r = await markiereEingereicht(ctx.session.tenantId, i.id, { fallnummer: i.fallnummer, notiz: i.notiz, userId: ctx.session.userId, via: ctx.channel === "claude" ? "Claude" : "den Assistenten" });
    if (!r.ok) return { text: r.fehler, isError: true };
    return json({ ok: true, anspruch: r.titel, status: "eingereicht", fallnummer: r.fallnummer ?? undefined, meldung: r.schonEingereicht ? "War schon eingereicht – Fallnummer/Notiz ergänzt." : "Als eingereicht markiert.", link: abs(ctx, `/ansprueche/${i.id}`) });
  },
});

export const BEARBEITEN = [posteingangArchivieren, posteingangEntwurf, anspruchEingereicht];
