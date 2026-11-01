import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { addDays, isDay, type ObservationEntry, type ReflexionEntry } from "@/lib/private/logic";
import { fuerNaechsteSitzung, therapieBogen } from "@/lib/private/rueckblick-logic";
import { loadEntries, requirePrivate } from "@/lib/private/service";
import { paarSitzungen } from "@/lib/private/sitzungen";
import { PrintButton } from "@/components/print-button";
import { PrivatHead, dm, dmy } from "../ui";

/**
 * Therapie-Bogen: eigene Beobachtungen als Tabelle wie der Papierbogen (Datum | Situation | Problematik |
 * gewünschte Veränderung) – ab der letzten Paartherapie-Sitzung (Privatkalender oder abgeglichener Kalender, B22.1)
 * oder frei gewählt; darunter die Zettel „Für die nächste Sitzung“. Nur eigene Einträge (Verfasser = ich, egal über
 * wen), nur mit vollem Privat-Umfang; zum Drucken bzw. als PDF.
 */
export default async function TherapieBogenPage({ searchParams }: { searchParams: Promise<{ ab?: string; bis?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const heute = todayIso();
  const [sitzungen, beob, zettel] = await Promise.all([
    paarSitzungen(session, heute),
    loadEntries<ObservationEntry>(session, ["beobachtung"]),
    loadEntries<ReflexionEntry>(session, ["reflexion"]),
  ]);
  const sitzung = sitzungen.letzte;
  const bis = isDay(sp.bis) && sp.bis! <= heute ? sp.bis! : heute;
  const ab = isDay(sp.ab) && sp.ab! <= bis ? sp.ab! : sitzung && sitzung <= bis ? sitzung : addDays(bis, -29);
  const zeilen = therapieBogen(beob.filter((e) => e.userId === session.userId).map((e) => e.data), ab, bis);
  const offen = zeilen.filter((z) => z.unvollstaendig).length;
  const naechste = fuerNaechsteSitzung(zettel.filter((z) => z.userId === session.userId), { bis, letzte: sitzung && sitzung <= bis ? sitzung : null });
  const vorschlaege = [
    ...(sitzung ? [{ label: `seit letzter Sitzung (${dm(sitzung)})`, ab: sitzung, bis: heute }] : []),
    { label: "letzte 2 Wochen", ab: addDays(heute, -13), bis: heute },
    { label: "letzte 4 Wochen", ab: addDays(heute, -27), bis: heute },
  ];

  return (
    <>
      <div className="no-print">
        <PrivatHead active="therapiebogen" title="Therapie-Bogen" sub={<PrintButton label="Drucken / als PDF speichern" />} />
        <form method="get" className="card card-pad stack" style={{ gap: 12 }} data-testid="tb-form">
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field"><label className="label" htmlFor="ab">Zeitraum von</label><input className="input" id="ab" name="ab" type="date" defaultValue={ab} max={heute} /></div>
            <div className="field"><label className="label" htmlFor="bis">bis</label><input className="input" id="bis" name="bis" type="date" defaultValue={bis} max={heute} /></div>
            <button className="btn" type="submit">Anzeigen</button>
          </div>
          <div className="small" style={{ display: "flex", gap: 10, flexWrap: "wrap" }} data-testid="tb-vorschlaege">
            {vorschlaege.map((v) => <Link key={v.label} href={`/privat/therapie-bogen?ab=${v.ab}&bis=${v.bis}`}>{v.label}</Link>)}
          </div>
          <div className="small muted">
            {sitzung ? <>Zeitraum ab der letzten Paartherapie-Sitzung laut Kalender: {dmy(sitzung)}.</> : <>Kein vergangener Paartherapie-Termin im Kalender gefunden (Privatkalender: Art „Paartherapie“, sonst Titel mit „Paartherapie“/„Paarberatung“) – bis dahin die letzten 30 Tage.</>}
            {sitzungen.naechste ? <> Nächste Sitzung: {dmy(sitzungen.naechste)}.</> : null}{" "}
            Beobachtungen ergänzen oder korrigieren: <Link href="/privat/beobachtungen">Partnerschaft › Beobachtungen</Link>.
          </div>
        </form>
        <div className="small muted" style={{ margin: "4px 0" }}>Vorschau – gedruckt wird genau das:</div>
      </div>

      <section className="card card-pad stack" data-testid="therapie-bogen">
        <h2>Beobachtungen {dmy(ab)} – {dmy(bis)}</h2>
        <div className="small muted">
          {zeilen.length} {zeilen.length === 1 ? "Eintrag" : "Einträge"}{offen ? ` · ${offen} mit „[?]“ – unvollständig` : ""} · nur eigene Einträge, ohne Auswertung
        </div>
        <table className="table tb-bogen">
          <thead>
            <tr><th style={{ width: "12%" }}>Datum</th><th style={{ width: "30%" }}>Situation</th><th style={{ width: "29%" }}>Problematik</th><th style={{ width: "29%" }}>Gewünschte Veränderung</th></tr>
          </thead>
          <tbody>
            {zeilen.length === 0 && <tr><td colSpan={4} className="muted">Keine Beobachtungen im Zeitraum.</td></tr>}
            {zeilen.map((z, i) => (
              <tr key={i} data-testid="tb-zeile">
                <td className="num" style={{ whiteSpace: "nowrap" }}>{dmy(z.tag)}</td>
                <td>{z.situation}{z.unvollstaendig && <div><span className="tag tag-warn" data-testid="tb-unvollstaendig">enthält [?] – unvollständig</span></div>}</td>
                <td>{z.problematik ?? ""}</td>
                <td>{z.veraenderung ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Für die nächste Sitzung</h3>
        {naechste.length === 0 ? <div className="small muted">Keine Zettel. <Link className="no-print" href="/privat/beobachtungen#reflexion">Reflexion notieren</Link></div> : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="tb-reflexion">
            {naechste.map((r, i) => <li key={r.id ?? i} style={{ whiteSpace: "pre-wrap" }}><strong>{dmy(r.tag)}</strong>: {r.text}</li>)}
          </ul>
        )}
      </section>
    </>
  );
}
