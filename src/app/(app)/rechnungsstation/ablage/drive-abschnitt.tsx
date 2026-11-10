import Link from "next/link";
import type { Session } from "@/lib/auth/session";
import { DRIVE_CHARGE_MAX, driveEinstellung, driveListe } from "@/lib/belege/drive-ablage";
import { driveAccess } from "@/lib/integrations/clients/drive";
import { getIntegration } from "@/lib/integrations/store";
import { driveBestandAction, driveFreigebenAction, driveLesenAction, drivePapierkorbAction, driveSchreibenAction, driveVerwerfenAction } from "./actions";

// B34.2 Google Drive (Rechnungsordner): Vorschau der Vorschläge (alter → neuer Name, Zielordner), Dublettenliste,
// Freigabe in Chargen. Ohne Schreibrecht nur lesen; gelöscht wird nichts – Dubletten höchstens nach Freigabe in den
// Drive-Papierkorb.

const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const ART: Record<string, string> = { ablegen: "Rechnung ablegen", dublette: "Dublette", kontoauszug: "Kontoauszug", liegen_lassen: "bleibt liegen" };
const TAG: Record<string, string> = { ablegen: "tag-ok", dublette: "tag-warn", kontoauszug: "tag-info", liegen_lassen: "tag-neutral" };

