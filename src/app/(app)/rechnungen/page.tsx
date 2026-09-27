import Link from "next/link";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatEuro } from "@/lib/numbers";
import { DriveSync, InvoiceUpload } from "./forms";

const VIEWS = { pruefen: "Prüfen", ware: "Wareneinkauf", kosten: "Betriebskosten", alle: "Alle", ignoriert: "Ignoriert" } as const;
type View = keyof typeof VIEWS;
const KIND: Record<string, [string, string]> = { goods: ["WARE", "tag-info"], expense: ["KOSTEN", "tag-neutral"], unknown: ["UNKLAR", "tag-warn"] };
const STATUS: Record<string, string> = { new: "neu", matched: "zugeordnet", review: "prüfen", ignored: "ignoriert" };

export default async function RechnungenPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; q?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "pruefen";
  const I = schema.invoices;
  const where: SQL[] = [eq(I.tenantId, session.tenantId)];
  if (view === "pruefen") where.push(inArray(I.status, ["review", "new"]));
  if (view === "ware") where.push(eq(I.kind, "goods"));
  if (view === "kosten") where.push(eq(I.kind, "expense"));
  if (view === "ignoriert") where.push(eq(I.status, "ignored"));
  if (sp.q) where.push(sql`(${I.fileName} ilike ${"%" + sp.q + "%"} or ${I.invoiceNumber} ilike ${"%" + sp.q + "%"} or ${I.orderNumber} ilike ${"%" + sp.q + "%"})`);
  const [rows, totals] = await Promise.all([
    db
      .select({ i: I, supplier: schema.suppliers.code, lots: sql<number>`(select count(*)::int from invoice_lots l where l.invoice_id = ${I.id})` })
      .from(I)
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, I.supplierId))
      .where(and(...where))
      .orderBy(desc(I.invoiceDate), desc(I.createdAt))
      .limit(300),
    db.select({ kind: I.kind, n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${I.totalGross}), 0)::float` }).from(I).where(eq(I.tenantId, session.tenantId)).groupBy(I.kind),
  ]);
  const t = (k: string) => totals.find((x) => x.kind === k) ?? { n: 0, sum: 0 };

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Einkauf & Buchhaltung</div><h1>Rechnungen</h1></div>
        <form action="/rechnungen" style={{ width: 360 }}>
          <input type="hidden" name="ansicht" value={view} />
          <label htmlFor="iq" className="sr-only">Suche</label>
          <input className="input" id="iq" name="q" defaultValue={sp.q} placeholder="Datei, Rechnungs- oder Bestellnummer" />
        </form>
      </div>
      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Wareneinkauf</div><div className="kpi-value">{formatEuro(t("goods").sum)}</div><div className="small muted">{t("goods").n} Rechnungen</div></div>
        <div className="card card-pad"><div className="kpi-label">Betriebskosten</div><div className="kpi-value">{formatEuro(t("expense").sum)}</div><div className="small muted">{t("expense").n} Rechnungen</div></div>
        <div className="card card-pad"><div className="kpi-label">Unklar</div><div className="kpi-value">{t("unknown").n}</div><div className="small muted">einmal einordnen – das System merkt es sich je Quelle</div></div>
        <div className="card card-pad"><DriveSync /></div>
      </div>
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={`/rechnungen?ansicht=${v}`} className={`chip${view === v ? " active" : ""}`}>{VIEWS[v]}</Link>)}
          </div>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>Datum</th><th>Datei</th><th>Quelle</th><th>Art</th><th>Nummer</th><th className="right">Brutto</th><th className="right">Chargen</th><th>Status</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8} className="muted">Keine Rechnungen in dieser Ansicht.</td></tr>}
                {rows.map(({ i, supplier, lots }) => (
                  <tr key={i.id}>
                    <td className="num">{formatDate(i.invoiceDate)}</td>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Link href={`/rechnungen/${i.id}`}>{i.fileName}</Link></td>
                    <td className="small">{i.sourceKey ?? "–"}{supplier ? ` · ${supplier}` : ""}</td>
                    <td><span className={`tag ${KIND[i.kind][1]}`}>{KIND[i.kind][0]}</span></td>
                    <td className="num small">{i.invoiceNumber ?? i.orderNumber ?? "–"}</td>
                    <td className="num right">{formatEuro(i.totalGross)}</td>
                    <td className="num right">{i.kind === "goods" ? lots : "–"}</td>
                    <td className="small">{STATUS[i.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <aside className="col-side">
          <section className="card card-pad"><InvoiceUpload /></section>
          <section className="card card-pad small muted">
            Invoice Fetcher legt die PDFs in den Drive-Ordner. Das System liest Datum und Quelle aus dem Dateinamen, Beträge und Nummern aus dem PDF und ordnet Warenrechnungen den Chargen zu – über ASINs im Text oder über Shop, Datum und Betrag. Der automatische Abruf läuft stündlich.
          </section>
        </aside>
      </div>
    </>
  );
}
