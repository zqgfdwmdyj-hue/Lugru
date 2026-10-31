import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { wochenrueckblick } from "@/lib/feierabend/service";
import { requirePrivate } from "@/lib/private/service";
import { VERGLEICH_TEXT } from "@/lib/private/rueckblick-logic";
import { PrintButton } from "@/components/print-button";
import { PrivatHead, dmy } from "../../ui";

// B19.7/B16: Wochenrückblick privat (7 Tage bis zum gewählten Tag) – Familienzeit, Paarzeit, eigene Beobachtungen,
// Zuwendung, Gespräche, Danke, eigene Stimmung, Dateideen, private Aufgaben und Vergleich zur Vorwoche.
// Nur mit vollem Privat-Zugang und nur für die eigene Person.

const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default async function WochenRueckblickPage({ searchParams }: { searchParams: Promise<{ bis?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const heute = todayIso();
  const bis = sp.bis && /^\d{4}-\d{2}-\d{2}$/.test(sp.bis) && sp.bis <= heute ? sp.bis : heute;
  const { privat: p } = await wochenrueckblick(session, bis, true);
  const von = plus(bis, -6);
  return (
    <>
      <div className="no-print">
        <PrivatHead active="wochenrueckblick" title="Wochenrückblick" pin={session.privatePin} sub={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Link className="btn" href={`/privat/rueckblick/woche?bis=${plus(bis, -7)}`} data-testid="woche-zurueck">‹ Vorwoche</Link>
            {bis < heute && <Link className="btn" href={`/privat/rueckblick/woche?bis=${plus(bis, 7) > heute ? heute : plus(bis, 7)}`}>Nächste Woche ›</Link>}
            <Link className="btn" href="/privat/rueckblick">Monatsrückblick</Link>
            <PrintButton label="Drucken / PDF" />
          </div>
        } />
      </div>
      {!p ? (
        <div className="card card-pad small muted">Der Wochenrückblick braucht vollen Privat-Zugang.</div>
      ) : (
        <section className="card card-pad stack" data-testid="wochenrueckblick">
          <h2>Woche {dmy(von)} – {dmy(bis)}</h2>
          <table className="table small">
            <tbody>
              <tr><td>Familienzeit</td><td className="num right">{p.familienzeitStunden ? `${String(p.familienzeitStunden).replace(".", ",")} Std.` : "nicht erfasst"}{p.familienzeitOhneUhrzeit ? ` (+${p.familienzeitOhneUhrzeit} ohne Uhrzeit)` : ""}</td></tr>
              <tr><td>Paarzeit</td><td className="num right">{p.paarzeitAnzahl ? `${p.paarzeitAnzahl}×` : "keine"}</td></tr>
              {p.zuwendung.map((z) => <tr key={z.art}><td>{z.art === "massage" ? "Massage" : "Streicheln"}</td><td className="num right">{z.anzahl ? `${z.anzahl}× (${z.wer.map((w) => `${w.richtung} ${w.anzahl}`).join(", ")})` : "keine"}</td></tr>)}
              {p.zuwendungAusgefallen > 0 && <tr><td>Zuwendung ausgefallen</td><td className="num right">{p.zuwendungAusgefallen}×</td></tr>}
              <tr><td>Stimmung (eigene)</td><td className="num right">{p.stimmung.schnitt === null ? "nicht erfasst" : `Ø ${String(p.stimmung.schnitt).replace(".", ",")}`}</td></tr>
              <tr><td>Private Aufgaben</td><td className="num right">{p.aufgaben.erledigt.length} erledigt · {p.aufgaben.offen.length} offen</td></tr>
            </tbody>
          </table>

          <h3 style={{ margin: "6px 0 0", fontSize: 15 }}>Vergleich zur Vorwoche</h3>
          {p.vergleichVorwoche.length === 0 ? <div className="small muted">keine Werte</div> : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="woche-vergleich">
              {p.vergleichVorwoche.map((v) => <li key={v.was}>{VERGLEICH_TEXT[v.was] ?? v.was}: {String(v.diese).replace(".", ",")} (Vorwoche {String(v.vorwoche).replace(".", ",")}) – {v.tendenz}</li>)}
            </ul>
          )}

          <h3 style={{ margin: "6px 0 0", fontSize: 15 }}>Meine Beobachtungen ({p.beobachtungen.length})</h3>
          {p.beobachtungen.length === 0 ? <div className="small muted">keine in dieser Woche – <Link href="/privat/beobachtungen">Beobachtung eintragen</Link></div> : (
            <table className="table small" data-testid="woche-beobachtungen">
              <thead><tr><th>Datum</th><th>Situation</th><th>Problematik</th><th>Gewünschte Veränderung</th></tr></thead>
              <tbody>{p.beobachtungen.map((b, i) => <tr key={i}><td>{dmy(b.tag)}</td><td>{b.situation}{b.unvollstaendig ? " [?]" : ""}</td><td>{b.problematik ?? "–"}</td><td>{b.veraenderung ?? "–"}</td></tr>)}</tbody>
            </table>
          )}

          {p.gespraeche.length > 0 && <><h3 style={{ margin: "6px 0 0", fontSize: 15 }}>Paar-Gespräche</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.gespraeche.map((g, i) => <li key={i}>{dmy(g.tag)}: {g.thema ?? "–"}{g.vereinbart ? ` – vereinbart: ${g.vereinbart}` : ""}</li>)}</ul></>}
          {p.danke.length > 0 && <><h3 style={{ margin: "6px 0 0", fontSize: 15 }}>Danke</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.danke.map((d, i) => <li key={i}>{dmy(d.tag)} {d.von}: {d.text}</li>)}</ul></>}
          {p.dateideen.length > 0 && <><h3 style={{ margin: "6px 0 0", fontSize: 15 }}>Dateideen</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.dateideen.map((d, i) => <li key={i}>{d.text}{d.umgesetzt ? " ✓" : ""}</li>)}</ul></>}
          <div className="small"><Link href="/privat/therapie-bogen">Therapie-Bogen seit letzter Sitzung →</Link></div>
        </section>
      )}
    </>
  );
}
