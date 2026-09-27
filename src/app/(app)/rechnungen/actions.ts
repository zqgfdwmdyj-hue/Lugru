"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { INVOICE_KINDS } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { parseAmount, parseDate } from "@/lib/numbers";
import { autoMatch, ingestInvoice, refreshInvoiceTasks, syncDrive } from "@/lib/invoices/service";

export type InvState = { ok: boolean; message: string } | null;
const uuid = z.string().uuid();

export async function syncDriveAction(_prev: InvState): Promise<InvState> {
  const session = await requireSession();
  try {
    const r = await syncDrive(session.tenantId);
    revalidatePath("/", "layout");
    return { ok: true, message: `${r.created} neue Rechnungen übernommen (${r.total} im Ordner).${r.remaining > 0 ? ` Noch ${r.remaining} offen – erneut klicken oder der automatische Abruf holt sie nach.` : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function uploadInvoices(_prev: InvState, fd: FormData): Promise<InvState> {
  const session = await requireSession();
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
  const session = await requireSession();
  const id = uuid.parse(fd.get("id"));
  const inv = await own(session.tenantId, id);
  const kind = z.enum(INVOICE_KINDS).parse(fd.get("kind"));
  const supplierId = uuid.safeParse(fd.get("supplierId")).success ? String(fd.get("supplierId")) : null;
  await db
    .update(schema.invoices)
    .set({
      kind,
      supplierId,
      invoiceDate: parseDate(String(fd.get("invoiceDate") ?? "")) ?? inv.invoiceDate,
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
  const session = await requireSession();
  const id = uuid.parse(fd.get("id"));
  await own(session.tenantId, id);
  const lotId = uuid.parse(fd.get("lotId"));
  await db.insert(schema.invoiceLots).values({ tenantId: session.tenantId, invoiceId: id, lotId, matchedBy: "manual" }).onConflictDoNothing();
  await db.update(schema.invoices).set({ status: "matched", updatedAt: new Date() }).where(eq(schema.invoices.id, id));
  await refreshInvoiceTasks(session.tenantId);
  revalidatePath("/", "layout");
}

export async function unlinkLot(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("id"));
  await own(session.tenantId, id);
  await db.delete(schema.invoiceLots).where(and(eq(schema.invoiceLots.invoiceId, id), eq(schema.invoiceLots.lotId, uuid.parse(fd.get("lotId")))));
  revalidatePath(`/rechnungen/${id}`);
}

export async function ignoreInvoice(fd: FormData) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("id"));
  await own(session.tenantId, id);
  await db.update(schema.invoices).set({ status: "ignored", updatedAt: new Date() }).where(eq(schema.invoices.id, id));
  await refreshInvoiceTasks(session.tenantId);
  revalidatePath("/", "layout");
}
