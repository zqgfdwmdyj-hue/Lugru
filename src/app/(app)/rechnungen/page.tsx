import Link from "next/link";
import { and, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { qcol } from "@/db/qcol";
import { requireArea } from "@/lib/auth/session";
import { formatDate, formatEuro } from "@/lib/numbers";
import { DOC_TYPE_LABEL, NEGATIVE, NOT_BOOKED, type DocType } from "@/lib/invoices/checks";
import { needsReview } from "@/lib/invoices/review";
import { BulkForm } from "@/components/bulk-form";
import { bulkInvoiceAction } from "./actions";
import { DriveSync, InvoiceUpload } from "./forms";

const VIEWS = { pruefen: "Prüfen", ware: "Wareneinkauf", kosten: "Betriebskosten", alle: "Alle", ignoriert: "Ignoriert" } as const;
type View = keyof typeof VIEWS;
const KIND: Record<string, [string, string]> = { goods: ["WARE", "tag-info"], expense: ["KOSTEN", "tag-neutral"], unknown: ["UNKLAR", "tag-warn"] };
const STATUS: Record<string, string> = { new: "neu", matched: "zugeordnet", review: "prüfen", ignored: "ignoriert" };
const PAGE = 100;

export default async function RechnungenPage({ searchParams }: { searchParams: Promise<{ ansicht?: string; q?: string; seite?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "pruefen";
  const page = Math.max(1, Number(sp.seite) || 1);
  const q = sp.q?.trim() ?? "";
  const I = schema.invoices;
  const t = session.tenantId;
  const viewWhere: Record<View, SQL | undefined> = {
    pruefen: needsReview,
    ware: and(eq(I.kind, "goods"), ne(I.status, "ignored")),
    kosten: and(eq(I.kind, "expense"), ne(I.status, "ignored")),
    alle: undefined,
    ignoriert: eq(I.status, "ignored"),
  };
  const where: SQL[] = [eq(I.tenantId, t)];
  if (viewWhere[view]) where.push(viewWhere[view]!);
  if (q) where.push(sql`(${I.fileName} ilike ${"%" + q + "%"} or ${I.invoiceNumber} ilike ${"%" + q + "%"} or ${I.orderNumber} ilike ${"%" + q + "%"} or ${I.vendor} ilike ${"%" + q + "%"})`);
  // Summen nur aus Buchungsbelegen: ohne ignorierte, ohne Auftragsbestätigungen/Lieferscheine/Mahnungen; Gutschriften abziehen.
  const signed = sql`case when ${I.docType} in (${sql.join(NOT_BOOKED.map((d) => sql`${d}`), sql`, `)}) then 0 when ${I.docType} in (${sql.join(NEGATIVE.map((d) => sql`${d}`), sql`, `)}) then -abs(coalesce(${I.totalGross}, 0)) else coalesce(${I.totalGross}, 0) end`;
  const [rows, [{ n: total }], totals, counts] = await Promise.all([
    db
      .select({ i: I, supplier: schema.suppliers.code, lots: sql<number>`(select count(*)::int from invoice_lots l where l.invoice_id = ${qcol(I.id)})` })
      .from(I)
      .leftJoin(schema.suppliers, eq(schema.suppliers.id, I.supplierId))
      .where(and(...where))
      .orderBy(desc(I.invoiceDate), desc(I.createdAt))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(I).where(and(...where)),
    db
      .select({ kind: I.kind, n: sql<number>`count(*) filter (where ${I.docType} not in (${sql.join(NOT_BOOKED.map((d) => sql`${d}`), sql`, `)}))::int`, sum: sql<number>`coalesce(sum(${signed}), 0)::float`, excluded: sql<number>`count(*) filter (where ${I.docType} in (${sql.join(NOT_BOOKED.map((d) => sql`${d}`), sql`, `)}))::int` })
      .from(I)
      .where(and(eq(I.tenantId, t), ne(I.status, "ignored")))
      .groupBy(I.kind),
    Promise.all((Object.keys(VIEWS) as View[]).map(async (v) => [v, (await db.select({ n: sql<number>`count(*)::int` }).from(I).where(and(eq(I.tenantId, t), viewWhere[v])))[0].n] as const)),
  ]);
  const tk = (k: string) => totals.find((x) => x.kind === k) ?? { n: 0, sum: 0, excluded: 0 };
  const excluded = totals.reduce((n, x) => n + x.excluded, 0);
  const count = new Map(counts);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const href = (p: { ansicht?: View; seite?: number }) => {
    const u = new URLSearchParams();
    const v = p.ansicht ?? view;
    if (v !== "pruefen") u.set("ansicht", v);
    if (q) u.set("q", q);
    if (p.seite && p.seite > 1) u.set("seite", String(p.seite));
    return `/rechnungen${u.size ? `?${u}` : ""}`;
  };
  const empty = q ? `Keine Rechnung zu „${q}“ in „${VIEWS[view]}“.` : view === "pruefen" ? "Nichts zu prüfen – alle Rechnungen sind eingeordnet, ohne offene Hinweise." : "Keine Rechnungen in dieser Ansicht.";

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Finanzen</div><h1>Eingangsrechnungen</h1></div>
        <form action="/rechnungen" style={{ width: 360, maxWidth: "100%" }} role="search">
          {view !== "pruefen" && <input type="hidden" name="ansicht" value={view} />}
          <label htmlFor="iq" className="sr-only">Suche</label>
          <input className="input" id="iq" name="q" defaultValue={q} placeholder="Datei, Rechnungs-, Bestellnummer, Aussteller" />
        </form>
      </div>
      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Wareneinkauf</div><div className="kpi-value">{formatEuro(tk("goods").sum)}</div><div className="small muted">{tk("goods").n} Belege, Gutschriften abgezogen</div></div>
        <div className="card card-pad"><div className="kpi-label">Betriebskosten</div><div className="kpi-value">{formatEuro(tk("expense").sum)}</div><div className="small muted">{tk("expense").n} Belege</div></div>
        {(count.get("pruefen") ?? 0) > 0 ? (
          <Link href="/rechnungen?ansicht=pruefen" className="card card-pad kpi-attn" style={{ color: "inherit", textDecoration: "none" }} data-testid="kpi-review">
            <div className="kpi-label">Zu prüfen – Handlungsbedarf</div>
            <div className="kpi-value">{count.get("pruefen")}</div>
            <div className="small">unklare Art, unsicheres Datum, mögliche Duplikate · <strong>Jetzt prüfen →</strong></div>
          </Link>
        ) : (
          <div className="card card-pad kpi-ok" data-testid="kpi-review"><div className="kpi-label">Zu prüfen</div><div className="kpi-value">0</div><div className="small muted">nichts offen</div></div>
        )}
        <div className="card card-pad"><DriveSync /></div>
      </div>
      {excluded > 0 && <div className="small muted">Nicht in den Summen: {excluded} Auftragsbestätigung{excluded === 1 ? "" : "en"}, Lieferscheine bzw. Mahnungen und alle ignorierten Belege.</div>}
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <Link key={v} href={href({ ansicht: v })} className={`chip${view === v ? " active" : ""}`} data-testid={`inv-view-${v}`}>{VIEWS[v]} · {count.get(v) ?? 0}</Link>
            ))}
          </div>
          <BulkForm
            action={bulkInvoiceAction}
            testid="inv-bulk"
            ops={[
              { op: "ware", label: "Als Ware" },
              { op: "kosten", label: "Als Kosten" },
              { op: "datum", label: "Datumsvorschlag übernehmen", confirm: "Für {n} Rechnungen das vorgeschlagene Datum übernehmen? Rechnungen ohne Vorschlag bleiben unverändert." },
              { op: "kein-duplikat", label: "Kein Duplikat" },
              { op: "pruefen", label: "Neu prüfen" },
              { op: "ignorieren", label: "Ignorieren", confirm: "{n} Rechnungen ignorieren? Sie bleiben gespeichert und lassen sich unter „Ignoriert“ wieder einordnen.", danger: true },
            ]}
          >
            <section className="card" style={{ overflow: "auto" }}>
              <table className="table sticky-head" data-testid="inv-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}><input type="checkbox" data-select-all aria-label="Alle auf dieser Seite auswählen" /></th>
                    <th>Datum</th><th>Datei</th><th>Quelle</th><th>Art</th><th>Nummer</th><th className="right">Brutto</th><th className="right">Chargen</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={9} className="muted" data-testid="inv-empty">{empty}</td></tr>}
                  {rows.map(({ i, supplier, lots }) => {
                    const c = i.checks;
                    const dup = c.duplicateOf && !c.notDuplicate ? c.duplicateOf : null;
                    return (
                      <tr key={i.id} data-testid="inv-row" data-file={i.fileName}>
                        <td><input type="checkbox" name="ids" value={i.id} aria-label={`${i.fileName} auswählen`} /></td>
                        <td className="num">
                          {formatDate(i.invoiceDate)}
                          {c.date && <div className="small" style={{ color: "var(--warn)" }} title={c.date.uncertain} data-testid="inv-date-hint">unsicher{c.date.suggestion ? ` → ${formatDate(c.date.suggestion)}?` : ""}</div>}
                        </td>
                        <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Link href={`/rechnungen/${i.id}`}>{i.fileName}</Link></td>
                        <td className="small">{i.vendor ?? i.sourceKey ?? "–"}{supplier ? ` · ${supplier}` : ""}</td>
                        <td>
                          <span className={`tag ${KIND[i.kind][1]}`}>{KIND[i.kind][0]}</span>
                          {i.docType !== "rechnung" && <div><span className={`tag ${c.docType ? "tag-warn" : "tag-neutral"}`} title={c.docType?.uncertain} data-testid="inv-doctype">{DOC_TYPE_LABEL[i.docType as DocType]}{c.docType ? "?" : ""}</span></div>}
                        </td>
                        <td className="num small">{i.invoiceNumber ?? i.orderNumber ?? "–"}</td>
                        <td className="num right" style={{ color: NEGATIVE.includes(i.docType as DocType) ? "var(--ok)" : NOT_BOOKED.includes(i.docType as DocType) ? "var(--muted)" : undefined }}>{NEGATIVE.includes(i.docType as DocType) && i.totalGross ? "−" : ""}{formatEuro(i.totalGross)}</td>
                        <td className="num right">{i.kind === "goods" ? lots : "–"}</td>
                        <td className="small">
                          {STATUS[i.status]}
                          {dup && <div><Link href={`/rechnungen/${dup[0].id}`} className="tag tag-warn" title={dup.map((d) => d.reason).join("; ")} data-testid="inv-dup">Duplikat?</Link></div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </BulkForm>
          {pages > 1 && (
            <nav className="pager" aria-label="Seiten">
              {page > 1 ? <Link className="btn btn-small" href={href({ seite: page - 1 })}>← Zurück</Link> : <span />}
              <span className="small muted">Seite {page} von {pages} · {total} Rechnungen</span>
              {page < pages ? <Link className="btn btn-small" href={href({ seite: page + 1 })}>Weiter →</Link> : <span />}
            </nav>
          )}
        </div>
        <aside className="col-side">
          <section className="card card-pad"><InvoiceUpload /></section>
          <section className="card card-pad small muted">
            Invoice Fetcher legt die PDFs in den Drive-Ordner. Das System liest Datum, Belegart, Beträge und Nummern aus dem PDF und gleicht das Datum mit dem Dateinamen ab. Unsichere Werte werden markiert statt still übernommen; mögliche Duplikate nur markiert, nie gelöscht. Der automatische Abruf läuft stündlich.
          </section>
        </aside>
      </div>
    </>
  );
}
