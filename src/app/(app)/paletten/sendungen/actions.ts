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
import { storePhotos } from "@/lib/pallets/photos";
import { canonicalCustomer, createShareLink, createShipmentRecord, logShipmentEvent, markNoticesSeen, setShipmentStatus, shiftShipment, trackShipment } from "@/lib/pallets/shipment-service";
import { LINK_DAYS, parseShipmentBase, type ShipmentBase } from "@/lib/pallets/shipments";

const S = schema.palletShipments;
const PH = schema.palletShipmentPhotos;
const L = schema.palletShipmentLinks;

export type ShipState = { ok: boolean; message: string; id?: string; link?: string } | null;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const txt = (fd: FormData, key: string, max: number) => String(fd.get(key) ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
const dateOf = (fd: FormData, key: string) => {
  const v = String(fd.get(key) ?? "").trim();
  return isoDate.safeParse(v).success ? v : null;
};
const who = (s: { userId: string; name?: string | null; email: string }) => ({ userId: s.userId, userName: s.name || s.email });

async function insertShipment(session: Awaited<ReturnType<typeof requireArea>>, fd: FormData): Promise<NonNullable<ShipState>> {
  const t = session.tenantId;
  const b = parseShipmentBase((k) => fd.get(k));
  if (typeof b === "string") return { ok: false, message: b };
  let photoIds: string[] = [];
  try {
    photoIds = await storePhotos(t, fd, "sendung.jpg");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Fotos konnten nicht gespeichert werden." };
  }
  const id = await createShipmentRecord(t, who(session), b, dateOf(fd, "plannedDate"), txt(fd, "plannedTime", 40), { ids: photoIds, shared: fd.get("photosShared") !== "off" });
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
      const r = await shiftShipment(t, actor, s, newDate, txt(fd, "plannedTime", 40), txt(fd, "reason", 200));
      return r.ok ? done(r.message) : r;
    }
    case "status": {
      const parsed = z.enum(SHIPMENT_STATUSES).safeParse(fd.get("status") ?? s.status);
      if (!parsed.success) return { ok: false, message: "Unbekannter Status." };
      const status: ShipmentStatus = parsed.data;
      const r = await setShipmentStatus(t, actor, s, status, fd.has("location") ? txt(fd, "location", 300) : s.location);
      return r.ok ? done(r.message) : r;
    }
    case "notiz": {
      const note = String(fd.get("text") ?? "").trim().slice(0, 600);
      if (!note) return { ok: false, message: "Bitte etwas eintragen." };
      await logShipmentEvent(db, t, s, { kind: "notiz", text: note, internal: true }, actor);
      return done("Notiz gespeichert (nur intern).");
    }
    case "bearbeiten": {
      const b = parseShipmentBase((k) => fd.get(k));
      if (typeof b === "string") return { ok: false, message: b };
      const customer = await canonicalCustomer(t, b.customer);
      const next = { ...b, customer };
      const labels: Record<keyof ShipmentBase, string> = { direction: "Richtung", title: "Bezeichnung", customer: "Kunde", place: "Von/Nach", carrier: "Spedition", carrierName: "Spedition", trackingNo: "Sendungsnummer", trackingUrl: "Verfolgungs-Link", palletCount: "Paletten", cartonCount: "Kartons", note: "Notiz" };
      const changed = [...new Set((Object.keys(next) as (keyof ShipmentBase)[]).filter((k) => (next[k] ?? null) !== (s[k] ?? null)).map((k) => labels[k]))];
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
