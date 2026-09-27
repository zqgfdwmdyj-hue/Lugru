import Link from "next/link";
import { redetect } from "@/app/(app)/ansprueche/actions";
import { CLAIM_STATUS_LABEL } from "@/lib/claims/labels";
import { formatDate, formatEuro } from "@/lib/numbers";
import { caseOpen, filterRows, needsAction, returnFilters, type ViewRow } from "@/lib/returns/filters";
import { monthly, type Mode, type MonthStat } from "@/lib/returns/reconcile";
import type { ReturnView } from "@/lib/returns/service";

const SERIES: { key: keyof MonthStat; label: string; color: string }[] = [
  { key: "returned", label: "Zurück erhalten", color: "#2E8B57" },
  { key: "paid", label: "Von Amazon bezahlt", color: "#4A6FD1" },
  { key: "waiting", label: "Ausstehend", color: "#C28A12" },
  { key: "lost", label: "Offen / verloren", color: "#C8375F" },
];

const qty = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
const monthName = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("de-DE", { month: "short", year: "2-digit", timeZone: "UTC" });

function niceMax(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function MonthChart({ months }: { months: MonthStat[] }) {
  const W = 820;
  const H = 240;
  const L = 70;
  const T = 10;
  const B = 26;
  const max = niceMax(Math.max(...months.map((m) => SERIES.reduce((a, s) => a + (m[s.key] as number), 0))));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const band = (W - L - 8) / months.length;
  const bw = Math.min(44, band * 0.6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto" }} role="img" aria-label="Erstattungen pro Monat, aufgeteilt nach Ergebnis">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={L} x2={W - 8} y1={y((max * i) / 4)} y2={y((max * i) / 4)} stroke={i ? "#e7e4dc" : "#c9c5ba"} />
          <text x={L - 8} y={y((max * i) / 4) + 4} textAnchor="end" fontSize="11" fill="#5b6168">{formatEuro((max * i) / 4).replace(",00", "")}</text>
        </g>
      ))}
      {months.map((m, i) => {
        const x = L + band * i + (band - bw) / 2;
        let acc = 0;
        return (
          <g key={m.month}>
            <title>{`${monthName(m.month)}: ${m.count} Erstattungen, ${formatEuro(m.refunded)}\n${SERIES.map((s) => `${s.label}: ${formatEuro(m[s.key] as number)}`).join("\n")}`}</title>
            {SERIES.map((s) => {
              const v = m[s.key] as number;
              if (v <= 0) return null;
              const y0 = y(acc);
              acc += v;
              const y1 = y(acc);
              return <rect key={s.key} x={x} y={y1 + 1} width={bw} height={Math.max(0, y0 - y1 - 1)} fill={s.color} rx={2} />;
            })}
            <text x={L + band * i + band / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#5b6168">{monthName(m.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ClaimTags({ r }: { r: ViewRow }) {
  if (!r.claims.length) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {r.claims.map((c) => {
        const [label, cls] = CLAIM_STATUS_LABEL[c.status];
        return (
          <Link key={c.id} href={`/ansprueche/${c.id}`} className={`tag ${cls}`} title="Anspruch öffnen: Fall-Text, Fallnummer, Status">
            {label}{c.amazonCaseId ? ` · ${c.amazonCaseId}` : ""}
          </Link>
        );
      })}
    </div>
  );
}

export function Abgleich({ view, mode, filter, q, marketplace }: { view: ReturnView; mode: Mode; filter: string; q: string; marketplace: string }) {
  const R = view.rows;
  const fba = mode === "fba";
  const count = (sts: string[]) => R.filter((r) => sts.includes(r.status) && !r.resolved).length;
  const sum = (f: (r: ViewRow) => number, pred: (r: ViewRow) => boolean = () => true) => R.filter(pred).reduce((a, r) => a + f(r), 0);
  const action = R.filter(needsAction);
  const openSum = sum((r) => r.open, (r) => !r.resolved);
  const cases = R.filter(caseOpen);
  const months = monthly(R, (r) => (r as ViewRow).resolved);
  const filters = returnFilters(R);
  const current = filters.some((f) => f.id === filter) ? filter : "action";
  const rows = filterRows(R, current, q);
  const link = (p: Record<string, string>) => `/retouren?${new URLSearchParams({ ansicht: "abgleich", modus: mode, filter: current, ...(q ? { q } : {}), ...p })}`;
  const orderUrl = (o: string) => `https://${marketplace}/orders-v3/order/${encodeURIComponent(o)}`;
  const missing = count(["missing", "nodoc"]);

  const tiles: [string, string, string, boolean?][] = fba
    ? [
        ["Fall eröffnen", String(action.length), `${formatEuro(sum((r) => r.open, needsAction))} offen`, action.length > 0],
        ["Ausstehend", String(count(["pending", "waitAmazon"])), `${formatEuro(sum((r) => r.expect))} von Amazon erwartet`],
        ["Von Amazon bezahlt", String(R.filter((r) => r.status === "reimbursed").length), `${formatEuro(sum((r) => r.amazon?.amount ?? 0, (r) => r.status === "reimbursed"))} erhalten`],
        ["Zurück erhalten", `${count(["ok", "damaged"])} / ${R.length}`, `${cases.length} Fälle bei Amazon offen · ${formatEuro(openSum)} offen gesamt`],
      ]
    : [
        ["Erstattet ohne Rückgabe", String(missing), `${formatEuro(sum((r) => r.open, (r) => ["missing", "nodoc"].includes(r.status) && !r.resolved))} offen`, missing > 0],
        ["Unterwegs / angefragt", String(count(["transit", "open"])), "Rücksendung noch nicht da"],
        ["Eingegangen, nicht erstattet", String(count(["toRefund"])), "Erstattung an den Kunden fällig"],
        ["Zurück erhalten", `${count(["ok"])} / ${R.length}`, `${cases.length} SAFE-T-Anträge offen`],
      ];

  return (
    <>
      <div className="between" style={{ flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Link className={`chip${fba ? " active" : ""}`} href="/retouren?ansicht=abgleich&modus=fba">Versand durch Amazon (FBA)</Link>
          <Link className={`chip${!fba ? " active" : ""}`} href="/retouren?ansicht=abgleich&modus=fbm">Händlerversand (FBM)</Link>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <form action={redetect}><button className="btn btn-small" type="submit" title="Ansprüche nach geänderten Einstellungen neu berechnen">Neu prüfen</button></form>
          <a className="btn btn-small" href={`/retouren/export?${new URLSearchParams({ modus: mode, filter: current, q })}`}>Als CSV</a>
          <Link className="btn btn-small" href="/import">Berichte hochladen</Link>
        </div>
      </div>

      {R.length === 0 && (
        <div className="notice">
          Noch keine Daten. Unter <Link href="/import">Daten importieren</Link> hochladen:{" "}
          {fba ? "Transaktionen (Berichte › Zahlungen › Berichts-Repository), FBA-Kundenrücksendungen und Erstattungen." : "Retourenbericht (Berichte › Retourenberichte) und Transaktionen."}{" "}
          Überlappende Zeiträume sind kein Problem, doppelte Zeilen werden erkannt.
        </div>
      )}
      {fba && R.length > 0 && !view.paymentsKnown && (
        <div className="notice notice-warn">
          <strong>Amazon-Zahlungen nicht geprüft.</strong> Es sind keine Entschädigungen gespeichert. Lade den Bericht „Erstattungen“ (Reimbursements) hoch, damit sichtbar wird, ob Amazon nicht zurückgeschickte Artikel bezahlt hat.
        </div>
      )}
      {cases.length > 0 && (
        <div className="notice">
          {cases.length} {cases.length === 1 ? "Fall ist" : "Fälle sind"} bei Amazon eingereicht und noch offen. <Link href={link({ filter: "caseOpen" })}>Anzeigen</Link> – nach 7 Tagen ohne Antwort nachfragen.
        </div>
      )}

      <div className="grid-kpi">
        {tiles.map(([label, value, sub, crit]) => (
          <div key={label} className="card card-pad" style={{ borderColor: crit ? "var(--danger)" : undefined }}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" style={{ color: crit ? "var(--danger)" : undefined }}>{value}</div>
            <div className="small muted">{sub}</div>
          </div>
        ))}
      </div>

      {months.length > 0 && (
        <section className="card card-pad">
          <div className="between" style={{ marginBottom: 8, flexWrap: "wrap" }}>
            <h2>Erstattungen pro Monat</h2>
            <div style={{ display: "flex", gap: 14, fontSize: 12, flexWrap: "wrap" }} className="muted">
              {SERIES.map((s) => (
                <span key={s.key} style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />{s.label}</span>
              ))}
            </div>
          </div>
          <MonthChart months={months} />
          <details style={{ marginTop: 8 }}>
            <summary className="small" style={{ cursor: "pointer" }}>Als Tabelle</summary>
            <table className="table" style={{ marginTop: 8 }}>
              <thead><tr><th>Monat</th><th className="right">Anzahl</th><th className="right">Erstattet</th><th className="right">Zurück erhalten</th><th className="right">Von Amazon bezahlt</th><th className="right">Ausstehend</th><th className="right">Offen / verloren</th></tr></thead>
              <tbody>
                {[...months].reverse().map((m) => (
                  <tr key={m.month}>
                    <td>{monthName(m.month)}</td>
                    <td className="num right">{m.count}</td>
                    <td className="num right">{formatEuro(m.refunded)}</td>
                    <td className="num right">{formatEuro(m.returned)}</td>
                    <td className="num right">{formatEuro(m.paid)}</td>
                    <td className="num right">{formatEuro(m.waiting)}</td>
                    <td className="num right">{formatEuro(m.lost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}

      <div className="between" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {filters.map((f) => (
            <Link key={f.id} href={link({ filter: f.id })} className={`chip${current === f.id ? " active" : ""}`}>{f.label} <span style={{ opacity: 0.6 }}>{f.n}</span></Link>
          ))}
        </div>
        <form style={{ display: "flex", gap: 6 }}>
          <input type="hidden" name="ansicht" value="abgleich" />
          <input type="hidden" name="modus" value={mode} />
          <input type="hidden" name="filter" value={current} />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Bestellnummer, SKU, Artikel, Fallnummer …" aria-label="Suchen" style={{ width: 280 }} />
        </form>
      </div>

      <section className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Status</th><th>Bestellung</th><th>Artikel</th><th className="right">Erstattet</th>
              {fba && <th className="right">Von Amazon</th>}<th className="right">Offen</th><th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={fba ? 7 : 6} className="muted">{R.length ? "Keine Einträge für diesen Filter." : "Noch keine Daten."}</td></tr>}
            {rows.map((r) => (
              <tr key={`${r.orderId}|${r.sku}`} style={{ opacity: r.resolved ? 0.55 : undefined, verticalAlign: "top" }}>
                <td style={{ width: 180, maxWidth: 180 }}>
                  <span className={`tag tag-${r.tone}`} style={{ whiteSpace: "normal", display: "inline-block" }}>{r.label}</span>
                  {r.overRefund > 0 && <div style={{ marginTop: 4 }}><span className="tag tag-warn">Zu viel erstattet</span></div>}
                  <ClaimTags r={r} />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <a className="num small" href={orderUrl(r.orderId)} target="_blank" rel="noopener noreferrer">{r.orderId}</a>
                  <div className="small muted">{fba ? "erstattet" : "angefragt"} {formatDate(r.date)}{r.days !== null ? ` · ${r.days} T.` : ""}</div>
                </td>
                <td style={{ maxWidth: 200 }}>
                  <div className="num small" style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={r.sku}>{r.sku || "–"}</div>
                  <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.title}>{r.title}</div>
                </td>
                <td className="num right" style={{ whiteSpace: "nowrap" }}>
                  {r.amount ? formatEuro(r.amount) : "–"}
                  <div className="small muted">{qty(r.qtyRefunded)} erst. / {qty(r.qtyReturned)} zurück</div>
                </td>
                {fba && (
                  <td className="num right" style={{ whiteSpace: "nowrap" }}>
                    {r.amazon ? <>{formatEuro(r.amazon.amount)}<div className="small muted">{formatDate(r.amazon.date)}</div></> : "–"}
                  </td>
                )}
                <td className="num right" style={{ whiteSpace: "nowrap", color: r.open && !r.resolved ? "var(--danger)" : undefined }}>{r.open ? formatEuro(r.open) : "–"}</td>
                <td className="small" style={{ minWidth: 180, maxWidth: 320 }}>
                  {r.detail.join(" · ")}
                  {r.reason && <div className="muted">Grund: {r.reason}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="small muted">
        Für alles, wofür Amazon zahlen muss, legt das System automatisch einen <Link href="/ansprueche">Anspruch</Link> an – dort stehen der fertige Text für Amazon, die Fallnummer und der Status. Ist der Anspruch erstattet, abgelehnt oder verworfen, gilt die Zeile als erledigt.
      </p>
    </>
  );
}
