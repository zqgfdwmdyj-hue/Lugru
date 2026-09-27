import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { CHANNEL_LABEL, ORDER_STATUS_LABEL } from "@/lib/labels";
import { formatEuro } from "@/lib/numbers";
import { estimateWeightKg, loadOrder } from "@/lib/orders/service";
import { getSettings } from "@/lib/settings";
import { cancelLabelAction, cancelOrder, markShippedAction, retryTracking, saveAddress } from "../actions";
import { LabelForm } from "./label-form";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await loadOrder(session.tenantId, id);
  if (!data) notFound();
  const { order, items, parcels } = data;
  const settings = await getSettings(session.tenantId);
  const weight = estimateWeightKg(items);
  const a = order.shipTo ?? {};
  const f = (name: keyof typeof a, label: string, width?: number) => (
    <div className="field" style={width ? { width } : undefined}>
      <label className="label" htmlFor={`a-${name}`}>{label}</label>
      <input className="input" id={`a-${name}`} name={name} defaultValue={a[name] ?? ""} />
    </div>
  );

  return (
    <>
      <div className="crumb"><Link href="/auftraege">Aufträge</Link> › {CHANNEL_LABEL[order.channel]}</div>
      <div className="page-head">
        <div>
          <h1 className="num" style={{ fontSize: 22 }}>{order.externalId}</h1>
          <div className="small muted" style={{ marginTop: 4 }}>{order.orderDate.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} · {order.fulfillment} · {ORDER_STATUS_LABEL[order.status]}{order.externalStatus ? ` (${order.externalStatus})` : ""}</div>
        </div>
        {order.status === "open" && <form action={cancelOrder}><input type="hidden" name="orderId" value={order.id} /><button className="btn-link small" style={{ color: "var(--danger)" }}>Stornieren</button></form>}
      </div>

      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card" style={{ overflow: "hidden" }}>
            <div className="card-head"><h2>Artikel</h2><span className="num">{formatEuro(order.total)}</span></div>
            <table className="table">
              <thead><tr><th>SKU</th><th>Artikel</th><th className="right">Menge</th><th className="right">Preis</th><th className="right">Gewicht</th></tr></thead>
              <tbody>
                {items.map(({ item, weightGrams, productTitle }) => (
                  <tr key={item.id}>
                    <td className="num">{item.sku ?? "–"}</td>
                    <td>{item.title ?? productTitle ?? item.asin ?? "–"}</td>
                    <td className="num right">{item.quantity}</td>
                    <td className="num right">{formatEuro(item.price)}</td>
                    <td className="num right">{weightGrams ? `${weightGrams} g` : <span style={{ color: "var(--warn)" }}>fehlt</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {order.fulfillment === "FBM" && (
            <form action={saveAddress} className="card card-pad stack" style={{ gap: 12 }}>
              <input type="hidden" name="orderId" value={order.id} />
              <h2>Lieferadresse</h2>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {f("name1", "Name", 260)}{f("name2", "Zusatz / Postnummer", 220)}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {f("street", "Straße (oder Packstation 123)", 260)}{f("houseNo", "Nr.", 80)}{f("zip", "PLZ", 100)}{f("city", "Ort", 200)}{f("country", "Land", 70)}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {f("email", "E-Mail", 260)}{f("phone", "Telefon", 180)}
              </div>
              <div><button className="btn" type="submit">Adresse speichern</button></div>
            </form>
          )}
        </div>

        <aside className="col-side">
          {order.fulfillment === "FBM" && (
            <section className="card card-pad stack">
              <h2>Versand</h2>
              {order.status === "open" && <LabelForm orderId={order.id} weightKg={weight} suggestKlein={weight !== null && weight <= settings.dhl.kleinpaketMaxKg} disabled={false} />}
              {settings.dhl.sandbox && <div className="small muted">DHL-Sandbox aktiv – Labels sind Testlabels.</div>}
              {parcels.map((p) => (
                <div key={p.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 13 }}>
                  <div className="between">
                    <span className="num">{p.trackingNumber ?? "–"}</span>
                    <span className={`tag ${p.status === "created" ? "tag-ok" : p.status === "error" ? "tag-critical" : "tag-neutral"}`}>{p.status === "created" ? "LABEL" : p.status === "error" ? "FEHLER" : "STORNIERT"}</span>
                  </div>
                  <div className="small muted">{p.product} · {p.weightKg} kg · {p.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</div>
                  {p.error && <div className="small" style={{ color: "var(--danger)" }}>{p.error}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {p.labelFileId && <a className="btn btn-small" href={`/datei/${p.labelFileId}`} target="_blank" rel="noreferrer">Label drucken</a>}
                    {p.status === "created" && order.status === "label_created" && (
                      <form action={cancelLabelAction}><input type="hidden" name="parcelId" value={p.id} /><button className="btn btn-small" type="submit">Stornieren</button></form>
                    )}
                  </div>
                </div>
              ))}
              {order.status !== "shipped" && order.status !== "cancelled" && (
                <form action={markShippedAction} className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <input type="hidden" name="orderId" value={order.id} />
                  {!order.trackingNumber && (
                    <>
                      <label className="label" htmlFor="tn">Sendungsnummer (wenn anders verschickt)</label>
                      <input className="input num" id="tn" name="trackingNumber" />
                      <input type="hidden" name="carrier" value="DHL" />
                    </>
                  )}
                  <button className="btn" type="submit">Als versendet markieren & melden</button>
                </form>
              )}
              {order.trackingUploadedAt && <div className="notice notice-ok small">An {CHANNEL_LABEL[order.channel]} gemeldet am {order.trackingUploadedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</div>}
              {order.trackingUploadError && (
                <div className="notice notice-warn small">
                  {order.trackingUploadError}
                  <form action={retryTracking} style={{ marginTop: 6 }}><input type="hidden" name="orderId" value={order.id} /><button className="btn btn-small" type="submit">Erneut melden</button></form>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
