import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { senderMailboxes, sendMail } from "@/lib/mail/accounts";
import { signatureFor } from "@/lib/mail/signature";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { addDays, chargeableFrom, customerKey, lastMonths, monthRange, monthlyBill, palletOverview, palletReminders, ratesFor, type CustomerRates } from "./billing";
import type { PalletEventKind } from "@/db/tables/pallets";
import { buildStatementPdf, statementMail } from "./statement";

const P = schema.pallets;
const PC = schema.palletCustomers;
const CH = schema.palletCharges;
const ST = schema.palletStatements;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export function shiftMonth(m: string, delta: number): string {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Standard-Konditionen, Kunden mit eigenen Konditionen und die Zuordnung Kunde → Konditionen. */
export async function palletContext(tenantId: string) {
  const settings = (await getSettings(tenantId)).pallets;
  const customers = await db.select().from(PC).where(eq(PC.tenantId, tenantId)).orderBy(asc(PC.name));
  const overrides = new Map<string, CustomerRates>(customers.map((c) => [customerKey(c.name), c]));
  // Mit Monat: die Konditionen, die damals galten (Preisänderungen wirken nicht rückwirkend).
  return { settings, customers, overrides, ratesOf: (c: string | null, month?: string) => ratesFor(c, settings, overrides, month) };
}

/** Nicht stornierte Paletten (Fehlbuchungen bleiben mit Verlauf erhalten, zählen aber nirgends). */
export const notCancelled = isNull(P.cancelledAt);

/** Buchungsverlauf schreiben – je Palette ein Eintrag. */
export async function logPalletEvent(tenantId: string, palletIds: string[], kind: PalletEventKind, text: string, opts: { day?: string | null; userName?: string | null } = {}) {
  if (!palletIds.length) return;
  await db.insert(schema.palletEvents).values(palletIds.map((palletId) => ({ tenantId, palletId, kind, text: text.slice(0, 500), day: opts.day ?? null, userName: opts.userName ?? null })));
}

/** Verlauf einer Palette, neueste zuerst. */
export async function palletHistory(tenantId: string, palletId: string) {
  return db.select().from(schema.palletEvents).where(and(eq(schema.palletEvents.tenantId, tenantId), eq(schema.palletEvents.palletId, palletId))).orderBy(desc(schema.palletEvents.createdAt));
}
export type PalletContext = Awaited<ReturnType<typeof palletContext>>;

/** Zusatzleistungen im Zeitraum, mit Palettennummer. */
async function loadCharges(tenantId: string, from: string, to: string) {
  return db
    .select({ id: CH.id, customer: CH.customer, day: CH.day, description: CH.description, quantity: CH.quantity, unitPrice: CH.unitPrice, palletId: CH.palletId, palletCode: P.code })
    .from(CH)
    .leftJoin(P, eq(P.id, CH.palletId))
    .where(and(eq(CH.tenantId, tenantId), gte(CH.day, from), lte(CH.day, to)))
    .orderBy(CH.day, CH.createdAt);
}

/**
 * Alle Paletten, die im Monat irgendwann eingelagert waren, und alle Leistungen – Abrechnung je Kunde,
 * mit den Konditionen, die in diesem Monat galten. `asOf`: nur bis zu diesem Tag Angefallenes.
 */
export async function loadMonthBill(tenantId: string, month: string, ctx?: PalletContext, opts: { asOf?: string } = {}) {
  const c = ctx ?? (await palletContext(tenantId));
  const { first, last } = monthRange(month);
  const rows = await db
    .select()
    .from(P)
    .where(and(eq(P.tenantId, tenantId), notCancelled, lte(P.inAt, last), or(isNull(P.outAt), gte(P.outAt, first))))
    .orderBy(P.customer, P.inAt, P.code);
  const charges = await loadCharges(tenantId, first, last);
  const ratesOf = (x: string | null) => c.ratesOf(x, month);
  return { rates: c.settings, ratesOf, ...monthlyBill(rows, month, ratesOf, charges, opts) };
}
export type MonthBill = Awaited<ReturnType<typeof loadMonthBill>>;

/** Zuletzt gesendete Monatsaufstellungen eines Monats je Kunde. */
export async function statementsFor(tenantId: string, month: string) {
  const rows = await db.select().from(ST).where(and(eq(ST.tenantId, tenantId), eq(ST.month, month)));
  return new Map(rows.map((r) => [customerKey(r.customer), r]));
}

async function recordStatement(tenantId: string, customer: string, month: string, patch: Partial<typeof ST.$inferInsert>) {
  const [row] = await db.select({ id: ST.id }).from(ST).where(and(eq(ST.tenantId, tenantId), eq(ST.month, month), sql`lower(${ST.customer}) = ${customerKey(customer)}`));
  if (row) await db.update(ST).set(patch).where(eq(ST.id, row.id));
  else await db.insert(ST).values({ tenantId, customer, month, ...patch });
}

/** Monatsaufstellung (PDF) eines Kunden per Mail – über das Standard-Postfach. */
export async function sendStatement(tenantId: string, customer: string, month: string, opts: { auto?: boolean; today: string }): Promise<{ ok: boolean; message: string }> {
  const ctx = await palletContext(tenantId);
  const cust = ctx.customers.find((c) => customerKey(c.name) === customerKey(customer));
  const to = cust?.email?.trim();
  if (!to) return { ok: false, message: `Für „${customer}“ ist keine E-Mail-Adresse hinterlegt (Paletten-Lager → Kunden).` };
  const bill = await loadMonthBill(tenantId, month, ctx);
  const group = bill.groups.find((g) => customerKey(g.customer) === customerKey(customer));
  if (!group || group.total <= 0) return { ok: false, message: `Für „${customer}“ ist im ${monthLabel(month)} nichts abzurechnen.` };
  const s = await getSettings(tenantId);
  const sender = { name: s.shipper.name1, street: s.shipper.street, houseNo: s.shipper.houseNo, zip: s.shipper.zip, city: s.shipper.city, email: s.shipper.email, phone: s.shipper.phone };
  const { boxes, defaultId } = await senderMailboxes(tenantId);
  const box = boxes.find((b) => b.id === defaultId);
  const mail = statementMail({ customer: group.customer, month, group, company: s.shipper.name1, signature: signatureFor(box?.signature, "de") });
  try {
    const pdf = await buildStatementPdf({ sender, month, group, today: opts.today, vat: { rate: s.vatRate, pricesAre: ctx.settings.pricesAre ?? "netto" } });
    await sendMail(tenantId, { to, subject: mail.subject, text: mail.text, attachments: [{ filename: mail.filename, content: pdf, contentType: "application/pdf" }] });
    await recordStatement(tenantId, group.customer, month, { recipient: to, total: group.total, sentAt: new Date(), auto: Boolean(opts.auto), error: null });
    return { ok: true, message: `Aufstellung ${monthLabel(month)} an ${to} gesendet.` };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await recordStatement(tenantId, group.customer, month, { recipient: to, total: group.total, auto: Boolean(opts.auto), error: error.slice(0, 500) });
    return { ok: false, message: `Senden an ${to} ging nicht: ${error}` };
  }
}

/**
 * Monatsanfang (Tag 1–7): Aufstellung des Vormonats an alle Kunden mit „automatisch senden“,
 * die noch keine bekommen haben. Fehler landen als Aufgabe.
 */
export async function autoSendStatements(tenantId: string, today: string) {
  if (Number(today.slice(8, 10)) > 7) return 0;
  const month = shiftMonth(today.slice(0, 7), -1);
  const ctx = await palletContext(tenantId);
  const due = ctx.customers.filter((c) => c.monthlyMail && c.email?.trim());
  if (!due.length) return 0;
  const sent = await statementsFor(tenantId, month);
  const bill = await loadMonthBill(tenantId, month, ctx);
  let n = 0;
  for (const c of due) {
    const key = customerKey(c.name);
    if (sent.get(key)?.sentAt) continue;
    const group = bill.groups.find((g) => customerKey(g.customer) === key);
    if (!group || group.total <= 0) continue;
    const res = await sendStatement(tenantId, c.name, month, { auto: true, today });
    const taskKey = `pallet-mail:${key}:${month}`;
    if (res.ok) {
      n++;
      await resolveSystemTask(db, tenantId, taskKey);
    } else {
      await upsertSystemTask(db, tenantId, taskKey, { title: `Paletten: Monatsaufstellung ${monthLabel(month)} an ${c.name} nicht gesendet`, notes: res.message, priority: "normal", category: "system", link: `/paletten/abrechnung?monat=${month}` });
    }
  }
  return n;
}

/** Erinnerungen als Aufgaben: freie Lagerzeit endet heute/morgen, Paletten stehen sehr lange. */
export async function refreshPalletReminders(tenantId: string, today: string) {
  const ctx = await palletContext(tenantId);
  const open = await db.select().from(P).where(and(eq(P.tenantId, tenantId), isNull(P.outAt), notCancelled));
  const s = ctx.settings;
  const r = palletReminders(open, today, ctx.ratesOf, { longStayDays: s.longStayDays, remindFreeEnd: s.remindFreeEnd });
  const link = (customer: string) => `/paletten?kunde=${encodeURIComponent(customer)}#lager`;
  for (const e of r.freeEnd) {
    await upsertSystemTask(db, tenantId, `pallet-free:${customerKey(e.customer)}:${e.lastFreeDay}`, {
      title: `Paletten ${e.customer}: freie Lagerzeit endet am ${dmy(e.lastFreeDay)} (${e.codes.length} Palette${e.codes.length === 1 ? "" : "n"})`,
      notes: `Ab ${dmy(addDays(e.lastFreeDay, 1))} kostenpflichtig: ${e.codes.join(", ")}`,
      priority: "normal",
      category: "system",
      link: e.customer === "Ohne Kunde" ? "/paletten#lager" : link(e.customer),
      dueDate: e.lastFreeDay,
    });
  }
  // Freie-Zeit-Erinnerungen erledigen sich, wenn alle betroffenen Paletten weg sind.
  const openFree = await db
    .select({ key: schema.tasks.systemKey })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.status, "open"), like(schema.tasks.systemKey, "pallet-free:%")));
  for (const t of openFree) {
    const m = /^pallet-free:(.*):(\d{4}-\d{2}-\d{2})$/.exec(t.key ?? "");
    if (!m) continue;
    const still = open.some((p) => customerKey(p.customer?.trim() || "Ohne Kunde") === m[1] && addDays(chargeableFrom(p.inAt, ctx.ratesOf(p.customer).freeDays), -1) === m[2]);
    if (!still) await resolveSystemTask(db, tenantId, t.key!);
  }

  const longKeys = new Set<string>();
  for (const e of r.longStay) {
    const key = `pallet-long:${customerKey(e.customer)}`;
    longKeys.add(key);
    await upsertSystemTask(db, tenantId, key, {
      title: `Paletten ${e.customer}: ${e.codes.length} Palette${e.codes.length === 1 ? "" : "n"} seit über ${s.longStayDays} Tagen im Lager`,
      notes: `Längste Standzeit ${e.maxDays} Tage: ${e.codes.join(", ")}`,
      priority: "low",
      category: "system",
      link: e.customer === "Ohne Kunde" ? "/paletten#lager" : link(e.customer),
    });
  }
  const openLong = await db
    .select({ key: schema.tasks.systemKey })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.status, "open"), like(schema.tasks.systemKey, "pallet-long:%")));
  for (const t of openLong) if (t.key && !longKeys.has(t.key)) await resolveSystemTask(db, tenantId, t.key);
  return r.freeEnd.length + r.longStay.length;
}

