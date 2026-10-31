import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { SubmitButton } from "@/components/submit-button";
import { preislisteHochladenAction } from "./actions";

export default async function B2bPreislistenPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("b2b");
  const sp = await searchParams;
  const t = session.tenantId;
  const F = schema.supplierFeeds;
  const S = schema.suppliers;
  const feeds = await db
    .select({ id: F.id, name: F.name, lastImportAt: F.lastImportAt, lieferant: sql<string | null>`coalesce(${S.name}, ${S.code})`, angebote: sql<number>`(select count(*) from supplier_offers o where o.feed_id = ${F.id} and o.active)::int`, mitAsin: sql<number>`(select count(*) from supplier_offers o where o.feed_id = ${F.id} and o.active and coalesce(o.asin, o.market->>'asin') is not null)::int` })
    .from(F)
    .leftJoin(S, eq(S.id, F.supplierId))
    .where(eq(F.tenantId, t))
    .orderBy(desc(F.lastImportAt))
    .limit(200);
  const lieferanten = await db.select({ id: S.id, name: S.name, code: S.code }).from(S).where(eq(S.tenantId, t)).orderBy(asc(S.code));
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/b2b">B2B-Deals</Link></div><h1>Preislisten je Land auswerten</h1></div>
      </div>
      {sp.meldung && <div className="notice notice-warn">{sp.meldung}</div>}
      <section className="card card-pad stack" style={{ gap: 10 }}>
        <h2>Preisliste hochladen</h2>
        <form action={preislisteHochladenAction} className="stack" style={{ gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
            <div className="field">
              <label className="label" htmlFor="pl-lieferant">Lieferant</label>
              <select className="input" id="pl-lieferant" name="supplierId" style={{ width: 220 }} required>{lieferanten.map((l) => <option key={l.id} value={l.id}>{l.name ? `${l.name} (${l.code})` : l.code}</option>)}</select>
            </div>
            <div className="field"><label className="label" htmlFor="pl-name">Name der Liste (optional)</label><input className="input" id="pl-name" name="name" style={{ width: 220 }} /></div>
            <div className="field"><label className="label" htmlFor="pl-datei">Datei (CSV, Excel)</label><input className="input" id="pl-datei" name="datei" type="file" accept=".csv,.xlsx,.xls,.txt" required data-testid="pl-datei" /></div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <label className="check small"><input type="checkbox" name="brutto" /> Preise sind brutto</label>
            <label className="check small"><input type="checkbox" name="voll" defaultChecked /> Vollständige Liste (Fehlendes gilt als nicht mehr gelistet)</label>
          </div>
          <div><SubmitButton label="Hochladen und auswerten" pendingLabel="Lese ein …" testId="pl-hochladen" /></div>
        </form>
        <div className="small muted">Spalten werden automatisch erkannt; unklare Listen ordnet die KI zu. Antworten von Lieferanten (Profil-E-Mail) mit Preisliste im Anhang werden automatisch übernommen.</div>
      </section>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table" data-testid="preislisten">
          <thead><tr><th>Liste</th><th>Lieferant</th><th className="right">Angebote</th><th className="right">mit ASIN</th><th>Stand</th></tr></thead>
          <tbody>
            {feeds.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Preislisten.</td></tr>}
            {feeds.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/b2b/preislisten/${f.id}`}>{f.name}</Link></td>
                <td>{f.lieferant ?? "–"}</td>
                <td className="num right">{f.angebote}</td>
                <td className="num right">{f.mitAsin}</td>
                <td className="small num">{f.lastImportAt ? f.lastImportAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
