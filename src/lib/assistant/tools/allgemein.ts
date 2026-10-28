import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { canAccess, linkAllowed } from "@/lib/auth/areas";
import { addDaysIso } from "@/lib/dates";
import { DEFAULT_CALENDAR_NAME, syncCalendar } from "@/lib/calendar/sync";
import { collectDesired } from "@/lib/calendar/items";
import { calendarVisible, isBusinessCalendar } from "@/lib/calendar/visibility";
import { searchOrderIds } from "@/lib/orders/search";
import { unreadNotices } from "@/lib/pallets/shipment-service";
import { carrierLabel, statusLabel } from "@/lib/pallets/shipments";
import { productSearch } from "@/lib/products/service";
import { loadSalesOverview } from "@/lib/sellerboard/sales";
import { getIntegration } from "@/lib/integrations/store";
import { bindingTask, todaySignals } from "@/lib/today/service";
import { privateCalendar } from "@/lib/private/calendar-data";
import { privateSettings } from "@/lib/private/service";
import { defineTool, type ToolCtx } from "../types";
import { PRIORITY_IN, abs, berlinDateTime, isoDate, json, likeOf, round2, taskBrief, uuid, visibleTask } from "./common";

const T = schema.tasks;
const PS = schema.palletShipments;
const OPEN_SHIP = ["geplant", "unterwegs", "verzoegert", "problem"] as const;

const syncSoon = (tenantId: string) => void syncCalendar(tenantId).catch(() => {});

export const ueberblick = defineTool({
  name: "ueberblick",
  title: "Tagesüberblick",
  description:
    "Überblick für heute: was ansteht (Versand, Fristen, Ansprüche, Fälle), offene und bis heute fällige Aufgaben, Paletten-Sendungen heute/überfällig, Umsatz heute/gestern/Monat. Nimm das als Einstieg bei Fragen wie „Was steht heute an?“, „Was ist offen?“, „Wie läuft es?“.",
  area: null,
  write: false,
  quelle: { text: "Seller-System: Aufgaben, Aufträge, Paletten, Posteingang", jobs: ["Amazon-Bestellungen", "eBay-Bestellungen", "Postfächer"] },
  input: z.object({}),
  run: async (ctx) => {
    const s = ctx.session;
    const t = s.tenantId;
    const out: Record<string, unknown> = { heute: ctx.today, person: s.name || s.email };
    const signals = await todaySignals(t, ctx.today);
    out.hinweise = signals.filter((x) => linkAllowed(s, x.href)).map((x) => ({ text: x.label, detail: x.detail, anzahl: x.count, stufe: x.level, link: abs(ctx, x.href) }));
    if (canAccess(s, "start") || canAccess(s, "kalender")) {
      const open = (await db.select().from(T).where(and(eq(T.tenantId, t), eq(T.status, "open"), bindingTask)).orderBy(sql`${T.dueDate} asc nulls last`).limit(400)).filter((x) => visibleTask(s, x));
      out.aufgaben = { offen: open.length, faellig_bis_heute: open.filter((x) => x.dueDate && x.dueDate <= ctx.today).slice(0, 15).map((x) => taskBrief(x, ctx)) };
    }
    if (canAccess(s, "paletten")) {
      const due = await db
        .select()
        .from(PS)
        .where(and(eq(PS.tenantId, t), inArray(PS.status, [...OPEN_SHIP]), lte(PS.plannedDate, addDaysIso(ctx.today, 1))))
        .orderBy(asc(PS.plannedDate));
      const notices = await unreadNotices(s, undefined, 1);
      out.paletten_sendungen = {
        neue_meldungen: notices.count,
        heute_morgen_oder_ueberfaellig: due.map((x) => ({ id: x.id, richtung: x.direction === "ein" ? "Anlieferung" : "Versand", titel: x.title, termin: x.plannedDate, status: statusLabel(x.status, x.direction), spedition: carrierLabel(x.carrier, x.carrierName), link: abs(ctx, `/paletten/sendungen/${x.id}`) })),
      };
    }
    if (s.role === "owner" || canAccess(s, "geld")) {
      const so = await loadSalesOverview(t).catch(() => null);
      if (so) out.umsatz = so.tiles.map((x) => ({ zeitraum: x.label, von: x.fromDay, bis: x.toDay, umsatz_brutto: round2(x.total.sales), bestellungen: x.total.orders, einheiten: x.total.units, nettogewinn: round2(x.total.netProfit) }));
    }
    return json(out);
  },
});

