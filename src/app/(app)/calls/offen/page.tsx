import Link from "next/link";
import { KpiMeta } from "@/components/kpi";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { offenePunkte } from "@/lib/calls/service";
import { punktStatusAction } from "../actions";

// Vor dem nächsten Call: offene Aufgaben aus Calls, offene Fragen, Punkte beim Consultant, Kennzahlen
// (wie im Business-Plan-Update).

const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);
const eur0 = (n: number | null | undefined) => (n === null || n === undefined ? "keine Daten" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }));

export default async function OffenePunktePage() {
  const session = await requireArea("amazon");
  const heute = todayIso();
  const o = await offenePunkte(session.tenantId, heute);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/calls">Consultant-Calls</Link></div>
          <h1>Offene Punkte für den Consultant</h1>
        </div>
      </div>
      {o.vorschlaege > 0 && (
        <div className="notice notice-warn small" style={{ marginBottom: 12 }}>
          {o.vorschlaege} Vorschläge aus Calls sind noch nicht geprüft – <Link href="/calls">Calls ansehen</Link>.
        </div>
      )}

      <div className="stack" style={{ gap: 6, marginBottom: 14 }} data-kpi-group>
        <div className="grid-kpi" data-testid="offen-kpis">
          <div className="card card-pad">
            <div className="kpi-label">Umsatz Monat bis heute</div>
            <div className="kpi-value">{eur0(o.kpis.laufend?.sales)}</div>
            <div className="small muted">Gewinn {eur0(o.kpis.laufend?.netProfit)}</div>
          </div>
          <div className="card card-pad">
            <div className="kpi-label">Umsatz letzter Monat</div>
            <div className="kpi-value">{eur0(o.kpis.vormonat?.sales)}</div>
            <div className="small muted">Gewinn {eur0(o.kpis.vormonat?.netProfit)}</div>
          </div>
          <div className="card card-pad">
            <div className="kpi-label">Aufgaben aus Calls</div>
            <div className="kpi-value" data-testid="offen-anzahl">{o.aufgabenOffen.length} offen</div>
            <div className="small muted">{o.erledigtSeitLetztem} erledigt (45 Tage)</div>
          </div>
        </div>
        <KpiMeta period="Monat bis heute · letzter Monat" source="sellerboard (Amazon + eBay), Aufgaben aus dem Call-Archiv" stand={new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} />
      </div>

      <section className="card card-pad" style={{ marginBottom: 12 }} data-testid="offen-aufgaben">
        <h2 style={{ marginTop: 0 }}>Meine offenen Aufgaben aus Calls</h2>
        {o.aufgabenOffen.length === 0 ? (
          <p className="small muted">Keine.</p>
        ) : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {o.aufgabenOffen.map((r) => (
              <li key={r.p.id}>
                {r.p.text}
                {r.taskFaellig && <span className={r.taskFaellig < heute ? "" : "muted"} style={r.taskFaellig < heute ? { color: "var(--danger)" } : undefined}> · fällig {dmy(r.taskFaellig)}</span>}
                <span className="muted"> · aus <Link href={`/calls/${r.p.callId}#p-${r.p.id}`}>{r.callTitel}</Link></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad" style={{ marginBottom: 12 }} data-testid="offen-fragen">
        <h2 style={{ marginTop: 0 }}>Offene Fragen an den Consultant</h2>
        {o.fragen.length === 0 ? (
          <p className="small muted">Keine.</p>
        ) : (
          <div className="stack small" style={{ gap: 6 }}>
            {o.fragen.map((r) => (
              <form key={r.p.id} action={punktStatusAction} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <input type="hidden" name="call" value={r.p.callId} />
                <input type="hidden" name="punkt" value={r.p.id} />
                <input type="hidden" name="status" value="geklaert" />
                <input type="hidden" name="zurueck" value="offen" />
                <span>❓ {r.p.text}</span>
                <span className="muted">aus <Link href={`/calls/${r.p.callId}#p-${r.p.id}`}>{r.callTitel}</Link></span>
                <button className="btn-link small" type="submit">geklärt</button>
              </form>
            ))}
          </div>
        )}
      </section>

      <section className="card card-pad" data-testid="offen-consultant">
        <h2 style={{ marginTop: 0 }}>Zugesagt vom Consultant</h2>
        {o.consultant.length === 0 ? (
          <p className="small muted">Nichts offen.</p>
        ) : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {o.consultant.map((r) => (
              <li key={r.p.id}>
                {r.p.text}{r.p.frist && <span className="muted"> · bis {dmy(r.p.frist)}</span>}
                <span className="muted"> · aus <Link href={`/calls/${r.p.callId}#p-${r.p.id}`}>{r.callTitel}</Link></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
