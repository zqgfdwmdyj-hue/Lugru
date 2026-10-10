import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, lte, notExists, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { ignoreInvoice, linkLot, saveInvoice, stotaxInvoiceAction, unlinkLot } from "../actions";

export default async function RechnungPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ suche?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const { suche } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.tenantId, session.tenantId)));
  if (!inv) notFound();
  const L = schema.lots;
  const P = schema.products;
  const [suppliers, linked] = await Promise.all([
    db.select().from(schema.suppliers).where(eq(schema.suppliers.tenantId, session.tenantId)).orderBy(asc(schema.suppliers.code)),
    db.select({ id: L.id, sku: L.sku, asin: P.asin, date: L.purchaseDate, cost: L.unitCostNet, by: schema.invoiceLots.matchedBy }).from(schema.invoiceLots).innerJoin(L, eq(L.id, schema.invoiceLots.lotId)).innerJoin(P, eq(P.id, L.productId)).where(eq(schema.invoiceLots.invoiceId, id)),
  ]);
  const day = inv.invoiceDate ?? todayIso();
  const candidates = inv.kind !== "expense"
    ? await db
        .select({ id: L.id, sku: L.sku, asin: P.asin, date: L.purchaseDate, cost: L.unitCostNet, gross: L.skuCostGross })
        .from(L)
        .innerJoin(P, eq(P.id, L.productId))
        .where(and(
          eq(L.tenantId, session.tenantId),
          eq(L.kind, "purchase"),
          notExists(db.select({ x: sql`1` }).from(schema.invoiceLots).where(eq(schema.invoiceLots.lotId, L.id))),
          suche ? sql`(${L.sku} ilike ${"%" + suche + "%"} or ${P.asin} ilike ${"%" + suche + "%"})` : and(gte(L.purchaseDate, addDaysIso(day, -14)), lte(L.purchaseDate, addDaysIso(day, 5)), inv.supplierId ? eq(L.supplierId, inv.supplierId) : undefined),
        ))
        .orderBy(desc(L.purchaseDate))
        .limit(40)
    : [];

  return (
    <>
      <div className="crumb"><Link href="/rechnungen">Rechnungen</Link> › {inv.sourceKey ?? "ohne Quelle"}</div>
      <div className="page-head"><h1 style={{ fontSize: 20, wordBreak: "break-all" }}>{inv.fileName}</h1></div>
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <iframe src={`/rechnungen/${inv.id}/pdf`} title="Rechnung" style={{ width: "100%", height: 720, border: "1px solid var(--border)", borderRadius: 12, background: "#fff" }} />
          {inv.kind !== "expense" && (
            <section className="card" style={{ overflow: "auto" }}>
              <div className="card-head">
                <h2>Passende Chargen ({suche ? `Suche „${suche}“` : "±2 Wochen, gleicher Shop"})</h2>
                <form style={{ display: "flex", gap: 6 }}>
                  <label htmlFor="ls" className="sr-only">Charge suchen</label>
                  <input className="input" id="ls" name="suche" defaultValue={suche} placeholder="SKU oder ASIN" style={{ width: 200, padding: "5px 8px" }} />
                </form>
              </div>
              <table className="table">
                <tbody>
                  {candidates.length === 0 && <tr><td className="muted">Keine offenen Chargen gefunden.</td></tr>}
                  {candidates.map((c) => (
                    <tr key={c.id}>
                      <td className="num small"><Link href={`/chargen/${c.id}`}>{c.sku}</Link></td>
                      <td className="num small">{formatDate(c.date)}</td>
                      <td className="num right">{formatEuro(c.gross ?? (c.cost ? Number(c.cost) * 1.19 : null))} brutto</td>
                      <td className="right"><form action={linkLot}><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="lotId" value={c.id} /><button className="btn btn-small" type="submit">Zuordnen</button></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
        <aside className="col-side">
          <form action={saveInvoice} className="card card-pad stack" style={{ gap: 10 }}>
            <input type="hidden" name="id" value={inv.id} />
            <h2>Daten</h2>
            <div className="field"><label className="label" htmlFor="kind">Art</label>
              <select className="select" id="kind" name="kind" defaultValue={inv.kind}><option value="goods">Wareneinkauf</option><option value="expense">Betriebskosten</option><option value="unknown">Unklar</option></select>
            </div>
            <div className="field"><label className="label" htmlFor="sup">Shop / Lieferant</label>
              <select className="select" id="sup" name="supplierId" defaultValue={inv.supplierId ?? ""}><option value="">–</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code}{s.name ? ` – ${s.name}` : ""}</option>)}</select>
            </div>
            <div className="field"><label className="label" htmlFor="idate">Rechnungsdatum</label><input className="input" id="idate" name="invoiceDate" defaultValue={formatDate(inv.invoiceDate) === "–" ? "" : formatDate(inv.invoiceDate)} /></div>
            <div className="field"><label className="label" htmlFor="inr">Rechnungsnummer</label><input className="input" id="inr" name="invoiceNumber" defaultValue={inv.invoiceNumber ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="onr">Bestellnummer</label><input className="input" id="onr" name="orderNumber" defaultValue={inv.orderNumber ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="gross">Betrag brutto</label><input className="input" id="gross" name="totalGross" defaultValue={inv.totalGross?.toFixed(2).replace(".", ",") ?? ""} /></div>
            {inv.sourceKey && <label className="small" style={{ display: "flex", gap: 6 }}><input type="checkbox" name="remember" defaultChecked /> Für alle Rechnungen von „{inv.sourceKey}“ merken</label>}
            <button className="btn btn-primary" type="submit">Speichern & zuordnen</button>
          </form>
          <section className="card card-pad stack">
            <h2>Zugeordnete Chargen</h2>
            {linked.length === 0 && <div className="small muted">Noch keine.</div>}
            {linked.map((l) => (
              <div key={l.id} className="between" style={{ fontSize: 12 }}>
                <Link href={`/chargen/${l.id}`} className="num">{l.sku}</Link>
                <form action={unlinkLot}><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="lotId" value={l.id} /><button className="btn-link small" type="submit" title={l.by === "auto" ? "automatisch zugeordnet" : "von Hand"}>lösen</button></form>
              </div>
            ))}
          </section>
          {inv.fileId && (
            <form action={stotaxInvoiceAction} className="small" data-testid="inv-stotax">
              <input type="hidden" name="id" value={inv.id} />
              {inv.stotaxSentAt ? (
                <span className="tag tag-ok">an Stotax übertragen am {new Date(inv.stotaxSentAt).toLocaleDateString("de-DE")}</span>
              ) : (
                <>
                  {inv.stotaxError && <div style={{ color: "var(--danger)" }}>{inv.stotaxError}</div>}
                  <button className="btn btn-small" type="submit">{inv.stotaxError ? "Erneut an Stotax senden" : "An Stotax senden"}</button>
                </>
              )}
            </form>
          )}
          {inv.status !== "ignored" && <form action={ignoreInvoice}><input type="hidden" name="id" value={inv.id} /><button className="btn-link small" type="submit">Ignorieren (keine Geschäftsrechnung)</button></form>}
        </aside>
      </div>
    </>
  );
}