export const suche = defineTool({
  name: "suche",
  title: "Suchen",
  description:
    "Sucht überall, wo die Person Zugriff hat: Produkte (SKU, EAN, ASIN, Name), Aufträge (Name, Bestellnummer, PLZ, Artikel), Paletten, Paletten-Sendungen (Titel, Sendungsnummer, Kunde), Aufgaben und Wissen. Nimm das, wenn unklar ist, wo etwas steht, oder bei einem Namen/einer Nummer.",
  area: null,
  write: false,
  quelle: { text: "Seller-System (Suche über alle Bereiche)" },
  input: z.object({ text: z.string().trim().min(2).max(100).describe("Suchbegriff: Name, Bestellnummer, SKU, EAN, Palettennummer, Sendungsnummer …") }),
  run: async (ctx, { text }) => {
    const s = ctx.session;
    const t = s.tenantId;
    const like = likeOf(text);
    const out: Record<string, unknown> = {};
    if (canAccess(s, "wawi")) {
      const p = await productSearch(t, text, 8);
      out.produkte = p.rows.map((r) => ({ titel: r.title, skus: r.skus, asin: r.asin, ean: r.ean, link: abs(ctx, r.href) }));
      const ids = await searchOrderIds(t, text, 10);
      if (ids.length) {
        const O = schema.orders;
        const rows = await db.select().from(O).where(and(eq(O.tenantId, t), inArray(O.id, ids)));
        out.auftraege = rows.map((o) => ({ id: o.id, kanal: o.channel, nummer: o.externalId, datum: berlinDateTime(o.orderDate), status: o.status, kaeufer: o.buyerName, link: abs(ctx, `/auftraege/${o.id}`) }));
      }
    }
    if (canAccess(s, "paletten")) {
      const P = schema.pallets;
      const pal = await db
        .select()
        .from(P)
        .where(and(eq(P.tenantId, t), sql`${P.cancelledAt} is null`, or(ilike(P.code, like), ilike(P.customer, like), ilike(P.contents, like), ilike(P.note, like), ilike(P.location, like))))
        .orderBy(desc(P.inAt))
        .limit(10);
      out.paletten = pal.map((p) => ({ id: p.id, nummer: p.code, kunde: p.customer, stellplatz: p.location, inhalt: p.contents, eingelagert: p.inAt, ausgelagert: p.outAt, link: abs(ctx, `/paletten/${p.id}`) }));
      const sh = await db
        .select()
        .from(PS)
        .where(and(eq(PS.tenantId, t), or(ilike(PS.title, like), ilike(PS.trackingNo, like), ilike(PS.customer, like), ilike(PS.place, like))))
        .orderBy(desc(PS.createdAt))
        .limit(10);
      out.sendungen = sh.map((x) => ({ id: x.id, titel: x.title, richtung: x.direction === "ein" ? "Anlieferung" : "Versand", status: statusLabel(x.status, x.direction), termin: x.plannedDate, sendungsnummer: x.trackingNo, link: abs(ctx, `/paletten/sendungen/${x.id}`) }));
    }
    if (canAccess(s, "start") || canAccess(s, "kalender")) {
      const rows = await db.select().from(T).where(and(eq(T.tenantId, t), or(ilike(T.title, like), ilike(T.notes, like)))).orderBy(desc(T.createdAt)).limit(30);
      out.aufgaben = rows.filter((x) => visibleTask(s, x)).slice(0, 10).map((x) => taskBrief(x, ctx));
    }
    if (canAccess(s, "wissen")) {
      const K = schema.knowledgeEntries;
      const rows = await db.select().from(K).where(and(eq(K.tenantId, t), or(ilike(K.title, like), ilike(K.body, like)))).limit(5);
      out.wissen = rows.map((k) => ({ id: k.id, titel: k.title, kategorie: k.category, auszug: k.body.slice(0, 300) }));
    }
    return json(out);
  },
});

// ---- Aufgaben ------------------------------------------------------------------------------------------

