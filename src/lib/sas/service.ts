import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { skuCostMap } from "@/lib/money/costs";
import { storeFile } from "@/lib/orders/service";
import { brandFacts, brandKey, brandSnippet, dealCalc, FAHRPLAN, parseBrandList, suggestBrands, type DealRow, type DealResult, type SasModule, type SasWaiting } from "./logic";

// Amazon SAS-Programm: Stand, Aufgaben (gekoppelt an die normalen Aufgaben), Marken, Deals, Unterlagen.

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const P = schema.sasProgram;
const I = schema.sasItems;
const T = schema.tasks;
const B = schema.sasBrands;
const D = schema.sasDeals;

export type SasProgram = typeof schema.sasProgram.$inferSelect;

export async function getProgram(tenantId: string): Promise<SasProgram> {
  const [row] = await db.select().from(P).where(eq(P.tenantId, tenantId));
  if (row) return row;
  // Standard: Black-Week-Frist 6. November des laufenden Jahres (laut Programm), noch kein Termin.
  const year = todayIso().slice(0, 4);
  const [created] = await db.insert(P).values({ tenantId, dealDeadline: `${year}-11-06` }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(P).where(eq(P.tenantId, tenantId)))[0];
}

export async function saveProgram(tenantId: string, v: Partial<Pick<SasProgram, "consultantName" | "consultantEmail" | "pstamName" | "nextMeeting" | "dealDeadline" | "notes">>) {
  await getProgram(tenantId);
  await db.update(P).set({ ...v, updatedAt: new Date() }).where(eq(P.tenantId, tenantId));
  // Fälligkeiten im Fahrplan nachziehen (nur offene, nur wo der Schritt davon abhängt).
  const prog = await getProgram(tenantId);
  for (const step of FAHRPLAN.filter((s) => s.key === "bw-einreichen" || s.key === "termin-bp")) {
    const due = step.due({ today: todayIso(), dealDeadline: prog.dealDeadline, nextMeeting: prog.nextMeeting });
    const [item] = await db.select({ taskId: I.taskId }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.templateKey, step.key)));
    if (item) await db.update(T).set({ dueDate: due }).where(and(eq(T.tenantId, tenantId), eq(T.id, item.taskId), eq(T.status, "open")));
  }
}

// ---- Aufgaben

export type SasItem = { taskId: string; title: string; notes: string | null; dueDate: string | null; priority: string; status: string; module: SasModule; waitingOn: SasWaiting; templateKey: string | null; sortOrder: number };

export async function loadItems(tenantId: string): Promise<SasItem[]> {
  return db
    .select({ taskId: I.taskId, title: T.title, notes: T.notes, dueDate: T.dueDate, priority: T.priority, status: T.status, module: I.module, waitingOn: I.waitingOn, templateKey: I.templateKey, sortOrder: I.sortOrder })
    .from(I)
    .innerJoin(T, and(eq(T.id, I.taskId), eq(T.tenantId, tenantId)))
    .where(eq(I.tenantId, tenantId))
    .orderBy(asc(I.sortOrder), asc(T.createdAt));
}

async function insertItem(tenantId: string, v: { title: string; notes?: string | null; dueDate?: string | null; priority?: "critical" | "normal" | "low"; module: SasModule; waitingOn: SasWaiting; templateKey?: string | null; sortOrder?: number }) {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .insert(T)
      .values({ tenantId, title: v.title, notes: v.notes ?? null, dueDate: v.dueDate ?? null, priority: v.priority ?? "normal", category: "amazon", link: "/sas?tab=aufgaben" })
      .returning({ id: T.id });
    await tx.insert(I).values({ taskId: task.id, tenantId, module: v.module, waitingOn: v.waitingOn, templateKey: v.templateKey ?? null, sortOrder: v.sortOrder ?? 100 });
    return task.id;
  });
}

