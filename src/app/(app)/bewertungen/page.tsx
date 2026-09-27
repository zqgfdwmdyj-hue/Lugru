import Link from "next/link";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/numbers";
import { CopyButton } from "@/components/copy-button";
import { setFeedbackStatus } from "./actions";

const STATUS: Record<string, string> = { new: "Neu", ok: "OK", answered: "Beantwortet", removal_requested: "Entfernung beantragt", removed: "Entfernt" };
const REMOVAL_TEXT = "Guten Tag,\n\ndie Bewertung zur Bestellung {Bestellnummer} bezieht sich ausschließlich auf die Lieferung bzw. den Versand durch Amazon (Versand durch Amazon). Gemäß den Richtlinien bitten wir um Entfernung.\n\nVielen Dank";

export default async function BewertungenPage({ searchParams }: { searchParams: Promise<{ ansicht?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const F = schema.feedback;
  const negative = sp.ansicht !== "alle";
  const [rows, stats] = await Promise.all([
    db.select().from(F).where(and(eq(F.tenantId, session.tenantId), negative ? lte(F.rating, 3) : undefined)).orderBy(desc(F.date)).limit(300),
    db.select({ n: sql<number>`count(*)::int`, avg: sql<number>`coalesce(avg(${F.rating}), 0)::float`, neg: sql<number>`count(*) filter (where ${F.rating} <= 2)::int` }).from(F).where(and(eq(F.tenantId, session.tenantId), sql`${F.date} >= current_date - 365`)),
  ]);
  const st = stats[0];
  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Service</div><h1>Bewertungen</h1></div>
        <div style={{ display: "flex", gap: 6 }}>
          <Link className={`chip${negative ? " active" : ""}`} href="/bewertungen">Neutral & negativ</Link>
          <Link className={`chip${!negative ? " active" : ""}`} href="/bewertungen?ansicht=alle">Alle</Link>
        </div>
      </div>
      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Bewertungen (12 Monate)</div><div className="kpi-value">{st.n}</div></div>
        <div className="card card-pad"><div className="kpi-label">Durchschnitt</div><div className="kpi-value">{st.avg ? st.avg.toFixed(2).replace(".", ",") : "–"}</div></div>
        <div className="card card-pad"><div className="kpi-label">Negativ (1–2 Sterne)</div><div className="kpi-value" style={{ color: st.neg ? "var(--danger)" : undefined }}>{st.neg}</div><div className="small muted">{st.n ? `${((st.neg / st.n) * 100).toFixed(1).replace(".", ",")} %` : ""}</div></div>
        <div className="card card-pad small"><div style={{ marginBottom: 6 }}>Vorlage Entfernungsantrag (FBA-Versand)</div><CopyButton text={REMOVAL_TEXT} /></div>
      </div>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>Datum</th><th>Sterne</th><th>Kommentar</th><th>Bestellung</th><th>Status</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Keine Bewertungen. Den Feedback-Bericht aus Seller Central importieren.</td></tr>}
            {rows.map((f) => (
              <tr key={f.id}>
                <td className="num">{formatDate(f.date)}</td>
                <td className="num" style={{ color: f.rating <= 2 ? "var(--danger)" : f.rating === 3 ? "var(--warn)" : undefined }}>{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}</td>
                <td style={{ maxWidth: 420 }}>{f.comment ?? "–"}</td>
                <td className="num small">{f.orderRef ? <Link href={`/suche?q=${f.orderRef}`}>{f.orderRef}</Link> : "–"}</td>
                <td>
                  <form action={setFeedbackStatus} style={{ display: "flex", gap: 4 }}>
                    <input type="hidden" name="id" value={f.id} />
                    <label className="sr-only" htmlFor={`fs-${f.id}`}>Status</label>
                    <select className="select" id={`fs-${f.id}`} name="status" defaultValue={f.status} style={{ padding: "3px 6px", fontSize: 12 }}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <button className="btn btn-small" type="submit">OK</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
