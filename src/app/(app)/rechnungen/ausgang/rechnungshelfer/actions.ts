"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { createFromDraft, discardDraft, draftConversion, getDraft, newRhToken, rhConfig, saveRhConfig } from "@/lib/invoices/rechnungshelfer-service";
import { ticketPrefix } from "@/lib/invoices/rechnungshelfer";

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

/** Kunde je Discord-Server (Ticket-Präfix), Standard-Kunde, Automatik. */
export async function settingsAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const cfg = await rhConfig(session.tenantId);
  const prefixes: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("p_")) continue;
    const id = String(v);
    if (uuid.safeParse(id).success) prefixes[k.slice(2)] = id;
  }
  const np = ticketPrefix(String(fd.get("newPrefix") ?? ""));
  const nc = String(fd.get("newCustomer") ?? "");
  if (np && uuid.safeParse(nc).success) prefixes[np] = nc;
  const def = String(fd.get("defaultCustomerId") ?? "");
  await saveRhConfig(session.tenantId, {
    ...cfg,
    prefixes,
    defaultCustomerId: uuid.safeParse(def).success ? def : null,
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
    if (!conv.customerId) return back("Erst den Kunden festlegen (Prüfen & erstellen).");
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
