import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { ebayDb } from "@/lib/ebay/db/pg";
import { missingSellerData } from "@/lib/ebay/invoices/build";
import { formatNumber } from "@/lib/ebay/invoices/numbering";
import { getInvoiceSettings, nextSeq } from "@/lib/ebay/invoices/store";
import { listOutgoing } from "@/lib/invoices/outgoing";
import { openDraftCount } from "@/lib/invoices/rechnungshelfer-service";
import { inStotaxScope, stotaxBacklog, stotaxConfig } from "@/lib/invoices/stotax";
import { formatEuro } from "@/lib/numbers";
import { cancelAction, mailAction, stotaxPendingAction, stotaxSendAction } from "./actions";
import { ActionMenu } from "@/components/action-menu";
import { ConfirmButton } from "@/components/confirm-button";

const ARTEN = { alle: "Alle", b2b: "B2B", ebay: "eBay", storno: "Stornos" } as const;
const fmtDate = (iso: string | Date) => new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

export default async function AusgangsrechnungenPage({ searchParams }: { searchParams: Promise<{ q?: string; meldung?: string; art?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const t = session.tenantId;
  const edb = ebayDb(t);
  const s = await getInvoiceSettings(edb);
  const year = new Date().getFullYear();
  const art = sp.art && sp.art in ARTEN ? (sp.art as keyof typeof ARTEN) : "alle";
  const [all, cfg, seq, drafts] = await Promise.all([listOutgoing(t, { q: sp.q, limit: art === "alle" ? 200 : 2000 }), stotaxConfig(t), nextSeq(edb, year, s), openDraftCount(t)]);
  // Eine Liste für eBay und B2B – Filter nach Art.
  const rows = all.filter((r) => art === "alle" || (art === "storno" ? r.kind === "storno" : r.source === art && r.kind !== "storno")).slice(0, 200);
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
          <Link className="btn" href="/rechnungen/ausgang/rechnungshelfer">Rechnungshelfer</Link>
          <Link className="btn" href="/rechnungen/kunden">Kunden</Link>
          <Link className="btn" href="/ebay?ansicht=rechnungen">eBay-Rechnungen</Link>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="out-msg">{sp.meldung}</div>}
      {drafts > 0 && (
        <div className="notice notice-warn" data-testid="rh-banner">
          {drafts === 1 ? "1 Rechnung" : `${drafts} Rechnungen`} aus dem Rechnungshelfer {drafts === 1 ? "wartet" : "warten"} auf Prüfung – <Link href="/rechnungen/ausgang/rechnungshelfer">ansehen und erstellen</Link>.
        </div>
      )}
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
              <div className="small muted">Noch nicht eingerichtet. Mit Mail2Select geht jede B2B-Rechnung (auch Stornos) automatisch als PDF in deine Stotax-Belegablage – du musst nichts mehr abtippen. eBay-Umsätze bucht AccountOne.</div>
              <Link className="btn" href="/anbindungen?p=stotax#stotax">Stotax Select einrichten</Link>
            </>
          ) : (
            <>
              <div className="small">
                An <strong>{cfg.address}</strong> · {cfg.auto ? "neue Rechnungen automatisch" : "nur per Knopf"} · {cfg.scope === "b2b" ? "nur B2B (eBay bucht AccountOne)" : "eBay und B2B"} · eingerichtet am {fmtDate(cfg.since)}
              </div>
              {cfg.scope === "alle" && (
                <div className="small muted">Auch eBay-Rechnungen gehen an Stotax. Bucht AccountOne die eBay-Umsätze, unter <Link href="/anbindungen?p=stotax#stotax">Anbindungen</Link> auf „Nur B2B“ stellen, damit eBay nicht doppelt ankommt.</div>
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

        <section className="card card-pad stack" style={{ gap: 8 }} data-testid="invoice-settings-summary">
          <h2>Nummern & Bank</h2>
          <div className="small">
            Nächste Nummer: <strong className="num" data-testid="next-number">{formatNumber(s, year, seq)}</strong>
            <br />
            Bank: {s.iban ? <span className="num">…{s.iban.slice(-4)}</span> : <span className="tag tag-missing">fehlt</span>} · Zahlungsziel {s.paymentDays ?? 14} Tage
          </div>
          {session.role === "owner" ? <Link className="btn btn-small" href="/einstellungen#rechnungen">In den Einstellungen ändern</Link> : <span className="small muted">Ändern kann der Inhaber unter Einstellungen.</span>}
        </section>
      </div>

      <div className="between" style={{ flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="out-filter">
          {(Object.keys(ARTEN) as (keyof typeof ARTEN)[]).map((a) => (
            <Link key={a} href={`/rechnungen/ausgang?${new URLSearchParams({ ...(a !== "alle" ? { art: a } : {}), ...(sp.q ? { q: sp.q } : {}) })}`} className={`chip${art === a ? " active" : ""}`} aria-current={art === a ? "true" : undefined}>{ARTEN[a]}</Link>
          ))}
        </div>
        <form action="/rechnungen/ausgang" style={{ width: 340, maxWidth: "100%" }} role="search">
          {art !== "alle" && <input type="hidden" name="art" value={art} />}
          <label htmlFor="oq" className="sr-only">Suche</label>
          <input className="input" id="oq" name="q" defaultValue={sp.q} placeholder="Nummer, Kunde, Bestellnummer" />
        </form>
      </div>
      <section className="card" style={{ minWidth: 0, overflow: "auto" }}>
        <table className="table sticky-head">
          <thead><tr><th>Nummer</th><th>Datum</th><th>Kunde</th><th>Art</th><th className="right">Brutto</th><th>Stotax</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">{sp.q || art !== "alle" ? "Keine Rechnung zu diesem Filter." : "Noch keine Rechnungen."}</td></tr>}
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
                    <span className="tag tag-ok" title={`gesendet ${new Date(r.stotaxSentAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`}>übertragen</span>
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
                  <a className="btn btn-small" href={`/rechnungen/ausgang/${r.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>{" "}
                  <ActionMenu testid="out-menu">
                    {r.source === "b2b" && <a className="menu-item" href={`/rechnungen/ausgang/${r.id}/xml`} title="E-Rechnung (EN 16931, CII)">E-Rechnung (XML)</a>}
                    {r.source === "b2b" && r.kind === "invoice" && (
                      <form action={mailAction}><input type="hidden" name="id" value={r.id} /><button className="menu-item" type="submit">{r.emailedAt ? "Erneut an Kunden mailen" : "An Kunden mailen"}</button></form>
                    )}
                    {r.kind === "invoice" && !r.cancelledById && (
                      <form action={cancelAction}><input type="hidden" name="id" value={r.id} /><ConfirmButton className="menu-item danger" confirm={`Rechnung ${r.number} wirklich stornieren? Es wird eine Stornorechnung mit eigener Nummer erstellt – das lässt sich nicht rückgängig machen.`} testid="cancel-btn">Stornieren …</ConfirmButton></form>
                    )}
                    {r.source !== "b2b" && r.kind !== "invoice" && <span className="menu-item muted">keine weiteren Aktionen</span>}
                  </ActionMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
