import Link from "next/link";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { carrierList, removalParcels } from "@/lib/claims/rules";
import { CopyButton } from "@/components/copy-button";
import { confirmRemovalReceipt, markRemovalShipment } from "./actions";

export default async function RemissionenPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; suche?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view = sp.ansicht === "alle" ? "alle" : "offen";
  const search = (sp.suche ?? "").trim().slice(0, 60);
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

  // Pakete je Auftrag + Sendungsnummer (Discord-Ablauf: abgeschlossene Remissionen, Versender TENDRON, nie angekommen).
  const allOrders = view === "offen" ? await db.select().from(R).where(eq(R.tenantId, t)) : orders;
  const marks = await db.select().from(schema.amazonRemovalShipmentMarks).where(eq(schema.amazonRemovalShipmentMarks.tenantId, t));
  const today = todayIso();
  const stuckWindow = settings.claims.windowDays.removal_shipment_stuck;
  const parcels = removalParcels(
    {
      removals: allOrders,
      removalShipments: shipments.map((s) => ({ ...s, quantity: s.shippedQuantity })),
      removalShipmentMarks: marks,
    },
    carrierList(settings.claims.problemCarriers),
    stuckWindow,
  )
    .filter((p) => !p.confirmed && p.mark !== "received" && (p.problemCarrier || p.mark === "lost"))
    .sort((a, b) => (a.claimUntil ?? "").localeCompare(b.claimUntil ?? ""));
  const claimRows = parcels.length
    ? await db
        .select({ id: schema.claims.id, key: schema.claims.detectionKey, status: schema.claims.status })
        .from(schema.claims)
        .where(and(eq(schema.claims.tenantId, t), sql`${schema.claims.detectionKey} like 'removal-ship:%'`))
    : [];
  const claimByKey = new Map(claimRows.map((c) => [c.key, c]));
  const summary = parcels
    .map((p) => `${p.orderId}\t${p.carrier ?? ""}\t${p.trackingNumber}\t${p.lines.map((l) => `${l.fnsku ?? l.sku} x ${l.quantity}`).join(", ")}`)
    .join("\n");

  // Stichwortsuche in allen Remissionssendungen (Versender, Sendungsnummer, Auftrag, SKU, FNSKU).
  const q = search.toLowerCase();
  const hits = q
    ? shipments
        .filter((s) => [s.carrier, s.trackingNumber, s.orderId, s.sku, s.fnsku].some((v) => (v ?? "").toLowerCase().includes(q)))
        .sort((a, b) => (b.requestDate ?? "").localeCompare(a.requestDate ?? ""))
    : [];
  const hitCsv = hits.map((s) => `${s.orderId}\t${formatDate(s.requestDate)}\t${s.carrier ?? ""}\t${s.trackingNumber ?? ""}\t${s.fnsku ?? s.sku ?? ""}\t${s.shippedQuantity}`).join("\n");

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
          <Link className="btn btn-primary btn-small" href="/remissionen/erfassen">Tendron-Pakete aus Seller Central holen</Link>
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

      <section className="card card-pad stack" style={{ gap: 10 }} id="suche">
        <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
          <h2>Remissionssendungen durchsuchen</h2>
          <form method="get" action="/remissionen#suche" style={{ display: "flex", gap: 6 }}>
            {view === "alle" && <input type="hidden" name="ansicht" value="alle" />}
            <label className="sr-only" htmlFor="suche">Stichwort</label>
            <input className="input" id="suche" name="suche" defaultValue={search} placeholder="Stichwort, z. B. tendron" style={{ width: 220 }} />
            <button className="btn" type="submit">Suchen</button>
            <Link className="btn btn-primary" href="/remissionen?suche=tendron#suche">Tendron</Link>
          </form>
        </div>
        {q && (
          <>
            <div className="between small">
              <span>{hits.length} Sendungszeilen mit „{search}“ (Auftrag, Sendungsnummer, FNSKU, Anzahl)</span>
              {hits.length > 0 && <CopyButton text={`Auftrag\tAuftragsdatum\tVersender\tSendungsnummer\tFNSKU\tAnzahl\n${hitCsv}`} label="Treffer kopieren" />}
            </div>
            <div style={{ overflow: "auto" }}>
              <table className="table" data-testid="search-hits">
                <thead><tr><th>Auftrag</th><th>Auftragsdatum</th><th>Versender</th><th>Sendungsnummer</th><th>FNSKU / SKU</th><th className="right">Anzahl</th></tr></thead>
                <tbody>
                  {hits.length === 0 && <tr><td colSpan={6} className="muted">Keine Treffer. Bericht „Remissionssendungen“ importiert?</td></tr>}
                  {hits.map((s) => (
                    <tr key={s.id}>
                      <td className="num">{s.orderId}</td>
                      <td className="num">{formatDate(s.requestDate)}</td>
                      <td>{/tendron/i.test(s.carrier ?? "") ? <span className="tag tag-warn">{s.carrier}</span> : s.carrier ?? "–"}</td>
                      <td className="num">{s.trackingNumber ?? "–"}</td>
                      <td className="num small">{s.fnsku ?? "–"}<div className="muted">{s.sku}</div></td>
                      <td className="num right">{s.shippedQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card" style={{ overflow: "auto" }} id="haengend">
        <div className="card-head">
          <h2>Hängende Sendungen – Stichwort {settings.claims.problemCarriers || "TENDRON"}{parcels.length ? ` (${parcels.length})` : ""}</h2>
          <span className="small muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            Fall ab Tag 15 bis Tag {stuckWindow} nach Auftrag
            {parcels.length > 0 && <CopyButton text={`Auftrag\tVersender\tSendungsnummer\tFNSKU x Anzahl\n${summary}`} label="Liste kopieren" />}
          </span>
        </div>
        <table className="table">
          <thead><tr><th>Auftrag</th><th>Versender / Sendung</th><th>FNSKU × Anzahl</th><th>Sendungsverfolgung</th><th>Fall-Fenster</th><th>Anspruch</th><th>Bei dir?</th></tr></thead>
          <tbody>
            {parcels.length === 0 && <tr><td colSpan={7} className="muted">Keine hängenden Pakete. Über „Tendron-Pakete aus Seller Central holen“ die Auftragsseiten einlesen – oder den Bericht „Remissionssendungen“ importieren.</td></tr>}
            {parcels.map((p) => {
              const claim = claimByKey.get(`removal-ship:${p.orderId}:${p.trackingNumber}`);
              const early = p.claimFrom !== null && p.claimFrom > today;
              const late = p.claimUntil !== null && p.claimUntil < today;
              return (
                <tr key={p.key} data-testid="stuck-parcel">
                  <td className="num">{p.orderId}<div className="small muted">{formatDate(p.requestDate)}</div></td>
                  <td>
                    {p.problemCarrier ? <span className="tag tag-warn">{p.carrier}</span> : <span className="small">{p.carrier ?? "–"}</span>}
                    <div className="num small">{p.trackingNumber}</div>
                    <div className="small muted">versandt {formatDate(p.shipmentDate)}</div>
                  </td>
                  <td className="small num">{p.lines.map((l) => <div key={l.fnsku ?? l.sku}>{l.fnsku ?? l.sku} × {l.quantity}</div>)}</td>
                  <td className="small" style={{ maxWidth: 240 }}>
                    {p.lastEventAt ? (
                      <>
                        <span className="num">{formatDate(p.lastEventAt)}</span>
                        <div className="muted">{p.lastEvent}</div>
                      </>
                    ) : <span className="muted">–</span>}
                  </td>
                  <td className="small num" style={{ color: late ? "var(--danger)" : undefined }}>
                    {formatDate(p.claimFrom)} – {formatDate(p.claimUntil)}
                    <div className="muted">{early ? "noch zu früh" : late ? "Frist abgelaufen" : "jetzt einreichen"}</div>
                  </td>
                  <td className="small">{claim ? <Link href={`/ansprueche/${claim.id}`}>Fall öffnen</Link> : early ? "kommt ab Tag 15" : "–"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(["received", "lost"] as const).map((st) => (
                        <form key={st} action={markRemovalShipment}>
                          <input type="hidden" name="orderId" value={p.orderId} />
                          <input type="hidden" name="tracking" value={p.trackingNumber} />
                          <input type="hidden" name="status" value={p.mark === st ? "clear" : st} />
                          <button className={`btn btn-small${p.mark === st ? " btn-primary" : ""}`} type="submit" title={st === "lost" ? "Nie angekommen – sofort als Anspruch" : "Paket ist bei dir angekommen"}>
                            {st === "received" ? "Angekommen" : p.mark === "lost" ? "Fehlt ✓" : "Fehlt"}
                          </button>
                        </form>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
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
