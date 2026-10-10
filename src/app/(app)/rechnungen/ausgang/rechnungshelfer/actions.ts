"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { createFromDraft, discardDraft, draftConversion, getDraft, importRechnungshelfer, newRhToken, rhConfig, saveRhConfig } from "@/lib/invoices/rechnungshelfer-service";

const PATH = "/rechnungen/ausgang/rechnungshelfer";
const back = (msg: string) => redirect(`${PATH}?${new URLSearchParams({ meldung: msg })}`);
const isRedirect = (e: unknown) => typeof (e as { digest?: string })?.digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_REDIRECT");
const uuid = z.string().uuid();

export type TokenState = { token?: string; error?: string } | null;

/** Neuen Schlüssel erzeugen – der alte gilt danach nicht mehr. */
export async function tokenAction(_prev: TokenState, _fd: FormData): Promise<TokenState> {
  const session = await requireArea("buchhaltung");
  const token = await newRhToken(session.tenantId);
  revalidatePath(PATH);
  return { token };
}

/** Rechnungsempfänger (Ankäufer) und Automatik. */
export async function settingsAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const customerId = String(fd.get("customerId") ?? "");
  await saveRhConfig(session.tenantId, {
    customerId: uuid.safeParse(customerId).success ? customerId : null,
    auto: fd.get("auto") === "on",
    mailCustomer: fd.get("mailCustomer") === "on",
  });
  revalidatePath(PATH);
  back("Gespeichert.");
}

/** Ohne Prüfbedarf: Rechnung direkt aus dem Entwurf erstellen. */
export async function createNowAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const id = uuid.parse(fd.get("id"));
  try {
    const row = await getDraft(session.tenantId, id);
    if (!row) return back("Entwurf nicht gefunden.");
    const conv = await draftConversion(session.tenantId, row);
    if (!conv.customerId) return back("Erst den Rechnungsempfänger festlegen.");
    const cfg = await rhConfig(session.tenantId);
    const inv = await createFromDraft(session.tenantId, id, conv.input, { mail: cfg.mailCustomer });
    revalidatePath("/rechnungen/ausgang");
    back(`Rechnung ${inv.number} für Ticket ${row.ticket} erstellt.`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(`Nicht erstellt: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function discardAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  await discardDraft(session.tenantId, uuid.parse(fd.get("id")));
  revalidatePath(PATH);
  back("Entwurf verworfen.");
}

/** Ohne Webhook: Screenshots, Text oder JSON-Datei → Entwurf, danach gleich das Formular zum Prüfen. */
export async function importAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const files = await Promise.all(
    fd
      .getAll("file")
      .filter((f): f is File => f instanceof File && f.size > 0)
      .map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
  let target: string;
  try {
    const r = await importRechnungshelfer(session.tenantId, { text: String(fd.get("text") ?? ""), files });
    revalidatePath(PATH);
    revalidatePath("/rechnungen/ausgang");
    target = r.status === "entwurf" && r.draftId ? `/rechnungen/ausgang/neu?entwurf=${r.draftId}` : `${PATH}?${new URLSearchParams({ meldung: r.message })}`;
  } catch (e) {
    if (isRedirect(e)) throw e;
    return back(`Nicht eingelesen: ${e instanceof Error ? e.message : String(e)}`);
  }
  redirect(target);
}
