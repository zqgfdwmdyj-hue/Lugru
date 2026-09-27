import "server-only";
import { and, eq, gte, inArray, lte, notExists, sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { downloadFile, driveToken, listPdfs } from "@/lib/integrations/clients/drive";
import { getIntegration } from "@/lib/integrations/store";
import { storeFile } from "@/lib/orders/service";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { extractInvoiceFacts, guessKind, matchBySum, parseInvoiceFileName } from "./parse";

export async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } catch {
    return "";
  }
}

/** Nimmt eine Rechnung auf, liest sie aus, ordnet sie ein und verknüpft sie wenn möglich. */
export async function ingestInvoice(opts: { tenantId: string; source: "drive" | "upload"; externalId: string; fileName: string; bytes: Buffer; storeBytes: boolean }) {
  const { tenantId } = opts;
  const [existing] = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.source, opts.source), eq(schema.invoices.externalId, opts.externalId)));
  if (existing) return { id: existing.id, created: false };

  const name = parseInvoiceFileName(opts.fileName);
  const text = await pdfText(opts.bytes);
  const facts = extractInvoiceFacts(text);
  const [rule] = name.sourceKey
    ? await db.select().from(schema.invoiceSourceRules).where(and(eq(schema.invoiceSourceRules.tenantId, tenantId), eq(schema.invoiceSourceRules.sourceKey, name.sourceKey)))
    : [];
  const kind = rule?.kind ?? guessKind(name.sourceKey);
  const fileId = opts.storeBytes ? await storeFile(tenantId, opts.fileName, "application/pdf", opts.bytes) : null;
  const [row] = await db
    .insert(schema.invoices)
    .values({
      tenantId,
      source: opts.source,
      externalId: opts.externalId,
      fileName: opts.fileName,
      fileId,
      sourceKey: name.sourceKey,
      supplierId: rule?.supplierId ?? null,
      kind,
      status: kind === "expense" ? "matched" : "new",
      invoiceDate: facts.invoiceDate ?? name.date,
      invoiceNumber: facts.invoiceNumber,
      orderNumber: facts.orderNumber,
      totalGross: facts.totalGross,
      totalNet: facts.totalNet,
      textExcerpt: text.slice(0, 8000),
    })
    .returning({ id: schema.invoices.id });
  if (kind === "goods") await autoMatch(tenantId, row.id, facts.asins);
  else if (kind === "unknown") await db.update(schema.invoices).set({ status: "review" }).where(eq(schema.invoices.id, row.id));
  return { id: row.id, created: true };
}

/** Versucht, eine Warenrechnung den passenden Chargen zuzuordnen. */
export async function autoMatch(tenantId: string, invoiceId: string, asinsFromText?: string[]) {
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!inv || inv.kind !== "goods") return false;
  const settings = await getSettings(tenantId);
  const asins = asinsFromText ?? [...new Set([...(inv.textExcerpt ?? "").matchAll(/\bB0[A-Z0-9]{8}\b/g)].map((m) => m[0]))];
  const day = inv.invoiceDate ?? todayIso(inv.createdAt);
  const L = schema.lots;
  const P = schema.products;
  const unlinked = notExists(db.select({ x: sql`1` }).from(schema.invoiceLots).where(eq(schema.invoiceLots.lotId, L.id)));

  let chosen: { id: string }[] = [];
  if (asins.length) {
    chosen = await db
      .select({ id: L.id })
      .from(L)
      .innerJoin(P, eq(P.id, L.productId))
      .where(and(eq(L.tenantId, tenantId), eq(L.kind, "purchase"), inArray(P.asin, asins), gte(L.purchaseDate, addDaysIso(day, -30)), lte(L.purchaseDate, addDaysIso(day, 5)), unlinked));
  } else if (inv.supplierId && inv.totalGross) {
    const cands = await db
      .select({ id: L.id, net: L.unitCostNet, gross: L.skuCostGross, qty: L.quantity })
      .from(L)
      .where(and(eq(L.tenantId, tenantId), eq(L.kind, "purchase"), eq(L.supplierId, inv.supplierId), gte(L.purchaseDate, addDaysIso(day, -10)), lte(L.purchaseDate, addDaysIso(day, 3)), unlinked));
    const withGross = cands.map((c) => ({ id: c.id, gross: (c.gross !== null ? Number(c.gross) : Number(c.net ?? 0) * (1 + settings.vatRate)) * (c.qty ?? 1) }));
    chosen = matchBySum(withGross, inv.totalGross) ?? (withGross.length === 1 ? withGross : []);
  }
  if (!chosen.length) {
    await db.update(schema.invoices).set({ status: "review", updatedAt: new Date() }).where(eq(schema.invoices.id, invoiceId));
    return false;
  }
  await db.insert(schema.invoiceLots).values(chosen.map((c) => ({ tenantId, invoiceId, lotId: c.id, matchedBy: "auto" as const }))).onConflictDoNothing();
  await db.update(schema.invoices).set({ status: "matched", updatedAt: new Date() }).where(eq(schema.invoices.id, invoiceId));
  return true;
}

