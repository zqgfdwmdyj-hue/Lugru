import Link from "next/link";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { CLAIM_TYPES, type ClaimType } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { submittedInWindow } from "@/lib/claims/service";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { CLAIM_TYPE_LABEL, getSettings } from "@/lib/settings";
import { CLAIM_STATUS_LABEL as STATUS_LABEL } from "@/lib/claims/labels";
import { bulkStatus, createManualClaim, queueAllDetected, redetect } from "./actions";

const VIEWS = {
  warteschlange: "Warteschlange",
  neu: "Neu erkannt",
  fristen: "Nach Frist",
  eingereicht: "Eingereicht",
  eskaliert: "Eskaliert",
  erledigt: "Erledigt",
  alle: "Alle",
} as const;
type View = keyof typeof VIEWS;


export default async function AnspruechePage({ searchParams }: { searchParams: Promise<{ ansicht?: string; art?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "warteschlange";
  const type = CLAIM_TYPES.includes(sp.art as ClaimType) ? (sp.art as ClaimType) : null;
  const settings = await getSettings(session.tenantId);
  const C = schema.claims;
  const t = session.tenantId;
  const today = todayIso();

  const where: SQL[] = [eq(C.tenantId, t)];
  if (type) where.push(eq(C.type, type));
  let order: SQL[] = [desc(C.priority)];
  switch (view) {
    case "warteschlange": where.push(eq(C.status, "queued")); order = [asc(C.deadline), desc(C.priority)]; break;
    case "neu": where.push(eq(C.status, "detected")); break;
    case "fristen": where.push(inArray(C.status, ["detected", "queued"])); order = [asc(C.deadline)]; break;
    case "eingereicht": where.push(inArray(C.status, ["submitted", "partial"])); order = [desc(C.submittedAt)]; break;
    case "eskaliert": where.push(eq(C.status, "escalated")); break;
    case "erledigt": where.push(inArray(C.status, ["reimbursed", "rejected", "dismissed"])); order = [desc(C.resolvedAt)]; break;
  }

  const [claims, stats, window] = await Promise.all([
    db.select().from(C).where(and(...where)).orderBy(...order).limit(300),
    db
      .select({
        status: C.status,
        n: sql<number>`count(*)::int`,
        sum: sql<number>`coalesce(sum(${C.expectedAmount}), 0)::float`,
        paid: sql<number>`coalesce(sum(${C.reimbursedAmount}), 0)::float`,
      })
      .from(C)
      .where(eq(C.tenantId, t))
      .groupBy(C.status),
    submittedInWindow(t, settings.claims.resetHour),
  ]);
  const st = (s: string[]) => stats.filter((x) => s.includes(x.status)).reduce((a, x) => ({ n: a.n + x.n, sum: a.sum + x.sum, paid: a.paid + x.paid }), { n: 0, sum: 0, paid: 0 });
  const open = st(["detected", "queued"]);
  const submitted = st(["submitted", "partial"]);
  const won = st(["reimbursed", "partial"]);
  const free = Math.max(0, settings.claims.dailyLimit - window.used);
  const resetAt = window.next.toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", minute: "2-digit" });

  const link = (v: View, a: string | null = type) => `/ansprueche?ansicht=${v}${a ? `&art=${a}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div><div className="crumb">Amazon FBA</div><h1>Ansprüche</h1></div>
        <div style={{ display: "flex", gap: 8 }}>
          <form action={redetect}><button className="btn" type="submit">Neu prüfen</button></form>
          <a className="btn" href="/ansprueche/export?status=escalated">Eskalierte als CSV</a>
        </div>
      </div>

      <div className="grid-kpi">
        <div className="card card-pad"><div className="kpi-label">Offen</div><div className="kpi-value">{formatEuro(open.sum)}</div><div className="small muted">{open.n} Ansprüche</div></div>
        <div className="card card-pad"><div className="kpi-label">Eingereicht, noch offen</div><div className="kpi-value">{formatEuro(submitted.sum)}</div><div className="small muted">{submitted.n} Fälle</div></div>
        <div className="card card-pad"><div className="kpi-label">Zurückgeholt</div><div className="kpi-value">{formatEuro(won.paid)}</div><div className="small muted">{won.n} erledigt mit Erstattung</div></div>
        <div className="card card-pad" style={{ borderColor: free === 0 ? "var(--danger)" : undefined }}>
          <div className="kpi-label">Tageslimit Amazon</div>
          <div className="kpi-value">{free} <span style={{ fontSize: 15 }} className="muted">von {settings.claims.dailyLimit} frei</span></div>
          <div className="small muted">{window.used} eingereicht · Reset {resetAt}</div>
        </div>
      </div>

      <div className="between" style={{ flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={link(v)} className={`chip${view === v ? " active" : ""}`}>{VIEWS[v]}</Link>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link href={link(view, null)} className={`chip${!type ? " active" : ""}`}>Alle Arten</Link>
          {CLAIM_TYPES.filter((x) => x !== "other").map((x) => <Link key={x} href={link(view, x)} className={`chip${type === x ? " active" : ""}`}>{CLAIM_TYPE_LABEL[x]}</Link>)}
        </div>
      </div>

      {view === "neu" && claims.length > 0 && (
        <form action={queueAllDetected}><button className="btn btn-primary" type="submit">Alle {claims.length} vormerken</button></form>
      )}
      {view === "warteschlange" && (
        <div className="notice notice-warn">
          Heute kannst du noch <strong>{free}</strong> Fälle einreichen. Die obersten {Math.min(free, claims.length)} sind markiert – nach Frist und Betrag sortiert.
          Nach dem Einreichen die Fall-ID eintragen, dann ordnet das System spätere Erstattungen automatisch zu.
        </div>
      )}

      <form action={bulkStatus} className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr><th style={{ width: 28 }}></th><th>Art</th><th>Anspruch</th><th className="right">Menge</th><th className="right">Wert</th><th>Ereignis</th><th>Frist</th><th>Status</th></tr>
          </thead>
          <tbody>
            {claims.length === 0 && <tr><td colSpan={8} className="muted">Keine Ansprüche in dieser Ansicht. Reports unter „Daten importieren“ hochladen, dann wird automatisch geprüft.</td></tr>}
            {claims.map((c, i) => {
              const urgent = c.deadline && c.deadline <= addDaysIso(today, 7) && ["detected", "queued"].includes(c.status);
              const todayPick = view === "warteschlange" && i < free;
              const [label, cls] = STATUS_LABEL[c.status];
              return (
                <tr key={c.id} style={{ background: todayPick ? "var(--accent-soft)" : undefined }}>
                  <td><input type="checkbox" name="ids" value={c.id} aria-label="Auswählen" /></td>
                  <td className="small">{CLAIM_TYPE_LABEL[c.type]}</td>
                  <td><Link href={`/ansprueche/${c.id}`}>{c.title}</Link>{c.expectedAmount === null && <span className="small" style={{ color: "var(--danger)" }}> · EK fehlt</span>}</td>
                  <td className="num right">{c.quantity}</td>
                  <td className="num right">{formatEuro(c.expectedAmount)}</td>
                  <td className="num">{formatDate(c.eventDate)}</td>
                  <td className="num" style={{ color: urgent ? "var(--danger)" : undefined, fontWeight: urgent ? 600 : undefined }}>{formatDate(c.deadline)}</td>
                  <td><span className={`tag ${cls}`}>{label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {claims.length > 0 && (
          <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--border)" }}>
            <button className="btn btn-small" name="bulk" value="queue" type="submit">Auswahl vormerken</button>
            <button className="btn btn-small" name="bulk" value="dismiss" type="submit">Auswahl verwerfen</button>
          </div>
        )}
      </form>

      <details className="card card-pad">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Anspruch von Hand anlegen</summary>
        <form action={createManualClaim} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginTop: 14, alignItems: "end" }}>
          <div className="field"><label className="label" htmlFor="m-type">Art</label><select className="select" id="m-type" name="type">{CLAIM_TYPES.map((x) => <option key={x} value={x}>{CLAIM_TYPE_LABEL[x]}</option>)}</select></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label className="label" htmlFor="m-title">Titel</label><input className="input" id="m-title" name="title" required /></div>
          <div className="field"><label className="label" htmlFor="m-sku">SKU</label><input className="input" id="m-sku" name="sku" /></div>
          <div className="field"><label className="label" htmlFor="m-ref">Referenz</label><input className="input" id="m-ref" name="reference" placeholder="Bestellung, Sendung …" /></div>
          <div className="field"><label className="label" htmlFor="m-qty">Menge</label><input className="input" id="m-qty" name="quantity" defaultValue="1" /></div>
          <div className="field"><label className="label" htmlFor="m-cost">EK je Einheit</label><input className="input" id="m-cost" name="unitCost" inputMode="decimal" /></div>
          <div className="field"><label className="label" htmlFor="m-date">Ereignisdatum</label><input className="input" id="m-date" name="eventDate" type="date" /></div>
          <button className="btn btn-primary" type="submit">Anlegen</button>
        </form>
      </details>
    </>
  );
}
