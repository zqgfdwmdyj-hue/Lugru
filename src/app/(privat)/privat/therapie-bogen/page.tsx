import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { addDays, isDay, type AppointmentEntry, type ObservationEntry } from "@/lib/private/logic";
import { letzteSitzung, therapieBogen } from "@/lib/private/rueckblick-logic";
import { loadEntries, requirePrivate } from "@/lib/private/service";
import { PrintButton } from "@/components/print-button";
import { PrivatHead, dm, dmy } from "../ui";

/**
 * Therapie-Bogen: eigene Beobachtungen als Tabelle wie der Papierbogen (Datum | Situation | Problematik |
 * gewünschte Veränderung) – ab der letzten Paartherapie-Sitzung aus dem Privatkalender oder frei gewählt.
 * Nur eigene Einträge, nur mit vollem Privat-Umfang; zum Drucken bzw. als PDF.
 */
export default async function TherapieBogenPage({ searchParams }: { searchParams: Promise<{ ab?: string; bis?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const heute = todayIso();
  const [termine, beob] = await Promise.all([
    loadEntries<AppointmentEntry>(session, ["termin"]),
    loadEntries<ObservationEntry>(session, ["beobachtung"]),
  ]);
  const sitzung = letzteSitzung(termine.map((t) => t.data), heute);
  const bis = isDay(sp.bis) && sp.bis! <= heute ? sp.bis! : heute;
  const ab = isDay(sp.ab) && sp.ab! <= bis ? sp.ab! : sitzung && sitzung <= bis ? sitzung : addDays(bis, -29);
  const zeilen = therapieBogen(beob.filter((e) => e.userId === session.userId).map((e) => e.data), ab, bis);
  const offen = zeilen.filter((z) => z.unvollstaendig).length;
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
            {sitzung ? <>Letzte Paartherapie-Sitzung laut Privatkalender: {dmy(sitzung)}.</> : <>Kein vergangener Paartherapie-Termin im Privatkalender – Standard sind die letzten 30 Tage.</>}{" "}
            Beobachtungen ergänzen oder korrigieren: <Link href="/privat/tagebuch#beobachtungen">ADHS-Tagebuch › Beobachtungen</Link>.
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
      </section>
    </>
  );
}
