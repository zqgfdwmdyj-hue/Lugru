import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { COST_SOURCE_LABEL } from "@/lib/money/profit-logic";
import { ISSUE_LABEL, type IssueKind } from "@/lib/products/logic";
import { mappingWorklist, productList } from "@/lib/products/service";
import { fbaReport } from "@/lib/stock/fba-report";
import { listHref, PAGE_SIZE, VIEWS, type View } from "./ui";

export const metadata = { title: "Produkte" };

export default async function ProduktePage({ searchParams }: { searchParams: Promise<{ q?: string; ansicht?: string; seite?: string; art?: string }> }) {
  const session = await requireArea("wawi");
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 120) || "";
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "bestand";
  const t = session.tenantId;
  const issues = await mappingWorklist(t);
  const here = listHref({ q, ansicht: view, seite: sp.seite, art: sp.art });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Produkte & Lager</div>
          <h1>Produkte</h1>
          <div className="small muted" style={{ marginTop: 4 }}>Ein Einstieg für Stammdaten, Chargen & Einkauf, Bestand, Angebote, Ergebnis und Belege.</div>
        </div>
        <form action="/produkte" className="search-form" role="search" style={{ display: "flex", gap: 6, flex: "1 1 320px", maxWidth: 520 }}>
          {view !== "bestand" && view !== "zuordnung" && <input type="hidden" name="ansicht" value={view} />}
          <input className="input" name="q" defaultValue={q} placeholder="SKU, Name, ASIN oder EAN" aria-label="Produkte suchen" data-testid="product-search" style={{ flex: 1, minWidth: 0 }} />
          <button className="btn btn-primary" type="submit">Suchen</button>
        </form>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link key={v} href={listHref({ q: v === "zuordnung" ? "" : q, ansicht: v })} className={`chip${view === v ? " active" : ""}`} data-testid={`view-${v}`}>
            {VIEWS[v]}
            {v === "zuordnung" && issues.length > 0 ? ` · ${issues.length}` : ""}
          </Link>
        ))}
        {q && <Link href={listHref({ ansicht: view })} className="chip">Suche: {q} ×</Link>}
      </div>
      {view === "zuordnung" ? <Worklist issues={issues} art={sp.art} /> : <ProductTable tenantId={t} q={q} view={view} seite={Number(sp.seite) || 1} back={here} />}
    </>
  );
}

