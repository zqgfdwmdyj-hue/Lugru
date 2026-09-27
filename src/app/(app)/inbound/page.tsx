import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { INBOUND_STATUS_LABEL } from "@/lib/labels";
import { createShipment } from "./actions";


export default async function InboundPage() {
  const session = await requireSession();
  const S = schema.inboundShipments;
  const rows = await db
    .select({
      s: S,
      skus: sql<number>`(select count(*)::int from inbound_items i where i.shipment_id = ${S.id})`,
      units: sql<number>`(select coalesce(sum(scanned_quantity), 0)::int from inbound_items i where i.shipment_id = ${S.id})`,
      boxes: sql<number>`(select count(*)::int from inbound_boxes b where b.shipment_id = ${S.id})`,
    })
    .from(S)
    .where(eq(S.tenantId, session.tenantId))
    .orderBy(desc(S.createdAt))
    .limit(100);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Amazon FBA</div><h1>Inbound-Sendungen</h1></div>
        <form action={createShipment} style={{ display: "flex", gap: 8 }}>
          <label htmlFor="name" className="sr-only">Name</label>
          <input className="input" id="name" name="name" placeholder={`z. B. KW ${Math.ceil((Date.now() - Date.UTC(new Date().getFullYear(), 0, 1)) / 604800000)} – Spielwaren`} style={{ width: 280 }} />
          <button className="btn btn-primary" type="submit">Neue Sendung</button>
        </form>
      </div>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>Sendung</th><th>Status</th><th>Amazon-ID</th><th className="right">Artikel</th><th className="right">Einheiten</th><th className="right">Kartons</th><th>Angelegt</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Noch keine Sendungen.</td></tr>}
            {rows.map(({ s, skus, units, boxes }) => (
              <tr key={s.id}>
                <td><Link href={`/inbound/${s.id}`}>{s.name}</Link></td>
                <td>{INBOUND_STATUS_LABEL[s.status]}</td>
                <td className="num">{s.amazonShipmentId ?? "–"}</td>
                <td className="num right">{skus}</td>
                <td className="num right">{units}</td>
                <td className="num right">{boxes}</td>
                <td className="num">{s.createdAt.toLocaleDateString("de-DE")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
