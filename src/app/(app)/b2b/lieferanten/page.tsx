import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";

/** Lieferanten mit Vertriebsfreigabe-Status – Lieferanten mit Deals zuerst. */
export default async function B2bLieferantenPage() {
  const session = await requireArea("b2b");
  const S = schema.suppliers;
  const LP = schema.lieferantenProfile;
  const deals = sql<number>`(select count(*) from deals d where d.tenant_id = ${S.tenantId} and d.supplier_id = ${S.id})::int`;
  const rows = await db
    .select({ id: S.id, code: S.code, name: S.name, wv: LP.wiederverkaufErlaubt, mp: LP.marktplatzErlaubt, geprueft: LP.vertriebGeprueftAm, marken: LP.marken, deals })
    .from(S)
    .leftJoin(LP, and(eq(LP.supplierId, S.id), eq(LP.tenantId, S.tenantId)))
    .where(eq(S.tenantId, session.tenantId))
    .orderBy(sql`${deals} desc`, asc(S.code));
  const jn = (v: boolean | null) => (v === true ? <span className="tag tag-ok">ja</span> : v === false ? <span className="tag tag-danger">nein</span> : <span className="tag tag-warn">ungeklärt</span>);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/b2b">B2B-Deals</Link></div><h1>Lieferanten-Freigaben</h1></div>
      </div>
      <div className="small muted">Ein Deal lässt sich nur freischalten, wenn beim Lieferanten Wiederverkauf an Händler und Verkauf auf Marktplätzen ausdrücklich erlaubt sind (selektiver Vertrieb).</div>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table" data-testid="lieferanten-freigaben">
          <thead><tr><th>Lieferant</th><th>Wiederverkauf</th><th>Marktplatz</th><th>Geprüft</th><th>Marken</th><th className="right">Deals</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Lieferanten.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/b2b/lieferanten/${r.id}`}>{r.name ? `${r.name} (${r.code})` : r.code}</Link></td>
                <td>{jn(r.wv)}</td>
                <td>{jn(r.mp)}</td>
                <td className="small num">{r.geprueft ? r.geprueft.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }) : "–"}</td>
                <td className="small">{(r.marken ?? []).slice(0, 5).join(", ") || "–"}</td>
                <td className="num right">{r.deals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
