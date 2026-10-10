"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import { ebayDb } from "@/lib/ebay/db/pg";
import { deriveNumbering, formatNumber, validNumberFormat } from "@/lib/ebay/invoices/numbering";
import { getInvoiceSettings, nextSeq, saveInvoiceSettings } from "@/lib/ebay/invoices/store";
import type { InvoiceSettings } from "@/lib/ebay/invoices/types";
import { b2bInputFromForm } from "@/lib/invoices/b2b-form";
import { cancelOutgoing, createB2bInvoice, mailB2bInvoice } from "@/lib/invoices/outgoing";
import { createFromDraft, getDraft } from "@/lib/invoices/rechnungshelfer-service";
import { sendPendingToStotax, sendToStotax } from "@/lib/invoices/stotax";
import { parseAmount } from "@/lib/numbers";

const back = (msg: string, path = "/rechnungen/ausgang") => redirect(`${path}?${new URLSearchParams({ meldung: msg })}`);
const idOf = (fd: FormData) => z.coerce.number().int().positive().parse(fd.get("id"));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isRedirect = (e: unknown) => typeof (e as { digest?: string })?.digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_REDIRECT");

/** Neue B2B-Rechnung: Nummer vergeben, an Stotax, auf Wunsch an den Kunden. */
export async function createB2bAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const input = b2bInputFromForm(fd);
  const draftId = String(fd.get("draftId") ?? "");
  let msg: string;
  try {
    if (/^[0-9a-f-]{36}$/.test(draftId)) {
      // Entwurf aus dem Rechnungshelfer: Rechnung erstellen und Entwurf abhaken.
      const inv = await createFromDraft(session.tenantId, draftId, input, { mail: input.mailCustomer, saveCustomer: input.saveCustomer });
      const d = await getDraft(session.tenantId, draftId);
      revalidatePath("/rechnungen/ausgang");
      return back(`Rechnung ${inv.number} erstellt${input.mailCustomer && !d?.error ? ` und an ${input.buyer.email} gemailt` : ""}${d?.error ? ` – ${d.error}` : ""}.`);
    }
    const inv = await createB2bInvoice(session.tenantId, input, { saveCustomer: input.saveCustomer });
    msg = `Rechnung ${inv.number} erstellt`;
    if (input.mailCustomer) {
      try {
        msg += ` und an ${await mailB2bInvoice(session.tenantId, inv.id)} gemailt`;
      } catch (e) {
        msg += ` – Mail an den Kunden ging nicht: ${errMsg(e)}`;
      }
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    // Eingaben bleiben im Browser stehen (Zurück) – Meldung oben auf der Formularseite.
    return back(errMsg(e), `/rechnungen/ausgang/neu${/^[0-9a-f-]{36}$/.test(draftId) ? `?entwurf=${draftId}` : ""}`);
  }
  revalidatePath("/rechnungen/ausgang");
  back(msg + ".");
}

export async function mailAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  try {
    const to = await mailB2bInvoice(session.tenantId, idOf(fd), String(fd.get("to") ?? "").trim() || undefined);
    back(`Rechnung an ${to} gemailt (PDF + E-Rechnung).`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(`Nicht gemailt: ${errMsg(e)}`);
  }
}

export async function cancelAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  try {
    const s = await cancelOutgoing(session.tenantId, idOf(fd));
    back(`Stornorechnung ${s.number} erstellt.`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(`Nicht storniert: ${errMsg(e)}`);
  }
}

export async function stotaxSendAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  try {
    await sendToStotax(session.tenantId, idOf(fd));
    back("An Stotax Select gesendet.");
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(`Nicht an Stotax gesendet: ${errMsg(e)}`);
  }
}

/** Offene seit dem Einrichten jetzt senden – oder ab einem Datum nachsenden (auch ältere). */
export async function stotaxPendingAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const from = String(fd.get("from") ?? "");
  const r = await sendPendingToStotax(session.tenantId, { force: true, limit: 100, ...(/^\d{4}-\d{2}-\d{2}$/.test(from) ? { from: new Date(`${from}T00:00:00`) } : {}) });
  const n = (k: number) => `${k} ${k === 1 ? "Rechnung" : "Rechnungen"}`;
  back(r.sent || r.failed ? `${n(r.sent)} an Stotax gesendet${r.failed ? `, ${r.failed} fehlgeschlagen (${r.error})` : ""}.` : "Keine offenen Rechnungen für Stotax.");
}

/** Nummernkreis aus der letzten Rechnungsnummer des bisherigen Programms übernehmen. */
export async function numberingAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const edb = ebayDb(session.tenantId);
  const s = await getInvoiceSettings(edb);
  const last = String(fd.get("last") ?? "").trim();
  const custom = String(fd.get("format") ?? "").trim();
  const now = new Date();
  // Nächste Nummer so, wie sie wirklich vergeben wird (berücksichtigt schon geschriebene Rechnungen).
  const nextText = async (n: InvoiceSettings) => formatNumber(n, now.getFullYear(), await nextSeq(edb, now.getFullYear(), n));
  if (custom) {
    if (!validNumberFormat(custom)) back("Format ungültig – genau einmal {NR} bzw. {NR:4}, optional {JJJJ}, sonst nur Buchstaben, Ziffern, - / . _");
    const next = Math.max(1, Math.round(parseAmount(String(fd.get("next") ?? "")) ?? 1));
    const n = { ...s, numberFormat: custom, startNumber: next, startNumberYear: now.getFullYear() };
    await saveInvoiceSettings(edb, n);
    back(`Nummernkreis gespeichert – nächste Rechnung: ${await nextText(n)}.`);
  }
  const d = deriveNumbering(last);
  if (!d) back("Bitte die letzte Rechnungsnummer genau so eintragen, wie sie in Stotax steht (z. B. 2026-0815 oder RE-123).");
  const derived = d!;
  const n = { ...s, numberFormat: derived.numberFormat, startNumber: derived.nextNumber, startNumberYear: derived.year ?? now.getFullYear() };
  await saveInvoiceSettings(edb, n);
  back(`Übernommen: Format ${derived.numberFormat}. Nächste Rechnung: ${await nextText(n)}.`);
}

/** Bankverbindung und Zahlungsziel für B2B-Rechnungen. */
export async function bankAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const edb = ebayDb(session.tenantId);
  const s = await getInvoiceSettings(edb);
  const iban = String(fd.get("iban") ?? "").replace(/\s+/g, "").toUpperCase();
  if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) back("IBAN sieht nicht gültig aus.");
  const days = parseAmount(String(fd.get("paymentDays") ?? ""));
  await saveInvoiceSettings(edb, {
    ...s,
    iban: iban || undefined,
    bic: String(fd.get("bic") ?? "").trim().toUpperCase() || undefined,
    bankName: String(fd.get("bankName") ?? "").trim() || undefined,
    paymentDays: days === null ? undefined : Math.max(0, Math.min(365, Math.round(days))),
  });
  back("Bankverbindung und Zahlungsziel gespeichert.");
}
