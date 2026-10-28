"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { getIntegration } from "@/lib/integrations/store";
import { onceOnly, submitKeyOf } from "@/lib/once";
import { customerKey } from "@/lib/pallets/billing";
import { storePhotos } from "@/lib/pallets/photos";
import { createShareLink, logShipmentEvent, markNoticesSeen, trackShipment } from "@/lib/pallets/shipment-service";
import { CARRIER_KEYS, LINK_DAYS, carrierLabel, cleanTrackingNo, dmy, loadText, safeUrl, shiftText, statusAfterShift, statusLabel, type Direction } from "@/lib/pallets/shipments";

const S = schema.palletShipments;
const PH = schema.palletShipmentPhotos;
const L = schema.palletShipmentLinks;

export type ShipState = { ok: boolean; message: string; id?: string; link?: string } | null;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const txt = (fd: FormData, key: string, max: number) => String(fd.get(key) ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const count = (fd: FormData, key: string) => {
  const v = Math.round(Number(String(fd.get(key) ?? "").trim() || "0"));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 9999) : null;
};
const dateOf = (fd: FormData, key: string) => {
  const v = String(fd.get(key) ?? "").trim();
  return isoDate.safeParse(v).success ? v : null;
};
const who = (s: { userId: string; name?: string | null; email: string }) => ({ userId: s.userId, userName: s.name || s.email });

/** Gleiche Schreibweise wie im Kundenstamm des Palettenlagers (sonst „Müller“ und „müller“). */
async function canonicalCustomer(tenantId: string, name: string | null) {
  if (!name) return null;
  const [known] = await db.select({ name: schema.palletCustomers.name }).from(schema.palletCustomers).where(and(eq(schema.palletCustomers.tenantId, tenantId), sql`lower(${schema.palletCustomers.name}) = ${customerKey(name)}`));
  return known?.name ?? name;
}

type Base = {
  direction: Direction;
  title: string;
  customer: string | null;
  place: string | null;
  carrier: string;
  carrierName: string | null;
  trackingNo: string | null;
  trackingUrl: string | null;
  palletCount: number | null;
  cartonCount: number | null;
  note: string | null;
};

function readBase(fd: FormData): Base | string {
  const direction = fd.get("direction") === "aus" ? "aus" : fd.get("direction") === "ein" ? "ein" : null;
  if (!direction) return "Bitte wählen: Anlieferung ins Lager oder Versand an Kunden.";
  const title = txt(fd, "title", 160);
  if (!title) return "Bitte eine Bezeichnung eingeben (z. B. „12 Paletten Shampoo“ oder die Auftragsnummer).";
  const carrier = String(fd.get("carrier") ?? "");
  if (!CARRIER_KEYS.includes(carrier)) return "Bitte Spedition bzw. Paketdienst wählen.";
  const rawUrl = String(fd.get("trackingUrl") ?? "").trim();
  const trackingUrl = safeUrl(rawUrl);
  if (rawUrl && !trackingUrl) return "Der Link zur Sendungsverfolgung muss mit https:// beginnen.";
  return {
    direction,
    title,
    customer: txt(fd, "customer", 120),
    place: txt(fd, "place", 160),
    carrier,
    carrierName: carrier === "andere" ? txt(fd, "carrierName", 80) : null,
    trackingNo: cleanTrackingNo(String(fd.get("trackingNo") ?? "")),
    trackingUrl,
    palletCount: count(fd, "palletCount"),
    cartonCount: count(fd, "cartonCount"),
    note: String(fd.get("note") ?? "").trim().slice(0, 2000) || null,
  };
}

/** Ankündigung für den Verlauf – ohne interne Notiz, der Kunde sieht sie im Link. */
function createdText(b: Base, plannedDate: string | null, plannedTime: string | null) {
  const what = b.direction === "ein" ? "Anlieferung angekündigt" : "Versand angelegt";
  const parts = [loadText(b), carrierLabel(b.carrier, b.carrierName), plannedDate ? `Termin ${dmy(plannedDate)}${plannedTime ? ` (${plannedTime})` : ""}` : "Termin noch offen"].filter(Boolean);
  return `${what}: ${parts.join(" · ")}`;
}

