import { ebayDb } from "@/lib/ebay/db/pg";
import { formatNumber } from "@/lib/ebay/invoices/numbering";
import { getInvoiceSettings, nextSeq } from "@/lib/ebay/invoices/store";
import { bankAction, numberingAction } from "./actions";

/** Nummernkreis und Bank & Zahlungsziel für Ausgangsrechnungen – Teil der Einstellungen. */
export async function InvoiceSettingsCards({ tenantId }: { tenantId: string }) {
  const edb = ebayDb(tenantId);
  const s = await getInvoiceSettings(edb);
  const year = new Date().getFullYear();
  const seq = await nextSeq(edb, year, s);
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="numbering-card">
        <h2>Rechnungsnummern</h2>
        <div className="small">
          Nächste Nummer: <strong className="num" data-testid="next-number">{formatNumber(s, year, seq)}</strong>
          {s.numberFormat ? <span className="muted"> · Format {s.numberFormat}{s.numberFormat.includes("{JJJJ}") ? " (jedes Jahr neu)" : " (durchlaufend)"}</span> : <span className="muted"> · Standard {s.prefix ?? "RE-"}JJJJ-NNNN</span>}
        </div>
        <div className="small muted">eBay- und B2B-Rechnungen teilen sich einen lückenlosen Nummernkreis. Für den Umstieg: letzte Rechnungsnummer aus Stotax eintragen – Format und nächste Nummer werden übernommen.</div>
        <form action={numberingAction} style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="zurueck" value="einstellungen" />
          <div className="field"><label className="label" htmlFor="nr-last">Letzte Nummer aus Stotax</label><input className="input num" id="nr-last" name="last" placeholder="z. B. 2026-0815" style={{ width: 170 }} /></div>
          <button className="btn btn-small" type="submit">Übernehmen</button>
        </form>
      </section>
      <section className="card card-pad stack" style={{ gap: 8 }} data-testid="bank-card">
        <h2>Bank & Zahlungsziel (B2B)</h2>
        <form action={bankAction} className="stack" style={{ gap: 6 }}>
          <input type="hidden" name="zurueck" value="einstellungen" />
          <div className="field"><label className="label" htmlFor="bk-iban">IBAN</label><input className="input num" id="bk-iban" name="iban" defaultValue={s.iban ?? ""} placeholder="DE…" /></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 120px" }}><label className="label" htmlFor="bk-bic">BIC</label><input className="input num" id="bk-bic" name="bic" defaultValue={s.bic ?? ""} /></div>
            <div className="field" style={{ flex: "1 1 140px" }}><label className="label" htmlFor="bk-name">Bank</label><input className="input" id="bk-name" name="bankName" defaultValue={s.bankName ?? ""} /></div>
            <div className="field" style={{ width: 90 }}><label className="label" htmlFor="bk-days">Ziel (Tage)</label><input className="input num" id="bk-days" name="paymentDays" defaultValue={s.paymentDays ?? 14} /></div>
          </div>
          <button className="btn btn-small" type="submit">Speichern</button>
        </form>
      </section>
    </div>
  );
}
