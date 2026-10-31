import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DEAL_STATUS } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { formatDate, formatEuro } from "@/lib/numbers";
import { besterMarkt, DEAL_STATUS_TAG as STATUS_TAG, DEAL_STATUS_TEXT } from "@/lib/b2b/logic";

const ANSICHTEN = [
  ["laufend", "Laufend", ["entwurf", "aktiv", "geschlossen", "bestellt", "angekommen"]],
  ["entwurf", "Entwürfe", ["entwurf"]],
  ["aktiv", "Offen im Portal", ["aktiv"]],
  ["abgeschlossen", "Abgeschlossen", ["verteilt", "erledigt", "verfallen"]],
  ["alle", "Alle", [...DEAL_STATUS]],
] as const;

export default async function B2bDealsPage({ searchParams }: { searchParams: Promise<{ ansicht?: string }> }) {
  const session = await requireArea("b2b");
  const sp = await searchParams;
  const ansicht = ANSICHTEN.find(([k]) => k === sp.ansicht) ?? ANSICHTEN[0];
  const D = schema.deals;
  const R = schema.dealReservierungen;
  const reserviert = sql<number>`coalesce((select sum(r.menge) from deal_reservierungen r where r.deal_id = ${D.id} and r.status not in ('storniert','erstattet')), 0)::int`;
  const kunden = sql<number>`(select count(*) from deal_reservierungen r where r.deal_id = ${D.id} and r.status not in ('storniert','erstattet'))::int`;
  const deals = await db
    .select({ id: D.id, nr: D.nr, status: D.status, titel: D.titel, asin: D.asin, marke: D.marke, preis: D.kundenpreisNetto, ek: D.ekNetto, frist: D.frist, maxGesamt: D.maxGesamt, moq: D.moqLieferant, prognose: D.prognose, reserviert, kunden })
    .from(D)
    .where(and(eq(D.tenantId, session.tenantId), inArray(D.status, [...ansicht[2]])))
    .orderBy(desc(D.nr))
    .limit(300);
  const [k] = await db
    .select({
      offen: sql<number>`count(*) filter (where ${D.status} = 'aktiv')::int`,
      entwurf: sql<number>`count(*) filter (where ${D.status} = 'entwurf')::int`,
    })
    .from(D)
    .where(eq(D.tenantId, session.tenantId));
  const [v] = await db
    .select({ n: sql<number>`count(*)::int`, betrag: sql<number>`coalesce(sum(${R.rechnungBrutto}), 0)::float` })
    .from(R)
    .where(and(eq(R.tenantId, session.tenantId), eq(R.status, "vorkasse_offen")));

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Einkauf</div><h1>B2B-Deals</h1></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link className="btn" href="/b2b/preislisten">Preislisten je Land</Link>
          <Link className="btn" href="/b2b/bilanz">Bilanz</Link>
          <Link className="btn" href="/b2b/kunden">B2B-Kunden</Link>
          <Link className="btn" href="/b2b/lieferanten">Lieferanten-Freigaben</Link>
          <Link className="btn btn-primary" href="/b2b/neu" data-testid="deal-neu">Deal anlegen</Link>
        </div>
      </div>
      <div className="small" data-testid="deals-summe">
        Offen im Portal: <b>{k.offen}</b> · Entwürfe: <b>{k.entwurf}</b> · Vorkasse offen: <b>{v.n}</b>{v.n ? ` (${formatEuro(v.betrag)})` : ""}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ANSICHTEN.map(([key, label]) => <Link key={key} className={`chip${ansicht[0] === key ? " active" : ""}`} aria-current={ansicht[0] === key ? "true" : undefined} href={`/b2b?ansicht=${key}`}>{label}</Link>)}
      </div>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table" data-testid="deals-liste">
          <thead><tr><th>Nr.</th><th>Artikel</th><th>Status</th><th className="right">Preis / EK</th><th className="right">Reserviert</th><th>Bestes Land</th><th>Frist</th></tr></thead>
          <tbody>
            {deals.length === 0 && <tr><td colSpan={7} className="muted">Keine Deals in dieser Ansicht. Deals entstehen aus dem Preislisten-Scanner oder über „Deal anlegen“.</td></tr>}
            {deals.map((d) => {
              const b = besterMarkt(d.prognose);
              const moqOk = d.reserviert >= d.moq;
              return (
                <tr key={d.id}>
                  <td className="num"><Link href={`/b2b/${d.id}`}>#{d.nr}</Link></td>
                  <td style={{ maxWidth: 320 }}><Link href={`/b2b/${d.id}`}>{d.titel}</Link><div className="small muted num">{d.asin}{d.marke ? ` · ${d.marke}` : ""}</div></td>
                  <td><span className={`tag ${STATUS_TAG[d.status]}`}>{DEAL_STATUS_TEXT[d.status]}</span></td>
                  <td className="num right">{formatEuro(d.preis)}<div className="small muted">EK {formatEuro(d.ek)}</div></td>
                  <td className="num right">{d.reserviert}{d.maxGesamt ? ` / ${d.maxGesamt}` : ""}<div className="small" style={{ color: moqOk ? "var(--ok)" : "var(--muted)" }}>MOQ {d.moq}{moqOk ? " ✓" : ""} · {d.kunden} Kd.</div></td>
                  <td className="small">{b ? `${b.land}: ${b.roi.toFixed(0)} % ROI` : "–"}</td>
                  <td className="num">{formatDate(d.frist)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