export const aufgaben = defineTool({
  name: "aufgaben",
  title: "Aufgaben ansehen",
  description: "Listet Aufgaben (offen oder erledigt), optional nach Text, Fälligkeit oder Kategorie gefiltert. Für „Welche Aufgaben habe ich?“, „Was ist diese Woche fällig?“.",
  area: ["start", "kalender"],
  write: false,
  quelle: { text: "Aufgaben im Seller-System" },
  input: z.object({
    status: z.enum(["offen", "erledigt"]).default("offen"),
    suche: z.string().trim().max(100).optional(),
    faellig_bis: isoDate.optional().describe("Nur Aufgaben, die bis zu diesem Tag fällig sind"),
    kategorie: z.enum(schema.TASK_CATEGORIES).optional(),
    auch_ideen: z.boolean().default(false).describe("Auch unverbindliche, automatisch erzeugte Ideen zeigen"),
    limit: z.number().int().min(1).max(100).default(40),
  }),
  run: async (ctx, i) => {
    const s = ctx.session;
    const where = [eq(T.tenantId, s.tenantId), eq(T.status, i.status === "erledigt" ? "done" : "open")];
    if (!i.auch_ideen) where.push(bindingTask);
    if (i.suche) where.push(or(ilike(T.title, likeOf(i.suche)), ilike(T.notes, likeOf(i.suche)))!);
    if (i.faellig_bis) where.push(and(isNotNull(T.dueDate), lte(T.dueDate, i.faellig_bis))!);
    if (i.kategorie) where.push(eq(T.category, i.kategorie));
    const rows = await db
      .select()
      .from(T)
      .where(and(...where))
      .orderBy(i.status === "erledigt" ? desc(T.completedAt) : sql`${T.dueDate} asc nulls last`)
      .limit(400);
    const vis = rows.filter((x) => visibleTask(s, x));
    return json({ anzahl: vis.length, aufgaben: vis.slice(0, i.limit).map((x) => taskBrief(x, ctx)), link: abs(ctx, "/?ansicht=liste") });
  },
});

export const aufgabeAnlegen = defineTool({
  name: "aufgabe_anlegen",
  title: "Aufgabe anlegen",
  description: "Legt eine neue Aufgabe an (erscheint auf der Startseite und – mit Fälligkeit – im Kalender).",
  area: ["start", "kalender"],
  write: true,
  input: z.object({
    titel: z.string().trim().min(1).max(300),
    notiz: z.string().trim().max(4000).optional(),
    faellig: isoDate.optional(),
    prioritaet: z.enum(["wichtig", "normal", "niedrig"]).default("normal"),
  }),
  summary: (i) => `Aufgabe „${i.titel}“${i.faellig ? ` (fällig ${i.faellig})` : ""}`,
  run: async (ctx, i) => {
    const s = ctx.session;
    // Mitarbeiter mit Kalender, aber ohne Startseite: Herkunft Kalender, damit sie die Aufgabe dort sehen.
    const link = s.role === "staff" && s.areas !== null && !canAccess(s, "start") ? "/kalender" : null;
    const [row] = await db
      .insert(T)
      .values({ tenantId: s.tenantId, title: i.titel, notes: i.notiz ?? null, dueDate: i.faellig ?? null, priority: PRIORITY_IN[i.prioritaet], category: "eigene", link, createdBy: s.userId })
      .returning();
    syncSoon(s.tenantId);
    return json({ ok: true, meldung: "Aufgabe angelegt.", aufgabe: taskBrief(row, ctx) });
  },
});

export const aufgabeAendern = defineTool({
  name: "aufgabe_aendern",
  title: "Aufgabe ändern / abhaken",
  description: "Hakt eine Aufgabe ab (erledigt: true), öffnet sie wieder (erledigt: false) oder ändert Titel, Notiz, Fälligkeit, Priorität. Die id kommt aus „aufgaben“ oder „suche“.",
  area: ["start", "kalender"],
  write: true,
  input: z.object({
    id: uuid,
    erledigt: z.boolean().optional(),
    titel: z.string().trim().min(1).max(300).optional(),
    notiz: z.string().trim().max(4000).optional(),
    faellig: isoDate.nullable().optional().describe("Neues Fälligkeitsdatum; null entfernt es"),
    prioritaet: z.enum(["wichtig", "normal", "niedrig"]).optional(),
  }),
  summary: (i) => [i.erledigt === true ? "abhaken" : i.erledigt === false ? "wieder öffnen" : null, i.titel ? `Titel „${i.titel}“` : null, i.faellig !== undefined ? `fällig ${i.faellig ?? "–"}` : null, i.prioritaet ? `Priorität ${i.prioritaet}` : null].filter(Boolean).join(", ") || "Aufgabe ändern",
  run: async (ctx, i) => {
    const s = ctx.session;
    const [task] = await db.select().from(T).where(and(eq(T.tenantId, s.tenantId), eq(T.id, i.id)));
    if (!task || !visibleTask(s, task)) return { text: "Aufgabe nicht gefunden.", isError: true };
    const patch: Partial<typeof T.$inferInsert> = {};
    if (i.erledigt !== undefined) Object.assign(patch, { status: i.erledigt ? "done" : "open", completedAt: i.erledigt ? new Date() : null });
    if (i.titel) patch.title = i.titel;
    if (i.notiz !== undefined) patch.notes = i.notiz || null;
    if (i.faellig !== undefined) patch.dueDate = i.faellig;
    if (i.prioritaet) patch.priority = PRIORITY_IN[i.prioritaet];
    if (!Object.keys(patch).length) return { text: "Nichts zu ändern angegeben.", isError: true };
    const [row] = await db.update(T).set(patch).where(and(eq(T.tenantId, s.tenantId), eq(T.id, i.id))).returning();
    syncSoon(s.tenantId);
    return json({ ok: true, meldung: "Aufgabe geändert.", aufgabe: taskBrief(row, ctx) });
  },
});