async function insertShipment(session: Awaited<ReturnType<typeof requireArea>>, fd: FormData): Promise<NonNullable<ShipState>> {
  const t = session.tenantId;
  const b = readBase(fd);
  if (typeof b === "string") return { ok: false, message: b };
  const plannedDate = dateOf(fd, "plannedDate");
  const plannedTime = txt(fd, "plannedTime", 40);
  const customer = await canonicalCustomer(t, b.customer);
  let photoIds: string[] = [];
  try {
    photoIds = await storePhotos(t, fd, "sendung.jpg");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Fotos konnten nicht gespeichert werden." };
  }
  const shared = fd.get("photosShared") !== "off";
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(S)
      .values({ tenantId: t, ...b, customer, plannedDate, plannedTime, firstDate: plannedDate, createdBy: session.userId })
      .returning();
    await logShipmentEvent(tx, t, row, { kind: "angelegt", text: createdText(b, plannedDate, plannedTime), notice: true, newDate: plannedDate, status: "geplant" }, who(session));
    if (photoIds.length) {
      await tx.insert(PH).values(photoIds.map((fileId) => ({ tenantId: t, shipmentId: row.id, fileId, shared })));
      await logShipmentEvent(tx, t, row, { kind: "foto", text: `${photoIds.length} Foto${photoIds.length === 1 ? "" : "s"} hinzugefügt`, internal: !shared }, who(session));
    }
    return row.id;
  });
  revalidatePath("/paletten", "layout");
  return { ok: true, message: "Sendung angelegt.", id };
}

/** Neue Sendung (Anlieferung oder Versand) – danach geht es auf die Detailseite. */
export async function createShipment(_prev: ShipState, fd: FormData): Promise<ShipState> {
  const session = await requireArea("paletten");
  const res = await onceOnly(session.tenantId, submitKeyOf(fd), () => insertShipment(session, fd), { ok: false, message: "Wird gerade angelegt – bitte nicht erneut tippen." });
  if (res.ok && res.id) redirect(`/paletten/sendungen/${res.id}?neu=1`);
  return res;
}

