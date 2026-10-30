import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { lernBerichtFuer } from "@/lib/deal-eingang/wert";
import { KpiMeta } from "@/components/kpi";
import { ergebnisseAction } from "../actions";

// Abschnitt 11: Monatsbericht „Wie gut lag der Deal-Wert?“ – Trefferquote, verpasste gute Deals, Fehlkäufe,
// wichtigste Merkmale (ab Lernmodell) und Stand der Lugru-Deals-History (nur Anzahlen).

const MERKMAL: Record<string, string> = {
  roi: "ROI",
  marge: "Marge",
  schwankung90: "Preisschwankung 90 Tage",
  einbrueche180: "Preiseinbrüche 180 Tage",
  angeboteTrend30: "Angebote-Trend 30 Tage",
  amazonAnteil: "Amazon-Anteil",
  bbAbweichung90: "Buy Box vs. Ø 90 Tage",
  rangTrend: "Rang-Trend",
  monatlichVerkauft: "Verkäufe/Monat",
  fbaAnteil: "FBA-Anteil",
  angebote: "Angebote",
};

function monate(heute: string): string[] {
  const out: string[] = [];
  const d = new Date(`${heute.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; i < 12; i++) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}
const monatText = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function DealLernenPage({ searchParams }: { searchParams: Promise<{ monat?: string; meldung?: string }> }) {
  const session = await requireArea("dealeingang");
  const sp = await searchParams;
  const liste = monate(todayIso());
  const monat = sp.monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.monat) ? sp.monat : liste[1];
  const b = await lernBerichtFuer(session.tenantId, monat);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/deal-eingang">Deal-Eingang</Link></div><h1>Deal-Wert: Wie gut lag er?</h1></div>
        <form className="row" style={{ gap: 8, alignItems: "center" }}>
          <select name="monat" defaultValue={monat} aria-label="Monat">
            {liste.map((m) => <option key={m} value={m}>{monatText(m)}</option>)}
          </select>
          <button className="btn" type="submit">Anzeigen</button>
        </form>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      {!session.readOnly && (
        <form action={ergebnisseAction} style={{ marginBottom: 12 }}>
          <input type="hidden" name="monat" value={monat} />
          <button className="btn" type="submit" data-testid="dl-ergebnisse" title="Sonst einmal täglich automatisch">Ergebnisse jetzt aktualisieren</button>
          <span className="small muted" style={{ marginLeft: 8 }}>reales Ergebnis gekaufter Deals 30/60/90 Tage nach Wareneingang (sellerboard)</span>
        </form>
      )}

      <div className="stack" style={{ gap: 6 }} data-kpi-group data-testid="dl-bericht" data-monat={monat}>
        <div className="grid-kpi">
          <div className="card card-pad"><div className="kpi-label">Deals</div><div className="kpi-value" data-testid="dl-deals">{b.deals}</div><div className="small muted">{b.mitWert} mit Deal-Wert</div></div>
          <div className="card card-pad"><div className="kpi-label">über der Schwelle</div><div className="kpi-value">{b.ueberSchwelle}</div><div className="small muted">Schwelle {b.schwelle}/100</div></div>
          <div className="card card-pad">
            <div className="kpi-label">Trefferquote</div>
            <div className={`kpi-value${b.trefferquote === null ? " muted" : ""}`} data-testid="dl-treffer">{b.trefferquote === null ? "noch keine" : `${b.trefferquote} %`}</div>
            <div className="small muted">{b.trefferBasis ? `aus ${b.trefferBasis} Deals mit Entscheidung` : "keine Entscheidung über der Schwelle"}</div>
          </div>
          <div className="card card-pad"><div className="kpi-label">Fehlkäufe</div><div className="kpi-value">{b.fehlkaeufe.length}</div><div className="small muted">realer ROI unter 0</div></div>
        </div>
        <KpiMeta period={monatText(monat)} source="Deal-Eingang (Deal-Wert beim Eingang, Entscheidung, 👍/👎), sellerboard (realer ROI)" stand="aktuell" />
      </div>
      <p className="small muted">
        Treffer = Deal-Wert über der Schwelle und danach gekauft (realer ROI ≥ Ziel bzw. Ergebnis noch offen) oder 👍. Verfahren: {b.verfahren}.
        Die roten Kriterien der Ampel gelten immer – ein roter Deal hat höchstens 30.
      </p>

      <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginTop: 12 }}>
        <section className="card card-pad" data-testid="dl-verpasst">
          <h3 style={{ marginTop: 0 }}>Verpasste gute Deals</h3>
          <p className="small muted">Deal-Wert unter 50, aber gekauft und gut gelaufen bzw. 👍.</p>
          {b.verpasst.length ? (
            <ul className="small">{b.verpasst.map((d) => <li key={d.id}><Link href={`/deal-eingang/${d.id}`}>{d.titel ?? "Deal"}</Link> · {d.datum} · Wert {d.wert}</li>)}</ul>
          ) : <p className="small muted">Keine.</p>}
        </section>
        <section className="card card-pad" data-testid="dl-fehlkaeufe">
          <h3 style={{ marginTop: 0 }}>Fehlkäufe</h3>
          <p className="small muted">Gekauft, realer ROI unter 0 (sellerboard, ab 30 Tagen nach Wareneingang).</p>
          {b.fehlkaeufe.length ? (
            <ul className="small">{b.fehlkaeufe.map((d) => <li key={d.id}><Link href={`/deal-eingang/${d.id}`}>{d.titel ?? "Deal"}</Link> · {d.datum} · Wert {d.wert ?? "–"} · ROI {d.realerRoi} %</li>)}</ul>
          ) : <p className="small muted">Keine.</p>}
        </section>
      </div>

      {b.wichtigsteMerkmale && (
        <section className="card card-pad" style={{ marginTop: 12 }} data-testid="dl-merkmale">
          <h3 style={{ marginTop: 0 }}>Was am meisten zählt (Lernmodell)</h3>
          <ul className="small">{b.wichtigsteMerkmale.map((m) => <li key={m.merkmal}>{MERKMAL[m.merkmal] ?? m.merkmal}: {m.gewicht > 0 ? "spricht dafür" : "spricht dagegen"} ({m.gewicht.toLocaleString("de-DE")})</li>)}</ul>
        </section>
      )}

      <section className="card card-pad" style={{ marginTop: 12 }} data-testid="dl-lugru">
        <h3 style={{ marginTop: 0 }}>Lugru-Deals-History</h3>
        {b.lugru.deals ? (
          <p className="small">
            {b.lugru.deals.toLocaleString("de-DE")} gepostete Deals, davon {b.lugru.mitKauf.toLocaleString("de-DE")} mit ✅ ({b.lugru.kaeufe.toLocaleString("de-DE")} Kauf-Reaktionen).
            {b.lugru.zuletzt && <> Stand {b.lugru.zuletzt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}.</>}
          </p>
        ) : (
          <p className="small muted">Noch nichts übernommen. In Lugru Deals unter Monitor → Einstellungen → eBay die Adresse des Seller-Systems und den Verbindungsschlüssel (Anbindungen → Lugru Deals) eintragen – dann kommt die History von selbst.</p>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>Reaktionen zählen nur als Anzahl und als schwaches Signal: keine Reaktion heißt nicht „nicht gekauft“. Keine Namen, keine Mitgliederprofile.</p>
      </section>
    </>
  );
}
