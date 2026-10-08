import Link from "next/link";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { CHANNELS } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { CHANNEL_LABEL, ORDER_STATUS_LABEL } from "@/lib/labels";
import { formatEuro } from "@/lib/numbers";
import { createManualOrder, fetchOrdersNow, markAllLabeledShipped } from "./actions";
import { BatchForm } from "./batch-form";

const VIEWS = { offen: "Zu versenden", label: "Label erstellt", versendet: "Versendet", fehler: "Meldung offen", fba: "FBA", alle: "Alle" } as const;
type View = keyof typeof VIEWS;

export default async function AuftraegePage({ searchParams }: { searchParams: Promise<{ ansicht?: string; kanal?: string; meldung?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "offen";
  const O = schema.orders;
  const where: SQL[] = [eq(O.tenantId, session.tenantId)];
  if (CHANNELS.includes(sp.kanal as never)) where.push(eq(O.channel, sp.kanal as never));
  switch (view) {
    case "offen": where.push(eq(O.fulfillment, "FBM"), eq(O.status, "open")); break;
    case "label": where.push(eq(O.status, "label_created")); break;
    case "versendet": where.push(eq(O.fulfillment, "FBM"), inArray(O.status, ["shipped", "delivered"])); break;
    case "fehler": where.push(eq(O.fulfillment, "FBM"), sql`${O.trackingNumber} is not null and ${O.trackingUploadedAt} is null`); break;
    case "fba": where.push(eq(O.fulfillment, "FBA")); break;
  }
  const orders = await db
    .select({
      o: O,
      items: sql<string>`(select string_agg(i.quantity || '× ' || coalesce(i.sku, i.title, '?'), ', ') from order_items i where i.order_id = ${O.id})`,
    })
    .from(O)
    .where(and(...where))
    .orderBy(view === "offen" ? sql`${O.shipBy} asc nulls last` : desc(O.orderDate))
    .limit(300);
  const counts = await db
    .select({ channel: O.channel, n: sql<number>`count(*)::int` })
    .from(O)
    .where(and(eq(O.tenantId, session.tenantId), eq(O.fulfillment, "FBM"), eq(O.status, "open")))
    .groupBy(O.channel);

  const link = (v: View) => `/auftraege?ansicht=${v}${sp.kanal ? `&kanal=${sp.kanal}` : ""}`;
  const table = (
    <section className="card" style={{ overflow: "auto" }}>
      <table className="table">
        <thead><tr><th style={{ width: 28 }}></th><th>Kanal</th><th>Bestellung</th><th>Datum</th><th>Empfänger</th><th>Artikel</th><th className="right">Summe</th><th>Status</th><th>Sendung</th></tr></thead>
        <tbody>
          {orders.length === 0 && <tr><td colSpan={9} className="muted">Keine Aufträge in dieser Ansicht.</td></tr>}
          {orders.map(({ o, items }) => (
            <tr key={o.id}>
              <td>{view === "offen" && <input type="checkbox" name="ids" value={o.id} aria-label="Auswählen" defaultChecked />}</td>
              <td><span className="tag tag-neutral">{CHANNEL_LABEL[o.channel]}</span></td>
              <td className="num"><Link href={`/auftraege/${o.id}`}>{o.externalId}</Link></td>
              <td className="num">{o.orderDate.toLocaleDateString("de-DE")}</td>
              <td>{o.shipTo?.name1 ?? o.buyerName ?? "–"}<div className="small muted">{[o.shipTo?.zip, o.shipTo?.city].filter(Boolean).join(" ")}</div></td>
              <td className="small" style={{ maxWidth: 260 }}>{items ?? "–"}</td>
              <td className="num right">{formatEuro(o.total)}</td>
              <td>{ORDER_STATUS_LABEL[o.status]}{o.trackingUploadError && <div className="small" style={{ color: "var(--warn)" }}>Meldung offen</div>}</td>
              <td className="num small">{o.trackingNumber ?? "–"}</td>
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
          <form action={fetchOrdersNow}><button className="btn btn-primary" type="submit" title="eBay- und Amazon-FBM-Bestellungen holen, danach Bestand in allen Kanälen abgleichen">Bestellungen jetzt abrufen</button></form>
          <a className="btn" href="/auftraege/vorlage">CSV-Vorlage</a>
          <a className="btn" href="/auftraege/versandbestaetigung">Amazon-Versandbestätigung (Datei)</a>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="orders-msg">{sp.meldung}</div>}
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
          {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={link(v)} className={`chip${view === v ? " active" : ""}`}>{VIEWS[v]}</Link>)}
          {sp.kanal && <Link href={`/auftraege?ansicht=${view}`} className="chip">Kanal: {CHANNEL_LABEL[sp.kanal as keyof typeof CHANNEL_LABEL] ?? sp.kanal} ×</Link>}
        </div>
        {view === "label" && orders.length > 0 && <form action={markAllLabeledShipped}><button className="btn" type="submit">Alle als versendet markieren</button></form>}
      </div>
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
