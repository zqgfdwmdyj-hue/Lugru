"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { DOC_TYPES, INVOICE_KINDS, type InvoiceChecks } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { parseAmount, parseDate } from "@/lib/numbers";
import { sendInvoiceToStotax } from "@/lib/invoices/receipts";
import { autoMatch, ingestInvoice, refreshInvoiceTasks, syncDrive } from "@/lib/invoices/service";
import { recheckInvoices } from "@/lib/invoices/review";

export type InvState = { ok: boolean; message: string } | null;
const uuid = z.string().uuid();

export async function syncDriveAction(_prev: InvState): Promise<InvState> {
  const session = await requireArea("buchhaltung");
  try {
    const r = await syncDrive(session.tenantId);
    revalidatePath("/", "layout");
    return { ok: true, message: `${r.created} neue Rechnungen übernommen (${r.total} im Ordner).${r.remaining > 0 ? ` Noch ${r.remaining} offen – erneut klicken oder der automatische Abruf holt sie nach.` : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadInvoices(_prev: InvState, fd: FormData): Promise<InvState> {
  const session = await requireArea("buchhaltung");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  let created = 0;
  for (const f of files) {
    const bytes = Buffer.from(await f.arrayBuffer());
    const { createHash } = await import("node:crypto");
    const r = await ingestInvoice({ tenantId: session.tenantId, source: "upload", externalId: createHash("sha256").update(bytes).digest("hex"), fileName: f.name, bytes, storeBytes: true });
    if (r.created) created++;
  }
  await refreshInvoiceTasks(session.tenantId);
  revalidatePath("/", "layout");
  return { ok: true, message: `${created} von ${files.length} Rechnungen neu übernommen.` };
}

async function own(tenantId: string, id: string) {
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.tenantId, tenantId)));
  if (!inv) throw new Error("Rechnung nicht gefunden");
  return inv;
}

export async function saveInvoice(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const id = uuid.parse(fd.get("id"));
  const inv = await own(session.tenantId, id);
  const kind = z.enum(INVOICE_KINDS).parse(fd.get("kind"));
  const docType = z.enum(DOC_TYPES).catch(inv.docType).parse(fd.get("docType") ?? inv.docType);
  const supplierId = uuid.safeParse(fd.get("supplierId")).success ? String(fd.get("supplierId")) : null;
  const invoiceDate = parseDate(String(fd.get("invoiceDate") ?? "")) ?? inv.invoiceDate;
  // Wer speichert, hat Datum und Belegart gesehen: diese Hinweise sind erledigt und kommen nicht wieder.
  const manual = new Set(inv.checks.manual ?? []);
  manual.add("date");
  manual.add("docType");
  const checks: InvoiceChecks = { ...inv.checks, manual: [...manual] };
  delete checks.date;
  delete checks.docType;
  await db
    .update(schema.invoices)
    .set({
      kind,
      docType,
      checks,
      supplierId,
      invoiceDate,
      invoiceNumber: String(fd.get("invoiceNumber") ?? "").trim() || null,
      orderNumber: String(fd.get("orderNumber") ?? "").trim() || null,
      totalGross: parseAmount(fd.get("totalGross")),
      status: kind === "expense" ? "matched" : inv.status === "ignored" ? "review" : inv.status,
      updatedAt: new Date(),
    })
    .where(eq(schema.invoices.id, id));
  if (fd.get("remember") === "on" && inv.sourceKey) {
    await db
      .insert(schema.invoiceSourceRules)
      .values({ tenantId: session.tenantId, sourceKey: inv.sourceKey, kind, supplierId })
      .onConflictDoUpdate({ target: [schema.invoiceSourceRules.tenantId, schema.invoiceSourceRules.sourceKey], set: { kind, supplierId } });
    // Gleiche Quelle, noch ungeklärt: gleich mit einordnen
    const others = await db.select({ id: schema.invoices.id }).from(schema.invoices).where(and(eq(schema.invoices.tenantId, session.tenantId), eq(schema.invoices.sourceKey, inv.sourceKey), eq(schema.invoices.status, "review")));
    for (const o of others) {
      await db.update(schema.invoices).set({ kind, supplierId, status: kind === "expense" ? "matched" : "new" }).where(eq(schema.invoices.id, o.id));
      if (kind === "goods") await autoMatch(session.tenantId, o.id);
    }
  }
  if (kind === "goods") await autoMatch(session.tenantId, id);
  await refreshInvoiceTasks(session.tenantId);
  revalidatePath("/", "layout");
}

export async function linkLot(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const id = uuid.parse(fd.get("id"));
  await own(session.tenantId, id);
  const lotId = uuid.parse(fd.get("lotId"));
  await db.insert(schema.invoiceLots).values({ tenantId: session.tenantId, invoiceId: id, lotId, matchedBy: "manual" }).onConflictDoNothing();
  await db.update(schema.invoices).set({ status: "matched", updatedAt: new Date() }).where(eq(schema.invoices.id, id));
  await refreshInvoiceTasks(session.tenantId);
  revalidatePath("/", "layout");
}

export async function unlinkLot(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const id = uuid.parse(fd.get("id"));
  await own(session.tenantId, id);
  await db.delete(schema.invoiceLots).where(and(eq(schema.invoiceLots.invoiceId, id), eq(schema.invoiceLots.lotId, uuid.parse(fd.get("lotId")))));
  revalidatePath(`/rechnungen/${id}`);
}

export async function ignoreInvoice(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const id = uuid.parse(fd.get("id"));
  await own(session.tenantId, id);
  await db.update(schema.invoices).set({ status: "ignored", updatedAt: new Date() }).where(eq(schema.invoices.id, id));
  await refreshInvoiceTasks(session.tenantId);
  revalidatePath("/", "layout");
}

/** Eingangsrechnung (PDF) an Stotax Select senden – per Mail2Select in die Belegablage. */
export async function stotaxInvoiceAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const id = uuid.parse(fd.get("id"));
  await own(session.tenantId, id);
  try {
    await sendInvoiceToStotax(session.tenantId, id);
  } catch {
    // Fehler steht an der Rechnung (stotax_error) und wird auf der Seite angezeigt.
  }
  revalidatePath(`/rechnungen/${id}`);
}

export type BulkState = { ok: boolean; message: string } | null;
const BULK_OPS = ["ware", "kosten", "ignorieren", "datum", "kein-duplikat", "pruefen"] as const;

/** Sammelbearbeitung in der Liste: Art setzen, ignorieren, Datumsvorschläge übernehmen, Duplikat-Hinweis erledigen. */
export async function bulkInvoiceAction(_prev: BulkState, fd: FormData): Promise<BulkState> {
  const session = await requireArea("buchhaltung");
  const op = z.enum(BULK_OPS).safeParse(fd.get("op"));
  const ids = fd.getAll("ids").map(String).filter((x) => uuid.safeParse(x).success).slice(0, 500);
  if (!op.success) return { ok: false, message: "Unbekannte Aktion." };
  if (!ids.length) return { ok: false, message: "Bitte zuerst Rechnungen auswählen." };
  const I = schema.invoices;
  const rows = await db.select().from(I).where(and(eq(I.tenantId, session.tenantId), inArray(I.id, ids)));
  let n = 0;
  for (const r of rows) {
    if (op.data === "ware" || op.data === "kosten") {
      const kind = op.data === "ware" ? "goods" : "expense";
      await db.update(I).set({ kind, status: kind === "expense" ? "matched" : r.status === "ignored" || r.status === "review" ? "new" : r.status, updatedAt: new Date() }).where(eq(I.id, r.id));
      if (kind === "goods") await autoMatch(session.tenantId, r.id);
      n++;
    } else if (op.data === "ignorieren") {
      await db.update(I).set({ status: "ignored", updatedAt: new Date() }).where(eq(I.id, r.id));
      n++;
    } else if (op.data === "datum") {
      const s = r.checks.date?.suggestion;
      if (!s) continue;
      const checks: InvoiceChecks = { ...r.checks, manual: [...new Set([...(r.checks.manual ?? []), "date" as const])] };
      delete checks.date;
      await db.update(I).set({ invoiceDate: s, checks, updatedAt: new Date() }).where(eq(I.id, r.id));
      n++;
    } else if (op.data === "kein-duplikat") {
      if (!r.checks.duplicateOf) continue;
      const checks: InvoiceChecks = { ...r.checks, notDuplicate: true };
      delete checks.duplicateOf;
      await db.update(I).set({ checks }).where(eq(I.id, r.id));
      n++;
    }
  }
  if (op.data === "pruefen") n = (await recheckInvoices(session.tenantId, { ids: rows.map((r) => r.id) })).checked;
  await refreshInvoiceTasks(session.tenantId);
  revalidatePath("/", "layout");
  const what: Record<(typeof BULK_OPS)[number], string> = { ware: "als Wareneinkauf eingeordnet", kosten: "als Betriebskosten eingeordnet", ignorieren: "ignoriert (bleiben gespeichert)", datum: "mit dem vorgeschlagenen Datum gespeichert", "kein-duplikat": "als „kein Duplikat“ bestätigt", pruefen: "neu geprüft" };
  const skipped = rows.length - n;
  return { ok: n > 0, message: `${n} Rechnung${n === 1 ? "" : "en"} ${what[op.data]}.${skipped > 0 ? ` ${skipped} übersprungen (kein Vorschlag bzw. kein Hinweis).` : ""}` };
}

/** Einzelner Prüfhinweis an der Rechnung: Vorschlag übernehmen, Datum bestätigen, Duplikat-Hinweis erledigen. */
export async function resolveCheckAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const id = uuid.parse(fd.get("id"));
  const inv = await own(session.tenantId, id);
  const op = z.enum(["datum-uebernehmen", "datum-ok", "kein-duplikat", "duplikat-ignorieren"]).parse(fd.get("op"));
  const checks: InvoiceChecks = { ...inv.checks };
  const set: Partial<typeof schema.invoices.$inferInsert> = { updatedAt: new Date() };
  if (op === "datum-uebernehmen" || op === "datum-ok") {
    if (op === "datum-uebernehmen" && inv.checks.date?.suggestion) set.invoiceDate = inv.checks.date.suggestion;
    checks.manual = [...new Set([...(checks.manual ?? []), "date" as const])];
    delete checks.date;
  } else if (op === "kein-duplikat") {
    checks.notDuplicate = true;
    delete checks.duplicateOf;
  } else {
    set.status = "ignored";
  }
  await db.update(schema.invoices).set({ ...set, checks }).where(and(eq(schema.invoices.id, id), eq(schema.invoices.tenantId, session.tenantId)));
  await refreshInvoiceTasks(session.tenantId);
  revalidatePath("/", "layout");
}
