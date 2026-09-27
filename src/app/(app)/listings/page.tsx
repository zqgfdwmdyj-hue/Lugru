import Link from "next/link";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { CHANNELS } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { CHANNEL_LABEL } from "@/lib/labels";
import { formatEuro } from "@/lib/numbers";
import { deleteListing, draftsFromOwnStock, publishAction, saveListing } from "./actions";

const STATUS: Record<string, [string, string]> = { draft: ["ENTWURF", "tag-neutral"], active: ["AKTIV", "tag-ok"], ended: ["BEENDET", "tag-neutral"], error: ["FEHLER", "tag-critical"] };

export default async function ListingsPage({ searchParams }: { searchParams: Promise<{ kanal?: string; sku?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const L = schema.listings;
  const where: SQL[] = [eq(L.tenantId, session.tenantId)];
  if (CHANNELS.includes(sp.kanal as never)) where.push(eq(L.channel, sp.kanal as never));
  const rows = await db.select().from(L).where(and(...where)).orderBy(desc(L.updatedAt)).limit(500);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">WaWi</div><h1>Listings</h1></div>
        <form action={draftsFromOwnStock} style={{ display: "flex", gap: 6 }}>
          <label htmlFor="dch" className="sr-only">Kanal</label>
          <select className="select" id="dch" name="channel" defaultValue="ebay">{CHANNELS.filter((c) => c !== "manual").map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select>
          <button className="btn" type="submit">Entwürfe aus eigenem Lager</button>
        </form>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href="/listings" className={`chip${!sp.kanal ? " active" : ""}`}>Alle</Link>
        {CHANNELS.filter((c) => c !== "manual").map((c) => <Link key={c} href={`/listings?kanal=${c}`} className={`chip${sp.kanal === c ? " active" : ""}`}>{CHANNEL_LABEL[c]}</Link>)}
      </div>
      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>Kanal</th><th>SKU</th><th>Titel</th><th className="right">Preis</th><th className="right">Menge</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="muted">Noch keine Listings.</td></tr>}
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>{CHANNEL_LABEL[l.channel]}</td>
                  <td className="num small">{l.sku}</td>
                  <td style={{ maxWidth: 320 }}>{l.title}{l.lastError && <div className="small" style={{ color: "var(--danger)" }}>{l.lastError}</div>}</td>
                  <td className="num right">{formatEuro(l.price)}</td>
                  <td className="num right">{l.quantity}</td>
                  <td><span className={`tag ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</span>{l.externalId && <div className="small muted num">{l.externalId}</div>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <form action={publishAction} style={{ display: "inline" }}><input type="hidden" name="id" value={l.id} /><button className="btn btn-small" type="submit">{l.status === "active" ? "Aktualisieren" : "Einstellen"}</button></form>
                    <Link className="btn-link small" href={`/listings?sku=${encodeURIComponent(l.sku)}&kanal=${l.channel}`} style={{ marginLeft: 8 }}>bearbeiten</Link>
                    <form action={deleteListing} style={{ display: "inline" }}><input type="hidden" name="id" value={l.id} /><button className="btn-link small" type="submit" style={{ marginLeft: 8, color: "var(--muted)" }}>×</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="col-side">
          <form action={saveListing} className="card card-pad stack" style={{ gap: 8 }}>
            <h2>{sp.sku ? "Listing bearbeiten" : "Neues Listing"}</h2>
            {(() => {
              const cur = sp.sku ? rows.find((r) => r.sku === sp.sku && (!sp.kanal || r.channel === sp.kanal)) : undefined;
              return (
                <>
                  <div className="field"><label className="label" htmlFor="l-ch">Kanal</label><select className="select" id="l-ch" name="channel" defaultValue={cur?.channel ?? "ebay"}>{CHANNELS.filter((c) => c !== "manual").map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select></div>
                  <div className="field"><label className="label" htmlFor="l-sku">SKU</label><input className="input" id="l-sku" name="sku" defaultValue={cur?.sku ?? sp.sku ?? ""} required /></div>
                  <div className="field"><label className="label" htmlFor="l-t">Titel (max. 80 Zeichen)</label><input className="input" id="l-t" name="title" maxLength={80} defaultValue={cur?.title ?? ""} placeholder="leer = Titel aus dem Artikel" /></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div className="field"><label className="label" htmlFor="l-p">Preis €</label><input className="input num" id="l-p" name="price" defaultValue={cur?.price?.toFixed(2).replace(".", ",") ?? ""} /></div>
                    <div className="field"><label className="label" htmlFor="l-q">Menge</label><input className="input num" id="l-q" name="quantity" defaultValue={cur?.quantity ?? 1} /></div>
                  </div>
                  <div className="field"><label className="label" htmlFor="l-e">EAN</label><input className="input num" id="l-e" name="ean" defaultValue={cur?.ean ?? ""} /></div>
                  <div className="field"><label className="label" htmlFor="l-c">Zustand</label><select className="select" id="l-c" name="condition" defaultValue={cur?.condition ?? "NEW"}><option value="NEW">Neu</option><option value="LIKE_NEW">Wie neu</option><option value="USED_EXCELLENT">Gebraucht – sehr gut</option><option value="USED_GOOD">Gebraucht – gut</option></select></div>
                  <div className="field"><label className="label" htmlFor="l-d">Beschreibung</label><textarea className="textarea" id="l-d" name="description" defaultValue={cur?.description ?? ""} style={{ minHeight: 100 }} /></div>
                  <button className="btn btn-primary" type="submit">Speichern</button>
                </>
              );
            })()}
          </form>
          <div className="small muted card card-pad">eBay wird über die Inventory-API eingestellt, sobald die eBay-Anbindung eingerichtet ist (Richtlinien für Versand, Zahlung und Rückgabe müssen im eBay-Konto existieren). Andere Kanäle: Entwurf als Übersicht, Einstellen im Kanal selbst.</div>
        </aside>
      </div>
    </>
  );
}
