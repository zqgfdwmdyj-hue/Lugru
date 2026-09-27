import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { CHANNELS, RETURN_STATUSES } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { CHANNEL_LABEL, RETURN_STATUS_LABEL } from "@/lib/labels";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { skuStats } from "@/lib/returns/reconcile";
import { loadReturnRows } from "@/lib/returns/service";
import { Abgleich } from "./abgleich";
import { Artikel } from "./artikel";
import { createReturn, updateReturn } from "./actions";

const CONDITION: Record<string, string> = { sellable: "verkäuflich", damaged: "beschädigt", missing: "fehlt/leer", wrong_item: "falscher Artikel" };

const NAV: [string, string][] = [
  ["abgleich", "Abgleich"],
  ["artikel", "Artikel"],
  ["offen", "Eigener Versand – offen"],
  ["erledigt", "Eigener Versand – erledigt"],
  ["fba", "FBA-Rücksendungen"],
];

type Search = { ansicht?: string; id?: string; modus?: string; filter?: string; q?: string; sort?: string; dir?: string };

export default async function RetourenPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const ansicht = NAV.some(([k]) => k === sp.ansicht) ? sp.ansicht! : "abgleich";
  const head = (
    <div className="page-head">
      <div><div className="crumb">Service</div><h1>Retouren</h1></div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {NAV.map(([k, label]) => <Link key={k} className={`chip${ansicht === k ? " active" : ""}`} href={`/retouren?ansicht=${k}`}>{label}</Link>)}
      </div>
    </div>
  );
  if (ansicht === "abgleich" || ansicht === "artikel") {
    const mode = sp.modus === "fbm" ? "fbm" : "fba";
    const [data, settings] = await Promise.all([loadReturnRows(session.tenantId, mode), getSettings(session.tenantId)]);
    return (
      <>
        {head}
        {ansicht === "abgleich" ? (
          <Abgleich view={data} mode={mode} filter={sp.filter ?? "action"} q={sp.q ?? ""} marketplace={settings.returns.marketplace} />
        ) : (
          <Artikel stats={skuStats(data.rows, data.tx, mode, data.reasons)} mode={mode} sort={sp.sort ?? "rate"} dir={sp.dir === "1" ? 1 : -1} q={sp.q ?? ""} />
        )}
      </>
    );
  }
  const view = ansicht as "offen" | "erledigt" | "fba";
  const R = schema.customerReturns;
  const own = view === "fba" ? [] : await db.select().from(R).where(and(eq(R.tenantId, session.tenantId), view === "offen" ? inArray(R.status, ["announced", "received"]) : inArray(R.status, ["refunded", "rejected", "closed"]))).orderBy(desc(R.createdAt)).limit(300);
  const fba = view === "fba"
    ? await db.execute<{ id: string; return_date: string; order_id: string | null; sku: string | null; title: string | null; quantity: number; disposition: string | null; reason: string | null; status: string | null; lpn: string | null; lot_id: string | null; lot_sku: string | null }>(sql`
        select r.id, r.return_date::text, r.order_id, r.sku, r.title, r.quantity, r.disposition, r.reason, r.status, r.lpn, l.id as lot_id, l.sku as lot_sku
          from amazon_customer_returns r
          left join lots l on l.tenant_id = r.tenant_id and l.return_lpn = r.lpn
         where r.tenant_id = ${session.tenantId}
         order by r.return_date desc limit 300`)
    : null;
  const current = sp.id ? own.find((r) => r.id === sp.id) : undefined;

  return (
    <>
      {head}
      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          {fba ? (
            <table className="table">
              <thead><tr><th>Datum</th><th>Bestellung</th><th>SKU</th><th className="right">Menge</th><th>Zustand</th><th>Grund</th><th>LPN → Retouren-SKU</th></tr></thead>
              <tbody>
                {fba.rows.length === 0 && <tr><td colSpan={7} className="muted">Keine – den Bericht „FBA-Kundenrücksendungen“ importieren.</td></tr>}
                {fba.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{formatDate(r.return_date)}</td>
                    <td className="num small">{r.order_id ?? "–"}</td>
                    <td className="num small">{r.sku}</td>
                    <td className="num right">{r.quantity}</td>
                    <td className="small" style={{ color: r.disposition && r.disposition !== "SELLABLE" ? "var(--warn)" : undefined }}>{r.disposition ?? "–"}</td>
                    <td className="small">{r.reason ?? "–"}</td>
                    <td className="num small">{r.lpn ?? "–"}{r.lot_id && <div><Link href={`/chargen/${r.lot_id}`}>{r.lot_sku}</Link></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table">
              <thead><tr><th>Kanal</th><th>Bestellung</th><th>SKU</th><th className="right">Menge</th><th>Grund</th><th>Status</th><th className="right">Erstattet</th></tr></thead>
              <tbody>
                {own.length === 0 && <tr><td colSpan={7} className="muted">Keine Retouren.</td></tr>}
                {own.map((r) => (
                  <tr key={r.id} style={{ background: current?.id === r.id ? "var(--accent-soft)" : undefined }}>
                    <td>{CHANNEL_LABEL[r.channel]}</td>
                    <td className="num"><Link href={`/retouren?ansicht=${view}&id=${r.id}`}>{r.orderRef}</Link></td>
                    <td className="num small">{r.sku ?? "–"}</td>
                    <td className="num right">{r.quantity}</td>
                    <td className="small">{r.reason ?? "–"}</td>
                    <td>{RETURN_STATUS_LABEL[r.status]}{r.condition ? <div className="small muted">{CONDITION[r.condition]}{r.restocked ? " · eingelagert" : ""}</div> : null}</td>
                    <td className="num right">{formatEuro(r.refundAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {view !== "fba" && (
          <aside className="col-side">
            {current ? (
              <form action={updateReturn} className="card card-pad stack" style={{ gap: 8 }}>
                <input type="hidden" name="id" value={current.id} />
                <h2>Retoure {current.orderRef}</h2>
                <div className="field"><label className="label" htmlFor="rs">Status</label><select className="select" id="rs" name="status" defaultValue={current.status}>{RETURN_STATUSES.map((s) => <option key={s} value={s}>{RETURN_STATUS_LABEL[s]}</option>)}</select></div>
                <div className="field"><label className="label" htmlFor="rc">Zustand bei Eingang</label><select className="select" id="rc" name="condition" defaultValue={current.condition ?? ""}><option value="">–</option>{Object.entries(CONDITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                {!current.restocked && <label className="small" style={{ display: "flex", gap: 6 }}><input type="checkbox" name="restock" /> Verkäuflich – ins eigene Lager zurückbuchen</label>}
                <div className="field"><label className="label" htmlFor="ra">Erstatteter Betrag €</label><input className="input num" id="ra" name="refundAmount" defaultValue={current.refundAmount?.toFixed(2).replace(".", ",") ?? ""} /></div>
                <div className="field"><label className="label" htmlFor="rn">Notizen</label><textarea className="textarea" id="rn" name="notes" defaultValue={current.notes ?? ""} style={{ minHeight: 80 }} /></div>
                <button className="btn btn-primary" type="submit">Speichern</button>
              </form>
            ) : (
              <form action={createReturn} className="card card-pad stack" style={{ gap: 8 }}>
                <h2>Retoure erfassen</h2>
                <div className="field"><label className="label" htmlFor="nr-ch">Kanal</label><select className="select" id="nr-ch" name="channel" defaultValue="ebay">{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select></div>
                <div className="field"><label className="label" htmlFor="nr-o">Bestellnummer</label><input className="input num" id="nr-o" name="orderRef" required /></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div className="field"><label className="label" htmlFor="nr-s">SKU</label><input className="input" id="nr-s" name="sku" /></div>
                  <div className="field"><label className="label" htmlFor="nr-q">Menge</label><input className="input num" id="nr-q" name="quantity" defaultValue="1" style={{ width: 70 }} /></div>
                </div>
                <div className="field"><label className="label" htmlFor="nr-r">Grund</label><input className="input" id="nr-r" name="reason" /></div>
                <div className="field"><label className="label" htmlFor="nr-t">Sendungsnummer Rücksendung</label><input className="input num" id="nr-t" name="trackingNumber" /></div>
                <button className="btn btn-primary" type="submit">Anlegen</button>
              </form>
            )}
          </aside>
        )}
      </div>
    </>
  );
}
