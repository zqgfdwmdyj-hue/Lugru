"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { createReceipt, deleteReceipt, ReceiptError, sendInvoiceToStotax } from "@/lib/invoices/receipts";

const PATH = "/rechnungen/belege";
const back = (msg: string) => redirect(`${PATH}?${new URLSearchParams({ meldung: msg })}`);
const isRedirect = (e: unknown) => typeof (e as { digest?: string })?.digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_REDIRECT");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type UploadState = { ok: boolean; message: string } | null;

/** Fotos eines Belegs (im Browser schon verkleinert) oder ein PDF aufnehmen. */
export async function uploadReceiptAction(fd: FormData): Promise<UploadState> {
  const session = await requireArea("buchhaltung");
  const images = await Promise.all(
    fd
      .getAll("image")
      .filter((f): f is File => f instanceof File && f.size > 0)
      .map(async (f) => ({ type: f.type || "image/jpeg", bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
  const pdfFile = fd.get("pdf");
  const pdf = pdfFile instanceof File && pdfFile.size > 0 ? new Uint8Array(await pdfFile.arrayBuffer()) : null;
  try {
    const r = await createReceipt(session.tenantId, { images, pdf, note: String(fd.get("note") ?? "") });
    revalidatePath(PATH);
    return { ok: true, message: r.duplicate ? "Diesen Beleg gibt es schon." : "Beleg gespeichert – wird gelesen und an Stotax gesendet." };
  } catch (e) {
    return { ok: false, message: e instanceof ReceiptError ? e.message : `Nicht gespeichert: ${errMsg(e)}` };
  }
}

export async function resendAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  try {
    await sendInvoiceToStotax(session.tenantId, z.string().uuid().parse(fd.get("id")));
    back("An Stotax gesendet.");
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(`Nicht gesendet: ${errMsg(e)}`);
  }
}

export async function deleteAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  try {
    await deleteReceipt(session.tenantId, z.string().uuid().parse(fd.get("id")));
    back("Beleg gelöscht.");
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(errMsg(e));
  }
}
