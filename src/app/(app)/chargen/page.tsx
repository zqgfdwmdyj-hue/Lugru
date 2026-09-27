import Link from "next/link";
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { COST_SOURCE_LABEL } from "@/lib/labels";
import { formatDate, formatEuro } from "@/lib/numbers";

const FILTERS = {
  alle: "Alle",
  einkauf: "Einkäufe",
  retouren: "Retouren",
  "ohne-ek": "Ohne EK",
  abweichung: "EK-Abweichung",
  geschaetzt: "Jahr geschätzt",
} as const;
type Filter = keyof typeof FILTERS;


const PAGE = 100;

export default async function ChargenPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; seite?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const filter: Filter = sp.filter && sp.filter in FILTERS ? (sp.filter as Filter) : "alle";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.seite) || 1);
  const L = schema.lots;
  const P = schema.products;
  const S = schema.suppliers;

  const where: SQL[] = [eq(L.tenantId, session.tenantId)];
  if (filter === "einkauf") where.push(eq(L.kind, "purchase"));
  if (filter === "retouren") where.push(eq(L.kind, "return"));
  if (filter === "ohne-ek") where.push(isNull(L.unitCostNet));
  if (filter === "geschaetzt") where.push(eq(L.purchaseDateEstimated, true));
  if (filter === "abweichung") {
    where.push(sql`${L.id} in (select lot_id from cost_observations where tenant_id = ${session.tenantId} group by lot_id having max(value_net) - min(value_net) > 0.02)`);
  }
  if (q) {
    const like = `%${q}%`;
    where.push(or(ilike(L.sku, like), ilike(P.asin, like), ilike(P.title, like), ilike(S.code, like), ilike(L.fnsku, like))!);
  }

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: L.id,
        sku: L.sku,
        kind: L.kind,
        skuSchema: L.skuSchema,
        asin: P.asin,
        title: P.title,
        supplier: S.code,
        purchaseDate: L.purchaseDate,
        estimated: L.purchaseDateEstimated,
        returnDate: L.returnDate,
        cost: L.unitCostNet,
        source: L.unitCostSource,
      })
      .from(L)
      .innerJoin(P, eq(P.id, L.productId))
      .leftJoin(S, eq(S.id, L.supplierId))
      .where(and(...where))
      .orderBy(desc(sql`coalesce(${L.purchaseDate}, ${L.returnDate})`), desc(L.createdAt))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db
      .select({ total: count() })
      .from(L)
      .innerJoin(P, eq(P.id, L.productId))
      .leftJoin(S, eq(S.id, L.supplierId))
      .where(and(...where)),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const link = (over: Partial<{ filter: string; q: string; seite: number }>) => {
    const p = new URLSearchParams();
    const f = over.filter ?? filter;
    if (f !== "alle") p.set("filter", f);
    const qq = over.q ?? q;
    if (qq) p.set("q", qq);
    const s = over.seite ?? 1;
    if (s > 1) p.set("seite", String(s));
    const str = p.toString();
    return str ? `/chargen?${str}` : "/chargen";
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">WaWi</div>
          <h1>Chargen & Artikel</h1>
        </div>
        <form action="/chargen" style={{ width: 420 }}>
          {filter !== "alle" && <input type="hidden" name="filter" value={filter} />}
          <label htmlFor="cq" className="sr-only">Chargen durchsuchen</label>
          <input id="cq" name="q" type="search" className="input" defaultValue={q} placeholder="SKU, ASIN, FNSKU, Shop …" />
        </form>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Link key={f} href={link({ filter: f })} className={`chip${filter === f ? " active" : ""}`}>{FILTERS[f]}</Link>
        ))}
      </div>

      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th><th>ASIN</th><th>Shop</th><th>Datum</th><th>Art</th><th className="right">EK netto</th><th>Quelle</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="muted">Keine Chargen gefunden.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="num" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Link href={`/chargen/${r.id}`}>{r.sku}</Link>
                </td>
                <td className="num">{r.asin}</td>
                <td>{r.supplier ?? "–"}</td>
                <td className="num" title={r.estimated ? "Jahr geschätzt – die SKU enthält kein Jahr" : undefined}>
                  {formatDate(r.purchaseDate ?? r.returnDate)}{r.estimated ? " ~" : ""}
                </td>
                <td>
                  {r.kind === "return" ? <span className="tag tag-info">RETOURE</span> : r.kind === "unknown" ? <span className="tag tag-warn">UNBEKANNT</span> : <span className="tag tag-neutral">EINKAUF {r.skuSchema}</span>}
                </td>
                <td className="num right" style={{ color: r.cost === null ? "var(--danger)" : undefined }}>
                  {r.cost === null ? "fehlt" : formatEuro(r.cost)}
                </td>
                <td className="small">{r.source ? COST_SOURCE_LABEL[r.source] : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="between small muted">
        <span>{total} Chargen · Seite {page} von {pages}</span>
        <span style={{ display: "flex", gap: 8 }}>
          {page > 1 && <Link className="btn btn-small" href={link({ seite: page - 1 })}>← Zurück</Link>}
          {page < pages && <Link className="btn btn-small" href={link({ seite: page + 1 })}>Weiter →</Link>}
        </span>
      </div>
    </>
  );
}
