import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { kuerzelZuordnenAction } from "./actions";

/** Lieferanten mit Vertriebsfreigabe-Status – Lieferanten mit Deals zuerst. */
export default async function B2bLieferantenPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const sp = await searchParams;
  const session = await requireArea("b2b");
  const S = schema.suppliers;
  const LP = schema.lieferantenProfile;
  const deals = sql<number>`(select count(*) from deals d where d.tenant_id = ${S.tenantId} and d.supplier_id = ${S.id})::int`;
  const rows = await db
    .select({ id: S.id, code: S.code, name: S.name, kuerzel: S.skuKuerzel, gehoertZu: S.gehoertZu, wv: LP.wiederverkaufErlaubt, mp: LP.marktplatzErlaubt, geprueft: LP.vertriebGeprueftAm, marken: LP.marken, deals })
    .from(S)
    .leftJoin(LP, and(eq(LP.supplierId, S.id), eq(LP.tenantId, S.tenantId)))
    .where(eq(S.tenantId, session.tenantId))
    .orderBy(sql`${deals} desc`, asc(S.code));
  // B15.12: SKU-Kürzel (z. B. „MUE“ aus MUE_…) sind keine Lieferanten – eigene Liste mit Zuordnung.
  const kuerzel = rows.filter((r) => r.kuerzel);
  const lieferanten = rows.filter((r) => !r.kuerzel);
  const nameVon = new Map(lieferanten.map((r) => [r.id, r.name ? `${r.name} (${r.code})` : r.code]));
  const jn = (v: boolean | null) => (v === true ? <span className="tag tag-ok">ja</span> : v === false ? <span className="tag tag-danger">nein</span> : <span className="tag tag-warn">ungeklärt</span>);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/b2b">B2B-Deals</Link></div><h1>Lieferanten-Freigaben</h1></div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status">{sp.meldung}</div>}
      <div className="small muted">Ein Deal lässt sich nur freischalten, wenn beim Lieferanten Wiederverkauf an Händler und Verkauf auf Marktplätzen ausdrücklich erlaubt sind (selektiver Vertrieb).</div>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table" data-testid="lieferanten-freigaben">
          <thead><tr><th>Lieferant</th><th>Wiederverkauf</th><th>Marktplatz</th><th>Geprüft</th><th>Marken</th><th className="right">Deals</th></tr></thead>
          <tbody>
            {lieferanten.length === 0 && <tr><td colSpan={6} className="muted">Noch keine Lieferanten.</td></tr>}
            {lieferanten.map((r) => (
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
      {kuerzel.length > 0 && (
        <section className="card" style={{ overflow: "auto" }} id="kuerzel" data-testid="sku-kuerzel">
          <div className="card-head">
            <div>
              <h2>SKU-Kürzel ({kuerzel.length}) – keine Lieferanten</h2>
              <div className="small muted" style={{ marginTop: 2 }}>Kürzel aus Artikelnummern (z. B. „MUE“ in MUE_…). Sie stehen nicht in der Freigabe-Liste. Optional einem echten Lieferanten zuordnen – oder, falls es doch einer ist, als Lieferant führen.</div>
            </div>
          </div>
          <table className="table">
            <thead><tr><th>Kürzel</th><th>gehört zu</th><th></th></tr></thead>
            <tbody>
              {kuerzel.map((k) => (
                <tr key={k.id}>
                  <td className="num">{k.code}</td>
                  <td>
                    <form action={kuerzelZuordnenAction} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <input type="hidden" name="kuerzelId" value={k.id} />
                      <select className="select" name="gehoertZu" defaultValue={k.gehoertZu ?? ""} aria-label={`Lieferant für ${k.code}`}>
                        <option value="">– nicht zugeordnet –</option>
                        {lieferanten.map((l) => <option key={l.id} value={l.id}>{nameVon.get(l.id)}</option>)}
                      </select>
                      <button className="btn btn-small" type="submit">Zuordnen</button>
                    </form>
                  </td>
                  <td className="right">
                    <form action={kuerzelZuordnenAction}>
                      <input type="hidden" name="kuerzelId" value={k.id} />
                      <input type="hidden" name="alsLieferant" value="1" />
                      <button className="btn btn-small" type="submit" data-testid="kuerzel-als-lieferant">Ist ein Lieferant</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
