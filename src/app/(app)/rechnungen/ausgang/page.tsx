import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { ebayDb } from "@/lib/ebay/db/pg";
import { missingSellerData } from "@/lib/ebay/invoices/build";
import { formatNumber } from "@/lib/ebay/invoices/numbering";
import { getInvoiceSettings, nextSeq } from "@/lib/ebay/invoices/store";
import { listOutgoing } from "@/lib/invoices/outgoing";
import { inStotaxScope, stotaxBacklog, stotaxConfig } from "@/lib/invoices/stotax";
import { formatEuro } from "@/lib/numbers";
import { bankAction, cancelAction, mailAction, numberingAction, stotaxPendingAction, stotaxSendAction } from "./actions";

const fmtDate = (iso: string | Date) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

export default async function AusgangsrechnungenPage({ searchParams }: { searchParams: Promise<{ q?: string; meldung?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const t = session.tenantId;
  const edb = ebayDb(t);
  const s = await getInvoiceSettings(edb);
  const year = new Date().getFullYear();
  const [rows, cfg, seq] = await Promise.all([listOutgoing(t, { q: sp.q }), stotaxConfig(t), nextSeq(edb, year, s)]);
  const backlog = await stotaxBacklog(t, cfg);
  const missing = missingSellerData(s);
  const pendingSince = cfg ? backlog.filter((b) => new Date(b.createdAt) >= cfg.since).length : 0;
  const older = cfg ? backlog.length - pendingSince : 0;
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Einkauf & Buchhaltung</div><h1>Ausgangsrechnungen</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link className="btn btn-primary" href="/rechnungen/ausgang/neu">Neue B2B-Rechnung</Link>
          <Link className="btn" href="/ebay?ansicht=rechnungen">eBay-Rechnungen</Link>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="out-msg">{sp.meldung}</div>}
      {missing.length > 0 && (
        <div className="notice notice-warn">
          Für Rechnungen fehlen noch Absenderdaten: {missing.join(", ")} – <Link href="/ebay?ansicht=einstellungen&tab=invoices">Einstellungen → Rechnungen</Link>.
        </div>
      )}

      <div className="grid-2" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <section className="card card-pad stack" style={{ gap: 8 }} data-testid="stotax-card">
          <h2>Stotax Select</h2>
          {!cfg ? (
            <>
              <div className="small muted">Noch nicht eingerichtet. Mit Mail2Select geht jede Rechnung (eBay und B2B, auch Stornos) automatisch als PDF in deine Stotax-Belegablage – du musst nichts mehr abtippen.</div>
              <Link className="btn" href="/anbindungen?p=stotax#stotax">Stotax Select einrichten</Link>
            </>
          ) : (
            <>
              <div className="small">
                An <strong>{cfg.address}</strong> · {cfg.auto ? "neue Rechnungen automatisch" : "nur per Knopf"} · {cfg.scope === "b2b" ? "nur B2B (eBay bucht AccountOne)" : "eBay und B2B"} · eingerichtet am {fmtDate(cfg.since)}
              </div>
              {cfg.scope === "alle" && (
                <div className="small muted">Bucht dein Steuerberater die eBay-Umsätze schon über AccountOne? Dann unter <Link href="/anbindungen?p=stotax#stotax">Anbindungen</Link> auf „Nur B2B“ stellen, damit eBay nicht doppelt ankommt.</div>
              )}
              <div className="small" data-testid="stotax-backlog">
                {pendingSince ? <span className="tag tag-warn">{pendingSince} noch nicht übertragen</span> : <span className="tag tag-ok">alles übertragen</span>}
                {older > 0 && <span className="muted"> · {older} ältere (vor dem Einrichten) nicht übertragen</span>}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
                {pendingSince > 0 && <form action={stotaxPendingAction}><button className="btn btn-small btn-primary" type="submit">Jetzt senden</button></form>}
                <form action={stotaxPendingAction} style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                  <div className="field"><label className="label" htmlFor="st-from">Nachsenden ab</label><input className="input" type="date" id="st-from" name="from" required style={{ width: 150 }} /></div>
                  <button className="btn btn-small" type="submit" title="Alle noch nicht übertragenen Rechnungen ab diesem Datum senden – nur, wenn sie noch nicht in Stotax sind">Nachsenden</button>
                </form>
              </div>
            </>
          )}
        </section>

        <section className="card card-pad stack" style={{ gap: 8 }} data-testid="numbering-card">
          <h2>Rechnungsnummern</h2>
          <div className="small">
            Nächste Nummer: <strong className="num" data-testid="next-number">{formatNumber(s, year, seq)}</strong>
            {s.numberFormat ? <span className="muted"> · Format {s.numberFormat}{s.numberFormat.includes("{JJJJ}") ? " (jedes Jahr neu)" : " (durchlaufend)"}</span> : <span className="muted"> · Standard {s.prefix ?? "RE-"}JJJJ-NNNN</span>}
          </div>
          <div className="small muted">eBay- und B2B-Rechnungen teilen sich einen lückenlosen Nummernkreis. Für den Umstieg: letzte Rechnungsnummer aus Stotax eintragen – Format und nächste Nummer werden übernommen.</div>
          <form action={numberingAction} style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field"><label className="label" htmlFor="nr-last">Letzte Nummer aus Stotax</label><input className="input num" id="nr-last" name="last" placeholder="z. B. 2026-0815" style={{ width: 170 }} /></div>
            <button className="btn btn-small" type="submit">Übernehmen</button>
          </form>
        </section>

        <section className="card card-pad stack" style={{ gap: 8 }}>
          <h2>Bank & Zahlungsziel (B2B)</h2>
          <form action={bankAction} className="stack" style={{ gap: 6 }}>
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

      <form action="/rechnungen/ausgang" style={{ maxWidth: 340 }}>
        <label htmlFor="oq" className="sr-only">Suche</label>
        <input className="input" id="oq" name="q" defaultValue={sp.q} placeholder="Nummer, Kunde, Bestellnummer" />
      </form>
      <section className="card" style={{ minWidth: 0, overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>Nummer</th><th>Datum</th><th>Kunde</th><th>Art</th><th className="right">Brutto</th><th>Stotax</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Noch keine Rechnungen.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} data-testid="out-row" data-number={r.number}>
                <td className="num">{r.number}{r.cancels && <div className="small muted">Storno zu {r.cancels}</div>}</td>
                <td className="num">{fmtDate(r.date)}</td>
                <td>{r.buyer}</td>
                <td>
                  <span className={`tag ${r.kind === "storno" ? "tag-critical" : "tag-neutral"}`}>{r.kind === "storno" ? "STORNO" : r.source === "b2b" ? "B2B" : "eBay"}</span>
                  {r.cancelledById && <div className="small muted">storniert</div>}
                </td>
                <td className="num right">{formatEuro(r.totalGross)}</td>
                <td className="small">
                  {r.stotaxSentAt ? (
                    <span className="tag tag-ok" title={`gesendet ${new Date(r.stotaxSentAt).toLocaleString("de-DE")}`}>übertragen</span>
                  ) : cfg && !inStotaxScope(cfg, r.source) ? (
                    <span className="muted" title="eBay-Umsätze bucht AccountOne – nicht an Stotax">über AccountOne</span>
                  ) : cfg ? (
                    <form action={stotaxSendAction} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={r.id} />
                      {r.stotaxError && <div style={{ color: "var(--danger)", maxWidth: 220 }}>{r.stotaxError}</div>}
                      <button className="btn btn-small" type="submit">{r.stotaxError ? "Erneut senden" : "Senden"}</button>
                    </form>
                  ) : <span className="muted">–</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <a className="btn btn-small" href={`/rechnungen/ausgang/${r.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                  {r.source === "b2b" && <a className="btn-link small" href={`/rechnungen/ausgang/${r.id}/xml`} style={{ marginLeft: 6 }} title="E-Rechnung (EN 16931, CII)">XML</a>}
                  {r.source === "b2b" && r.kind === "invoice" && (
                    <form action={mailAction} style={{ display: "inline" }}><input type="hidden" name="id" value={r.id} /><button className="btn-link small" type="submit" style={{ marginLeft: 6 }}>{r.emailedAt ? "erneut mailen" : "an Kunden mailen"}</button></form>
                  )}
                  {r.kind === "invoice" && !r.cancelledById && (
                    <form action={cancelAction} style={{ display: "inline" }}><input type="hidden" name="id" value={r.id} /><button className="btn-link small" type="submit" style={{ marginLeft: 6, color: "var(--muted)" }} data-testid="cancel-btn">stornieren</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