export async function syncDrive(tenantId: string, max = 150) {
  const cfg = await getIntegration(tenantId, "google_drive");
  if (!cfg?.serviceAccountJson || !cfg.folderId) throw new Error("Google Drive ist noch nicht eingerichtet (Anbindungen).");
  const token = await driveToken(cfg.serviceAccountJson);
  const files = await listPdfs(token, cfg.folderId);
  const known = new Set(
    (await db.select({ id: schema.invoices.externalId }).from(schema.invoices).where(and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.source, "drive")))).map((r) => r.id),
  );
  const todo = files.filter((f) => !known.has(f.id)).slice(0, max);
  let created = 0;
  for (const f of todo) {
    try {
      const bytes = await downloadFile(token, f.id);
      const r = await ingestInvoice({ tenantId, source: "drive", externalId: f.id, fileName: f.name, bytes, storeBytes: false });
      if (r.created) created++;
    } catch (e) {
      console.error("Rechnung nicht verarbeitet", f.name, e);
    }
  }
  await refreshInvoiceTasks(tenantId);
  return { total: files.length, created, remaining: files.filter((f) => !known.has(f.id)).length - todo.length };
}

export async function refreshInvoiceTasks(tenantId: string) {
  const I = schema.invoices;
  const [review] = await db.select({ n: sql<number>`count(*)::int` }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.status, "review")));
  if (review.n > 0) {
    await upsertSystemTask(db, tenantId, "invoices-review", { title: `${review.n} Rechnungen prüfen und zuordnen`, category: "einkauf", link: "/rechnungen?ansicht=pruefen" });
  } else await resolveSystemTask(db, tenantId, "invoices-review");

  // Einkäufe älter als 14 Tage ohne Rechnung – nur, wenn überhaupt schon Warenrechnungen da sind.
  const [hasGoods] = await db.select({ n: sql<number>`count(*)::int` }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.kind, "goods")));
  if (hasGoods.n > 0) {
    const L = schema.lots;
    const oldest = (await db.select({ d: sql<string | null>`min(${I.invoiceDate})::text` }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.kind, "goods"))))[0]?.d;
    const [missing] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(L)
      .where(and(eq(L.tenantId, tenantId), eq(L.kind, "purchase"), lte(L.purchaseDate, addDaysIso(todayIso(), -14)), oldest ? gte(L.purchaseDate, oldest) : undefined, notExists(db.select({ x: sql`1` }).from(schema.invoiceLots).where(eq(schema.invoiceLots.lotId, L.id)))));
    if (missing.n > 0) {
      await upsertSystemTask(db, tenantId, "lots-without-invoice", { title: `${missing.n} Einkäufe ohne Rechnung`, notes: "Für Ansprüche und die Buchhaltung sollte jede Charge eine Rechnung haben.", category: "einkauf", priority: "low", link: "/chargen?filter=ohne-rechnung" });
    } else await resolveSystemTask(db, tenantId, "lots-without-invoice");
  }
}