/** Auslastung und Umsatz der letzten 12 Monate. */
export async function loadOverview(tenantId: string, today: string, n = 12) {
  const ctx = await palletContext(tenantId);
  const months = lastMonths(today.slice(0, 7), n);
  const { first } = monthRange(months[0]);
  const rows = await db.select().from(P).where(and(eq(P.tenantId, tenantId), notCancelled, lte(P.inAt, today), or(isNull(P.outAt), gte(P.outAt, first))));
  const charges = await loadCharges(tenantId, first, monthRange(months[months.length - 1]).last);
  return { ...palletOverview(rows, charges, months, (c, m) => ctx.ratesOf(c, m), today), capacity: ctx.settings.capacity };
}

/** Fotos von Paletten (Datei-IDs je Palette). */
export async function palletPhotos(tenantId: string, palletIds: string[]) {
  if (!palletIds.length) return new Map<string, string[]>();
  const rows = await db
    .select({ palletId: schema.palletPhotos.palletId, fileId: schema.palletPhotos.fileId })
    .from(schema.palletPhotos)
    .where(and(eq(schema.palletPhotos.tenantId, tenantId), inArray(schema.palletPhotos.palletId, palletIds)))
    .orderBy(schema.palletPhotos.createdAt);
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.palletId, [...(out.get(r.palletId) ?? []), r.fileId]);
  return out;
}

/** Dateien löschen, auf die kein Palettenfoto mehr zeigt. */
export async function dropOrphanPhotoFiles(tenantId: string, fileIds: string[]) {
  if (!fileIds.length) return;
  const still = await db.select({ fileId: schema.palletPhotos.fileId }).from(schema.palletPhotos).where(and(eq(schema.palletPhotos.tenantId, tenantId), inArray(schema.palletPhotos.fileId, fileIds)));
  const keep = new Set(still.map((r) => r.fileId));
  const drop = fileIds.filter((id) => !keep.has(id));
  if (drop.length) await db.delete(schema.files).where(and(eq(schema.files.tenantId, tenantId), inArray(schema.files.id, drop)));
}