/** Fehlende Schritte des Standard-Fahrplans als Aufgaben anlegen (vorhandene bleiben, wie sie sind). */
export async function createFahrplan(tenantId: string): Promise<number> {
  const prog = await getProgram(tenantId);
  const have = new Set((await db.select({ k: I.templateKey }).from(I).where(and(eq(I.tenantId, tenantId), isNotNull(I.templateKey)))).map((r) => r.k));
  let n = 0;
  for (const [i, s] of FAHRPLAN.entries()) {
    if (have.has(s.key)) continue;
    await insertItem(tenantId, { title: s.title, notes: s.notes, dueDate: s.due({ today: todayIso(), dealDeadline: prog.dealDeadline, nextMeeting: prog.nextMeeting }), priority: s.priority, module: s.module, waitingOn: s.waitingOn, templateKey: s.key, sortOrder: i });
    n++;
  }
  return n;
}

export async function addItem(tenantId: string, v: { title: string; notes: string | null; dueDate: string | null; module: SasModule; waitingOn: SasWaiting }) {
  return insertItem(tenantId, { ...v, sortOrder: 200 });
}

export async function updateItem(tenantId: string, taskId: string, v: { module?: SasModule; waitingOn?: SasWaiting; dueDate?: string | null; done?: boolean }) {
  const [own] = await db.select({ id: I.taskId }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.taskId, taskId)));
  if (!own) return;
  if (v.module || v.waitingOn) await db.update(I).set({ ...(v.module ? { module: v.module } : {}), ...(v.waitingOn ? { waitingOn: v.waitingOn } : {}) }).where(and(eq(I.tenantId, tenantId), eq(I.taskId, taskId)));
  if (v.dueDate !== undefined || v.done !== undefined)
    await db
      .update(T)
      .set({ ...(v.dueDate !== undefined ? { dueDate: v.dueDate } : {}), ...(v.done !== undefined ? { status: v.done ? ("done" as const) : ("open" as const), completedAt: v.done ? new Date() : null } : {}) })
      .where(and(eq(T.tenantId, tenantId), eq(T.id, taskId)));
}

async function templateTask(tenantId: string, key: string) {
  const [r] = await db.select({ taskId: I.taskId }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.templateKey, key)));
  return r?.taskId ?? null;
}

// ---- Marken

export async function importBrands(tenantId: string, values: string[]): Promise<{ added: number; total: number }> {
  const brands = parseBrandList(values);
  let added = 0;
  for (const b of brands) {
    const r = await db.insert(B).values({ tenantId, brand: b, brandKey: brandKey(b) }).onConflictDoNothing().returning({ id: B.id });
    added += r.length;
  }
  await recomputeBrandFacts(tenantId);
  return { added, total: brands.length };
}

/** Kennzahlen je Marke neu berechnen (Produkte/Umsatz laut sellerboard, Belege, Lieferanten-Angebote). */
export async function recomputeBrandFacts(tenantId: string) {
  const brands = await db.select().from(B).where(eq(B.tenantId, tenantId));
  if (!brands.length) return 0;
  const [products, stats, invoices, offers] = await Promise.all([
    db.select({ name: schema.sellerboardProducts.name }).from(schema.sellerboardProducts).where(eq(schema.sellerboardProducts.tenantId, tenantId)),
    db.select({ name: schema.sellerboardSkuStats.name, sales: schema.sellerboardSkuStats.sales, units: schema.sellerboardSkuStats.units }).from(schema.sellerboardSkuStats).where(eq(schema.sellerboardSkuStats.tenantId, tenantId)),
    // Nur echte Rechnungen (keine AGB, Werbung, Bestätigungen …) und nichts Aussortiertes.
    db.select({ text: schema.invoices.textExcerpt, vendor: schema.invoices.vendor }).from(schema.invoices).where(and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.docType, "rechnung"), ne(schema.invoices.status, "ignored"))),
    db.select({ title: schema.supplierOffers.title }).from(schema.supplierOffers).where(eq(schema.supplierOffers.tenantId, tenantId)),
  ]);
  const facts = brandFacts(
    brands.map((b) => b.brand),
    { products, stats, invoices: invoices.map((i) => ({ text: `${i.vendor ?? ""} ${i.text ?? ""}` })), offers },
  );
  const now = new Date();
  for (const b of brands) {
    const f = facts.get(b.brandKey);
    await db
      .update(B)
      .set({ products: f?.products ?? 0, sales30: String(f?.sales30 ?? 0), units30: f?.units30 ?? 0, invoices: f?.invoices ?? 0, supplierOffers: f?.supplierOffers ?? 0, computedAt: now })
      .where(and(eq(B.tenantId, tenantId), eq(B.id, b.id)));
  }
  return brands.length;
}

