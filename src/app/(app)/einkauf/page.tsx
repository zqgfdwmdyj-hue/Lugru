import Link from "next/link";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { PO_STATUS_LABEL } from "@/lib/purchasing/calc";
import { NewPoForm } from "./forms";

const VIEWS = { offen: "Offen", entwuerfe: "Entwürfe", eingegangen: "Eingegangen", alle: "Alle" } as const;
type View = keyof typeof VIEWS;
const STATUS_BY_VIEW: Record<View, string[] | null> = { offen: ["ordered", "shipped", "partial"], entwuerfe: ["draft"], eingegangen: ["received"], alle: null };

export default async function EinkaufPage({ searchParams }: { searchParams: Promise<{ ansicht?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "offen";
  const t = session.tenantId;
  const PO = schema.purchaseOrders;
  const statuses = STATUS_BY_VIEW[view];
  const [orders, suppliers] = await Promise.all([
    db
      .select({
        po: PO,
        supplier: sql<string | null>`coalesce(${schema.suppliers.name}, ${schema.suppliers.code})`,
        items: sql<number>`(select count(*)::int from purchase_order_items i where i.po_id = ${PO.id})`,
        qty: sql<number>`(select coalesce(sum(i.quantity), 0)::int from purchase_order_items i where i.po_id = ${PO.id})`,
        received: sql<number>`(select coalesce(sum(i.received), 0)::int from purchase_order_items i where i.po_id = ${PO.id})`,
        total: sql<number>`(select coalesce(sum(i.quantity * i.unit_cost_gross), 0)::float from purchase_order_items i where i.po_id = ${PO.id})`,
      })
      .from(PO)
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, PO.supplierId))
      .where(and(eq(PO.tenantId, t), statuses ? inArray(PO.status, statuses as (typeof schema.PO_STATUSES)[number][]) : undefined))
      .orderBy(desc(PO.createdAt))
      .limit(300),
    db.select({ code: schema.suppliers.code, name: schema.suppliers.name }).from(schema.suppliers).where(eq(schema.suppliers.tenantId, t)).orderBy(asc(schema.suppliers.code)),
  ]);
  const today = todayIso();

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">WaWi</div><h1>Einkauf</h1></div>
        <Link className="btn" href="/einkauf/vorschlaege">Bestellvorschläge</Link>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 820 }}>
        Lieferantenbestellungen wie in JTL: bestellen → Lieferung verfolgen → Wareneingang buchen. Beim Wareneingang entsteht je Artikel eine Charge mit SKU (Schema <span className="num">SHOP_TTMONJJ_ASIN_EK_VK</span>), der Bestand im eigenen Lager steigt und die Eingangsrechnung wird über die Shop-Bestellnummer zugeordnet.
      </p>
      <div className="row">
        <div className="stack" style={{ flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={`/einkauf?ansicht=${v}`} className={`chip${view === v ? " active" : ""}`}>{VIEWS[v]}</Link>)}
          </div>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>Nummer</th><th>Lieferant</th><th>Status</th><th>Bestellt</th><th>Erwartet</th><th className="right">Menge</th><th className="right">Summe brutto</th></tr></thead>
              <tbody>
                {orders.length === 0 && <tr><td colSpan={7} className="muted">Keine Bestellungen in dieser Ansicht.</td></tr>}
                {orders.map(({ po, supplier, items, qty, received, total }) => {
                  const [label, cls] = PO_STATUS_LABEL[po.status];
                  const late = po.expectedDate && po.expectedDate < today && ["ordered", "shipped", "partial"].includes(po.status);
                  return (
                    <tr key={po.id}>
                      <td><Link href={`/einkauf/${po.id}`} style={{ fontWeight: 600 }} className="num">{po.number}</Link>{po.supplierOrderNo && <div className="small muted">{po.supplierOrderNo}</div>}</td>
                      <td>{supplier ?? "–"}</td>
                      <td><span className={`tag ${cls}`}>{label}</span>{po.invoiceId && <div className="small muted">Rechnung ✓</div>}</td>
                      <td className="num small">{po.orderDate ? formatDate(po.orderDate) : "–"}</td>
                      <td className="num small" style={late ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{po.expectedDate ? formatDate(po.expectedDate) : "–"}{late && " überfällig"}</td>
                      <td className="num right">{received > 0 && received < qty ? `${received}/` : ""}{qty}<div className="small muted">{items} Pos.</div></td>
                      <td className="num right">{formatEuro(total + (po.shippingCostGross ?? 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
        <aside className="col-side">
          <NewPoForm suppliers={suppliers} today={today} />
        </aside>
      </div>
    </>
  );
}
