import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { profitAt } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { offerToListing } from "../actions";
import { FeedUpload } from "./upload-form";

type Row = { id: string; supplier_sku: string; ean: string | null; asin: string | null; title: string | null; price: number | null; stock: number | null; amz_price: number | null; our_asin: string | null; fee: number | null; ref: number | null };

export default async function FeedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nur?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [feed] = await db.select().from(schema.supplierFeeds).where(and(eq(schema.supplierFeeds.id, id), eq(schema.supplierFeeds.tenantId, session.tenantId)));
  if (!feed) notFound();
  const s = await getSettings(session.tenantId);
  const res = await db.execute<Row>(sql`
    select o.id, o.supplier_sku, o.ean, o.asin, o.title, o.price::float, o.stock,
           (select max(i.price)::float from amazon_inventory i where i.tenant_id = o.tenant_id and i.asin = coalesce(o.asin, p.asin)) as amz_price,
           p.asin as our_asin, p.fba_fee::float as fee, p.referral_rate::float as ref
      from supplier_offers o
      left join products p on p.tenant_id = o.tenant_id and ((o.asin is not null and p.asin = o.asin) or (o.ean is not null and p.ean = o.ean))
     where o.feed_id = ${id}
     order by o.supplier_sku
     limit 3000`);
  const rows = res.rows.map((r) => {
    const profit = r.price !== null && r.amz_price !== null ? profitAt(r.amz_price, { unitCost: r.price, fbaFee: r.fee ?? s.pricing.defaultFbaFee, referralRate: r.ref ?? s.pricing.referralRate, vatRate: s.vatRate }) : null;
    return { ...r, profit };
  });
  const shown = sp.nur === "treffer" ? rows.filter((r) => r.our_asin) : sp.nur === "gewinn" ? rows.filter((r) => (r.profit ?? -1) > 0).sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0)) : rows;

  return (
    <>
      <div className="crumb"><Link href="/lieferanten">Lieferanten-Feeds</Link></div>
      <div className="page-head"><div><h1>{feed.name}</h1><div className="small muted">{rows.length} Angebote · {rows.filter((r) => r.our_asin).length} passen zu deinen Artikeln</div></div></div>
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <div style={{ display: "flex", gap: 6 }}>
            <Link href={`/lieferanten/${id}`} className={`chip${!sp.nur ? " active" : ""}`}>Alle</Link>
            <Link href={`/lieferanten/${id}?nur=treffer`} className={`chip${sp.nur === "treffer" ? " active" : ""}`}>Passt zu meinen Artikeln</Link>
            <Link href={`/lieferanten/${id}?nur=gewinn`} className={`chip${sp.nur === "gewinn" ? " active" : ""}`}>Mit Gewinn</Link>
          </div>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>Art.-Nr.</th><th>Titel</th><th>EAN / ASIN</th><th className="right">EK</th><th className="right">Bestand</th><th className="right">Dein Amazon-Preis</th><th className="right">Gewinn/Stk</th><th></th></tr></thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={8} className="muted">Keine Angebote.</td></tr>}
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.id}>
                    <td className="num small">{r.supplier_sku}</td>
                    <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title ?? "–"}</td>
                    <td className="num small">{r.ean ?? "–"}{r.our_asin ? <div><Link href={`/chargen?q=${r.our_asin}`}>{r.our_asin}</Link></div> : null}</td>
                    <td className="num right">{formatEuro(r.price)}</td>
                    <td className="num right">{r.stock ?? "–"}</td>
                    <td className="num right">{formatEuro(r.amz_price)}</td>
                    <td className="num right" style={{ color: (r.profit ?? 0) < 0 ? "var(--danger)" : r.profit ? "var(--ok)" : undefined }}>{formatEuro(r.profit)}</td>
                    <td>
                      <form action={offerToListing} style={{ display: "flex", gap: 4 }}>
                        <input type="hidden" name="offerId" value={r.id} />
                        <input type="hidden" name="price" value={r.amz_price ?? ""} />
                        <button className="btn btn-small" type="submit" title="eBay-Listing-Entwurf anlegen">→ eBay</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <aside className="col-side"><FeedUpload feedId={feed.id} mapping={feed.mapping} /></aside>
      </div>
    </>
  );
}