export type SasBrand = typeof schema.sasBrands.$inferSelect;

/** Kennzahlen neu rechnen, wenn der letzte Stand älter als 12 Stunden ist (Umsätze und Belege ändern sich täglich). */
export async function refreshBrandFactsIfStale(tenantId: string) {
  const [r] = await db.select({ at: sql<Date | null>`min(${B.computedAt})`, n: sql<number>`count(*)::int` }).from(B).where(eq(B.tenantId, tenantId));
  if (!r?.n) return false;
  if (r.at && Date.now() - new Date(r.at).getTime() < 12 * 3_600_000) return false;
  await recomputeBrandFacts(tenantId);
  return true;
}

/** Woher der 30-Tage-Umsatz kommt und ob überhaupt Daten da sind (sellerboard, je Produkt). */
export async function salesCoverage(tenantId: string) {
  const S = schema.sellerboardSkuStats;
  const [r] = await db
    .select({ rows: sql<number>`count(*)::int`, named: sql<number>`count(${S.name})::int`, withSales: sql<number>`count(*) filter (where coalesce(${S.sales}, 0) > 0)::int`, from: sql<string | null>`min(${S.fromDay})::text`, to: sql<string | null>`max(${S.toDay})::text`, synced: sql<Date | null>`max(${S.syncedAt})` })
    .from(S)
    .where(eq(S.tenantId, tenantId));
  return { rows: r?.rows ?? 0, named: r?.named ?? 0, withSales: r?.withSales ?? 0, from: r?.from ?? null, to: r?.to ?? null, synced: r?.synced ? new Date(r.synced) : null };
}

/** Belege, in denen die Marke vorkommt – mit Ausschnitt zum Nachprüfen (Bankdaten/Fußzeilen ausgenommen). */
export async function brandEvidence(tenantId: string, brandId: string) {
  const [b] = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.id, brandId)));
  if (!b) return null;
  const I = schema.invoices;
  const rows = await db
    .select({ id: I.id, vendor: I.vendor, fileName: I.fileName, invoiceDate: I.invoiceDate, invoiceNumber: I.invoiceNumber, totalGross: I.totalGross, text: I.textExcerpt })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), eq(I.docType, "rechnung"), ne(I.status, "ignored")))
    .orderBy(desc(I.invoiceDate));
  const hits = rows
    .map((r) => ({ ...r, snippet: brandSnippet(b.brand, `${r.vendor ?? ""} ${r.text ?? ""}`) }))
    .filter((r) => r.snippet)
    .map(({ text: _t, ...r }) => r);
  return { brand: b, hits: hits.slice(0, 60), total: hits.length };
}

export async function loadBrands(tenantId: string): Promise<SasBrand[]> {
  return db.select().from(B).where(eq(B.tenantId, tenantId)).orderBy(asc(B.brand));
}

