import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { createFeed } from "./actions";

export default async function LieferantenPage() {
  const session = await requireArea("lieferanten");
  const F = schema.supplierFeeds;
  const [feeds, suppliers] = await Promise.all([
    db.select({ f: F, offers: sql<number>`(select count(*)::int from supplier_offers o where o.feed_id = ${F.id})` }).from(F).where(eq(F.tenantId, session.tenantId)).orderBy(desc(F.createdAt)),
    db.select().from(schema.suppliers).where(eq(schema.suppliers.tenantId, session.tenantId)).orderBy(asc(schema.suppliers.code)),
  ]);
  return (
    <>
      <div className="page-head"><div><div className="crumb">WaWi</div><h1>Lieferanten-Feeds</h1></div></div>
      <div className="row">
        <section className="card" style={{ flexGrow: 1, overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>Feed</th><th className="right">Angebote</th><th>Letzter Import</th></tr></thead>
            <tbody>
              {feeds.length === 0 && <tr><td colSpan={3} className="muted">Noch keine Feeds. Rechts einen anlegen – danach Preislisten (CSV/Excel) hochladen oder Shop-Seiten, Fotos und PDFs scannen.</td></tr>}
              {feeds.map(({ f, offers }) => (
                <tr key={f.id}><td><Link href={`/lieferanten/${f.id}`}>{f.name}</Link></td><td className="num right">{offers}</td><td className="num">{f.lastImportAt?.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) ?? "–"}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="col-side">
          <form action={createFeed} className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Neuer Feed</h2>
            <div className="field"><label className="label" htmlFor="fn">Name</label><input className="input" id="fn" name="name" required placeholder="z. B. Großhändler X Preisliste" /></div>
            <div className="field"><label className="label" htmlFor="fs">Shop / Lieferant</label><select className="select" id="fs" name="supplierId"><option value="">–</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code}{s.name ? ` – ${s.name}` : ""}</option>)}</select></div>
            <button className="btn btn-primary" type="submit">Anlegen</button>
          </form>
        </aside>
      </div>
    </>
  );
}
