import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { ebayDb } from "@/lib/ebay/db/pg";
import { missingSellerData } from "@/lib/ebay/invoices/build";
import { formatNumber } from "@/lib/ebay/invoices/numbering";
import { getInvoiceSettings, nextSeq } from "@/lib/ebay/invoices/store";
import { listCustomers } from "@/lib/invoices/outgoing";
import { stotaxConfig } from "@/lib/invoices/stotax";
import { createB2bAction } from "../actions";
import { B2bForm } from "./b2b-form";

export default async function NeueRechnungPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const edb = ebayDb(session.tenantId);
  const s = await getInvoiceSettings(edb);
  const year = new Date().getFullYear();
  const [customers, cfg, seq] = await Promise.all([listCustomers(session.tenantId), stotaxConfig(session.tenantId), nextSeq(edb, year, s)]);
  const missing = missingSellerData(s);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/rechnungen/ausgang">Ausgangsrechnungen</Link></div><h1>Neue B2B-Rechnung</h1></div>
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
      />
    </>
  );
}
