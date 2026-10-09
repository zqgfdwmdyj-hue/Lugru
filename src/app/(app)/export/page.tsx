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
          <h1>EK-Liste für AccountOne</h1>
        </div>
      </div>
      <div className="row">
        <section className="card card-pad stack" style={{ flexGrow: 1, padding: 22, gap: 14 }}>
          <p style={{ margin: 0, maxWidth: 640 }}>
            Gleiches Format wie der AccountOne-COG-Export aus Arbitrage One, aber vollständig: Retouren bekommen den EK ihrer
            Ursprungs-Charge statt 0,01 € bzw. statt zu fehlen, und je SKU gilt genau ein EK.
          </p>
          <p className="small muted" style={{ margin: 0, maxWidth: 640 }}>
            Wofür: AccountOne braucht den Einkaufspreis netto je SKU – tax.fish bewertet damit die <strong>PAN-EU-Verbringungen</strong>
            (Pro-forma-Rechnungen für Ware in Amazon-Lagern im EU-Ausland). Fehlt der EK, stimmt die Meldung nicht. Hochladen in AccountOne
            unter Benutzer → Artikelstammdaten → Einkaufspreis („EK Netto Liste hochladen“, Jahr eintragen). Sind seit dem letzten Download
            neue EKs dazugekommen, erinnert eine Aufgabe höchstens alle 4 Wochen daran.
          </p>
          <div className={`notice ${s.changedSinceExport ? "notice-warn" : "notice-ok"} small`} data-testid="cog-status">
            {s.lastExportAt
              ? `Zuletzt heruntergeladen am ${s.lastExportAt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}${s.changedSinceExport ? ` – seitdem ${s.changedSinceExport} neue/geänderte SKUs mit EK, bitte neu hochladen.` : " – seitdem nichts Neues."}`
              : `Noch nie heruntergeladen – ${s.changedSinceExport} SKUs mit EK bereit.`}
          </div>
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
