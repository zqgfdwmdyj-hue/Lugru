import "server-only";
import { anrufName, istAnruf, telefonAus, telefonRueckfrage } from "@/lib/mobil/logic";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
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
import type { CalKind } from "@/lib/private/kalender";
import { privateSettings } from "@/lib/private/service";
import { defineTool, type ToolCtx } from "../types";
import { PRIORITY_IN, abs, berlinDateTime, isoDate, json, likeOf, round2, taskBrief, uuid, visibleTask } from "./common";
import { wissenSichtbar } from "@/lib/knowledge/sichtbar";
import { personen } from "@/lib/delegieren/service";

const T = schema.tasks;
const PS = schema.palletShipments;
const OPEN_SHIP = ["geplant", "unterwegs", "verzoegert", "problem"] as const;

const syncSoon = (tenantId: string) => void syncCalendar(tenantId).catch(() => {});

export const ueberblick = defineTool({
  name: "ueberblick",
  title: "Tagesüberblick",
  description:
    "Überblick für heute: was ansteht (Versand, Fristen, Ansprüche, Fälle), offene und bis heute fällige Aufgaben, Paletten-Sendungen heute/überfällig, Umsatz heute/gestern/Monat, für den Inhaber die Zeile „VA heute“ (erledigt, Rückfragen, automatisch beantwortet, Fristen verpasst = rot). Nimm das als Einstieg bei Fragen wie „Was steht heute an?“, „Was ist offen?“, „Wie läuft es?“.",
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
    const recht = await import("@/lib/recht/service").then((x) => x.rechtZeile(s, ctx.today)).catch(() => null);
    if (recht) (out.hinweise as unknown[]).push({ text: recht.text, anzahl: recht.anzahl, stufe: "warn", link: abs(ctx, recht.link) });
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
    // VA (B18): Zeile für den Morgenbericht – „N Fristen verpasst“ ist rot.
    if (s.role === "owner") {
      const va = await import("@/lib/va/service").then((x) => x.vaHeute(t, ctx.today)).catch(() => null);
      if (va) out.va = { text: va.text, erledigt: va.erledigt, rueckfragen: va.rueckfragen, automatisch_beantwortet: va.auto, fristen_verpasst: va.fristenVerpasst, stufe: va.stufe, link: abs(ctx, "/delegation/va") };
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
      const rows = await db.select().from(K).where(and(eq(K.tenantId, t), wissenSichtbar(s), or(ilike(K.title, like), ilike(K.body, like)))).limit(5);
      out.wissen = rows.map((k) => ({ id: k.id, titel: k.title, kategorie: k.category, insider: k.insider ? "Insider – nicht weitergeben" : undefined, call_datum: k.quelleDatum ?? undefined, gesagt_von: k.quelleWer ?? undefined, auszug: k.body.slice(0, 300), link: abs(ctx, `/wissen/${k.id}`) }));
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
    zustaendig: z.string().trim().max(60).optional().describe("Filter Zuständigkeit: „ich“, „niemand“, „extern“ oder Name (z. B. Assistenz, Steuerberater)"),
    limit: z.number().int().min(1).max(100).default(40),
  }),
  run: async (ctx, i) => {
    const s = ctx.session;
    const where = [eq(T.tenantId, s.tenantId), eq(T.status, i.status === "erledigt" ? "done" : "open")];
    const ps = await personen(s.tenantId);
    const nameVon = new Map(ps.map((p) => [p.key, p.name]));
    if (i.zustaendig) {
      const z = i.zustaendig.toLowerCase();
      if (z === "ich") where.push(s.role === "owner" ? or(eq(T.assigneeId, s.userId), and(isNull(T.assigneeId), isNull(T.zustaendigExtern)))! : eq(T.assigneeId, s.userId));
      else if (z === "niemand") where.push(and(isNull(T.assigneeId), isNull(T.zustaendigExtern))!);
      else if (z === "extern") where.push(isNotNull(T.zustaendigExtern));
      else {
        const treffer = ps.filter((p) => p.name.toLowerCase().includes(z));
        const ids = treffer.filter((p) => p.art === "intern").map((p) => p.key.slice(5));
        const ext = treffer.filter((p) => p.art === "extern").map((p) => p.key.slice(7));
        if (!ids.length && !ext.length) return { text: `Keine Person „${i.zustaendig}“ gefunden. Bekannt: ${ps.map((p) => p.name).join(", ")}.`, isError: true };
        where.push(or(ids.length ? inArray(T.assigneeId, ids) : undefined, ext.length ? inArray(T.zustaendigExtern, ext) : undefined)!);
      }
    }
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
    const zustaendig = (x: (typeof vis)[number]) => (x.assigneeId ? (nameVon.get(`user:${x.assigneeId}`) ?? "andere Person") : x.zustaendigExtern ? `${x.zustaendigExtern} (extern)` : undefined);
    return json({ anzahl: vis.length, aufgaben: vis.slice(0, i.limit).map((x) => ({ ...taskBrief(x, ctx), zustaendig: zustaendig(x) })), link: abs(ctx, "/?ansicht=liste") });
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
    zustaendig: z.enum(["va"]).optional().describe("„va“ = an die VA geben: eigener Discord-Thread (auf Englisch, mit Anleitung) – einzeln bestätigen"),
    telefon: z.string().trim().max(40).optional().describe("Bei Anruf-Aufgaben: Telefonnummer (nur wenn genannt oder ausdrücklich bestätigt)"),
  }),
  stufe: (i) => (i.zustaendig === "va" ? "gelb" : "gruen"),
  summary: (i) => `Aufgabe „${i.titel}“${i.faellig ? ` (fällig ${i.faellig})` : ""}${i.zustaendig === "va" ? " → an die VA (Discord)" : ""}`,
  run: async (ctx, i) => {
    const s = ctx.session;
    // Mitarbeiter mit Kalender, aber ohne Startseite: Herkunft Kalender, damit sie die Aufgabe dort sehen.
    const link = s.role === "staff" && s.areas !== null && !canAccess(s, "start") ? "/kalender" : null;
    const [row] = await db
      .insert(T)
      .values({ tenantId: s.tenantId, title: i.titel, notes: i.notiz ?? null, dueDate: i.faellig ?? null, priority: PRIORITY_IN[i.prioritaet], category: "eigene", link, createdBy: s.userId, telefon: i.telefon ? (telefonAus(i.telefon) ?? i.telefon) : istAnruf(i.titel) ? telefonAus(i.notiz ?? "") : null })
      .returning();
    syncSoon(s.tenantId);
    // Anruf ohne Nummer: nachfragen, mit Vorschlag aus Kontakten/Mails (wird nicht von selbst gespeichert).
    let rueckfrage: string | undefined;
    let telefonVorschlagWert: { nummer: string; quelle: string } | null | undefined;
    if (istAnruf(i.titel) && !row.telefon) {
      const { telefonVorschlag } = await import("@/lib/mobil/telefon");
      telefonVorschlagWert = await telefonVorschlag(s.tenantId, anrufName(i.titel), { mails: canAccess(s, "posteingang") }).catch(() => null);
      rueckfrage = telefonRueckfrage(anrufName(i.titel), telefonVorschlagWert);
    }
    let va: string | undefined;
    if (i.zustaendig === "va") {
      if (s.role !== "owner") return { text: "An die VA gibt nur der Inhaber Aufgaben.", isError: true };
      const { anVaGeben } = await import("@/lib/va/service");
      const r = await anVaGeben(s.tenantId, row.id);
      va = r.ok ? "an die VA gegeben (Discord-Thread)" : `Aufgabe angelegt, aber nicht an die VA: ${r.fehler}`;
    }
    return { text: JSON.stringify({ ok: true, meldung: "Aufgabe angelegt.", va, rueckfrage, telefon_vorschlag: telefonVorschlagWert, aufgabe: { ...taskBrief(row, ctx), telefon: row.telefon ?? undefined } }), ids: [row.id], undo: { id: row.id } };
  },
  undo: async (ctx, d) => {
    const id = (d as { id?: string }).id;
    if (id) await db.delete(T).where(and(eq(T.tenantId, ctx.session.tenantId), eq(T.id, id), eq(T.category, "eigene")));
    syncSoon(ctx.session.tenantId);
    return "Aufgabe wieder entfernt.";
  },
});

