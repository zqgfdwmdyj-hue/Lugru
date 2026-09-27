import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { cogSummary } from "@/lib/exports/cog";

export default async function ExportPage() {
  const session = await requireSession();
  const s = await cogSummary(session.tenantId);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Buchhaltung</div>
          <h1>COG-Export für AccountOne</h1>
        </div>
      </div>
      <div className="row">
        <section className="card card-pad stack" style={{ flexGrow: 1, padding: 22, gap: 14 }}>
          <p style={{ margin: 0, maxWidth: 640 }}>
            Gleiches Format wie der AccountOne-COG-Export aus Arbitrage One, aber vollständig: Retouren bekommen den EK ihrer
            Ursprungs-Charge statt 0,01 € bzw. statt zu fehlen, und je SKU gilt genau ein EK.
          </p>
          <form action="/export/accountone" method="get" className="stack" style={{ gap: 12, maxWidth: 460 }}>
            <div className="field">
              <label className="label" htmlFor="account">AccountOne-Konto-ID (source_account_id, optional)</label>
              <input id="account" name="account" className="input" placeholder="leer lassen, wenn die Spalte entfallen soll" />
            </div>
            <div>
              <button className="btn btn-primary" type="submit">CSV herunterladen</button>
            </div>
          </form>
        </section>
        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Inhalt</h2>
            <div className="between"><span className="muted">Zeilen im Export</span><span className="num">{s.withCost}</span></div>
            <div className="between"><span className="muted">davon Retouren mit geerbtem EK</span><span className="num">{s.inherited}</span></div>
            <div className="between">
              <span className="muted">nicht enthalten (EK fehlt)</span>
              <Link className="num" href="/chargen?filter=ohne-ek" style={{ color: s.withoutCost ? "var(--danger)" : undefined }}>{s.withoutCost}</Link>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
