import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { ebayDb } from "@/lib/ebay/db/pg";
import { missingSellerData } from "@/lib/ebay/invoices/build";
import { formatNumber } from "@/lib/ebay/invoices/numbering";
import { getInvoiceSettings, nextSeq } from "@/lib/ebay/invoices/store";
import { listCustomers } from "@/lib/invoices/outgoing";
import { stotaxConfig } from "@/lib/invoices/stotax";
import { createB2bAction } from "../actions";
import { draftConversion, getDraft, rhConfig } from "@/lib/invoices/rechnungshelfer-service";
import { B2bForm, type DraftPrefill } from "./b2b-form";

const amount = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });

/** Entwurf aus dem Rechnungshelfer → Startwerte des Formulars. */
async function draftPrefill(tenantId: string, id: string | undefined): Promise<DraftPrefill | undefined> {
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const row = await getDraft(tenantId, id);
  if (!row || row.status !== "offen") return undefined;
  const [conv, cfg] = await Promise.all([draftConversion(tenantId, row), rhConfig(tenantId)]);
  const i = conv.input;
  return {
    id: row.id,
    ticket: row.ticket,
    customerId: conv.customerId,
    serviceDate: i.serviceDate,
    serviceDateTo: i.serviceDateTo,
    paymentDays: i.paymentDays,
    reference: i.reference,
    note: i.note,
    rcWhole: Boolean(i.rcWhole),
    mailCustomer: Boolean(cfg.mailCustomer),
    lines: i.lines.map((l) => ({ desc: l.description, qty: String(l.quantity), unit: l.unit ?? "Stk", price: amount(l.unitNet), vat: String(l.vatRate), device: Boolean(l.device) })),
    warnings: conv.warnings,
  };
}

export default async function NeueRechnungPage({ searchParams }: { searchParams: Promise<{ meldung?: string; kunde?: string; entwurf?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const edb = ebayDb(session.tenantId);
  const s = await getInvoiceSettings(edb);
  const year = new Date().getFullYear();
  const [customers, cfg, seq, draft] = await Promise.all([listCustomers(session.tenantId), stotaxConfig(session.tenantId), nextSeq(edb, year, s), draftPrefill(session.tenantId, sp.entwurf)]);
  const missing = missingSellerData(s);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/rechnungen/ausgang">Ausgangsrechnungen</Link></div><h1>{draft ? `Rechnung zu Ticket ${draft.ticket}` : "Neue B2B-Rechnung"}</h1></div>
        <Link className="btn" href="/rechnungen/kunden">Kunden verwalten</Link>
      </div>
      {sp.meldung && <div className="notice notice-error" data-testid="form-msg">{sp.meldung}</div>}
      {missing.length > 0 && (
        <div className="notice notice-warn">
          Erst Absenderdaten eintragen: {missing.join(", ")} – <Link href="/ebay?ansicht=einstellungen&tab=invoices">Einstellungen → Rechnungen</Link>.
        </div>
      )}
      <B2bForm
        action={createB2bAction}
        customers={customers.map((c) => ({ id: c.id, name: c.name, contact: c.contact ?? "", street: c.street, zip: c.zip, city: c.city, country: c.country, vatId: c.vatId ?? "", email: c.email ?? "", customerNumber: c.customerNumber ?? "" }))}
        nextNumber={formatNumber(s, year, seq)}
        paymentDays={s.paymentDays ?? 14}
        kleinunternehmer={Boolean(s.kleinunternehmer)}
        sellerVatId={s.vatId ?? ""}
        stotax={cfg ? (cfg.auto ? `geht automatisch an Stotax (${cfg.address})` : "an Stotax per Knopf in der Übersicht") : null}
        hasIban={Boolean(s.iban)}
        initialCustomerId={customers.some((c) => c.id === sp.kunde) ? sp.kunde : undefined}
        draft={draft}
      />
    </>
  );
}
