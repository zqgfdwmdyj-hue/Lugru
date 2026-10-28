import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "@/db";
import type { ShipmentEventKind, ShipmentStatus } from "@/db/schema";
import { canAccess } from "@/lib/auth/areas";
import { getPrefs, updatePrefs } from "@/lib/auth/prefs";
import { getIntegration } from "@/lib/integrations/store";
import { trackDhl } from "@/lib/integrations/clients/dhl-tracking";
import { sendMail } from "@/lib/mail/accounts";
import { appUrl } from "@/lib/oauth/state";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { carrierLabel, dmy, isOpen, isOverdue, linkExpiry, trackingUpdate, type Direction } from "./shipments";

const S = schema.palletShipments;
const E = schema.palletShipmentEvents;
const PH = schema.palletShipmentPhotos;
const L = schema.palletShipmentLinks;

export type Shipment = typeof S.$inferSelect;
export type ShipmentEvent = typeof E.$inferSelect;
type Actor = { userId: string | null; userName: string | null };

/** Offene Sendungen und die erledigten der letzten 60 Tage. */
export async function loadShipments(tenantId: string) {
  const since = new Date(Date.now() - 60 * 86400_000);
  return db
    .select()
    .from(S)
    .where(and(eq(S.tenantId, tenantId), or(inArray(S.status, ["geplant", "unterwegs", "verzoegert", "problem"]), gt(S.updatedAt, since))))
    .orderBy(S.plannedDate, desc(S.createdAt))
    .limit(500);
}

export async function loadShipment(tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [s] = await db.select().from(S).where(and(eq(S.tenantId, tenantId), eq(S.id, id)));
  if (!s) return null;
  const [events, photos, links] = await Promise.all([
    db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.shipmentId, id))).orderBy(desc(E.createdAt)),
    db.select().from(PH).where(and(eq(PH.tenantId, tenantId), eq(PH.shipmentId, id))).orderBy(PH.createdAt),
    db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.shipmentId, id))).orderBy(desc(L.createdAt)),
  ]);
  return { shipment: s, events, photos, links };
}

/**
 * Eintrag im Verlauf. Meldungen (`notice`) sehen alle mit Zugriff aufs Palettenlager als Hinweis; ist
 * es eingestellt, gehen sie zusätzlich per E-Mail raus (nicht an den, der es eingetragen hat).
 */
export async function logShipmentEvent(
  conn: Db | Tx,
  tenantId: string,
  shipment: Pick<Shipment, "id" | "title" | "direction">,
  ev: { kind: ShipmentEventKind; text: string; notice?: boolean; internal?: boolean; oldDate?: string | null; newDate?: string | null; status?: ShipmentStatus | null },
  actor: Actor,
) {
  await conn.insert(E).values({
    tenantId,
    shipmentId: shipment.id,
    kind: ev.kind,
    text: ev.text.slice(0, 600),
    oldDate: ev.oldDate ?? null,
    newDate: ev.newDate ?? null,
    status: ev.status ?? null,
    notice: ev.notice ?? false,
    internal: ev.internal ?? false,
    userId: actor.userId,
    userName: actor.userName,
  });
  if (ev.notice) void mailNotice(tenantId, shipment, ev.text, actor.userId);
}

/** Alle, die das Palettenlager sehen dürfen (ohne Nur-ansehen-Konten). */
export async function palletMembers(tenantId: string) {
  const rows = await db
    .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.memberships.role, areas: schema.memberships.areas, readOnly: schema.memberships.readOnly })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.tenantId, tenantId));
  return rows.filter((r) => !r.readOnly && canAccess({ role: r.role, areas: r.areas ?? null }, "paletten"));
}