/** Alle Änderungen an einer Sendung über ein Feld „intent“. */
export async function shipmentAction(_prev: ShipState, fd: FormData): Promise<ShipState> {
  const session = await requireArea("paletten");
  const t = session.tenantId;
  const id = String(fd.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "Sendung nicht gefunden." };
  const [s] = await db.select().from(S).where(and(eq(S.tenantId, t), eq(S.id, id)));
  if (!s) return { ok: false, message: "Sendung nicht gefunden." };
  const intent = String(fd.get("intent") ?? "");
  const actor = who(session);
  const done = (message: string, extra: Partial<NonNullable<ShipState>> = {}): ShipState => {
    revalidatePath(`/paletten/sendungen/${id}`);
    revalidatePath("/paletten", "layout");
    return { ok: true, message, ...extra };
  };

  switch (intent) {
    case "termin": {
      const raw = String(fd.get("plannedDate") ?? "").trim();
      const newDate = raw ? dateOf(fd, "plannedDate") : null;
      if (raw && !newDate) return { ok: false, message: "Bitte ein gültiges Datum wählen." };
      const plannedTime = txt(fd, "plannedTime", 40);
      const reason = txt(fd, "reason", 200);
      if (newDate === s.plannedDate && plannedTime === s.plannedTime) return { ok: false, message: "Termin und Zeitfenster sind unverändert." };
      const status = statusAfterShift(s.status, s.plannedDate, newDate);
      const timeNote = plannedTime && plannedTime !== s.plannedTime ? `, Zeitfenster ${plannedTime}` : "";
      const text = newDate === s.plannedDate ? `Zeitfenster geändert: ${plannedTime ?? "offen"}${reason ? ` – ${reason}` : ""}` : `${shiftText(s.plannedDate, newDate, reason)}${timeNote}`;
      await db.transaction(async (tx) => {
        await tx.update(S).set({ plannedDate: newDate, plannedTime, firstDate: s.firstDate ?? s.plannedDate ?? newDate, status, updatedAt: new Date() }).where(and(eq(S.tenantId, t), eq(S.id, id)));
        await logShipmentEvent(tx, t, s, { kind: "termin", text, notice: true, oldDate: s.plannedDate, newDate, status: status !== s.status ? status : null }, actor);
      });
      return done(newDate === s.plannedDate ? "Zeitfenster gespeichert – alle mit Paletten-Zugriff sehen die Meldung." : "Neuer Termin gespeichert – alle mit Paletten-Zugriff sehen die Meldung.");
    }
    case "status": {
      const parsed = z.enum(SHIPMENT_STATUSES).safeParse(fd.get("status") ?? s.status);
      if (!parsed.success) return { ok: false, message: "Unbekannter Status." };
      const status: ShipmentStatus = parsed.data;
      const location = fd.has("location") ? txt(fd, "location", 300) : s.location;
      if (status === s.status && location === s.location) return { ok: false, message: "Nichts geändert." };
      const deliveredAt = status === "zugestellt" ? (s.deliveredAt ?? new Date()) : null;
      await db.transaction(async (tx) => {
        await tx.update(S).set({ status, location, deliveredAt, updatedAt: new Date() }).where(and(eq(S.tenantId, t), eq(S.id, id)));
        if (status !== s.status) {
          await logShipmentEvent(tx, t, s, { kind: "status", text: `${statusLabel(status, s.direction)[0].toUpperCase()}${statusLabel(status, s.direction).slice(1)}${location && location !== s.location ? ` – ${location}` : ""}`, notice: true, status }, actor);
        } else {
          await logShipmentEvent(tx, t, s, { kind: "standort", text: `Stand: ${location ?? "–"}` }, actor);
        }
      });
      return done(status !== s.status ? `Status „${statusLabel(status, s.direction)}“ gespeichert – alle mit Paletten-Zugriff sehen die Meldung.` : "Stand gespeichert.");
    }
    case "notiz": {
      const note = String(fd.get("text") ?? "").trim().slice(0, 600);
      if (!note) return { ok: false, message: "Bitte etwas eintragen." };
      await logShipmentEvent(db, t, s, { kind: "notiz", text: note, internal: true }, actor);
      return done("Notiz gespeichert (nur intern).");
    }
    case "bearbeiten": {
      const b = readBase(fd);
      if (typeof b === "string") return { ok: false, message: b };
      const customer = await canonicalCustomer(t, b.customer);
      const next = { ...b, customer };
      const labels: Record<keyof Base, string> = { direction: "Richtung", title: "Bezeichnung", customer: "Kunde", place: "Von/Nach", carrier: "Spedition", carrierName: "Spedition", trackingNo: "Sendungsnummer", trackingUrl: "Verfolgungs-Link", palletCount: "Paletten", cartonCount: "Kartons", note: "Notiz" };
      const changed = [...new Set((Object.keys(next) as (keyof Base)[]).filter((k) => (next[k] ?? null) !== (s[k] ?? null)).map((k) => labels[k]))];
      if (!changed.length) return { ok: false, message: "Nichts geändert." };
      const trackingChanged = next.trackingNo !== s.trackingNo || next.carrier !== s.carrier;
      await db.transaction(async (tx) => {
        await tx.update(S).set({ ...next, ...(trackingChanged ? { trackedAt: null, trackError: null } : {}), updatedAt: new Date() }).where(and(eq(S.tenantId, t), eq(S.id, id)));
        await logShipmentEvent(tx, t, s, { kind: "geaendert", text: `Geändert: ${changed.join(", ")}`, internal: true }, actor);
      });
      return done("Gespeichert.");
    }
    case "fotos": {
      let ids: string[];
      try {
        ids = await storePhotos(t, fd, "sendung.jpg");
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "Fotos konnten nicht gespeichert werden." };
      }
      if (!ids.length) return { ok: false, message: "Bitte Fotos aufnehmen oder auswählen." };
      const shared = fd.get("photosShared") !== "off";
      await db.transaction(async (tx) => {
        await tx.insert(PH).values(ids.map((fileId) => ({ tenantId: t, shipmentId: id, fileId, shared })));
        await logShipmentEvent(tx, t, s, { kind: "foto", text: `${ids.length} Foto${ids.length === 1 ? "" : "s"} hinzugefügt`, internal: !shared }, actor);
      });
      return done(`${ids.length} Foto${ids.length === 1 ? "" : "s"} gespeichert${shared ? " – im Kunden-Link sichtbar" : " – nur intern"}.`);
    }
    case "foto-teilen": {
      const photoId = String(fd.get("photoId") ?? "");
      const shared = fd.get("shared") === "1";
      const r = await db.update(PH).set({ shared }).where(and(eq(PH.tenantId, t), eq(PH.shipmentId, id), eq(PH.id, photoId))).returning({ id: PH.id });
      if (!r.length) return { ok: false, message: "Foto nicht gefunden." };
      return done(shared ? "Foto ist im Kunden-Link sichtbar." : "Foto ist jetzt nur intern.");
    }
    case "foto-loeschen": {
      const photoId = String(fd.get("photoId") ?? "");
      const [p] = await db.delete(PH).where(and(eq(PH.tenantId, t), eq(PH.shipmentId, id), eq(PH.id, photoId))).returning({ fileId: PH.fileId });
      if (!p) return { ok: false, message: "Foto nicht gefunden." };
      // Datei nur löschen, wenn nichts anderes mehr darauf zeigt.
      const [other] = await db.select({ id: PH.id }).from(PH).where(and(eq(PH.tenantId, t), eq(PH.fileId, p.fileId))).limit(1);
      const [pal] = await db.select({ id: schema.palletPhotos.id }).from(schema.palletPhotos).where(and(eq(schema.palletPhotos.tenantId, t), eq(schema.palletPhotos.fileId, p.fileId))).limit(1);
      if (!other && !pal) await db.delete(schema.files).where(and(eq(schema.files.tenantId, t), eq(schema.files.id, p.fileId)));
      await logShipmentEvent(db, t, s, { kind: "foto", text: "Foto entfernt", internal: true }, actor);
      return done("Foto entfernt.");
    }
    case "link": {
      const days = Number(fd.get("days"));
      if (!(LINK_DAYS as readonly number[]).includes(days)) return { ok: false, message: "Bitte Gültigkeit wählen." };
      const showPhotos = fd.get("showPhotos") === "on";
      const token = await createShareLink(t, id, { days, showPhotos, userId: session.userId });
      await logShipmentEvent(db, t, s, { kind: "link", text: `Kunden-Link erstellt (${days} Tage gültig${showPhotos ? ", mit Fotos" : ", ohne Fotos"})`, internal: true }, actor);
      return done(`Link erstellt – ${days} Tage gültig. Jetzt kopieren oder teilen.`, { link: `/sendung/${token}` });
    }
    case "link-widerrufen": {
      const linkId = String(fd.get("linkId") ?? "");
      const r = await db.update(L).set({ revokedAt: new Date() }).where(and(eq(L.tenantId, t), eq(L.shipmentId, id), eq(L.id, linkId), sql`${L.revokedAt} is null`)).returning({ id: L.id });
      if (!r.length) return { ok: false, message: "Link nicht gefunden oder schon zurückgezogen." };
      await logShipmentEvent(db, t, s, { kind: "link", text: "Kunden-Link zurückgezogen", internal: true }, actor);
      return done("Link zurückgezogen – er zeigt ab sofort nichts mehr an.");
    }
    case "dhl": {
      if (s.carrier !== "dhl" || !s.trackingNo) return { ok: false, message: "Nur für DHL-Sendungen mit Sendungsnummer." };
      const v = await getIntegration(t, "dhl_tracking");
      if (!v?.apiKey) return { ok: false, message: "DHL-Sendungsverfolgung ist nicht eingerichtet (Einstellungen → Anbindungen → „DHL Sendungsverfolgung“)." };
      const msg = await trackShipment(t, s, v.apiKey);
      return done(msg);
    }
    default:
      return { ok: false, message: "Unbekannte Aktion." };
  }
}

/** Meldungen als gelesen markieren (je Person). */
export async function markNoticesSeenAction() {
  const session = await requireArea("paletten");
  await markNoticesSeen(session);
  revalidatePath("/paletten", "layout");
}