/** Marke an-/abwählen; höchstens 10 im Piloten. */
export async function selectBrand(tenantId: string, id: string, selected: boolean): Promise<string | null> {
  if (selected) {
    const n = (await db.select({ id: B.id }).from(B).where(and(eq(B.tenantId, tenantId), eq(B.selected, true)))).length;
    if (n >= 10) return "Schon 10 Marken ausgewählt – für den Piloten sind es zehn. Erst eine abwählen.";
  }
  await db.update(B).set({ selected, status: selected ? "ausgewaehlt" : "offen" }).where(and(eq(B.tenantId, tenantId), eq(B.id, id), inArray(B.status, ["offen", "ausgewaehlt"])));
  return null;
}

/** Vorschlag übernehmen: 10 Marken mit Belegen und Umsatz. Schon eingereichte bleiben unberührt. */
export async function applyBrandSuggestion(tenantId: string): Promise<number> {
  const all = await loadBrands(tenantId);
  const fixed = all.filter((b) => !["offen", "ausgewaehlt"].includes(b.status));
  const pick = suggestBrands(all.filter((b) => ["offen", "ausgewaehlt"].includes(b.status)).map((b) => ({ ...b, sales30: b.sales30 === null ? null : Number(b.sales30) })), Math.max(0, 10 - fixed.filter((b) => b.selected).length));
  await db.update(B).set({ selected: false, status: "offen" }).where(and(eq(B.tenantId, tenantId), eq(B.status, "ausgewaehlt")));
  if (pick.length) await db.update(B).set({ selected: true, status: "ausgewaehlt" }).where(and(eq(B.tenantId, tenantId), inArray(B.id, pick.map((p) => p.id))));
  return pick.length;
}

/** Auswahl an den Consultant geschickt: Marken „eingereicht“, Fahrplan weiter (Appeal-Mail in ~2 Wochen). */
export async function markPilotSubmitted(tenantId: string) {
  const today = todayIso();
  await getProgram(tenantId);
  await db.update(P).set({ pilotStatus: "eingereicht", pilotSubmittedAt: today, updatedAt: new Date() }).where(eq(P.tenantId, tenantId));
  await db.update(B).set({ status: "eingereicht" }).where(and(eq(B.tenantId, tenantId), eq(B.selected, true), eq(B.status, "ausgewaehlt")));
  const done = await templateTask(tenantId, "ar-auswahl");
  if (done) await updateItem(tenantId, done, { done: true });
  const mail = await templateTask(tenantId, "ar-appeal-mail");
  if (mail) await updateItem(tenantId, mail, { dueDate: addDays(today, 14) });
  const role = await templateTask(tenantId, "ar-rolle");
  if (role) await updateItem(tenantId, role, { dueDate: addDays(today, 28) });
}

export async function setBrandStatus(tenantId: string, id: string, status: SasBrand["status"]) {
  await db.update(B).set({ status, selected: status !== "offen" }).where(and(eq(B.tenantId, tenantId), eq(B.id, id)));
}

// ---- Deals (Black Week)

export async function importDeals(tenantId: string, rows: DealRow[]): Promise<number> {
  for (const r of rows) {
    await db
      .insert(D)
      .values({ tenantId, asin: r.asin, title: r.title, minDiscountPct: r.minDiscountPct === null ? null : String(r.minDiscountPct), dealType: r.dealType })
      .onConflictDoUpdate({ target: [D.tenantId, D.asin], set: { title: r.title, minDiscountPct: r.minDiscountPct === null ? null : String(r.minDiscountPct), dealType: r.dealType } });
  }
  return rows.length;
}

export type SasDealView = typeof schema.sasDeals.$inferSelect & { sku: string | null; name: string | null; price: number | null; stock: number | null; daysLeft: number | null; units30: number | null; calc: DealResult };