export const aufgabeAendern = defineTool({
  name: "aufgabe_aendern",
  title: "Aufgabe ändern / abhaken",
  description: "Hakt eine Aufgabe ab (erledigt: true), öffnet sie wieder (erledigt: false) oder ändert Titel, Notiz, Fälligkeit, Priorität, Aufwand (S = 15 Min., M = 1 Std., L = halber Tag; null = wieder schätzen – der Tagesplan lernt daraus für Aufgaben gleicher Art). Die id kommt aus „aufgaben“ oder „suche“.",
  area: ["start", "kalender"],
  write: true,
  input: z.object({
    id: uuid,
    erledigt: z.boolean().optional(),
    titel: z.string().trim().min(1).max(300).optional(),
    notiz: z.string().trim().max(4000).optional(),
    faellig: isoDate.nullable().optional().describe("Neues Fälligkeitsdatum; null entfernt es"),
    prioritaet: z.enum(["wichtig", "normal", "niedrig"]).optional(),
    aufwand: z.enum(["S", "M", "L"]).nullable().optional().describe("S = 15 Min., M = 1 Std., L = halber Tag; null = wieder schätzen"),
    telefon: z.string().trim().max(40).nullable().optional().describe("Telefonnummer der Anruf-Aufgabe (z. B. bestätigter Vorschlag); null entfernt sie"),
  }),
  summary: (i) => [i.erledigt === true ? "abhaken" : i.erledigt === false ? "wieder öffnen" : null, i.titel ? `Titel „${i.titel}“` : null, i.faellig !== undefined ? `fällig ${i.faellig ?? "–"}` : null, i.prioritaet ? `Priorität ${i.prioritaet}` : null, i.aufwand !== undefined ? `Aufwand ${i.aufwand ?? "schätzen"}` : null, i.telefon !== undefined ? `Telefon ${i.telefon ?? "–"}` : null].filter(Boolean).join(", ") || "Aufgabe ändern",
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
    if (i.aufwand !== undefined) patch.aufwand = i.aufwand;
    if (i.telefon !== undefined) patch.telefon = i.telefon ? (telefonAus(i.telefon) ?? i.telefon) : null;
    if (!Object.keys(patch).length) return { text: "Nichts zu ändern angegeben.", isError: true };
    // B19.5: alte Werte der geänderten Felder für „Rückgängig“ (7 Tage) merken.
    const vorher = Object.fromEntries(Object.keys(patch).map((k) => [k, (task as Record<string, unknown>)[k] ?? null]));
    const [row] = await db.update(T).set(patch).where(and(eq(T.tenantId, s.tenantId), eq(T.id, i.id))).returning();
    syncSoon(s.tenantId);
    return { text: json({ ok: true, meldung: "Aufgabe geändert.", aufgabe: taskBrief(row, ctx) }), ids: [row.id], undo: { id: row.id, vorher } };
  },
  undo: async (ctx, d) => {
    const { id, vorher } = d as { id?: string; vorher?: Record<string, unknown> };
    if (!id || !vorher) throw new Error("Keine alten Werte gespeichert.");
    const erlaubt = ["status", "completedAt", "title", "notes", "dueDate", "priority", "aufwand", "telefon"];
    const patch = Object.fromEntries(Object.entries(vorher).filter(([k]) => erlaubt.includes(k)).map(([k, v]) => [k, k === "completedAt" && typeof v === "string" ? new Date(v) : v])) as Partial<typeof T.$inferInsert>;
    if (!Object.keys(patch).length) throw new Error("Keine alten Werte gespeichert.");
    const r = await db.update(T).set(patch).where(and(eq(T.tenantId, ctx.session.tenantId), eq(T.id, id))).returning({ id: T.id });
    if (!r.length) throw new Error("Aufgabe gibt es nicht mehr.");
    syncSoon(ctx.session.tenantId);
    return "Aufgabe wieder wie vorher.";
  },
});

