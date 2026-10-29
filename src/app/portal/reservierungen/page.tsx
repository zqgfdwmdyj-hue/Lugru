import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePortal } from "@/lib/b2b/portal-auth";
import { RES_STATUS_TAG, RES_STATUS_TEXT } from "@/lib/b2b/logic";

const eur = (n: number | null) => (n === null ? "–" : `${n.toFixed(2).replace(".", ",")} €`);

/** Nur die eigenen Reservierungen, Rechnungen und Gutschriften des angemeldeten Kunden. */
export default async function PortalReservierungenPage() {
  const s = await requirePortal();
  const R = schema.dealReservierungen;
  const D = schema.deals;
  const rows = await db
    .select({ r: R, nr: D.nr, titel: D.titel, asin: D.asin, dealId: D.id })
    .from(R)
    .innerJoin(D, and(eq(D.id, R.dealId), eq(D.tenantId, R.tenantId)))
    .where(and(eq(R.tenantId, s.tenantId), eq(R.kundeId, s.kundeId)))
    .orderBy(desc(R.createdAt))
    .limit(200);
  return (
    <>
      <h1 style={{ margin: 0 }}>Meine Reservierungen</h1>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table" data-testid="portal-reservierungen">
          <thead><tr><th>Deal</th><th className="right">Menge</th><th className="right">Preis netto</th><th>Status</th><th>Rechnung</th><th>Gutschrift</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Reservierungen.</td></tr>}
            {rows.map(({ r, nr, titel, asin, dealId }) => (
              <tr key={r.id}>
                <td><Link href={`/portal/deals/${dealId}`}>#{nr} {titel}</Link><div className="small muted num">{asin}</div></td>
                <td className="num right">{r.menge}{r.zugeteilt !== null && r.zugeteilt !== r.menge ? <div className="small">geliefert {r.zugeteilt}</div> : null}</td>
                <td className="num right">{eur(r.preisNetto)}</td>
                <td><span className={`tag ${RES_STATUS_TAG[r.status]}`}>{RES_STATUS_TEXT[r.status]}</span></td>
                <td className="small num">{r.rechnungNr ? <a href={`/portal/beleg/${r.id}/rechnung`} target="_blank" rel="noreferrer">{r.rechnungNr}</a> : "–"}{r.rechnungBrutto !== null ? <div>{eur(r.rechnungBrutto)}{r.bezahltAm ? " · bezahlt" : ""}</div> : null}</td>
                <td className="small num">{r.gutschriftBetrag !== null ? <a href={`/portal/beleg/${r.id}/gutschrift`} target="_blank" rel="noreferrer">{eur(r.gutschriftBetrag)}</a> : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
