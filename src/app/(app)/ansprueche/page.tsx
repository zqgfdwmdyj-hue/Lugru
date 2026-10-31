import Link from "next/link";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { CLAIM_TYPES, type ClaimType } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { KpiMeta } from "@/components/kpi";
import { jobStand } from "@/lib/today/jobs";
import { dataAreas } from "@/lib/today/service";
import { submittedInWindow } from "@/lib/claims/service";
import { addDaysIso, todayIso } from "@/lib/dates";
import { formatDate, formatEuro } from "@/lib/numbers";
import { CLAIM_TYPE_LABEL, getSettings } from "@/lib/settings";
import { CLAIM_STATUS_LABEL as STATUS_LABEL } from "@/lib/claims/labels";
import { bulkStatus, createManualClaim, queueAllDetected, redetect } from "./actions";
import { ConfirmButton } from "@/components/confirm-button";

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
  const session = await requireArea("amazon");
  const sp = await searchParams;
  const view: View = sp.ansicht && sp.ansicht in VIEWS ? (sp.ansicht as View) : "warteschlange";
  const type = CLAIM_TYPES.includes(sp.art as ClaimType) ? (sp.art as ClaimType) : null;
  const [settings, stand] = await Promise.all([getSettings(session.tenantId), jobStand(session.tenantId, ["Ansprüche", "Amazon-Reports abholen"])]);
  const C = schema.claims;
  const t = session.tenantId;
  const today = todayIso();

  const where: SQL[] = [eq(C.tenantId, t)];
  if (type) where.push(eq(C.type, type));
  // Status je Ansicht – auch für die Zähler an den Reitern.
  const VIEW_STATUS: Record<View, string[] | null> = {
    warteschlange: ["queued"],
    neu: ["detected"],
    fristen: ["detected", "queued"],
    eingereicht: ["submitted", "partial"],
    eskaliert: ["escalated"],
    erledigt: ["reimbursed", "rejected", "dismissed"],
    alle: null,
  };
  if (VIEW_STATUS[view]) where.push(inArray(C.status, VIEW_STATUS[view]! as (typeof C.status.enumValues)[number][]));
  const ORDER: Partial<Record<View, SQL[]>> = { warteschlange: [asc(C.deadline), desc(C.priority)], fristen: [asc(C.deadline)], eingereicht: [desc(C.submittedAt)], erledigt: [desc(C.resolvedAt)] };
  const order: SQL[] = ORDER[view] ?? [desc(C.priority)];

  const [claims, stats, window, typeStats, areas] = await Promise.all([
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
    // Zähler je Status mit dem gewählten Art-Filter (für die Reiter).
    db.select({ status: C.status, n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${C.expectedAmount}), 0)::float` }).from(C).where(and(eq(C.tenantId, t), type ? eq(C.type, type) : undefined)).groupBy(C.status),
    dataAreas(t),
  ]);
  const tabCount = (v: View) => typeStats.filter((x) => !VIEW_STATUS[v] || VIEW_STATUS[v]!.includes(x.status)).reduce((n, x) => n + x.n, 0);
  const reports = areas.filter((a) => ["report:ledger", "report:reimbursements", "report:customerReturns", "report:removalOrders", "report:inventory"].includes(a.key));
  const st = (s: string[]) => stats.filter((x) => s.includes(x.status)).reduce((a, x) => ({ n: a.n + x.n, sum: a.sum + x.sum, paid: a.paid + x.paid }), { n: 0, sum: 0, paid: 0 });
  const open = st(["detected", "queued"]);
  const detected = st(["detected"]);
  const queued = st(["queued"]);
  const submitted = st(["submitted", "partial"]);
  const won = st(["reimbursed", "partial"]);
  const free = Math.max(0, settings.claims.dailyLimit - window.used);
  const resetAt = window.next.toLocaleString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", minute: "2-digit" });

  const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
  const link = (v: View, a: string | null = type) => `/ansprueche?ansicht=${v}${a ? `&art=${a}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Service & Ansprüche</div><h1>Ansprüche</h1>
          <div className="small muted" style={{ marginTop: 4 }} data-testid="claims-stand">
            Datenstand: {reports.map((r, i) => (
              <span key={r.key}>{i ? " · " : ""}<span style={{ color: r.missing || r.stale ? "var(--warn)" : undefined }}>{r.label.replace("Amazon: ", "")} {r.last ? r.last.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" }) : "fehlt"}{r.stale ? " (veraltet)" : ""}</span></span>
            ))} · <Link href="/import#datenstand">Details</Link>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <form action={redetect}><button className="btn" type="submit">Neu prüfen</button></form>
          <a className="btn" href="/ansprueche/export?status=escalated">Eskalierte als CSV</a>
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }} data-kpi-group>
      <div className="grid-kpi">
        <div className="card card-pad" data-testid="claims-open">
          <div className="kpi-label">Offen (alle Arten)</div><div className="kpi-value">{formatEuro(open.sum)}</div>
          <div className="small muted">{open.n} Ansprüche: <Link href={link("neu", null)}>{detected.n} neu erkannt</Link> · <Link href={link("warteschlange", null)}>{queued.n} vorgemerkt</Link></div>
        </div>
        <div className="card card-pad"><div className="kpi-label">Eingereicht, noch offen</div><div className="kpi-value">{formatEuro(submitted.sum)}</div><div className="small muted">{submitted.n} Fälle</div></div>
        <div className="card card-pad"><div className="kpi-label">Zurückgeholt</div><div className="kpi-value">{formatEuro(won.paid)}</div><div className="small muted">{won.n} erledigt mit Erstattung</div></div>
        <div className="card card-pad" style={{ borderColor: free === 0 ? "var(--danger)" : undefined }}>
          <div className="kpi-label">Tageslimit Amazon</div>
          <div className="kpi-value">{free} <span style={{ fontSize: 15 }} className="muted">von {settings.claims.dailyLimit} frei</span></div>
          <div className="small muted">{window.used} eingereicht · Reset {resetAt}</div>
        </div>
      </div>
      <KpiMeta period="offen: alle bis heute · zurückgeholt: gesamt" source="Amazon-Berichte (Lagerbewegungen, Erstattungen, Remissionen) und eigene Fälle" stand={stand.text} fehler={stand.fehler} />
      </div>

      <div className="between" style={{ flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(VIEWS) as View[]).map((v) => <Link key={v} href={link(v)} className={`chip${view === v ? " active" : ""}`} aria-current={view === v ? "true" : undefined} data-testid={`claims-tab-${v}`}>{VIEWS[v]} · {tabCount(v)}</Link>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link href={link(view, null)} className={`chip${!type ? " active" : ""}`} aria-current={!type ? "true" : undefined}>Alle Arten</Link>
          {CLAIM_TYPES.filter((x) => x !== "other").map((x) => <Link key={x} href={link(view, x)} className={`chip${type === x ? " active" : ""}`} aria-current={type === x ? "true" : undefined}>{CLAIM_TYPE_LABEL[x]}</Link>)}
        </div>
      </div>

      {view === "neu" && claims.length > 0 && (
        <form action={queueAllDetected}><button className="btn btn-primary" type="submit">Alle {claims.length} vormerken</button></form>
      )}
      {view === "warteschlange" && claims.length === 0 && detected.n > 0 && (
        <div className="notice notice-info" data-testid="queue-explain">
          Die Warteschlange ist leer, weil noch nichts vorgemerkt ist. Die {detected.n} offenen Ansprüche ({formatEuro(detected.sum)}) oben sind <strong>neu erkannt</strong> und warten auf deine Prüfung –{" "}
          <Link href={link("neu")}>ansehen und vormerken</Link>.{type ? " (Gezählt über alle Arten; der Filter oben gilt nur für die Liste.)" : ""}
        </div>
      )}
      {view === "warteschlange" && claims.length > 0 && (
        <div className="notice notice-warn">
          Heute kannst du noch <strong>{free}</strong> Fälle einreichen. Die obersten {Math.min(free, claims.length)} sind markiert – nach Frist und Betrag sortiert.
          Nach dem Einreichen die Fall-ID eintragen, dann ordnet das System spätere Erstattungen automatisch zu.
        </div>
      )}

      {claims.length >= 300 && tabCount(view) > 300 && <div className="small muted" data-testid="claims-limit">Es werden die ersten 300 von {tabCount(view)} gezeigt (nach Frist bzw. Priorität) – mit Art-Filter oder Reitern eingrenzen.</div>}
      <form action={bulkStatus} className="card" style={{ overflow: "auto" }}>
        <table className="table sticky-head">
          <thead>
            <tr><th style={{ width: 28 }}></th><th>Art</th><th>Anspruch</th><th className="right">Menge</th><th className="right">Wert</th><th>Ereignis</th><th>Frist</th><th>Status</th></tr>
          </thead>
          <tbody>
            {claims.length === 0 && <tr><td colSpan={8} className="muted" data-testid="claims-empty">{open.n + tabCount("alle") === 0 ? "Noch keine Ansprüche. Reports unter „Daten importieren“ hochladen, dann wird automatisch geprüft." : `Keine Ansprüche in „${VIEWS[view]}“${type ? ` für „${CLAIM_TYPE_LABEL[type]}“` : ""}. Andere Reiter zeigen die übrigen.`}</td></tr>}
            {claims.map((c, i) => {
              const urgent = c.deadline && c.deadline <= addDaysIso(today, 7) && ["detected", "queued"].includes(c.status);
              const todayPick = view === "warteschlange" && i < free;
              const [label, cls] = STATUS_LABEL[c.status];
              // Platzhalter-Frist: ohne Ereignisdatum, oder von Hand angelegt mit Ereignis = Anlegetag.
              const placeholder = Boolean(c.deadline) && (!c.eventDate || (!c.detectionKey && c.eventDate === c.createdAt.toISOString().slice(0, 10)));
              return (
                <tr key={c.id} style={{ background: todayPick ? "var(--accent-soft)" : undefined }}>
                  <td><input type="checkbox" name="ids" value={c.id} aria-label="Auswählen" /></td>
                  <td className="small">{CLAIM_TYPE_LABEL[c.type]}</td>
                  <td><Link href={`/ansprueche/${c.id}`}>{c.title}</Link>{c.expectedAmount === null && <span className="tag tag-missing" style={{ marginLeft: 6 }}>EK fehlt</span>}</td>
                  <td className="num right">{c.quantity}</td>
                  <td className="num right">{formatEuro(c.expectedAmount)}</td>
                  <td className="num">{formatDate(c.eventDate)}</td>
                  <td className="num" style={{ color: urgent ? "var(--danger)" : undefined, fontWeight: urgent ? 600 : undefined }} data-testid="claim-deadline">
                    {formatDate(c.deadline)}
                    {placeholder ? (
                      <div className="small" style={{ color: "var(--warn)", fontWeight: 400 }} title="Kein echtes Ereignisdatum – die Frist ist nur ein Platzhalter ab dem Anlegen. Ereignisdatum im Anspruch eintragen.">Platzhalter</div>
                    ) : c.eventDate && c.deadline ? (
                      <div className="small muted" style={{ fontWeight: 400 }} title={`Frist = Ereignis + ${days(c.eventDate, c.deadline)} Tage (Regel für „${CLAIM_TYPE_LABEL[c.type]}“: ${settings.claims.windowDays[c.type]} Tage)`}>Ereignis + {days(c.eventDate, c.deadline)} T.</div>
                    ) : null}
                    {c.deadline && c.deadline < today && ["detected", "queued"].includes(c.status) && <div className="small">abgelaufen?</div>}
                  </td>
                  <td><span className={`tag ${cls}`}>{label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {claims.length > 0 && (
          <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid var(--border)" }}>
            <button className="btn btn-small" name="bulk" value="queue" type="submit">Auswahl vormerken</button>
            <ConfirmButton name="bulk" value="dismiss" confirm="Ausgewählte Ansprüche verwerfen? Sie bleiben unter „Erledigt“ sichtbar und lassen sich wieder öffnen.">Auswahl verwerfen</ConfirmButton>
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