async function mailNotice(tenantId: string, shipment: Pick<Shipment, "id" | "title" | "direction">, text: string, actorId: string | null) {
  try {
    const s = await getSettings(tenantId);
    if (!s.pallets.shipmentMail) return;
    const to = (await palletMembers(tenantId)).filter((m) => m.userId !== actorId && m.email).map((m) => m.email);
    if (!to.length) return;
    const kind = shipment.direction === "ein" ? "Anlieferung" : "Versand";
    await sendMail(tenantId, {
      to: to.join(", "),
      subject: `Paletten-Lager · ${kind}: ${shipment.title}`.slice(0, 180),
      text: `${text}\n\nSendung ansehen: ${appUrl()}/paletten/sendungen/${shipment.id}\n\n(Automatische Meldung aus dem Seller-System – an alle mit Zugriff aufs Palettenlager.)`,
    });
  } catch (e) {
    console.error("[Paletten-Sendungen] Meldung per E-Mail fehlgeschlagen:", e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Meldungen für alle mit Paletten-Zugriff (Hinweis oben im Palettenlager + Zähler in der Seitenleiste)

const NOTICE_WINDOW_MS = 14 * 86400_000;

/** Ungelesene Meldungen der anderen (eigene Einträge zählen nicht). */
export async function unreadNotices(session: { tenantId: string; userId: string }, seenAt?: string | null, limit = 12) {
  const seen = seenAt === undefined ? (await getPrefs(session)).shipmentNoticesSeenAt : seenAt;
  const floor = new Date(Math.max(Date.now() - NOTICE_WINDOW_MS, seen ? Date.parse(seen) || 0 : 0));
  const where = and(eq(E.tenantId, session.tenantId), eq(E.notice, true), gt(E.createdAt, floor), or(isNull(E.userId), sql`${E.userId} <> ${session.userId}`));
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({ id: E.id, shipmentId: E.shipmentId, text: E.text, kind: E.kind, createdAt: E.createdAt, userName: E.userName, title: S.title, direction: S.direction })
      .from(E)
      .innerJoin(S, eq(S.id, E.shipmentId))
      .where(where)
      .orderBy(desc(E.createdAt))
      .limit(limit),
    db.select({ n: sql<number>`count(*)::int` }).from(E).where(where),
  ]);
  return { items: rows, count: n };
}

export async function markNoticesSeen(session: { tenantId: string; userId: string }) {
  await updatePrefs(session, (p) => ({ ...p, shipmentNoticesSeenAt: new Date().toISOString() }));
}

// ---------------------------------------------------------------------------------------------------------
// Kunden-Links

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createShareLink(tenantId: string, shipmentId: string, opts: { days: number; showPhotos: boolean; userId: string | null }) {
  const token = randomBytes(18).toString("base64url");
  await db.insert(L).values({ tenantId, shipmentId, tokenHash: hashToken(token), token, expiresAt: linkExpiry(opts.days), showPhotos: opts.showPhotos, createdBy: opts.userId });
  return token;
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;

/** Gültiger Link → Sendung mit dem, was der Kunde sehen darf. Abgelaufen/widerrufen → null. */
export async function resolveShareLink(token: string, opts: { count?: boolean } = {}) {
  if (!TOKEN_RE.test(token)) return null;
  const [link] = await db.select().from(L).where(eq(L.tokenHash, hashToken(token)));
  if (!link || link.revokedAt || link.expiresAt.getTime() < Date.now()) return null;
  const [s] = await db.select().from(S).where(and(eq(S.tenantId, link.tenantId), eq(S.id, link.shipmentId)));
  if (!s) return null;
  const [events, photos, [tenant]] = await Promise.all([
    db.select().from(E).where(and(eq(E.tenantId, link.tenantId), eq(E.shipmentId, s.id), eq(E.internal, false))).orderBy(desc(E.createdAt)).limit(100),
    link.showPhotos ? db.select({ fileId: PH.fileId }).from(PH).where(and(eq(PH.tenantId, link.tenantId), eq(PH.shipmentId, s.id), eq(PH.shared, true))).orderBy(PH.createdAt) : Promise.resolve([]),
    db.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, link.tenantId)),
  ]);
  if (opts.count) await db.update(L).set({ views: sql`${L.views} + 1`, lastViewedAt: new Date() }).where(eq(L.id, link.id));
  return { link, shipment: s, events, photos: photos.map((p) => p.fileId), sender: tenant?.name ?? "" };
}

// ---------------------------------------------------------------------------------------------------------
// Hintergrund: überfällige Sendungen melden, DHL-Sendungen automatisch verfolgen

const TRACK_EVERY_MS = 3 * 3600_000;
const TRACK_MAX_PER_RUN = 8;
const SYSTEM: Actor = { userId: null, userName: "System" };

