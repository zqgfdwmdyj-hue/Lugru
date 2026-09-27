import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { loadShipment, shipmentChecks } from "@/lib/inbound/service";
import { INBOUND_STATUS_LABEL } from "@/lib/labels";
import { formatEuro } from "@/lib/numbers";
import { addBox, deleteShipment, removeItem, saveProductData, setPlanned, undoLastScan, updateBox, updateShipmentStatus } from "../actions";
import { ScanPanel } from "./scan-panel";
import { db, schema } from "@/db";
import { inArray } from "drizzle-orm";

const TAG = { ok: "tag-ok", warn: "tag-warn", error: "tag-critical" } as const;

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const view = await loadShipment(session.tenantId, id);
  if (!view) notFound();
  const { shipment, items, boxes, boxItems, scans } = view;
  const checks = shipmentChecks(view);
  const editable = ["draft", "ready"].includes(shipment.status);
  const units = items.reduce((n, i) => n + i.item.scannedQuantity, 0);
  const value = items.reduce((n, i) => n + (i.cost ? Number(i.cost) * i.item.scannedQuantity : 0), 0);
  const hasErrors = checks.some((c) => c.level === "error");
  const productIds = items.map((i) => i.item.productId).filter((x): x is string => !!x);
  const products = productIds.length ? await db.select().from(schema.products).where(inArray(schema.products.id, productIds)) : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const inBox = (boxId: string) => boxItems.filter((b) => b.boxId === boxId);
  const itemById = new Map(items.map((i) => [i.item.id, i.item]));

  return (
    <>
      <div className="crumb"><Link href="/inbound">Inbound</Link> › {INBOUND_STATUS_LABEL[shipment.status]}</div>
      <div className="page-head">
        <div>
          <h1>{shipment.name}</h1>
          <div className="small muted" style={{ marginTop: 4 }}>{units} Einheiten · {items.length} Artikel · {boxes.length} Kartons · Warenwert {formatEuro(value)}{shipment.amazonShipmentId ? ` · Amazon ${shipment.amazonShipmentId}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn" href={`/etikett?sendung=${shipment.id}`} target="_blank" rel="noreferrer">Alle FNSKU-Etiketten</a>
          <a className="btn" href={`/inbound/${shipment.id}/packliste`}>Packliste (CSV)</a>
        </div>
      </div>

      <ScanPanel shipmentId={shipment.id} boxes={boxes.map((b) => ({ id: b.id, number: b.number }))} disabled={!editable} />

      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <div className="card-head">
            <h2>Artikel</h2>
            {editable && scans.length > 0 && (
              <form action={undoLastScan}><input type="hidden" name="shipmentId" value={shipment.id} /><button className="btn btn-small" type="submit">Letzten Scan rückgängig</button></form>
            )}
          </div>
          <table className="table">
            <thead><tr><th>Artikel</th><th>FNSKU</th><th className="right">EK</th><th className="right">Geplant</th><th className="right">Gescannt</th><th>Prüfung</th><th></th></tr></thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={7} className="muted">Noch nichts gescannt.</td></tr>}
              {items.map(({ item, cost }) => {
                const p = item.productId ? productById.get(item.productId) : undefined;
                return (
                  <tr key={item.id}>
                    <td style={{ maxWidth: 320 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title ?? item.asin}</div>
                      <div className="small muted num">{item.sku}</div>
                      {p && (
                        <details>
                          <summary className="small" style={{ cursor: "pointer", color: "var(--accent)" }}>Artikeldaten</summary>
                          <form action={saveProductData} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 6 }}>
                            <input type="hidden" name="productId" value={p.id} />
                            <input type="hidden" name="sku" value={item.sku} />
                            <input className="input" name="fnsku" placeholder="FNSKU" defaultValue={item.fnsku ?? ""} aria-label="FNSKU" style={{ gridColumn: "span 2", padding: "4px 6px", fontSize: 12 }} />
                            <input className="input" name="ean" placeholder="EAN" defaultValue={p.ean ?? ""} aria-label="EAN" style={{ gridColumn: "span 2", padding: "4px 6px", fontSize: 12 }} />
                            <input className="input" name="weightGrams" placeholder="g" defaultValue={p.weightGrams ?? ""} aria-label="Gewicht in Gramm" style={{ padding: "4px 6px", fontSize: 12 }} />
                            <input className="input" name="lengthCm" placeholder="L cm" defaultValue={p.lengthCm ?? ""} aria-label="Länge" style={{ padding: "4px 6px", fontSize: 12 }} />
                            <input className="input" name="widthCm" placeholder="B cm" defaultValue={p.widthCm ?? ""} aria-label="Breite" style={{ padding: "4px 6px", fontSize: 12 }} />
                            <input className="input" name="heightCm" placeholder="H cm" defaultValue={p.heightCm ?? ""} aria-label="Höhe" style={{ padding: "4px 6px", fontSize: 12 }} />
                            <input className="input" name="prep" placeholder="Prep, z. B. Beutel" defaultValue={p.prepInstructions ?? ""} aria-label="Prep" style={{ gridColumn: "span 3", padding: "4px 6px", fontSize: 12 }} />
                            <label className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" name="hazmat" defaultChecked={p.isHazmat} /> Gefahrgut</label>
                            <button className="btn btn-small" type="submit" style={{ gridColumn: "span 4" }}>Speichern</button>
                          </form>
                        </details>
                      )}
                    </td>
                    <td className="num">{item.fnsku ?? <span style={{ color: "var(--danger)" }}>fehlt</span>}</td>
                    <td className="num right">{cost ? formatEuro(cost) : "–"}</td>
                    <td className="right">
                      {editable ? (
                        <form action={setPlanned} style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <input className="input num" name="planned" defaultValue={item.plannedQuantity || ""} aria-label="Geplante Menge" style={{ width: 60, padding: "4px 6px", textAlign: "right" }} />
                        </form>
                      ) : <span className="num">{item.plannedQuantity || "–"}</span>}
                    </td>
                    <td className="num right" style={{ fontWeight: 600, fontSize: 15 }}>{item.scannedQuantity}</td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {item.checks.map((c, k) => <span key={k} className={`tag ${TAG[c.level]}`} style={{ whiteSpace: "normal" }}>{c.message}</span>)}
                      </div>
                    </td>
                    <td>
                      <a className="btn btn-small" href={`/etikett?skus=${encodeURIComponent(item.sku)}:${Math.max(1, item.scannedQuantity)}`} target="_blank" rel="noreferrer" title="Etiketten">🏷</a>
                      {editable && (
                        <form action={removeItem} style={{ display: "inline" }}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <button className="btn-link" type="submit" aria-label="Entfernen" style={{ marginLeft: 6, color: "var(--muted)" }}>×</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="col-side">
          <section className="card card-pad stack">
            <div className="between">
              <h2>Kartons</h2>
              {editable && <form action={addBox}><input type="hidden" name="shipmentId" value={shipment.id} /><button className="btn btn-small" type="submit">+ Karton</button></form>}
            </div>
            {boxes.map((b) => {
              const content = inBox(b.id);
              return (
                <div key={b.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                  <div className="between"><strong>Karton {b.number}</strong><span className="small num">{content.reduce((n, c) => n + c.quantity, 0)} Stk</span></div>
                  <form action={updateBox} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginTop: 6 }}>
                    <input type="hidden" name="boxId" value={b.id} />
                    {(["lengthCm", "widthCm", "heightCm", "weightKg"] as const).map((k) => (
                      <input key={k} className="input num" name={k} defaultValue={b[k] ?? ""} placeholder={{ lengthCm: "L", widthCm: "B", heightCm: "H", weightKg: "kg" }[k]} aria-label={k} style={{ padding: "4px 6px", fontSize: 12 }} disabled={!editable} />
                    ))}
                    {editable && <button className="btn btn-small" type="submit" style={{ gridColumn: "span 4" }}>Maße speichern</button>}
                  </form>
                  {content.length > 0 && (
                    <div className="small muted" style={{ marginTop: 6 }}>
                      {content.map((c) => `${c.quantity}× ${itemById.get(c.itemId)?.sku ?? "?"}`).join(" · ")}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <section className="card card-pad stack">
            <h2>Prüfung vor dem Absenden</h2>
            {checks.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 13 }}>
                <span style={{ color: c.level === "ok" ? "var(--ok)" : c.level === "warn" ? "var(--warn)" : "var(--danger)", fontWeight: 700 }}>{c.level === "ok" ? "✓" : c.level === "warn" ? "!" : "×"}</span>
                {c.message}
              </div>
            ))}
            <form action={updateShipmentStatus} className="stack" style={{ gap: 8, marginTop: 6 }}>
              <input type="hidden" name="shipmentId" value={shipment.id} />
              <label className="label" htmlFor="amzid">Amazon-Sendungs-ID</label>
              <input className="input num" id="amzid" name="amazonShipmentId" defaultValue={shipment.amazonShipmentId ?? ""} placeholder="FBA15…" />
              <span className="small muted">Solange die SP-API nicht verbunden ist: Sendung in Seller Central anlegen (Packliste hilft) und die ID hier eintragen – sie wird für den Abgleich beim Wareneingang gebraucht.</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {editable && <button className="btn btn-primary btn-small" name="status" value="transmitted" type="submit" disabled={hasErrors}>Übertragen</button>}
                {["transmitted", "draft", "ready"].includes(shipment.status) && <button className="btn btn-small" name="status" value="shipped" type="submit" disabled={hasErrors}>Versandt</button>}
                {["shipped", "receiving"].includes(shipment.status) && <button className="btn btn-small" name="status" value="closed" type="submit">Abschließen</button>}
                {!editable && <button className="btn btn-small" name="status" value="draft" type="submit">Zurück zu Entwurf</button>}
              </div>
              {hasErrors && <span className="small" style={{ color: "var(--danger)" }}>Erst möglich, wenn alle Fehler behoben sind.</span>}
            </form>
            {shipment.status === "draft" && items.length === 0 && (
              <form action={deleteShipment}><input type="hidden" name="shipmentId" value={shipment.id} /><button className="btn-link small" style={{ color: "var(--danger)" }} type="submit">Sendung löschen</button></form>
            )}
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 8 }}>Letzte Scans</h2>
            <div className="stack" style={{ gap: 4, fontSize: 12 }}>
              {scans.map((s) => (
                <div key={s.id} className="between">
                  <span className="num">{s.quantity > 0 ? `+${s.quantity}` : s.quantity} {s.sku ?? s.code}</span>
                  <span className="muted">{s.createdAt.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin" })}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