async function ProductTable({ tenantId, q, view, seite, back }: { tenantId: string; q: string; view: Exclude<View, "zuordnung">; seite: number; back: string }) {
  const [rows, fba] = await Promise.all([productList(tenantId, { q: q || undefined, view }), fbaReport(tenantId)]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, seite), pages);
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const empty = q
    ? `Keine Treffer für „${q}“. Gesucht wird in SKU, Name, ASIN und EAN aller Chargen, Lager-SKUs, Angebote und Artikel.`
    : view === "bestand"
      ? "Kein Produkt mit Bestand. Unter „Alle“ stehen auch Produkte ohne Bestand."
      : "Noch keine Produkte. Sie entstehen aus Chargen (Einkauf), eigenem Lager, Angeboten oder dem Artikelstamm.";
  return (
    <section className="card" style={{ overflow: "auto" }}>
      <div className="between" style={{ padding: "10px 14px", flexWrap: "wrap", gap: 8 }}>
        <span className="small muted" data-testid="product-count">{rows.length} Produkt{rows.length === 1 ? "" : "e"}{q ? ` für „${q}“` : ""}{fba.missing ? " · Amazon-Bestand unbekannt (FBA-Bericht fehlt)" : fba.stale ? ` · Amazon-Bestand vom ${fba.snapshot?.split("-").reverse().join(".")} (veraltet)` : ""}</span>
        {pages > 1 && <Pager page={page} pages={pages} q={q} view={view} />}
      </div>
      <table className="table sticky-head" data-testid="product-list">
        <thead>
          <tr><th>Produkt</th><th>SKUs</th><th className="right">Eigenes Lager</th><th className="right">Amazon</th><th className="right">Angebote</th><th className="right">EK</th></tr>
        </thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan={6} className="muted" data-testid="product-empty">{empty}</td></tr>}
          {shown.map((r) => (
            <tr key={r.key} data-testid="product-row">
              <td style={{ maxWidth: 380 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                  {r.image ? <img src={r.image} alt="" width={36} height={36} style={{ objectFit: "contain", borderRadius: 4, flex: "none", background: "var(--surface-2)" }} loading="lazy" /> : <span className="thumb-empty" aria-hidden="true" />}
                  <div style={{ minWidth: 0 }}>
                    <Link href={`${r.href}?von=${encodeURIComponent(back)}`} style={{ fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.title ?? undefined}>{r.title ?? "– Name fehlt –"}</Link>
                    <span className="small muted num">{[r.asin, r.ean].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
              </td>
              <td className="small num">{r.skus.slice(0, 2).join(", ")}{r.skus.length > 2 ? ` +${r.skus.length - 2}` : ""}</td>
              <td className="num right" style={{ color: r.own < 0 ? "var(--danger)" : undefined }}>{r.own || ""}</td>
              <td className="num right">{fba.missing ? <span className="muted" title="FBA-Bestandsbericht fehlt – Amazon-Bestand unbekannt">?</span> : r.fba || ""}</td>
              <td className="num right">{r.offers || ""}</td>
              <td className="num right">
                {r.costMissing > 0 ? (
                  <Link href={`${r.href}?tab=einkauf`} style={{ color: "var(--warn)" }}>EK fehlt{r.skus.length > 1 ? ` (${r.costMissing})` : ""}</Link>
                ) : r.cost ? (
                  <span title={COST_SOURCE_LABEL[r.cost.source]}>{formatEuro(r.cost.cost)}</span>
                ) : (
                  <span className="muted small">–</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && <div style={{ padding: "10px 14px" }}><Pager page={page} pages={pages} q={q} view={view} /></div>}
    </section>
  );
}

function Pager({ page, pages, q, view }: { page: number; pages: number; q: string; view: View }) {
  return (
    <nav className="pager" aria-label="Seiten" data-testid="pager">
      {page > 1 ? <Link className="btn btn-small" href={listHref({ q, ansicht: view, seite: String(page - 1) })}>← Zurück</Link> : <span />}
      <span className="small muted">Seite {page} von {pages}</span>
      {page < pages ? <Link className="btn btn-small" href={listHref({ q, ansicht: view, seite: String(page + 1) })}>Weiter →</Link> : <span />}
    </nav>
  );
}

function Worklist({ issues, art }: { issues: Awaited<ReturnType<typeof mappingWorklist>>; art?: string }) {
  const kinds = (Object.keys(ISSUE_LABEL) as IssueKind[]).filter((k) => issues.some((i) => i.kind === k));
  const active = art && art in ISSUE_LABEL ? (art as IssueKind) : null;
  const list = active ? issues.filter((i) => i.kind === active) : issues;
  if (!issues.length) return <div className="notice notice-ok" data-testid="worklist-empty">Alles zugeordnet: keine verkauften SKUs ohne Zuordnung, keine Angebote ohne Lager-SKU, kein fehlender EK.</div>;
  return (
    <section className="stack" data-testid="worklist">
      <div className="small muted">Hier wird nichts automatisch zusammengeführt oder gelöscht – jede Zeile führt zur Stelle, an der du es klärst.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href={listHref({ ansicht: "zuordnung" })} className={`chip${!active ? " active" : ""}`}>Alle · {issues.length}</Link>
        {kinds.map((k) => (
          <Link key={k} href={listHref({ ansicht: "zuordnung", art: k })} className={`chip${active === k ? " active" : ""}`} data-testid={`issue-filter-${k}`}>
            {ISSUE_LABEL[k].label} · {issues.filter((i) => i.kind === k).length}
          </Link>
        ))}
      </div>
      {active && <div className="small muted">{ISSUE_LABEL[active].hint}</div>}
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table sticky-head">
          <thead><tr><th>Was</th><th>SKU / EAN</th><th>Produkt</th><th>Details</th><th /></tr></thead>
          <tbody>
            {list.slice(0, 500).map((i) => (
              <tr key={`${i.kind}:${i.sku}:${i.detail}`} data-testid="issue-row" data-kind={i.kind}>
                <td><span className={`tag tag-${ISSUE_LABEL[i.kind].level}`} title={ISSUE_LABEL[i.kind].hint}>{ISSUE_LABEL[i.kind].label}</span></td>
                <td className="num small">{i.sku}</td>
                <td className="small" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title ?? <span className="muted">–</span>}</td>
                <td className="small">{i.detail}</td>
                <td className="right"><Link className="btn btn-small" href={i.href}>Klären</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > 500 && <div className="small muted" style={{ padding: "8px 14px" }}>Die ersten 500 von {list.length} – bitte nach Art filtern.</div>}
      </section>
    </section>
  );
}