/** Eine DHL-Sendung abfragen und Änderungen übernehmen. Gibt eine kurze Beschreibung zurück. */
export async function trackShipment(tenantId: string, s: Shipment, apiKey: string): Promise<string> {
  try {
    const t = await trackDhl(apiKey, s.trackingNo!);
    if (!t) {
      await db.update(S).set({ trackedAt: new Date(), trackError: "DHL kennt die Nummer (noch) nicht." }).where(and(eq(S.tenantId, tenantId), eq(S.id, s.id)));
      return "DHL kennt die Nummer (noch) nicht – oft erst nach der Abholung.";
    }
    const u = trackingUpdate({ status: s.status, location: s.location, plannedDate: s.plannedDate, direction: s.direction }, t);
    await db.transaction(async (tx) => {
      await tx
        .update(S)
        .set({
          trackedAt: new Date(),
          trackError: null,
          ...(u.status ? { status: u.status } : {}),
          ...(u.location ? { location: u.location } : {}),
          ...(u.plannedDate ? { plannedDate: u.plannedDate, firstDate: s.firstDate ?? s.plannedDate ?? u.plannedDate } : {}),
          ...(u.deliveredAt ? { deliveredAt: u.deliveredAt } : {}),
          ...(u.status || u.location || u.plannedDate ? { updatedAt: new Date() } : {}),
        })
        .where(and(eq(S.tenantId, tenantId), eq(S.id, s.id)));
      for (const ev of u.events) await logShipmentEvent(tx, tenantId, s, ev, SYSTEM);
    });
    return u.events.length ? u.events.map((e) => e.text).join(" · ") : `Keine Änderung (${t.text || "Stand bei DHL unverändert"}).`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(S).set({ trackedAt: new Date(), trackError: msg.slice(0, 300) }).where(and(eq(S.tenantId, tenantId), eq(S.id, s.id)));
    return msg;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stündlich aus dem Hintergrund: Überfälliges melden (einmal je Termin), DHL abfragen, Aufgaben pflegen. */
export async function refreshShipments(tenantId: string, today: string) {
  const open = await db.select().from(S).where(and(eq(S.tenantId, tenantId), inArray(S.status, ["geplant", "unterwegs", "verzoegert", "problem"])));

  // DHL-Sendungen verfolgen (wenn angebunden) – sparsam, das Kontingent ist klein.
  const dhl = await getIntegration(tenantId, "dhl_tracking");
  if (dhl?.apiKey) {
    const due = open.filter((s) => s.carrier === "dhl" && s.trackingNo && (!s.trackedAt || Date.now() - s.trackedAt.getTime() > TRACK_EVERY_MS)).slice(0, TRACK_MAX_PER_RUN);
    for (const [i, s] of due.entries()) {
      if (i > 0) await sleep(process.env.DHL_TRACKING_BASE_URL ? 50 : 5_000);
      await trackShipment(tenantId, s, dhl.apiKey);
    }
  }

  const fresh = open.length ? await db.select().from(S).where(and(eq(S.tenantId, tenantId), inArray(S.id, open.map((s) => s.id)))) : [];
  const byId = new Map(fresh.map((s) => [s.id, s]));
  let late = 0;
  for (const s0 of open) {
    const s = byId.get(s0.id) ?? s0;
    const key = `pallet-ship:${s.id}`;
    const overdue = isOverdue(s, today);
    if (overdue) {
      late++;
      const [already] = await db
        .select({ id: E.id })
        .from(E)
        .where(and(eq(E.tenantId, tenantId), eq(E.shipmentId, s.id), eq(E.kind, "ueberfaellig"), eq(E.newDate, s.plannedDate!)))
        .limit(1);
      if (!already) {
        const what = s.direction === "ein" ? "noch nicht als angekommen gebucht" : "noch nicht als zugestellt gemeldet";
        await logShipmentEvent(db, tenantId, s, { kind: "ueberfaellig", text: `Termin ${dmy(s.plannedDate!)} überschritten – ${what}. Bitte beim Spediteur nachfragen und neuen Termin eintragen.`, notice: true, internal: true, newDate: s.plannedDate }, SYSTEM);
      }
    }
    if (isOpen(s.status) && (overdue || s.status === "problem")) {
      const kind = s.direction === "ein" ? "Anlieferung" : "Versand";
      await upsertSystemTask(db, tenantId, key, {
        title: s.status === "problem" ? `Paletten-${kind} mit Problem: ${s.title}` : `Paletten-${kind} überfällig: ${s.title} (erwartet ${dmy(s.plannedDate!)})`,
        notes: [carrierLabel(s.carrier, s.carrierName), s.trackingNo ? `Nr. ${s.trackingNo}` : null, s.location].filter(Boolean).join(" · ") || null,
        priority: "normal",
        category: "system",
        link: `/paletten/sendungen/${s.id}`,
      });
    } else {
      await resolveSystemTask(db, tenantId, key);
    }
  }
  // Aufgaben zu inzwischen erledigten Sendungen schließen.
  const closed = await db
    .select({ id: S.id })
    .from(S)
    .where(and(eq(S.tenantId, tenantId), inArray(S.status, ["zugestellt", "storniert"]), gt(S.updatedAt, new Date(Date.now() - 30 * 86400_000))));
  for (const c of closed) await resolveSystemTask(db, tenantId, `pallet-ship:${c.id}`);
  return late;
}

export function noticeTitle(n: { direction: Direction; title: string }) {
  return `${n.direction === "ein" ? "Anlieferung" : "Versand"}: ${n.title}`;
}