export async function DriveAbschnitt({ s }: { s: Session }) {
  const cfg = await getIntegration(s.tenantId, "google_drive");
  const zugang = await driveAccess(cfg).catch(() => null);
  const einst = await driveEinstellung(s.tenantId);
  const liste = await driveListe(s.tenantId);
  const inhaber = s.role === "owner" && !s.readOnly;
  const offen = liste.filter((z) => (z.zustand === "vorschlag" || z.zustand === "fehler") && z.vorschlag !== "liegen_lassen");
  const dubletten = liste.filter((z) => z.vorschlag === "dublette" && z.zustand !== "verworfen");
  const erledigt = liste.filter((z) => z.zustand === "erledigt").slice(0, 50);
  const kannSchreiben = einst.schreiben && zugang?.mode === "service";
  return (
    <section className="card card-pad stack" style={{ gap: 10 }} data-testid="drive-ablage" data-schreiben={einst.schreiben ? "1" : "0"} data-modus={zugang?.mode ?? "keiner"}>
      <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Google Drive (Rechnungsordner)</h2>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <form action={driveLesenAction}><button className="btn btn-sm" type="submit" disabled={!zugang} data-testid="drive-lesen">Ordner jetzt lesen</button></form>
          <form action={driveBestandAction}><button className="btn btn-sm" type="submit" disabled={!zugang} data-testid="drive-bestand">Vorhandene Dateien vorschlagen</button></form>
        </div>
      </div>
      {!zugang ? (
        <p className="small muted" style={{ margin: 0 }}>Noch nicht eingerichtet – <Link href="/einstellungen/anbindungen">Anbindungen → Google Drive (Rechnungsordner)</Link>.</p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Stündlich gelesen (neue Dateien direkt im Ordner). Vorschlag: umbenennen nach JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr und nach Monat/Lieferant ablegen; Kontoauszüge nach „Kontoauszüge/JJJJ-MM“ (importiert, nicht als Rechnung); Dubletten (gleiche Datei oder gleiche Nummer + Betrag) nach „Dubletten“. Ausgeführt wird erst nach deiner Freigabe – gelöscht wird nichts.
        </p>
      )}

      <div className="notice small" data-testid="drive-schreibrecht">
        {zugang?.mode === "link" ? (
          <span>Zugang über den Freigabelink: nur lesen. Zum Ablegen braucht es das Dienstkonto mit Bearbeiter-Recht auf den Ordner (Anbindungen → Google Drive: Schlüssel + Ordner-ID).</span>
        ) : einst.schreiben ? (
          <span>Umbenennen/Verschieben in Drive ist freigegeben – ausgeführt wird trotzdem nur, was du unten freigibst.</span>
        ) : (
          <span>Drive wird nur gelesen. Erst wenn du das Schreibrecht einschaltest, kann eine Freigabe Dateien umbenennen und verschieben.</span>
        )}
        {inhaber && (
          <form action={driveSchreibenAction} style={{ display: "inline", marginLeft: 8 }}>
            <input type="hidden" name="schreiben" value={einst.schreiben ? "0" : "1"} />
            <button className="btn btn-sm" type="submit" data-testid="drive-schreiben-schalter">{einst.schreiben ? "Schreibrecht ausschalten" : "Umbenennen/Verschieben erlauben"}</button>
          </form>
        )}
      </div>

      <form className="stack" style={{ gap: 6 }} data-testid="drive-vorschlaege">
        <div className="between"><h3 style={{ margin: 0 }}>Vorschau ({offen.length} offen)</h3>
          {inhaber && offen.length > 0 && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-primary" type="submit" formAction={driveFreigebenAction} disabled={!kannSchreiben} data-testid="drive-freigeben">Auswahl freigeben und ausführen</button>
              <button className="btn btn-sm" type="submit" formAction={driveFreigebenAction} name="alle" value="1" disabled={!kannSchreiben} data-testid="drive-alle-freigeben">Alle {Math.min(offen.length, DRIVE_CHARGE_MAX)} freigeben</button>
              <button className="btn btn-sm" type="submit" formAction={driveVerwerfenAction} data-testid="drive-verwerfen">Auswahl verwerfen</button>
            </div>
          )}
        </div>
        {offen.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Keine offenen Vorschläge.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="table small">
              <thead><tr><th></th><th>Datei jetzt</th><th>Vorschlag</th><th>Neuer Name</th><th>Zielordner</th><th>Betrag</th><th>Hinweis</th></tr></thead>
              <tbody>
                {offen.map((z) => (
                  <tr key={z.id} data-testid="drive-vorschlag" data-vorschlag={z.vorschlag} data-zustand={z.zustand} data-datei={z.dateiname}>
                    <td>{inhaber && <input type="checkbox" name="id" value={z.id} aria-label={`${z.dateiname} auswählen`} defaultChecked />}</td>
                    <td><a href={`/rechnungsstation/ablage/drive/${z.id}/pdf`} target="_blank" rel="noreferrer">{z.dateiname}</a></td>
                    <td><span className={`tag ${TAG[z.vorschlag] ?? ""}`}>{ART[z.vorschlag] ?? z.vorschlag}</span></td>
                    <td data-testid="drive-neuer-name">{z.vorschlag === "ablegen" ? z.zielName : <span className="muted">bleibt</span>}</td>
                    <td data-testid="drive-ziel">{z.zielOrdner ?? "–"}</td>
                    <td>{eur(z.betrag)}</td>
                    <td>{z.zustand === "fehler" ? <span className="tag tag-critical">{z.meldung}</span> : (z.dubletteGrund ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </form>

      <div className="stack" style={{ gap: 6 }} data-testid="drive-dubletten">
        <div className="between"><h3 style={{ margin: 0 }}>Dubletten ({dubletten.length})</h3>
          {inhaber && dubletten.some((z) => z.zustand === "erledigt" && !z.papierkorbAm) && (
            <form action={drivePapierkorbAction}><input type="hidden" name="alle" value="1" /><button className="btn btn-sm" type="submit" disabled={!kannSchreiben} data-testid="drive-papierkorb-alle">Alle verschobenen Dubletten in den Papierkorb (Freigabe)</button></form>
          )}
        </div>
        {dubletten.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Keine Dubletten.</p> : (
          <table className="table small">
            <thead><tr><th>Datei</th><th>Grund</th><th>Stand</th></tr></thead>
            <tbody>
              {dubletten.map((z) => (
                <tr key={z.id} data-testid="drive-dublette" data-zustand={z.zustand}>
                  <td>{z.dateiname}</td>
                  <td>{z.dubletteGrund ?? "–"}</td>
                  <td>{z.papierkorbAm ? "im Drive-Papierkorb (nach Freigabe)" : z.zustand === "erledigt" ? "liegt in „Dubletten“ – nicht gelöscht" : "Vorschlag: nach „Dubletten“ verschieben"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {erledigt.length > 0 && (
        <details>
          <summary className="small">Abgelegt ({erledigt.length})</summary>
          <table className="table small" data-testid="drive-erledigt">
            <thead><tr><th>Datei vorher</th><th>Jetzt</th></tr></thead>
            <tbody>{erledigt.map((z) => <tr key={z.id} data-testid="drive-erledigt-zeile"><td>{z.dateiname}</td><td>{z.meldung}</td></tr>)}</tbody>
          </table>
        </details>
      )}
    </section>
  );
}
