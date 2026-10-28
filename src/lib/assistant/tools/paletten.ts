import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { SHIPMENT_STATUSES } from "@/db/schema";
import { customerKey, storedDays } from "@/lib/pallets/billing";
import { createShareLink, createShipmentRecord, getShipment, loadShipment, logShipmentEvent, setShipmentStatus, shiftShipment } from "@/lib/pallets/shipment-service";
import { CARRIERS, CARRIER_KEYS, LINK_DAYS, carrierLabel, delayDays, linkState, loadText, parseShipmentBase, statusLabel, trackingLink } from "@/lib/pallets/shipments";
import { defineTool } from "../types";
import { abs, actorOf, berlinDateTime, isoDate, json, likeOf, uuid } from "./common";

const P = schema.pallets;
const S = schema.palletShipments;
const STATUS_TEXT = "geplant | unterwegs | verzoegert (verzögert) | zugestellt (bei Anlieferung = angekommen) | problem | storniert";

export const paletten = defineTool({
  name: "paletten",
  title: "Paletten im Lager",
  description: "Eingelagerte Paletten (oder auch ausgelagerte) mit Kunde, Stellplatz, Inhalt, Einlagerungsdatum und Lagertagen – optional nach Kunde oder Suchbegriff gefiltert. Dazu Anzahl je Kunde. Für „Wie viele Paletten hat Kunde X?“, „Wo steht Palette P-0012?“.",
  area: "paletten",
  write: false,
  input: z.object({
    kunde: z.string().trim().max(120).optional(),
    suche: z.string().trim().max(80).optional().describe("Palettennummer, Inhalt, Stellplatz oder Notiz"),
    nur_eingelagert: z.boolean().default(true),
    limit: z.number().int().min(1).max(200).default(60),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const where = [eq(P.tenantId, t), isNull(P.cancelledAt)];
    if (i.nur_eingelagert) where.push(isNull(P.outAt));
    if (i.kunde) where.push(sql`lower(trim(${P.customer})) = ${customerKey(i.kunde)}`);
    if (i.suche) where.push(or(ilike(P.code, likeOf(i.suche)), ilike(P.contents, likeOf(i.suche)), ilike(P.location, likeOf(i.suche)), ilike(P.note, likeOf(i.suche)))!);
    const rows = await db.select().from(P).where(and(...where)).orderBy(asc(P.inAt), asc(P.code));
    const perCustomer = new Map<string, number>();
    for (const p of rows) if (!p.outAt) perCustomer.set(p.customer?.trim() || "ohne Kunde", (perCustomer.get(p.customer?.trim() || "ohne Kunde") ?? 0) + 1);
    return json({
      anzahl: rows.length,
      eingelagert_je_kunde: Object.fromEntries(perCustomer),
      paletten: rows.slice(0, i.limit).map((p) => ({ id: p.id, nummer: p.code, kunde: p.customer, stellplatz: p.location, inhalt: p.contents, gewicht_kg: p.weightKg, eingelagert: p.inAt, ausgelagert: p.outAt, lagertage: storedDays(p, ctx.today), notiz: p.note, link: abs(ctx, `/paletten/${p.id}`) })),
    });
  },
});

const shipBrief = (ctx: Parameters<typeof abs>[0], x: typeof S.$inferSelect) => ({
  id: x.id,
  richtung: x.direction === "ein" ? "Anlieferung ins Lager" : "Versand an Kunden",
  titel: x.title,
  kunde: x.customer,
  von_nach: x.place,
  spedition: carrierLabel(x.carrier, x.carrierName),
  sendungsnummer: x.trackingNo,
  verfolgung: trackingLink(x),
  ladung: loadText(x) || undefined,
  termin: x.plannedDate,
  zeitfenster: x.plannedTime,
  verschoben_um_tage: delayDays(x) || undefined,
  urspruenglich: delayDays(x) ? x.firstDate : undefined,
  status: statusLabel(x.status, x.direction),
  stand: x.location,
  link: abs(ctx, `/paletten/sendungen/${x.id}`),
});

export const sendungen = defineTool({
  name: "sendungen",
  title: "Paletten-Sendungen ansehen",
  description: "Sendungen per Spedition oder Paketdienst im Palettenlager: Anlieferungen ins Lager und Versand an Kunden, mit Termin, Status, Sendungsnummer und aktuellem Stand. Für „Welche Paletten kommen diese Woche?“, „Ist die Lieferung von X schon da?“.",
  area: "paletten",
  write: false,
  input: z.object({
    richtung: z.enum(["ein", "aus"]).optional().describe("ein = Anlieferung ins Lager, aus = Versand an Kunden"),
    nur_offen: z.boolean().default(true),
    suche: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(100).default(40),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const where = [eq(S.tenantId, t)];
    if (i.richtung) where.push(eq(S.direction, i.richtung));
    if (i.nur_offen) where.push(inArray(S.status, ["geplant", "unterwegs", "verzoegert", "problem"]));
    if (i.suche) where.push(or(ilike(S.title, likeOf(i.suche)), ilike(S.trackingNo, likeOf(i.suche)), ilike(S.customer, likeOf(i.suche)), ilike(S.place, likeOf(i.suche)))!);
    const rows = await db.select().from(S).where(and(...where)).orderBy(i.nur_offen ? sql`${S.plannedDate} asc nulls last` : desc(S.updatedAt)).limit(i.limit);
    return json({ heute: ctx.today, anzahl: rows.length, sendungen: rows.map((x) => shipBrief(ctx, x)) });
  },
});

export const sendung = defineTool({
  name: "sendung",
  title: "Sendung im Detail",
  description: "Eine Paletten-Sendung mit Verlauf (Terminverschiebungen, Status, Notizen), Fotos und aktiven Kunden-Links.",
  area: "paletten",
  write: false,
  input: z.object({ id: uuid }),
  run: async (ctx, { id }) => {
    const data = await loadShipment(ctx.session.tenantId, id);
    if (!data) return { text: "Sendung nicht gefunden.", isError: true };
    return json({
      ...shipBrief(ctx, data.shipment),
      interne_notiz: data.shipment.note,
      zugestellt_am: berlinDateTime(data.shipment.deliveredAt),
      fotos: data.photos.length,
      kunden_links: data.links.filter((l) => linkState(l) === "aktiv").map((l) => ({ link: abs(ctx, `/sendung/${l.token}`), gueltig_bis: berlinDateTime(l.expiresAt), geoeffnet: l.views })),
      verlauf: data.events.map((e) => ({ zeit: berlinDateTime(e.createdAt), text: e.text, von: e.userName, meldung_an_alle: e.notice || undefined, intern: e.internal || undefined })),
    });
  },
});

export const sendungAnlegen = defineTool({
  name: "sendung_anlegen",
  title: "Sendung anlegen",
  description: `Legt eine Paletten-Sendung an (Anlieferung ins Lager oder Versand an Kunden) – alle mit Zugriff aufs Palettenlager bekommen eine Meldung. spedition ist einer dieser Schlüssel: ${CARRIERS.map((c) => `${c.key} (${c.name})`).join(", ")}.`,
  area: "paletten",
  write: true,
  input: z.object({
    richtung: z.enum(["ein", "aus"]).describe("ein = Anlieferung ins Lager, aus = Versand an Kunden"),
    bezeichnung: z.string().trim().min(1).max(160),
    spedition: z.enum(CARRIER_KEYS as [string, ...string[]]),
    spedition_name: z.string().trim().max(80).optional().describe("Nur bei spedition = andere"),
    sendungsnummer: z.string().trim().max(80).optional(),
    verfolgungs_link: z.string().trim().max(600).optional().describe("https-Link zur Sendungsverfolgung, falls bekannt"),
    kunde: z.string().trim().max(120).optional(),
    von_nach: z.string().trim().max(160).optional(),
    paletten: z.number().int().min(0).max(9999).optional(),
    kartons: z.number().int().min(0).max(9999).optional(),
    termin: isoDate.optional(),
    zeitfenster: z.string().trim().max(40).optional(),
    notiz: z.string().trim().max(2000).optional().describe("Interne Notiz – sieht der Kunde nie"),
  }),
  summary: (i) => `${i.richtung === "ein" ? "Anlieferung" : "Versand"} „${i.bezeichnung}“ (${carrierLabel(i.spedition, i.spedition_name)}${i.termin ? `, ${i.termin}` : ""})`,
  run: async (ctx, i) => {
    const map: Record<string, unknown> = { direction: i.richtung, title: i.bezeichnung, carrier: i.spedition, carrierName: i.spedition_name, trackingNo: i.sendungsnummer, trackingUrl: i.verfolgungs_link, customer: i.kunde, place: i.von_nach, palletCount: i.paletten, cartonCount: i.kartons, note: i.notiz };
    const b = parseShipmentBase((k) => map[k]);
    if (typeof b === "string") return { text: b, isError: true };
    const id = await createShipmentRecord(ctx.session.tenantId, actorOf(ctx), b, i.termin ?? null, i.zeitfenster ?? null);
    return json({ ok: true, meldung: "Sendung angelegt – alle mit Paletten-Zugriff sehen die Meldung.", id, link: abs(ctx, `/paletten/sendungen/${id}`) });
  },
});

export const sendungTermin = defineTool({
  name: "sendung_termin",
  title: "Sendungstermin verschieben",
  description: "Neuer Liefertag und/oder Zeitfenster einer Paletten-Sendung, mit Grund (sieht auch der Kunde im Link). Später als bisher → Status „verzögert“. Alle mit Paletten-Zugriff bekommen eine Meldung.",
  area: "paletten",
  write: true,
  input: z.object({ id: uuid, termin: isoDate.nullable().describe("Neuer Tag; null = Termin offen"), zeitfenster: z.string().trim().max(40).optional(), grund: z.string().trim().max(200).optional() }),
  summary: (i) => `Termin → ${i.termin ?? "offen"}${i.zeitfenster ? ` (${i.zeitfenster})` : ""}${i.grund ? ` – ${i.grund}` : ""}`,
  run: async (ctx, i) => {
    const s = await getShipment(ctx.session.tenantId, i.id);
    if (!s) return { text: "Sendung nicht gefunden.", isError: true };
    const r = await shiftShipment(ctx.session.tenantId, actorOf(ctx), s, i.termin, i.zeitfenster ?? s.plannedTime, i.grund ?? null);
    return r.ok ? json({ ok: true, meldung: r.message }) : { text: r.message, isError: true };
  },
});

export const sendungStatus = defineTool({
  name: "sendung_status",
  title: "Sendungsstatus melden",
  description: `Status und/oder Stand („wo ist sie gerade“) einer Paletten-Sendung setzen. Status: ${STATUS_TEXT}. Statuswechsel sind Meldungen an alle mit Paletten-Zugriff.`,
  area: "paletten",
  write: true,
  input: z.object({ id: uuid, status: z.enum(SHIPMENT_STATUSES).optional(), stand: z.string().trim().max(300).optional() }),
  summary: (i) => [i.status ? `Status ${i.status}` : null, i.stand ? `Stand „${i.stand}“` : null].filter(Boolean).join(", ") || "Status",
  run: async (ctx, i) => {
    const s = await getShipment(ctx.session.tenantId, i.id);
    if (!s) return { text: "Sendung nicht gefunden.", isError: true };
    const r = await setShipmentStatus(ctx.session.tenantId, actorOf(ctx), s, i.status ?? s.status, i.stand !== undefined ? i.stand || null : s.location);
    return r.ok ? json({ ok: true, meldung: r.message }) : { text: r.message, isError: true };
  },
});

export const sendungNotiz = defineTool({
  name: "sendung_notiz",
  title: "Notiz zur Sendung",
  description: "Interne Notiz im Verlauf einer Paletten-Sendung (z. B. „Spedition angerufen, kommt Freitag“). Sieht der Kunde nie.",
  area: "paletten",
  write: true,
  input: z.object({ id: uuid, text: z.string().trim().min(1).max(600) }),
  summary: (i) => `Notiz: „${i.text.slice(0, 80)}“`,
  run: async (ctx, i) => {
    const s = await getShipment(ctx.session.tenantId, i.id);
    if (!s) return { text: "Sendung nicht gefunden.", isError: true };
    await logShipmentEvent(db, ctx.session.tenantId, s, { kind: "notiz", text: i.text, internal: true }, actorOf(ctx));
    return json({ ok: true, meldung: "Notiz gespeichert (nur intern)." });
  },
});

export const sendungKundenlink = defineTool({
  name: "sendung_kundenlink",
  title: "Kunden-Link erstellen",
  description: "Erstellt einen befristeten Link für den Kunden (ohne Anmeldung): Status, Termin, Spedition, Verfolgungs-Link, Fotos, Verlauf – ohne interne Notizen. Gibt die Adresse zurück, die man dem Kunden schickt.",
  area: "paletten",
  write: true,
  input: z.object({ id: uuid, tage: z.union(LINK_DAYS.map((d) => z.literal(d)) as unknown as [z.ZodLiteral<3>, z.ZodLiteral<7>, z.ZodLiteral<14>, z.ZodLiteral<30>]).default(7), fotos: z.boolean().default(true) }),
  summary: (i) => `Kunden-Link für ${i.tage} Tage${i.fotos ? " mit Fotos" : ""}`,
  run: async (ctx, i) => {
    const s = await getShipment(ctx.session.tenantId, i.id);
    if (!s) return { text: "Sendung nicht gefunden.", isError: true };
    const token = await createShareLink(ctx.session.tenantId, s.id, { days: i.tage, showPhotos: i.fotos, userId: ctx.session.userId });
    await logShipmentEvent(db, ctx.session.tenantId, s, { kind: "link", text: `Kunden-Link erstellt (${i.tage} Tage gültig${i.fotos ? ", mit Fotos" : ", ohne Fotos"})`, internal: true }, actorOf(ctx));
    return json({ ok: true, link: abs(ctx, `/sendung/${token}`), gueltig_tage: i.tage });
  },
});

export const PALETTEN = [paletten, sendungen, sendung, sendungAnlegen, sendungTermin, sendungStatus, sendungNotiz, sendungKundenlink];
