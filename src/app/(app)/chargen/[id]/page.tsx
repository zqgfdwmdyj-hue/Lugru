import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { COST_SOURCE_LABEL } from "@/lib/labels";
import { formatDate, formatEuro } from "@/lib/numbers";
import { resetCost, setManualCost } from "../actions";

export default async function ChargePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const L = schema.lots;
  const [lot] = await db
    .select({
      lot: L,
      asin: schema.products.asin,
      title: schema.products.title,
      productId: schema.products.id,
      supplier: schema.suppliers.code,
      supplierName: schema.suppliers.name,
    })
    .from(L)
    .innerJoin(schema.products, eq(schema.products.id, L.productId))
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, L.supplierId))
    .where(and(eq(L.id, id), eq(L.tenantId, session.tenantId)));
  if (!lot) notFound();

  const [observations, siblings, invoices] = await Promise.all([
    db
      .select()
      .from(schema.costObservations)
      .where(and(eq(schema.costObservations.lotId, id), eq(schema.costObservations.tenantId, session.tenantId)))
      .orderBy(asc(schema.costObservations.source)),
    db
      .select({ id: L.id, sku: L.sku, kind: L.kind, cost: L.unitCostNet, date: L.purchaseDate, returnDate: L.returnDate, parentLotId: L.parentLotId })
      .from(L)
      .where(and(eq(L.tenantId, session.tenantId), eq(L.productId, lot.productId)))
      .orderBy(asc(L.purchaseDate)),
    db
      .select({ id: schema.invoices.id, fileName: schema.invoices.fileName, date: schema.invoices.invoiceDate })
      .from(schema.invoiceLots)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLots.invoiceId))
      .where(eq(schema.invoiceLots.lotId, id)),
  ]);
  const l = lot.lot;
  const parentSku = l.parentLotId ? siblings.find((s) => s.id === l.parentLotId)?.sku : undefined;

  const info: [string, React.ReactNode][] = [
    ["ASIN", <span className="num" key="a">{lot.asin}</span>],
    ["Shop", lot.supplier ? `${lot.supplier}${lot.supplierName ? ` (${lot.supplierName})` : ""}` : "–"],
    ["SKU-Schema", l.skuSchema],
    [l.kind === "return" ? "Retourendatum" : "Einkaufsdatum", `${formatDate(l.kind === "return" ? l.returnDate : l.purchaseDate)}${l.purchaseDateEstimated ? " (Jahr geschätzt)" : ""}`],
    ["FNSKU", l.fnsku ?? "–"],
    ["Menge", l.quantity ?? "–"],
    ["Rechnung", invoices.length ? invoices.map((i) => <Link key={i.id} href={`/rechnungen/${i.id}`} style={{ marginRight: 8 }}>{i.fileName}</Link>) : "keine verknüpft"],
  ];
  if (l.kind === "return") {
    info.push(["LPN", l.returnLpn ?? "–"], ["Retouren-Code", l.returnCode ?? "–"], ["Kanal", l.returnChannel ?? "–"]);
  }
  if (l.skuCostNet || l.skuCostGross || l.skuTargetPrice) {
    info.push(["Laut SKU", [l.skuCostNet && `EK netto ${formatEuro(l.skuCostNet)}`, l.skuCostGross && `EK brutto ${formatEuro(l.skuCostGross)}`, l.skuTargetPrice && `VK ${formatEuro(l.skuTargetPrice)}`].filter(Boolean).join(" · ")]);
  }

  return (
    <>
      <div className="crumb"><Link href="/chargen">Chargen</Link> › {lot.asin}</div>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="num" style={{ fontSize: 20, wordBreak: "break-all" }}>{l.sku}</h1>
          {lot.title && <div className="muted" style={{ marginTop: 4 }}>{lot.title}</div>}
        </div>
      </div>

      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card card-pad">
            <h2 style={{ marginBottom: 12 }}>Daten</h2>
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", rowGap: 8, fontSize: 14 }}>
              {info.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span className="muted">{k}</span><span>{v}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card" style={{ overflow: "hidden" }}>
            <div className="card-head"><h2>Alle Chargen dieser ASIN</h2></div>
            <table className="table">
              <thead><tr><th>SKU</th><th>Art</th><th>Datum</th><th className="right">EK netto</th></tr></thead>
              <tbody>
                {siblings.map((s) => (
                  <tr key={s.id} style={{ background: s.id === l.id ? "var(--accent-soft)" : undefined }}>
                    <td className="num"><Link href={`/chargen/${s.id}`}>{s.sku}</Link>{s.parentLotId === l.id && <span className="small muted"> · erbt von hier</span>}</td>
                    <td>{s.kind === "return" ? "Retoure" : "Einkauf"}</td>
                    <td className="num">{formatDate(s.date ?? s.returnDate)}</td>
                    <td className="num right">{s.cost === null ? "fehlt" : formatEuro(s.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="col-side">
          <section className="card card-pad stack">
            <h2>Gültiger EK</h2>
            <div className="num" style={{ fontSize: 28, color: l.unitCostNet === null ? "var(--danger)" : undefined }}>
              {l.unitCostNet === null ? "fehlt" : formatEuro(l.unitCostNet)}
            </div>
            <div className="small muted">
              Quelle: {l.unitCostSource ? COST_SOURCE_LABEL[l.unitCostSource] : "–"}
              {l.unitCostSource === "inherited" && parentSku && (
                <> von <Link href={`/chargen/${l.parentLotId}`}>{parentSku}</Link></>
              )}
            </div>
            <form action={setManualCost} style={{ display: "flex", gap: 8 }}>
              <input type="hidden" name="id" value={l.id} />
              <label htmlFor="cost" className="sr-only">EK netto manuell</label>
              <input id="cost" name="cost" className="input" inputMode="decimal" placeholder="EK netto, z. B. 12,60" required />
              <button className="btn" type="submit">Setzen</button>
            </form>
            {l.unitCostSource === "manual" && (
              <form action={resetCost}>
                <input type="hidden" name="id" value={l.id} />
                <button type="submit" className="btn-link small">Wieder automatisch ermitteln</button>
              </form>
            )}
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 10 }}>EK je Quelle</h2>
            {observations.length === 0 ? (
              <div className="small muted">Keine Quelle hat einen EK geliefert.</div>
            ) : (
              <div className="stack" style={{ fontSize: 14 }}>
                {observations.map((o) => (
                  <div key={o.id} className="between">
                    <span className="muted">{COST_SOURCE_LABEL[o.source] ?? o.source}</span>
                    <span className="num">{formatEuro(o.valueNet)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="small muted" style={{ marginBottom: 0 }}>Vorrang: manuell › eigene Vorlage › AccountOne › Sellerboard. Retouren erben vom Einkauf.</p>
          </section>
        </div>
      </div>
    </>
  );
}