// ---- Kalender ------------------------------------------------------------------------------------------

export const kalender = defineTool({
  name: "kalender",
  title: "Kalender ansehen",
  description:
    "Termine im Zeitraum: Fristen, Versandtage, Aufgaben mit Datum, Paletten-Anlieferungen, Termine aus den verbundenen Kalendern – und bei freigegebenem Privatbereich auch private Einträge (Kinderzeit, Auszeit, Paarzeit, private Termine). Für „Was steht nächste Woche an?“, „Wann kommt …?“.",
  area: "kalender",
  write: false,
  quelle: { text: "Kalender im Seller-System und verbundene Kalender", jobs: ["Kalender"] },
  input: z.object({ von: isoDate, bis: isoDate.describe("Höchstens 92 Tage nach „von“") }),
  run: async (ctx, { von, bis }) => {
    if (bis < von) return { text: "„bis“ liegt vor „von“.", isError: true };
    const to = bis > addDaysIso(von, 92) ? addDaysIso(von, 92) : bis;
    const s = ctx.session;
    const t = s.tenantId;
    const restricted = s.role === "staff" && (s.areas !== null || s.brandIds !== null);
    const system = (await collectDesired(t, ctx.today, { from: von, to })).filter((d) => !restricted || linkAllowed(s, d.link));
    const [tenant] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, t));
    const staffCalendars = tenant?.settings.calendar?.staffCalendars;
    const pushName = (await getIntegration(t, "apple_calendar"))?.calendarName || DEFAULT_CALENDAR_NAME;
    const E = schema.calendarEvents;
    const events = (await db.select().from(E).where(and(eq(E.tenantId, t), gte(E.day, von), lte(E.day, to))).orderBy(asc(E.startsAt)))
      // Ohne Privat-Freigabe nur geschäftliche Kalender – Familientermine gehen sonst nicht an die KI.
      .filter((e) => calendarVisible(s, e.calendarName, staffCalendars) && (ctx.privat || isBusinessCalendar(e.calendarName, staffCalendars, pushName)));
    const out: Record<string, unknown> = {
      zeitraum: { von, bis: to },
      system: system.map((d) => ({ tag: d.date, titel: d.title, art: d.category, link: abs(ctx, d.link) })).sort((a, b) => a.tag.localeCompare(b.tag)),
      kalender_termine: events.map((e) => ({ tag: e.day, beginn: e.allDay ? "ganztägig" : berlinDateTime(e.startsAt), ende: e.endsAt && !e.allDay ? berlinDateTime(e.endsAt) : undefined, titel: e.title, kalender: e.calendarName, ort: e.location ?? undefined })),
    };
    if (ctx.privat && s.privateAccess) {
      const pc = await privateCalendar(s, von, to, ctx.today);
      const names = pc.settings.partners;
      out.privat = pc.items.map((x) => ({ id: x.id, tag: x.day, bis_tag: x.endDay, von: x.from, bis: x.to, art: x.kind, titel: x.title, personen: x.people.map((p) => names[p]), status: x.status, notiz: x.note }));
    }
    return json(out);
  },
});

export const privatPartnerNamen = async (tenantId: string) => (await privateSettings(tenantId)).partners;

export const ALLGEMEIN = [ueberblick, suche, aufgaben, aufgabeAnlegen, aufgabeAendern, kalender];
export type { ToolCtx };
