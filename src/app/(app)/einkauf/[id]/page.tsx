import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatEuro } from "@/lib/numbers";
import { netFromGross, PO_STATUS_LABEL } from "@/lib/purchasing/calc";
import { removeItemAction, setStatusAction } from "../actions";
import { AddItemForm, PoEditForm, ReceiveForm } from "../forms";

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = session.tenantId;
  const PO = schema.purchaseOrders;
  const [row] = await db
    .select({ po: PO, supplier: schema.suppliers, invoice: schema.invoices })
    .from(PO)
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, PO.supplierId))
    .leftJoin(schema.invoices, eq(schema.invoices.id, PO.invoiceId))
    .where(and(eq(PO.id, id), eq(PO.tenantId, t)));
  if (!row) notFound();
  const { po, supplier, invoice } = row;
  const items = await db.select().from(schema.purchaseOrderItems).where(and(eq(schema.purchaseOrderItems.poId, po.id), eq(schema.purchaseOrderItems.tenantId, t))).orderBy(asc(schema.purchaseOrderItems.createdAt));
  const [label, cls] = PO_STATUS_LABEL[po.status];
  const totalGross = items.reduce((s, i) => s + i.quantity * Number(i.unitCostGross), 0) + (po.shippingCostGross ?? 0);
  const totalNet = items.reduce((s, i) => s + i.quantity * netFromGross(Number(i.unitCostGross), Number(i.vatRate)), 0);
  const editable = po.status !== "received" && po.status !== "cancelled";
  const open = items.filter((i) => i.received < i.quantity).map((i) => ({ id: i.id, asin: i.asin, title: i.title, open: i.quantity - i.received }));
  const statusBtn = (status: string, text: string, primary = false) => (
    <form action={setStatusAction}><input type="hidden" name="poId" value={po.id} /><input type="hidden" name="status" value={status} /><button className={`btn${primary ? " btn-primary" : ""}`} type="submit">{text}</button></form>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/einkauf">Einkauf</Link></div>
          <h1 style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className="num">{po.number}</span> <span style={{ fontWeight: 400 }}>{supplier?.name || supplier?.code}</span> <span className={`tag ${cls}`}>{label}</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {po.status === "draft" && items.length > 0 && statusBtn("ordered", "Als bestellt markieren", true)}
          {po.status === "ordered" && statusBtn("shipped", "Ist unterwegs")}
          {po.status === "draft" && statusBtn("cancelled", "Verwerfen")}
          {(po.status === "ordered" || po.status === "shipped") && statusBtn("cancelled", "Stornieren")}
        </div>
      </div>

      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>ASIN</th><th>Artikel</th><th className="right">Menge</th><th className="right">Eingang</th><th className="right">EK brutto</th><th className="right">EK netto</th><th className="right">VK geplant</th><th>Charge / SKU</th><th></th></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={9} className="muted">Noch keine Positionen – unten ASIN, Menge und Einkaufspreis eintragen.</td></tr>}
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="num">{i.asin}</td>
                    <td style={{ maxWidth: 280 }}>{i.title ?? <span className="muted">–</span>}</td>
                    <td className="num right">{i.quantity}</td>
                    <td className="num right" style={{ color: i.received >= i.quantity ? "var(--ok)" : i.received > 0 ? "var(--warn)" : undefined }}>{i.received}</td>
                    <td className="num right">{formatEuro(Number(i.unitCostGross))}<div className="small muted">{Number(i.vatRate)} %</div></td>
                    <td className="num right">{formatEuro(netFromGross(Number(i.unitCostGross), Number(i.vatRate)))}</td>
                    <td className="num right">{i.targetPrice ? formatEuro(Number(i.targetPrice)) : "–"}</td>
                    <td className="small" style={{ overflowWrap: "anywhere", minWidth: 160 }}>{i.lotId ? <Link href={`/chargen/${i.lotId}`} className="num">{i.sku}</Link> : <span className="muted">beim Eingang</span>}</td>
                    <td>{editable && i.received === 0 && <form action={removeItemAction}><input type="hidden" name="id" value={i.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>Entfernen</button></form>}</td>
                  </tr>
                ))}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr><td colSpan={4} className="right muted">Summe netto (ohne Versand) {formatEuro(totalNet)}</td><td colSpan={5} className="num"><strong>{formatEuro(totalGross)}</strong> brutto{po.shippingCostGross ? ` inkl. ${formatEuro(po.shippingCostGross)} Versand` : ""}</td></tr>
                </tfoot>
              )}
            </table>
            {editable && <AddItemForm poId={po.id} />}
          </section>

          {["ordered", "shipped", "partial"].includes(po.status) && open.length > 0 && (
            <section className="card card-pad stack">
              <h2>Wareneingang</h2>
              <ReceiveForm poId={po.id} items={open} />
            </section>
          )}
        </div>

        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Bestellung</h2>
            {editable ? (
              <PoEditForm po={{ id: po.id, supplierOrderNo: po.supplierOrderNo, orderDate: po.orderDate, expectedDate: po.expectedDate, carrier: po.carrier, trackingNumber: po.trackingNumber, shippingCostGross: po.shippingCostGross, notes: po.notes }} />
            ) : (
              <div className="small stack" style={{ gap: 4 }}>
                <div>Shop-Bestellnummer: {po.supplierOrderNo ?? "–"}</div>
                <div>Bestellt: {po.orderDate ? formatDate(po.orderDate) : "–"}</div>
                <div>Eingegangen: {po.receivedAt ? po.receivedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }) : "–"}</div>
                {po.trackingNumber && <div>Sendung: {po.carrier} {po.trackingNumber}</div>}
                {po.notes && <div style={{ whiteSpace: "pre-wrap" }}>{po.notes}</div>}
              </div>
            )}
          </section>
          <section className="card card-pad stack small">
            <h2>Rechnung</h2>
            {invoice ? (
              <div>
                <Link href={`/rechnungen/${invoice.id}`}>{invoice.invoiceNumber ?? invoice.fileName}</Link> · {invoice.invoiceDate ? formatDate(invoice.invoiceDate) : ""} · {invoice.totalGross != null ? formatEuro(invoice.totalGross) : ""}
                {invoice.totalGross != null && Math.abs(invoice.totalGross - totalGross) > 0.05 && <div style={{ color: "var(--warn)" }}>Weicht um {formatEuro(invoice.totalGross - totalGross)} von der Bestellung ab.</div>}
              </div>
            ) : (
              <div className="muted">Noch keine zugeordnet. Rechnungen mit derselben Shop-Bestellnummer werden automatisch verknüpft (Rechnungen → Drive-Ordner).</div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
