import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { qcol } from "@/db/qcol";
import { CHANNELS } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { CHANNEL_LABEL, ORDER_STATUS_LABEL } from "@/lib/labels";
import { formatEuro } from "@/lib/numbers";
import { itemNameSql, type OrderItemLine } from "@/lib/orders/service";
import { bestaetigungHochgeladen, createManualOrder, fetchOrdersNow, markAllLabeledShipped } from "./actions";
import { offeneBestaetigungen } from "@/lib/orders/bestaetigung";
import { BatchForm } from "./batch-form";
import { openLabels } from "@/lib/shipping/label-pdfs";
import { searchOrderIds } from "@/lib/orders/search";

const VIEWS = { offen: "Zu versenden", label: "Label erstellt", versendet: "Versendet", fehler: "Meldung offen", fba: "FBA", alle: "Alle" } as const;
type View = keyof typeof VIEWS;

export default async function AuftraegePage({ searchParams }: { searchParams: Promise<{ ansicht?: string; kanal?: string; meldung?: string; q?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  // Suche (Name, Bestellnummer, Ort/PLZ, Artikel) über alle Status – z. B. „schon übertragen?“
  const q = (sp.q ?? "").trim().slice(0, 100);
  const hits = q ? await searchOrderIds(session.tenantId, q) : null;
  const view: View = hits ? "alle" : sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "offen";
  const O = schema.orders;
  const where: SQL[] = [eq(O.tenantId, session.tenantId)];
  if (hits) where.push(hits.length ? inArray(O.id, hits) : sql`false`);
  if (CHANNELS.includes(sp.kanal as never)) where.push(eq(O.channel, sp.kanal as never));
  if (!hits) switch (view) {
    case "offen": where.push(eq(O.fulfillment, "FBM"), eq(O.status, "open")); break;
    case "label": where.push(eq(O.status, "label_created")); break;
    case "versendet": where.push(eq(O.fulfillment, "FBM"), inArray(O.status, ["shipped", "delivered"])); break;
    // Meldung offen: versendet, aber dem Kanal nicht gemeldet – Amazon auch ohne Sendungsnummer (z. B. Prep Center).
    case "fehler": where.push(eq(O.fulfillment, "FBM"), sql`${O.trackingUploadedAt} is null and ((${O.channel} = 'amazon' and ${O.status} in ('shipped', 'delivered') and coalesce(lower(${O.externalStatus}), '') not in ('shipped', 'delivered', 'canceled', 'cancelled')) or ${O.trackingNumber} is not null or (${O.carrier} = 'Deutsche Post' and ${O.status} = 'shipped'))`); break;
    case "fba": where.push(eq(O.fulfillment, "FBA")); break;
  }
  const orders = await db
    .select({
      o: O,
      items: sql<OrderItemLine[] | null>`(select json_agg(json_build_object('q', i.quantity, 'sku', i.sku, 'name', ${itemNameSql})) from order_items i where i.order_id = ${qcol(O.id)} and i.tenant_id = ${session.tenantId})`,
    })
    .from(O)
    .where(and(...where))
    .orderBy(view === "offen" ? sql`${O.shipBy} asc nulls last` : desc(O.orderDate))
    .limit(300);
  const bestaetigung = view === "fehler" ? await offeneBestaetigungen(session.tenantId, new Date(), { ohneWartezeit: true }) : [];
  const counts = await db
    .select({ channel: O.channel, n: sql<number>`count(*)::int` })
    .from(O)
    .where(and(eq(O.tenantId, session.tenantId), eq(O.fulfillment, "FBM"), eq(O.status, "open")))
    .groupBy(O.channel);

  // „Label erstellt“: alle fertigen Label-PDFs auf einmal drucken (Warensendungen per CSV haben keins).
  const labelsOpen = view === "label" && orders.length ? await openLabels(session.tenantId, sp.kanal ? orders.map(({ o }) => o.id) : undefined) : null;
  const link = (v: View) => `/auftraege?ansicht=${v}${sp.kanal ? `&kanal=${sp.kanal}` : ""}`;
  const table = (
    <section className="card" style={{ overflow: "auto" }}>
      <table className="table sticky-head">
        <thead><tr><th style={{ width: 28 }}></th><th>Kanal</th><th>Bestellung</th><th>Datum</th><th>Empfänger</th><th>Artikel</th><th className="right">Summe</th><th>Status</th><th>Sendung</th></tr></thead>
        <tbody>
          {orders.length === 0 && <tr><td colSpan={9} className="muted">Keine Aufträge in dieser Ansicht.</td></tr>}
          {orders.map(({ o, items }) => (
            <tr key={o.id}>
              <td>{view === "offen" && <input type="checkbox" name="ids" value={o.id} aria-label="Auswählen" defaultChecked />}</td>
              <td><span className="tag tag-neutral">{CHANNEL_LABEL[o.channel]}</span></td>
              <td className="num"><Link href={`/auftraege/${o.id}`}>{o.externalId}</Link></td>
              <td className="num">{o.orderDate.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</td>
              <td>{o.shipTo?.name1 ?? o.buyerName ?? "–"}<div className="small muted">{[o.shipTo?.zip, o.shipTo?.city].filter(Boolean).join(" ")}</div></td>
              <td className="small" style={{ maxWidth: 300 }} data-testid="order-items">
                {items?.length ? (
                  <>
                    {items.slice(0, items.length > 3 ? 2 : 3).map((it, n) => (
                      <div key={n} data-testid="order-item-line">
                        {it.q}× {it.name ?? <span className="muted">Name unbekannt</span>}
                        {it.sku && <span className="muted num"> · {it.sku}</span>}
                      </div>
                    ))}
                    {items.length > 3 && (
                      <div className="muted" data-testid="order-items-more">
                        + {items.length - 2} weitere Positionen ({items.slice(2).reduce((n, it) => n + (Number(it.q) || 0), 0)} Stück) – insgesamt {items.reduce((n, it) => n + (Number(it.q) || 0), 0)} Stück
                      </div>
                    )}
                  </>
                ) : (
                  <span className="muted">keine Positionen erfasst</span>
                )}
              </td>
              <td className="num right">{formatEuro(o.total)}</td>
              <td>{ORDER_STATUS_LABEL[o.status]}{o.carrier && o.status !== "open" && <div className="small muted">{o.carrier}{o.shippedBy === "prep" ? " · Prep Center" : ""}</div>}{o.trackingUploadError && <div className="small" style={{ color: "var(--warn)" }}>Meldung offen</div>}</td>
              <td className="num small">{o.trackingNumber ?? (o.carrier === "Deutsche Post" ? "Warensendung" : "–")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">WaWi</div><h1>Aufträge & Versand</h1></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <form action={fetchOrdersNow}><button className="btn btn-primary" type="submit" title="eBay-, Amazon-FBM- und Temu-Bestellungen holen, danach Bestand in allen Kanälen abgleichen">Bestellungen jetzt abrufen</button></form>
          <Link className="btn btn-primary" href="/auftraege/lieferschein" data-testid="slip-link">Labels: Warensendung & DHL</Link>
          <a className="btn" href="/auftraege/vorlage">CSV-Vorlage</a>
          <a className="btn" href="/auftraege/versandbestaetigung">Amazon-Versandbestätigung (Datei)</a>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="orders-msg">{sp.meldung}</div>}
      {view === "fehler" && bestaetigung.length > 0 && (
        <div className="notice notice-warn" data-testid="bestaetigung-box" style={{ marginBottom: 12 }}>
          <strong>{bestaetigung.length} Amazon-Auftr{bestaetigung.length === 1 ? "ag" : "äge"} versendet, aber bei Amazon nicht bestätigt</strong>
          {bestaetigung[0].frist && <> – früheste Versandfrist {new Date(bestaetigung[0].frist).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</>}
          <ol className="small" style={{ margin: "6px 0", paddingLeft: 18 }}>
            <li><a href="/auftraege/versandbestaetigung" data-testid="bestaetigung-datei">Versandbestätigung (Datei) laden</a></li>
            <li>In Seller Central unter Bestellungen → Bestellberichte hochladen → „Versandbestätigung“ hochladen</li>
            <li>Hier bestätigen – dann gelten die Aufträge als an Amazon gemeldet, die Erinnerung endet und die Amazon-ToDos schließen sich</li>
          </ol>
          <form action={bestaetigungHochgeladen}>
            {bestaetigung.map((b) => <input key={b.id} type="hidden" name="id" value={b.id} />)}
            <button className="btn btn-small" type="submit" data-testid="bestaetigung-hochgeladen">In Seller Central hochgeladen ({bestaetigung.length})</button>
          </form>
        </div>
      )}
      <form action="/auftraege" className="orders-search" data-testid="orders-search">
        <label htmlFor="oq" className="sr-only">Aufträge suchen</label>
        <input id="oq" name="q" type="search" className="input" defaultValue={q} placeholder="Name, Bestellnummer, PLZ/Ort oder Artikel suchen – z. B. „schon übertragen?“" />
        <button className="btn" type="submit">Suchen</button>
        {q && <Link className="btn-link small" href="/auftraege">zurücksetzen</Link>}
      </form>
      {hits && <div className="small muted" data-testid="orders-search-count">{hits.length ? `${hits.length} Treffer für „${q}“ (alle Status, letzte 18 Monate)` : `Kein Auftrag zu „${q}“ gefunden (letzte 18 Monate).`}</div>}
      <div className="grid-kpi">
        {(["amazon", "ebay", "tiktok", "temu"] as const).map((c) => (
          <Link key={c} href={`/auftraege?ansicht=offen&kanal=${c}`} className="card card-pad" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="kpi-label">{CHANNEL_LABEL[c]} – zu versenden</div>
            <div className="kpi-value">{counts.find((x) => x.channel === c)?.n ?? 0}</div>
          </Link>
        ))}
      </div>
      <div className="between" style={{ flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={link(v)} className={`chip${view === v ? " active" : ""}`} aria-current={view === v ? "true" : undefined}>{VIEWS[v]}</Link>)}
          {sp.kanal && <Link href={`/auftraege?ansicht=${view}`} className="chip">Kanal: {CHANNEL_LABEL[sp.kanal as keyof typeof CHANNEL_LABEL] ?? sp.kanal} ×</Link>}
        </div>
        {view === "label" && orders.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {labelsOpen && labelsOpen.fileIds.length > 0 && (
              <a className="btn btn-primary" href={`/auftraege/labels${sp.kanal ? `?ids=${orders.map(({ o }) => o.id).join(",")}` : ""}`} target="_blank" rel="noreferrer" data-testid="print-all-labels">
                Alle Labels drucken ({labelsOpen.orders - labelsOpen.withoutPdf} Aufträge, ein PDF)
              </a>
            )}
            {labelsOpen && labelsOpen.fileIds.length > 0 && orders.some(({ o }) => o.shippedBy === "prep") && (
              <>
                <a className="btn" href={`/auftraege/labels?von=prep${sp.kanal ? `&ids=${orders.map(({ o }) => o.id).join(",")}` : ""}`} target="_blank" rel="noreferrer" data-testid="print-prep-labels">Nur fürs Prep Center</a>
                <a className="btn" href={`/auftraege/labels?von=self${sp.kanal ? `&ids=${orders.map(({ o }) => o.id).join(",")}` : ""}`} target="_blank" rel="noreferrer" data-testid="print-self-labels">Nur meine</a>
              </>
            )}
            <form action={markAllLabeledShipped}><ConfirmButton className="btn" confirm={`Alle ${orders.length} Aufträge mit Label als versendet markieren? Die Sendungsnummern gehen an die Marktplätze.`}>Alle als versendet markieren</ConfirmButton></form>
          </div>
        )}
      </div>
      {labelsOpen && labelsOpen.withoutPdf > 0 && <div className="small muted" data-testid="labels-csv-hint">{labelsOpen.withoutPdf} Auftrag/Aufträge ohne PDF (Warensendung per CSV) – Porto wird im Internetmarke-Shop gedruckt.</div>}
      {view === "offen" ? <BatchForm>{table}</BatchForm> : table}
      <details className="card card-pad">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Auftrag von Hand anlegen</summary>
        <form action={createManualOrder} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field"><label className="label" htmlFor="mo-ch">Kanal</label><select className="select" id="mo-ch" name="channel">{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select></div>
          <div className="field"><label className="label" htmlFor="mo-id">Bestellnummer</label><input className="input" id="mo-id" name="externalId" placeholder="optional" /></div>
          <div className="field"><label className="label" htmlFor="mo-sku">SKU</label><input className="input" id="mo-sku" name="sku" /></div>
          <div className="field"><label className="label" htmlFor="mo-q">Menge</label><input className="input" id="mo-q" name="quantity" defaultValue="1" style={{ width: 70 }} /></div>
          <button className="btn btn-primary" type="submit">Anlegen</button>
        </form>
      </details>
    </>
  );
}
