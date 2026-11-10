import { requireOwner } from "@/lib/auth/session";
import { agentOnline, AGENT_VERSION_AKTUELL, ZUSTAND_TEXT } from "@/lib/druck/logic";
import { MEDIEN } from "@/lib/druck/brother";
import { agenten } from "@/lib/druck/service";
import { DruckerSymbol } from "@/components/drucker-symbol";
import { ConfirmButton } from "@/components/confirm-button";
import { AgentAnlegen } from "./agent-anlegen";
import { agentEinstellungenAction, agentWiderrufenAction } from "./actions";

// Einstellungen → Drucker (nur Inhaber): Druckagent im Lager (Windows-Dienst auf dem Arbeits-PC, Ausweichlösung
// Mini-PC mit Linux). Token einmal anzeigen, jederzeit widerrufbar; Shelly-IPs und Ordner nur hier bzw. im Agenten.

const zeit = (d: Date | null) => (d ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d) : "–");

export default async function DruckerEinstellungen({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const s = await requireOwner();
  const sp = await searchParams;
  const liste = await agenten(s.tenantId);
  return (
    <>
      <div className="page-head">
        <div><h1>Drucker</h1><p className="small muted" style={{ margin: 0 }}>Druckagent „lugru-druckagent“ im Lager – holt Druckaufträge ab (nur ausgehende Verbindung, kein offener Port).</p></div>
        <div className="stack" style={{ gap: 4 }}>
          <DruckerSymbol tenantId={s.tenantId} modell="QL-800" />
          <DruckerSymbol tenantId={s.tenantId} modell="QL-1100" />
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}

      <section className="card card-pad stack">
        <h2 style={{ margin: 0 }}>Agent anlegen</h2>
        <AgentAnlegen />
        <div className="small"><a href="/api/druckagent/paket" data-testid="agent-paket">⬇ Installationspaket (Windows-Dienst + Linux/systemd/Docker)</a> · aktuelle Agent-Version {AGENT_VERSION_AKTUELL}</div>
      </section>

      <section className="card" style={{ marginTop: 12, overflow: "auto" }}>
        {liste.length ? (
          <table className="table small" data-testid="agent-liste">
            <thead><tr><th>Agent</th><th>Status</th><th>Gerät</th><th>Drucker</th><th>Letzter Druck</th><th /></tr></thead>
            <tbody>
              {liste.map((a) => {
                const on = agentOnline(a);
                return (
                  <tr key={a.id} data-testid="agent-zeile" data-status={a.deaktiviertAm ? "deaktiviert" : on ? "online" : "offline"} data-name={a.name}>
                    <td>{a.name}<div className="muted">Token {a.tokenAnfang}… · angelegt {zeit(a.createdAt)}</div></td>
                    <td data-testid="agent-status">{a.deaktiviertAm ? <span className="muted">deaktiviert ({a.deaktiviertGrund ?? ""})</span> : on ? <span style={{ color: "var(--success, #1a7f37)" }}>online</span> : <span style={{ color: "var(--danger, #c0392b)" }}>offline seit {zeit(a.letzterKontakt)}</span>}</td>
                    <td>{a.geraet ?? "–"}<div className="muted">{a.os ?? ""}{a.version ? ` · Agent ${a.version}` : ""}{a.systemStart ? ` · Systemstart ${zeit(a.systemStart)}` : ""}</div>{a.updates.length ? <div className="muted">Update: {a.updates[0].von} → {a.updates[0].nach} ({a.updates[0].ergebnis})</div> : null}</td>
                    <td data-testid="agent-drucker">{a.drucker.length ? a.drucker.map((d) => <div key={d.name}>{d.modell ?? d.name}{d.seriennummer ? ` (${d.seriennummer})` : ""}: <b data-testid="agent-drucker-zustand">{d.fehler.length ? d.fehler.join(", ") : (ZUSTAND_TEXT[d.zustand] ?? d.zustand)}</b>{d.medienBreite ? ` · ${d.medienBreite} mm` : ""}{d.shelly ? " · Shelly" : ""}{d.autoAusAus === false ? " · Auto-Aus aktiv!" : ""}</div>) : "–"}</td>
                    <td>{zeit(a.letzterDruck)}</td>
                    <td>{!a.deaktiviertAm && <form action={agentWiderrufenAction}><input type="hidden" name="id" value={a.id} /><ConfirmButton className="btn btn-sm" confirm={`Agent „${a.name}“ widerrufen? Er druckt danach nicht mehr.`} testid="agent-widerrufen">Widerrufen</ConfirmButton></form>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="card-pad small muted">Noch kein Agent – oben anlegen, dann das Paket auf dem Arbeits-PC installieren.</div>
        )}
      </section>

      {liste.filter((a) => !a.deaktiviertAm).map((a) => (
        <section key={a.id} className="card card-pad stack" style={{ marginTop: 12 }}>
          <h2 style={{ margin: 0 }}>{a.name}: Strom, Ordner, Leerlauf</h2>
          <form action={agentEinstellungenAction} className="stack" style={{ gap: 10 }} data-testid="agent-einstellungen">
            <input type="hidden" name="id" value={a.id} />
            {["QL-800", "QL-1100"].map((m) => (
              <div key={m} className="row small" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ width: 80 }}>{m}</span>
                <label>Shelly-Steckdose (optional) IP <input className="input" name={`shelly_ip_${m}`} defaultValue={a.einstellungen.shelly?.[m]?.ip ?? ""} placeholder="192.168.178.x" style={{ width: 150 }} /></label>
                <select className="input" name={`shelly_typ_${m}`} defaultValue={a.einstellungen.shelly?.[m]?.typ ?? "gen1"}><option value="gen1">Gen1 (/relay/0)</option><option value="gen2">Gen2 (/rpc/Switch.Set)</option></select>
              </div>
            ))}
            <div className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
              <label>Überwachter Ordner (PDFs → Upload) <input className="input" name="ordner" defaultValue={a.einstellungen.ordner?.pfad ?? ""} placeholder="C:\Users\…\Scans\Rechnungen" style={{ width: 280 }} /></label>
              <label>alle <input className="input" name="intervall" type="number" min={15} max={3600} defaultValue={a.einstellungen.ordner?.intervallSek ?? 60} style={{ width: 70 }} /> s</label>
              <label>Steckdose aus nach <input className="input" name="leerlauf" type="number" min={1} max={240} defaultValue={a.einstellungen.leerlaufAusMin ?? 10} style={{ width: 60 }} /> Min. ohne Auftrag</label>
            </div>
            <div className="row small" style={{ gap: 10, flexWrap: "wrap" }} data-testid="agent-belege">
              <label>Download-Ordner (Belege, PDFs/Fotos) <input className="input" name="belege_pfad" defaultValue={a.einstellungen.belege?.pfad ?? ""} placeholder="C:\Users\…\Downloads" style={{ width: 240 }} /></label>
              <label>Ablage (Monat/Lieferant, Dubletten, Kontoauszüge) <input className="input" name="belege_ablage" defaultValue={a.einstellungen.belege?.ablage ?? ""} placeholder="D:\Belege" style={{ width: 240 }} /></label>
              <span className="muted">Rechnungen werden umbenannt (JJJJ-MM-TT_Lieferant_Betrag_Nr) und nach Monat/Lieferant abgelegt, Kontoauszüge importiert, Dubletten in „Dubletten“ verschoben – gelöscht wird nichts ohne Freigabe (Rechnungsstation → Download-Ordner).</span>
            </div>
            <div><button className="btn btn-sm" type="submit">Speichern</button></div>
          </form>
        </section>
      ))}

      <section className="card card-pad stack" style={{ marginTop: 12 }} id="pc-einrichten" data-testid="pc-einrichten">
        <h2 style={{ margin: 0 }}>PC einrichten (Schritt für Schritt)</h2>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          <li><b>Drucker anschließen:</b> QL-800 und QL-1100 per USB an den Arbeits-PC. Brother-Treiber installieren (Druckernamen „Brother QL-800“/„Brother QL-1100“). Der Agent druckt über den Windows-Spooler im Modus „RAW“ – der Treiber bleibt installiert.</li>
          <li><b>Auto-Aus aus (Weg 1, Standard):</b> Brother <i>Printer Setting Tool</i> → Gerät wählen → „Geräteeinstellungen“ → „Automatisches Ausschalten“ auf <b>Aus</b> (Netzteil und Akku) → „Übernehmen“. Dann bleibt der Drucker über Nacht bereit.</li>
          <li><b>Shelly (Weg 2, optional):</b> im Printer Setting Tool zusätzlich <b>„Auto Power On“ / „Automatisch einschalten bei Stromzufuhr“</b> aktivieren, sonst startet der Drucker nach dem Einschalten der Steckdose nicht. IP der Steckdose oben eintragen (Fritzbox: „immer dieselbe IP“).</li>
          <li><b>Agent anlegen</b> (oben) und den Token bereithalten. <b>Installationspaket</b> herunterladen, auf dem PC entpacken.</li>
          <li><b>Installieren:</b> PowerShell als Administrator öffnen, in den Ordner <code>lugru-druckagent\windows</code> wechseln und <code>powershell -ExecutionPolicy Bypass -File .\installieren.ps1</code> ausführen. Das Skript installiert Node.js (falls nötig), richtet den <b>Windows-Dienst</b> ein (Start vor der Anmeldung, Neustart bei Absturz) und fragt Adresse und Token ab.</li>
          <li><b>PC wach halten:</b> Das Skript bietet an, Energiesparmodus und Ruhezustand auszuschalten und die Windows-Update-Nutzungszeit auf 06–23 Uhr zu setzen (Neustarts nur nachts). Eine automatische Anmeldung ist nicht nötig.</li>
          <li><b>Prüfen:</b> Innerhalb einer Minute steht der Agent oben auf „online“ mit Gerätename und Druckern. Test: Lager → Drucken → FNSKU-Etikett.</li>
          <li><b>Ausweichlösung Mini-PC (Linux):</b> Paket entpacken, <code>sudo bash linux/installieren.sh</code> (systemd-Dienst) oder Docker (<code>linux/Dockerfile</code>, mit <code>--device /dev/usb/lp0</code>). <b>Umzug:</b> dort einen neuen Agenten mit „Umzug“ anlegen – der alte wird deaktiviert.</li>
        </ol>
        <p className="small muted" style={{ margin: 0 }}>Medien: {MEDIEN.map((m) => m.text).join(" · ")}. Weitere Medien in der config.json des Agenten unter „medien“.</p>
      </section>
    </>
  );
}