// ---- Kalender ------------------------------------------------------------------------------------------

const AUSSER_HAUS = "Termin außer Haus";
const PRIVAT_ALS_ZEIT: Partial<Record<CalKind, string>> = { termin: AUSSER_HAUS, kinder: "privat geblockt", auszeit: "privat geblockt" };

export const kalender = defineTool({
  name: "kalender",
  title: "Kalender ansehen",
  description:
    "Termine im Zeitraum: Fristen, Versandtage, Aufgaben mit Datum, Paletten-Anlieferungen, Termine aus den verbundenen Geschäftskalendern. Bei freigegebenem Privatbereich zusätzlich private Termine und Familienkalender nur als „Termin außer Haus“ mit Uhrzeit (Kinderzeit/Auszeit als „privat geblockt“) – Einzelheiten nur über privat_kalender. Für „Was steht nächste Woche an?“, „Wann kommt …?“, „Wann bin ich unterwegs?“.",
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
    const zeit = (e: (typeof events)[number]) => ({ tag: e.day, beginn: e.allDay ? "ganztägig" : berlinDateTime(e.startsAt), ende: e.endsAt && !e.allDay ? berlinDateTime(e.endsAt) : undefined });
    const out: Record<string, unknown> = {
      zeitraum: { von, bis: to },
      system: system.map((d) => ({ tag: d.date, titel: d.title, art: d.category, link: abs(ctx, d.link) })).sort((a, b) => a.tag.localeCompare(b.tag)),
      // Familienkalender (nur mit Privat-Freigabe) ohne Titel, Kalender und Ort – nur „Termin außer Haus“ mit Uhrzeit.
      kalender_termine: events.map((e) => (isBusinessCalendar(e.calendarName, staffCalendars, pushName) ? { ...zeit(e), titel: e.title, kalender: e.calendarName, ort: e.location ?? undefined } : { ...zeit(e), titel: AUSSER_HAUS })),
    };
    if (ctx.privat && s.privateAccess) {
      // Private Einträge nur als belegte Zeit: Termine → „Termin außer Haus“, Kinderzeit/Auszeit → „privat geblockt“.
      // Familienkalender stehen schon oben, Intimes und Periode gar nicht. Einzelheiten nur über privat_kalender.
      const pc = await privateCalendar(s, von, to, ctx.today);
      out.privat = pc.items
        .filter((x) => PRIVAT_ALS_ZEIT[x.kind] && !x.skipped && x.status !== "ausgefallen")
        .map((x) => ({ tag: x.day, bis_tag: x.endDay, von: x.from, bis: x.to, titel: PRIVAT_ALS_ZEIT[x.kind] }));
      out.privat_hinweis = "Private Termine nur als belegte Zeit. Einzelheiten (Titel, Personen, Ort) nur auf ausdrückliche Frage über privat_kalender.";
    }
    return json(out);
  },
});

export const privatPartnerNamen = async (tenantId: string) => (await privateSettings(tenantId)).partners;

export const ALLGEMEIN = [ueberblick, suche, aufgaben, aufgabeAnlegen, aufgabeAendern, kalender];
export type { ToolCtx };
