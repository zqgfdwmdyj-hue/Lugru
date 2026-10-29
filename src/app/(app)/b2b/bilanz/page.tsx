import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { formatEuro } from "@/lib/numbers";
import { DEAL_STATUS_TAG, DEAL_STATUS_TEXT } from "@/lib/b2b/logic";
import { dealBilanzen } from "@/lib/b2b/kontrolle";
import type { DealStatus } from "@/db/schema";
import { SubmitButton } from "@/components/submit-button";
import { kontrolleJetztAction } from "./actions";

const BEWERTUNG: Record<string, [string, string]> = { wie_prognostiziert: ["tag-ok", "wie prognostiziert"], besser: ["tag-ok", "besser"], schlechter: ["tag-danger", "schlechter"], keine_daten: ["tag-neutral", "keine Daten"] };

export default async function B2bBilanzPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("b2b");
  const sp = await searchParams;
  const b = await dealBilanzen(session.tenantId);
  return (
    <>
      <div className="page-head">
        <div><div className="crumb"><Link href="/b2b">B2B-Deals</Link></div><h1>Deal-Bilanz & Erfolgskontrolle</h1></div>
        <form action={kontrolleJetztAction}><SubmitButton className="btn" label="Erfolgskontrolle jetzt prüfen" pendingLabel="Prüfe …" testId="kontrolle-jetzt" /></form>
      </div>
      {sp.meldung && <div className="notice notice-info" data-testid="bilanz-meldung">{sp.meldung}</div>}
      <section className="card card-pad" style={{ display: "flex", gap: 24, flexWrap: "wrap" }} data-testid="bilanz-summe">
        <div><div className="small muted">Stück verkauft</div><b style={{ fontSize: 20 }}>{b.summe.stueck}</b></div>
        <div><div className="small muted">Umsatz netto</div><b style={{ fontSize: 20 }}>{formatEuro(b.summe.umsatz)}</b></div>
        <div><div className="small muted">Unser Gewinn</div><b style={{ fontSize: 20, color: b.summe.gewinn < 0 ? "var(--danger)" : undefined }}>{formatEuro(b.summe.gewinn)}</b></div>
        <div><div className="small muted">Prognosen getroffen</div><b style={{ fontSize: 20 }}>{b.treffer.trefferquote === null ? "–" : `${b.treffer.trefferquote.toFixed(0)} %`}</b><div className="small muted">{b.treffer.anzahl} Kontrollen{b.treffer.abweichungSchnitt !== null ? ` · Ø ${b.treffer.abweichungSchnitt > 0 ? "+" : ""}${b.treffer.abweichungSchnitt.toFixed(1)} %` : ""}</div></div>
      </section>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table" data-testid="bilanz-liste">
          <thead><tr><th>Deal</th><th>Status</th><th className="right">Stück</th><th className="right">Umsatz netto</th><th className="right">EK + Versand</th><th className="right">Gewinn</th><th>Kontrolle 30/60 Tage (Ø Buy Box vs. Prognose)</th></tr></thead>
          <tbody>
            {b.liste.length === 0 && <tr><td colSpan={7} className="muted">Noch keine bestellten Deals.</td></tr>}
            {b.liste.map((d) => (
              <tr key={d.id}>
                <td><Link href={`/b2b/${d.id}`}>#{d.nr}</Link> <span className="small">{d.titel}</span></td>
                <td><span className={`tag ${DEAL_STATUS_TAG[d.status as DealStatus]}`}>{DEAL_STATUS_TEXT[d.status as DealStatus]}</span></td>
                <td className="num right">{d.stueck}</td>
                <td className="num right">{formatEuro(d.umsatzNetto)}</td>
                <td className="num right">{formatEuro(d.ekNetto + d.versand)}</td>
                <td className="num right" style={{ color: d.gewinn < 0 ? "var(--danger)" : "var(--ok)", fontWeight: 600 }}>{formatEuro(d.gewinn)}</td>
                <td className="small">
                  {d.kontrollen.length === 0 ? <span className="muted">{d.status === "bestellt" ? "nach Wareneingang" : "folgt nach 30 Tagen"}</span> : d.kontrollen.map((k) => (
                    <div key={`${k.tag}${k.land}`}>{k.tag} T. {k.land}: {formatEuro(k.ist)} vs. {formatEuro(k.prognose)} <span className={`tag ${BEWERTUNG[k.bewertung][0]}`}>{BEWERTUNG[k.bewertung][1]}{k.abweichung !== null ? ` ${k.abweichung > 0 ? "+" : ""}${k.abweichung.toFixed(0)} %` : ""}</span></div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="small muted">Gewinn = Umsatz netto (gelieferte Menge × Kundenpreis) − EK laut Staffel − Versandanteil. Gutschriften für Fehlmengen sind im Umsatz bereits abgezogen. Kontrolle: Ø Buy Box der letzten 30 Tage, ±10 % gilt als „wie prognostiziert“.</div>
    </>
  );
}
