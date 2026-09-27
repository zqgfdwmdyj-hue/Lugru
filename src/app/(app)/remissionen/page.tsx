import Link from "next/link";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { confirmRemovalReceipt } from "./actions";

export default async function RemissionenPage({ searchParams }: { searchParams: Promise<{ ansicht?: string }> }) {
  const session = await requireSession();
  const view = (await searchParams).ansicht === "alle" ? "alle" : "offen";
  const t = session.tenantId;
  const settings = await getSettings(t);
  const R = schema.amazonRemovalOrders;
  const orders = await db
    .select()
    .from(R)
    .where(and(eq(R.tenantId, t), view === "offen" ? sql`${R.shippedQuantity} > 0 and ${R.receivedQuantity} is null and lower(coalesce(${R.orderType}, '')) not like '%dispos%'` : undefined))
    .orderBy(desc(R.requestDate))
    .limit(300);
  const shipments = await db.select().from(schema.amazonRemovalShipments).where(eq(schema.amazonRemovalShipments.tenantId, t));
  const tracking = new Map<string, string[]>();
  for (const s of shipments) {
    if (!s.trackingNumber) continue;
    const k = `${s.orderId}|${s.sku}`;
    tracking.set(k, [...new Set([...(tracking.get(k) ?? []), `${s.carrier ?? ""} ${s.trackingNumber}`.trim()])]);
  }

  const I = schema.amazonInventory;
  const warnBefore = addDaysIso(todayIso(), -settings.aging.unsellableWarnDays);
  const unsellable = await db
    .select({ sku: I.sku, fnsku: I.fnsku, asin: I.asin, title: I.title, unsellable: I.unsellable, since: I.unsellableSince, cost: schema.lots.unitCostNet })
    .from(I)
    .leftJoin(schema.lots, and(eq(schema.lots.tenantId, t), eq(schema.lots.sku, I.sku)))
    .where(and(eq(I.tenantId, t), gt(I.unsellable, 0)))
    .orderBy(I.unsellableSince);

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Amazon FBA</div><h1>Remissionen</h1></div>
        <div style={{ display: "flex", gap: 6 }}>
          <Link className={`chip${view === "offen" ? " active" : ""}`} href="/remissionen">Eingang offen</Link>
          <Link className={`chip${view === "alle" ? " active" : ""}`} href="/remissionen?ansicht=alle">Alle Aufträge</Link>
        </div>
      </div>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-head">
          <h2>{view === "offen" ? "Versandt – Eingang bei dir bestätigen" : "Remissions- und Entsorgungsaufträge"}</h2>
          <span className="small muted">Fehlmengen werden automatisch zum Anspruch</span>
        </div>
        <table className="table">
          <thead><tr><th>Auftrag</th><th>Art</th><th>SKU</th><th>Zustand</th><th className="right">Angefordert</th><th className="right">Versandt</th><th className="right">Entsorgt</th><th>Sendung</th><th>Angekommen</th></tr></thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={9} className="muted">Keine Aufträge. Remissions-Reports unter „Daten importieren“ hochladen.</td></tr>}
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="num">{o.orderId}<div className="small muted">{formatDate(o.requestDate)} · {o.orderStatus ?? ""}</div></td>
                <td>{o.orderType ?? "–"}</td>
                <td className="num">{o.sku}</td>
                <td className="small">{o.disposition}</td>
                <td className="num right">{o.requestedQuantity}</td>
                <td className="num right">{o.shippedQuantity}</td>
                <td className="num right">{o.disposedQuantity}</td>
                <td className="small">{(tracking.get(`${o.orderId}|${o.sku}`) ?? []).join(", ") || "–"}</td>
                <td>
                  {o.shippedQuantity > 0 && !/dispos/i.test(o.orderType ?? "") ? (
                    <form action={confirmRemovalReceipt} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="id" value={o.id} />
                      <label className="sr-only" htmlFor={`rcv-${o.id}`}>Angekommen</label>
                      <input className="input" id={`rcv-${o.id}`} name="received" type="number" min={0} defaultValue={o.receivedQuantity ?? o.shippedQuantity} style={{ width: 70, padding: "4px 8px" }} />
                      <button className="btn btn-small" type="submit">{o.receivedQuantity === null ? "Bestätigen" : "Ändern"}</button>
                    </form>
                  ) : "–"}
                  {o.receivedQuantity !== null && o.receivedQuantity < o.shippedQuantity && <div className="small" style={{ color: "var(--danger)" }}>{o.shippedQuantity - o.receivedQuantity} fehlen</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ overflow: "auto" }}>
        <div className="card-head">
          <h2>Unverkäuflicher Bestand bei Amazon</h2>
          <span className="small muted">Früh remissionieren – bevor Amazon entsorgt oder keine Erstattung mehr möglich ist</span>
        </div>
        <table className="table">
          <thead><tr><th>SKU</th><th>Artikel</th><th className="right">Unverkäuflich</th><th>Seit (beobachtet)</th><th className="right">Wert (EK)</th></tr></thead>
          <tbody>
            {unsellable.length === 0 && <tr><td colSpan={5} className="muted">Kein unverkäuflicher Bestand bekannt. Den FBA-Bestandsbericht importieren.</td></tr>}
            {unsellable.map((u) => {
              const old = u.since !== null && u.since <= warnBefore;
              return (
                <tr key={u.sku}>
                  <td className="num">{u.sku}</td>
                  <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.title ?? u.asin}</td>
                  <td className="num right">{u.unsellable}</td>
                  <td className="num" style={{ color: old ? "var(--danger)" : undefined }}>{formatDate(u.since)}{old ? " – Remission beauftragen!" : ""}</td>
                  <td className="num right">{u.cost ? formatEuro(Number(u.cost) * u.unsellable) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
