import Link from "next/link";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { CASE_STATUSES, CASE_TYPES, CHANNELS } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { addDaysIso, todayIso } from "@/lib/dates";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL, CHANNEL_LABEL } from "@/lib/labels";
import { formatDate, formatEuro } from "@/lib/numbers";
import { createCase, updateCase } from "./actions";

export default async function FaellePage({ searchParams }: { searchParams: Promise<{ ansicht?: string; id?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const open = sp.ansicht !== "erledigt";
  const C = schema.cases;
  const where: SQL[] = [eq(C.tenantId, session.tenantId), open ? inArray(C.status, ["open", "waiting"]) : inArray(C.status, ["won", "lost", "closed"])];
  const [cases, snippets] = await Promise.all([
    db.select().from(C).where(and(...where)).orderBy(open ? sql`${C.deadline} asc nulls last` : desc(C.resolvedAt)).limit(300),
    db.select({ id: schema.knowledgeEntries.id, title: schema.knowledgeEntries.title }).from(schema.knowledgeEntries).where(and(eq(schema.knowledgeEntries.tenantId, session.tenantId), or(eq(schema.knowledgeEntries.kind, "snippet"), ilike(schema.knowledgeEntries.category, "%fälle%")))).orderBy(asc(schema.knowledgeEntries.title)),
  ]);
  const today = todayIso();
  const current = sp.id ? cases.find((c) => c.id === sp.id) : undefined;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Service</div><h1>Fälle & A-bis-Z</h1></div>
        <div style={{ display: "flex", gap: 6 }}>
          <Link className={`chip${open ? " active" : ""}`} href="/faelle">Offen</Link>
          <Link className={`chip${!open ? " active" : ""}`} href="/faelle?ansicht=erledigt">Erledigt</Link>
        </div>
      </div>
      <div className="row">
        <section className="card" style={{ flexGrow: 1, minWidth: 0, overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>Kanal</th><th>Art</th><th>Fall</th><th>Bestellung</th><th className="right">Betrag</th><th>Frist</th><th>Status</th></tr></thead>
            <tbody>
              {cases.length === 0 && <tr><td colSpan={7} className="muted">Keine Fälle. Fälle entstehen automatisch aus Mails (A-bis-Z, eBay-Fälle, Rücksendeanfragen) oder hier von Hand.</td></tr>}
              {cases.map((c) => {
                const urgent = open && c.deadline && c.deadline <= addDaysIso(today, 1);
                return (
                  <tr key={c.id} style={{ background: current?.id === c.id ? "var(--accent-soft)" : undefined }}>
                    <td>{CHANNEL_LABEL[c.channel]}</td>
                    <td className="small">{CASE_TYPE_LABEL[c.type]}</td>
                    <td><Link href={`/faelle?${open ? "" : "ansicht=erledigt&"}id=${c.id}`}>{c.title}</Link>{c.externalId && <div className="small muted num">{c.externalId}</div>}</td>
                    <td className="num small">{c.orderRef ? <Link href={`/suche?q=${encodeURIComponent(c.orderRef)}`}>{c.orderRef}</Link> : "–"}</td>
                    <td className="num right">{formatEuro(c.amount)}</td>
                    <td className="num" style={{ color: urgent ? "var(--danger)" : undefined, fontWeight: urgent ? 600 : undefined }}>{formatDate(c.deadline)}</td>
                    <td><span className={`tag ${CASE_STATUS_LABEL[c.status][1]}`}>{CASE_STATUS_LABEL[c.status][0]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <aside className="col-side">
          {current ? (
            <form action={updateCase} className="card card-pad stack" style={{ gap: 8 }}>
              <input type="hidden" name="id" value={current.id} />
              <h2>{current.title}</h2>
              <div className="field"><label className="label" htmlFor="cs">Status</label><select className="select" id="cs" name="status" defaultValue={current.status}>{CASE_STATUSES.map((s) => <option key={s} value={s}>{CASE_STATUS_LABEL[s][0]}</option>)}</select></div>
              <div className="field"><label className="label" htmlFor="cd">Frist</label><input className="input" id="cd" name="deadline" type="date" defaultValue={current.deadline ?? ""} /></div>
              <div className="field"><label className="label" htmlFor="ce">Fall-ID</label><input className="input num" id="ce" name="externalId" defaultValue={current.externalId ?? ""} /></div>
              <div className="field"><label className="label" htmlFor="cn">Notizen</label><textarea className="textarea" id="cn" name="notes" defaultValue={current.notes ?? ""} style={{ minHeight: 120 }} /></div>
              <button className="btn btn-primary" type="submit">Speichern</button>
              {snippets.length > 0 && (
                <div className="small"><strong>Textbausteine:</strong> {snippets.slice(0, 8).map((s) => <Link key={s.id} href={`/wissen/${s.id}`} style={{ marginRight: 8 }}>{s.title}</Link>)}</div>
              )}
            </form>
          ) : (
            <form action={createCase} className="card card-pad stack" style={{ gap: 8 }}>
              <h2>Fall anlegen</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <div className="field"><label className="label" htmlFor="nc-ch">Kanal</label><select className="select" id="nc-ch" name="channel">{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select></div>
                <div className="field"><label className="label" htmlFor="nc-t">Art</label><select className="select" id="nc-t" name="type">{CASE_TYPES.map((t) => <option key={t} value={t}>{CASE_TYPE_LABEL[t]}</option>)}</select></div>
              </div>
              <div className="field"><label className="label" htmlFor="nc-title">Titel</label><input className="input" id="nc-title" name="title" required /></div>
              <div className="field"><label className="label" htmlFor="nc-o">Bestellnummer</label><input className="input num" id="nc-o" name="orderRef" /></div>
              <div className="field"><label className="label" htmlFor="nc-e">Fall-ID</label><input className="input num" id="nc-e" name="externalId" /></div>
              <div style={{ display: "flex", gap: 8 }}>
                <div className="field"><label className="label" htmlFor="nc-a">Betrag €</label><input className="input num" id="nc-a" name="amount" /></div>
                <div className="field"><label className="label" htmlFor="nc-d">Frist</label><input className="input" id="nc-d" name="deadline" type="date" /></div>
              </div>
              <div className="field"><label className="label" htmlFor="nc-c">Kunde</label><input className="input" id="nc-c" name="customer" /></div>
              <button className="btn btn-primary" type="submit">Anlegen</button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
