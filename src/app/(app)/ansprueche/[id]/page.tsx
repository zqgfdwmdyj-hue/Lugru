import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";
import { CLAIM_STATUS_LABEL } from "@/lib/claims/labels";
import { claimCaseText } from "@/lib/claims/texts";
import { formatDate, formatEuro } from "@/lib/numbers";
import { CLAIM_TYPE_LABEL } from "@/lib/settings";
import { CopyButton } from "@/components/copy-button";
import { dismissClaim, escalateClaim, queueClaim, reopenClaim, resolveClaim, saveClaimNotes, submitClaim } from "../actions";

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const C = schema.claims;
  const [claim] = await db.select().from(C).where(and(eq(C.id, id), eq(C.tenantId, session.tenantId)));
  if (!claim) notFound();
  const [events, invoices] = await Promise.all([
    db
      .select({ at: schema.claimEvents.createdAt, action: schema.claimEvents.action, note: schema.claimEvents.note, user: schema.users.name })
      .from(schema.claimEvents)
      .leftJoin(schema.users, eq(schema.users.id, schema.claimEvents.userId))
      .where(eq(schema.claimEvents.claimId, id))
      .orderBy(desc(schema.claimEvents.createdAt)),
    claim.lotId
      ? db
          .select({ id: schema.invoices.id, fileName: schema.invoices.fileName, date: schema.invoices.invoiceDate })
          .from(schema.invoiceLots)
          .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceLots.invoiceId))
          .where(eq(schema.invoiceLots.lotId, claim.lotId))
          .orderBy(asc(schema.invoices.invoiceDate))
      : Promise.resolve([]),
  ]);
  const [label, cls] = CLAIM_STATUS_LABEL[claim.status];
  const text = claimCaseText(claim);
  const open = ["detected", "queued"].includes(claim.status);

  return (
    <>
      <div className="crumb"><Link href="/ansprueche">Ansprüche</Link> › {CLAIM_TYPE_LABEL[claim.type]}</div>
      <div className="page-head">
        <div><h1 style={{ fontSize: 22 }}>{claim.title}</h1></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`tag ${cls}`}>{label}</span>
          <a className="btn" href={`/mappe/${claim.id}`} target="_blank" rel="noreferrer">Nachweis-Mappe</a>
        </div>
      </div>

      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card card-pad">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
              <div><div className="kpi-label">Menge</div><div className="kpi-value" style={{ fontSize: 22 }}>{claim.quantity}</div></div>
              <div><div className="kpi-label">EK je Einheit</div><div className="kpi-value" style={{ fontSize: 22 }}>{formatEuro(claim.unitCost)}</div></div>
              <div><div className="kpi-label">Erwarteter Betrag</div><div className="kpi-value" style={{ fontSize: 22 }}>{formatEuro(claim.expectedAmount)}</div></div>
              <div><div className="kpi-label">Frist</div><div className="kpi-value" style={{ fontSize: 22 }}>{formatDate(claim.deadline)}</div></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 6, marginTop: 16, fontSize: 14 }}>
              <span className="muted">SKU</span><span className="num">{claim.lotId ? <Link href={`/chargen/${claim.lotId}`}>{claim.sku}</Link> : (claim.sku ?? "–")}</span>
              <span className="muted">FNSKU / ASIN</span><span className="num">{claim.fnsku ?? "–"} / {claim.asin ?? "–"}</span>
              <span className="muted">Referenz</span><span className="num">{claim.reference ?? "–"}</span>
              <span className="muted">Ereignis</span><span>{formatDate(claim.eventDate)}</span>
              <span className="muted">Amazon-Fall</span><span className="num">{claim.amazonCaseId ?? "–"}</span>
              <span className="muted">Erstattet</span><span className="num">{formatEuro(claim.reimbursedAmount)}</span>
              <span className="muted">Rechnungen</span>
              <span>{invoices.length ? invoices.map((i) => <Link key={i.id} href={`/rechnungen/${i.id}`} style={{ marginRight: 10 }}>{i.fileName}</Link>) : <span className="muted">keine verknüpft</span>}</span>
            </div>
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 10 }}>Nachweise</h2>
            <table className="table">
              <tbody>
                {claim.evidence.map((e, i) => (
                  <tr key={i}><td style={{ width: 240 }}>{e.label}</td><td>{e.value}</td><td className="small muted">{e.source}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card card-pad stack">
            <div className="between"><h2>Text für den Amazon-Fall</h2><CopyButton text={text} /></div>
            <div className="snippet article-body" style={{ fontSize: 14 }}>{text}</div>
          </section>
        </div>

        <aside className="col-side">
          <section className="card card-pad stack">
            <h2>Bearbeiten</h2>
            {claim.status === "detected" && <form action={queueClaim}><input type="hidden" name="id" value={claim.id} /><button className="btn btn-primary" type="submit" style={{ width: "100%" }}>Zum Einreichen vormerken</button></form>}
            {open && (
              <form action={submitClaim} className="stack" style={{ gap: 6 }}>
                <input type="hidden" name="id" value={claim.id} />
                <label className="label" htmlFor="caseId">Bei Amazon eingereicht – Fall-ID</label>
                <input className="input" id="caseId" name="caseId" placeholder="z. B. 12345678901" />
                <button className="btn" type="submit">Als eingereicht markieren</button>
              </form>
            )}
            {["submitted", "partial", "escalated"].includes(claim.status) && (
              <form action={resolveClaim} className="stack" style={{ gap: 6 }}>
                <input type="hidden" name="id" value={claim.id} />
                <label className="label" htmlFor="amount">Ergebnis</label>
                <input className="input" id="amount" name="amount" inputMode="decimal" placeholder="Erstatteter Betrag in €" />
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-small" name="result" value="reimbursed" type="submit">Erstattet</button>
                  <button className="btn btn-small" name="result" value="partial" type="submit">Teilweise</button>
                  <button className="btn btn-small" name="result" value="rejected" type="submit">Abgelehnt</button>
                </div>
              </form>
            )}
            {["submitted", "partial", "rejected"].includes(claim.status) && (
              <form action={escalateClaim}><input type="hidden" name="id" value={claim.id} /><button className="btn" type="submit" style={{ width: "100%" }}>Eskalieren (Anwalt)</button></form>
            )}
            {open && <form action={dismissClaim}><input type="hidden" name="id" value={claim.id} /><button className="btn-link small" type="submit" style={{ color: "var(--danger)" }}>Verwerfen</button></form>}
            {!open && <form action={reopenClaim}><input type="hidden" name="id" value={claim.id} /><button className="btn-link small" type="submit">Wieder öffnen</button></form>}
          </section>

          <section className="card card-pad">
            <form action={saveClaimNotes} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="id" value={claim.id} />
              <input type="hidden" name="caseId" value={claim.amazonCaseId ?? ""} />
              <label className="label" htmlFor="notes">Notizen</label>
              <textarea className="textarea" id="notes" name="notes" defaultValue={claim.notes ?? ""} style={{ minHeight: 100 }} />
              <button className="btn btn-small" type="submit">Speichern</button>
            </form>
          </section>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 10 }}>Verlauf</h2>
            <div className="stack" style={{ gap: 8, fontSize: 13 }}>
              {events.map((e, i) => (
                <div key={i}>
                  <div><strong>{e.action}</strong>{e.user ? ` · ${e.user}` : ""}</div>
                  <div className="small muted">{e.at.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}{e.note ? ` · ${e.note}` : ""}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