export async function loadDeals(tenantId: string): Promise<SasDealView[]> {
  const deals = await db.select().from(D).where(eq(D.tenantId, tenantId)).orderBy(asc(D.createdAt));
  if (!deals.length) return [];
  const asins = deals.map((d) => d.asin);
  const SP = schema.sellerboardProducts;
  const SS = schema.sellerboardSkuStats;
  const SI = schema.sellerboardInventory;
  const [prods, stats, inv, costs] = await Promise.all([
    db.select().from(SP).where(and(eq(SP.tenantId, tenantId), inArray(SP.asin, asins))),
    db.select().from(SS).where(and(eq(SS.tenantId, tenantId), eq(SS.channel, "amazon"), inArray(SS.asin, asins))),
    db.select().from(SI).where(and(eq(SI.tenantId, tenantId), inArray(SI.asin, asins))),
    skuCostMap(tenantId),
  ]);
  return deals.map((d) => {
    const p = prods.find((x) => x.asin === d.asin && (x.channel ?? "FBA").toUpperCase() !== "FBM") ?? prods.find((x) => x.asin === d.asin) ?? null;
    const s = stats.find((x) => x.asin === d.asin) ?? null;
    const stock = inv.filter((x) => x.asin === d.asin);
    const sku = p?.sku ?? s?.sku ?? stock[0]?.sku ?? null;
    const price = s?.price ?? p?.price ?? null;
    const ek = sku ? (costs.get(sku)?.cost ?? null) : null;
    const referralRate = p?.referralFee && p.price ? Math.abs(p.referralFee) / p.price : null;
    const calc = dealCalc({ price, vatPct: p?.vatPct === null || p?.vatPct === undefined ? null : Number(p.vatPct), referralRate, fbaFee: p?.fbaFee === null || p?.fbaFee === undefined ? null : Math.abs(p.fbaFee), ek, discountPct: d.minDiscountPct === null ? null : Number(d.minDiscountPct) });
    return { ...d, sku, name: p?.name ?? s?.name ?? null, price, stock: stock.length ? stock.reduce((n, x) => n + x.fbaStock, 0) : null, daysLeft: s?.daysLeft ?? stock[0]?.daysLeft ?? null, units30: s?.units ?? null, calc };
  });
}

export async function setDealStatus(tenantId: string, id: string, status: (typeof schema.SAS_DEAL_STATUS)[number]) {
  await db.update(D).set({ status }).where(and(eq(D.tenantId, tenantId), eq(D.id, id)));
}

export async function deleteDeals(tenantId: string) {
  await db.delete(D).where(eq(D.tenantId, tenantId));
}

// ---- Unterlagen

export async function addDocument(tenantId: string, name: string, mime: string, data: Buffer, kind: (typeof schema.sasDocuments.$inferInsert)["kind"]) {
  const fileId = await storeFile(tenantId, name, mime, data);
  await db.insert(schema.sasDocuments).values({ tenantId, fileId, name, kind });
}

export async function loadDocuments(tenantId: string) {
  const SD = schema.sasDocuments;
  return db
    .select({ id: SD.id, name: SD.name, kind: SD.kind, createdAt: SD.createdAt, size: schema.files.size, mimeType: schema.files.mimeType })
    .from(SD)
    .innerJoin(schema.files, and(eq(schema.files.id, SD.fileId), eq(schema.files.tenantId, tenantId)))
    .where(eq(SD.tenantId, tenantId))
    .orderBy(asc(SD.createdAt));
}

export async function deleteDocument(tenantId: string, id: string) {
  const SD = schema.sasDocuments;
  const [doc] = await db.select({ fileId: SD.fileId }).from(SD).where(and(eq(SD.tenantId, tenantId), eq(SD.id, id)));
  if (!doc) return;
  await db.delete(schema.files).where(and(eq(schema.files.tenantId, tenantId), eq(schema.files.id, doc.fileId)));
}

export async function documentFile(tenantId: string, id: string) {
  const SD = schema.sasDocuments;
  const [row] = await db
    .select({ name: SD.name, data: schema.files.data, mimeType: schema.files.mimeType })
    .from(SD)
    .innerJoin(schema.files, and(eq(schema.files.id, SD.fileId), eq(schema.files.tenantId, tenantId)))
    .where(and(eq(SD.tenantId, tenantId), eq(SD.id, id)));
  return row ?? null;
}
