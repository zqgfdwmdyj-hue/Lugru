import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { CHANNEL_LABEL, ORDER_STATUS_LABEL } from "@/lib/labels";
import { formatEuro } from "@/lib/numbers";
import { loadOrder } from "@/lib/orders/service";
import { orderShipWeight, skuWeightMap } from "@/lib/shipping/weights-service";
import { wawiSku } from "@/lib/stock/channel-sync";
import { getSettings } from "@/lib/settings";
import { cancelLabelAction, cancelOrder, markShippedAction, retryTracking, saveAddress, saveSkuWeightAction } from "../actions";
import { LabelForm } from "./label-form";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await loadOrder(session.tenantId, id);
  if (!data) notFound();
  const { order, items, parcels } = data;
  const settings = await getSettings(session.tenantId);
  // Versandgewicht: einmal je Artikel eingetragen × Stück, sonst Artikeldaten + Verpackung (Schätzwert nicht vorbelegen).
  const sw = await orderShipWeight(session.tenantId, data);
  const weight = sw.source === "geschaetzt" ? null : sw.kg;
  // Versandgewicht je Stück pro Position (an der Lager-SKU) – hier direkt eintragbar.
  const keys = await Promise.all(items.map((i) => (i.item.sku ? wawiSku(session.tenantId, order.channel, i.item.sku) : Promise.resolve(null))));
  const skuGrams = await skuWeightMap(session.tenantId, keys.filter((k): k is string => Boolean(k)));
  const kgText = (g: number) => (g / 1000).toLocaleString("de-DE", { maximumFractionDigits: 3 });
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
      {order.notes && <div className="notice notice-warn" data-testid="order-notes">{order.notes}</div>}

      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card" style={{ overflow: "hidden" }}>
            <div className="card-head"><h2>Artikel</h2><span className="num">{formatEuro(order.total)}</span></div>
            <table className="table">
              <thead><tr><th>SKU</th><th>Artikel</th><th className="right">Menge</th><th className="right">Preis</th><th className="right">Versandgewicht je Stück</th></tr></thead>
              <tbody>
                {items.map(({ item, weightGrams, productTitle }, n) => {
                  const key = keys[n];
                  const g = key ? skuGrams.get(key) ?? null : null;
                  return (
                    <tr key={item.id}>
                      <td className="num">{item.sku ?? "–"}</td>
                      <td>{item.title ?? productTitle ?? item.asin ?? <span className="muted">Name unbekannt</span>}</td>
                      <td className="num right">{item.quantity}</td>
                      <td className="num right">{formatEuro(item.price)}</td>
                      <td className="right">
                        {key ? (
                          <form action={saveSkuWeightAction} style={{ display: "inline-flex", gap: 4, alignItems: "center", justifyContent: "flex-end" }} data-testid="item-weight">
                            <input type="hidden" name="orderId" value={order.id} />
                            <input type="hidden" name="sku" value={key} />
                            <input className="input" name="kg" defaultValue={g !== null ? kgText(g) : ""} placeholder={weightGrams ? kgText(weightGrams) : "0,3"} inputMode="decimal" aria-label={`Versandgewicht je Stück ${item.sku}`} style={{ width: 70, padding: "4px 6px" }} />
                            <span className="small muted">kg</span>
                            <button className="btn btn-small" type="submit">Speichern</button>
                          </form>
                        ) : (
                          <span className="muted">–</span>
                        )}
                        {key && g === null && <div className="small" style={{ color: "var(--warn)" }}>{weightGrams ? `Artikeldaten ${weightGrams} g + Verpackung` : "fehlt – wird geschätzt"}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="small muted" style={{ padding: "8px 14px" }} data-testid="order-weight-sum">Sendung: {sw.note} · gilt für alle Aufträge mit diesem Artikel (Amazon und eBay)</div>
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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn btn-primary" type="submit">Adresse speichern</button>
                <a className="btn" href={`/auftraege/adressetiketten?ids=${order.id}`} target="_blank" rel="noreferrer" data-testid="address-label" title="Nur Name und Anschrift – Brother QL-800, Papier 62 mm × 29 mm, Skalierung 100 %">Adressetikett 62 × 29 mm</a>
              </div>
            </form>
          )}
        </div>

        <aside className="col-side">
          {order.fulfillment === "FBM" && (
            <section className="card card-pad stack">
              <h2>Versand</h2>
              {order.status === "open" && <LabelForm orderId={order.id} weightKg={weight} suggestKlein={weight !== null && weight <= settings.dhl.kleinpaketMaxKg} disabled={false} />}
              {order.status === "open" && weight !== null && <div className="small muted" data-testid="order-weight-note">Gewicht: {sw.note}</div>}
              {order.status === "open" && (
                <Link className="btn btn-small" href={`/auftraege/lieferschein?ids=${order.id}`} data-testid="order-warensendung">Als Warensendung / automatisch …</Link>
              )}
              {settings.dhl.sandbox && <div className="small muted">DHL-Sandbox aktiv – Labels sind Testlabels.</div>}
              {parcels.map((p) => (
                <div key={p.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 13 }}>
                  <div className="between">
                    <span className="num">{p.carrier !== "DHL" ? `${p.carrier}${p.trackingNumber ? ` · Frankier-ID ${p.trackingNumber}` : ""}` : p.trackingNumber ?? "–"}</span>
                    <span className={`tag ${p.status === "created" ? "tag-ok" : p.status === "error" ? "tag-critical" : "tag-neutral"}`}>{p.status === "created" ? "LABEL" : p.status === "error" ? "FEHLER" : "STORNIERT"}</span>
                  </div>
                  <div className="small muted">{p.product} · {p.weightKg} kg · {p.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</div>
                  {p.error && <div className="small" style={{ color: "var(--danger)" }}>{p.error}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {p.labelFileId && <a className="btn btn-small" href={`/datei/${p.labelFileId}`} target="_blank" rel="noreferrer">Label drucken</a>}
                    {p.status === "created" && order.status === "label_created" && (
                      p.carrier !== "DHL" ? (
                        <form action={cancelLabelAction}><input type="hidden" name="parcelId" value={p.id} /><ConfirmButton className="btn btn-small" confirm={`Warensendung verwerfen? Der Auftrag ist danach wieder offen. Das Porto erstattet die Post nicht automatisch – Erstattung in der Portokasse beantragen${p.trackingNumber ? ` (Frankier-ID ${p.trackingNumber})` : ""}.`}>Verwerfen</ConfirmButton></form>
                      ) : (
                        <form action={cancelLabelAction}><input type="hidden" name="parcelId" value={p.id} /><button className="btn btn-small" type="submit">Stornieren</button></form>
                      )
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
