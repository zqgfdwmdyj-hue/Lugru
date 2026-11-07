import Link from "next/link";
import type { BqoolLauf } from "@/lib/bqool/kreislauf";
import { freigabeFristen, freigabeText, jeLandText, standText, uebernommenJeLand, uhrBerlin } from "@/lib/bqool/kreislauf-logic";
import { kreislaufAblehnenAction, kreislaufEinstellungenAction, kreislaufFreigebenAction, kreislaufStartenAction, nachkontrolleAction } from "./actions";

// B31.2 Täglicher BQool-Kreislauf auf Repricer → BQool-Dateien: Stand, Freigabe, Upload-Rückmeldung, Nachkontrolle,
// Einstellungen. Freigeben, Starten und Einstellungen nur für den Inhaber.

const PHASE: Record<string, string> = { ist: "Ist wird geholt", soll: "Soll wird erzeugt", freigabe: "wartet auf Freigabe", upload: "Upload läuft", kontrolle: "hochgeladen – Nachkontrolle folgt", fertig: "fertig", abgebrochen: "abgebrochen", verfallen: "verfallen (nicht freigegeben)" };
const FREIGABE: Record<string, string> = { offen: "offen", freigegeben: "freigegeben", automatisch: "automatisch", verfallen: "verfallen", nicht_noetig: "nicht nötig (keine Änderungen)", abgelehnt: "heute nicht hochladen" };

type Stand = {
  eingerichtet: boolean;
  exportSeite: boolean;
  aus: boolean;
  heute: BqoolLauf | null;
  istJeLand: { land: string; am: Date | null }[];
  letzterUpload: BqoolLauf | null;
};

export function KreislaufKarte({ stand, lauf, laeufe, inhaber, freigebenHinweis, einstellungen }: { stand: Stand; lauf: BqoolLauf | null; laeufe: BqoolLauf[]; inhaber: boolean; freigebenHinweis: boolean; einstellungen: { automatisch: boolean; minGeprueft: boolean; minGeprueftAm: string | null; minInDatei: "effektiv" | "sicherheitsnetz" } }) {
  const jetzt = new Date();
  const offen = lauf?.freigabe === "offen";
  const fristen = lauf ? freigabeFristen(lauf.createdAt) : null;
  const u = lauf?.upload ? uebernommenJeLand(lauf.upload) : null;
  return (
    <section className="card card-pad stack" id="freigabe" data-testid="bq-kreislauf" style={{ marginBottom: 12 }}>
      <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Täglicher BQool-Lauf (06:00)</h2>
        {inhaber && stand.eingerichtet && !offen && (
          <form action={kreislaufStartenAction}>
            <button className="btn btn-small" type="submit" data-testid="bq-kreislauf-starten">Jetzt starten</button>
          </form>
        )}
      </div>
      <div className="small" data-testid="bq-stand">
        BQool-Stand (Ist): {stand.istJeLand.length ? [...stand.istJeLand].sort((a, b) => a.land.localeCompare(b.land)).map((x) => `${x.land} ${standText(x.am, jetzt)}`).join(" · ") : "noch kein Ist"}
        {stand.letzterUpload?.uploadAm && <> · letzter Upload {standText(stand.letzterUpload.uploadAm, jetzt)}</>}
      </div>
      {!stand.eingerichtet ? (
        <div className="notice notice-warn small">Für den täglichen Lauf fehlt die <Link href="/anbindungen?p=bqool_web#bqool_web">Anbindung „BQool – Anmeldung“</Link> (E-Mail, Passwort, Upload-Seite DE). Bis dahin: Export unten erzeugen, ZIP herunterladen und selbst hochladen.</div>
      ) : stand.aus ? (
        <div className="small muted">Täglicher Lauf ist in der Anbindung ausgeschaltet – nur „Jetzt starten“.</div>
      ) : !stand.exportSeite ? (
        <div className="notice notice-warn small" data-testid="bq-ohne-export">Ohne Export-Seite holt die Automatik den Ist nicht – der Lauf vergleicht dann mit dem letzten Datei-Upload. Unter <Link href="/anbindungen?p=bqool_web#bqool_web">Anbindungen → BQool</Link> „Export-Seite DE“ eintragen.</div>
      ) : null}

      {lauf ? (
        <div className="stack" style={{ gap: 6 }} data-testid="bq-lauf" data-lauf={lauf.id} data-freigabe={lauf.freigabe ?? ""}>
          <div className="small">
            <strong>Lauf {lauf.tag.split("-").reverse().join(".")} {uhrBerlin(lauf.createdAt)}</strong> ({lauf.ausloeser === "zeitplan" ? "06:00" : "Jetzt starten"}) · {PHASE[lauf.phase] ?? lauf.phase}
            {lauf.freigabe && <> · Freigabe: <span data-testid="bq-freigabe-status">{FREIGABE[lauf.freigabe] ?? lauf.freigabe}</span>{lauf.freigabeAm ? ` ${uhrBerlin(lauf.freigabeAm)}` : ""}{lauf.freigabeVon && lauf.freigabeVon !== "automatisch" ? ` (${lauf.freigabeVon})` : ""}</>}
          </div>
          {lauf.ist.length > 0 && <div className="small muted" data-testid="bq-lauf-ist">Ist: {lauf.ist.map((x) => `${x.land} ${x.ok ? (x.skus !== undefined ? `${x.skus} SKUs` : "ok") : `– ${x.text}`}`).join(" · ")}</div>}
          {lauf.zusammenfassung && <div className="small" data-testid="bq-lauf-soll">Soll: {lauf.zusammenfassung.gesamt ? freigabeText(lauf.zusammenfassung) : "keine Änderungen"}{lauf.exportId && <> · <Link href={`/repricer/bqool?export=${lauf.exportId}`}>Ansehen</Link></>}</div>}
          {lauf.fehler && <div className="small" style={{ color: "var(--danger)" }}>{lauf.fehler}</div>}
          {offen && inhaber && (
            <div className={`notice ${freigebenHinweis ? "notice-warn" : "notice-info"} small stack`} style={{ gap: 6 }} data-testid="bq-freigabe">
              <div>Ohne Freigabe wird nichts hochgeladen. {fristen && jetzt < fristen.verfall ? `Bis ${uhrBerlin(fristen.verfall)} Uhr, danach verfällt der Lauf.` : ""} Warnungen und Änderungen je SKU stehen unten.</div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <form action={kreislaufFreigebenAction}>
                  <input type="hidden" name="lauf" value={lauf.id} />
                  <button className="btn btn-primary" type="submit" data-testid="bq-freigeben" autoFocus={freigebenHinweis}>Freigeben und hochladen</button>
                </form>
                <form action={kreislaufAblehnenAction}>
                  <input type="hidden" name="lauf" value={lauf.id} />
                  <button className="btn btn-small" type="submit" data-testid="bq-ablehnen">Heute nicht hochladen</button>
                </form>
              </div>
            </div>
          )}
          {offen && !inhaber && <div className="small muted">Wartet auf die Freigabe durch den Inhaber.</div>}
          {lauf.upload && (
            <div className="small" data-testid="bq-lauf-upload">
              Upload {lauf.uploadAm ? uhrBerlin(lauf.uploadAm) : ""}: {u && Object.keys(u.jeLand).length ? `${jeLandText(u.jeLand)} übernommen` : "nichts übernommen"}, {u?.fehler ?? 0} Fehler{lauf.uploadStatus === "pruefen" ? " – Bestätigung bitte in BQool prüfen" : ""}
              <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                {lauf.upload.map((x) => (
                  <li key={x.land}>
                    {x.text}
                    {x.fehlerZeilen.slice(0, 5).map((f) => <div key={f.sku} style={{ color: "var(--warn)" }}>{f.sku}: {f.text}</div>)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lauf.kontrolle ? (
            <div className={`small ${lauf.kontrolle.abweichungen.length ? "notice notice-warn" : ""}`} data-testid="bq-kontrolle">
              Nachkontrolle {lauf.kontrolleAm ? uhrBerlin(lauf.kontrolleAm) : ""}: {lauf.kontrolle.text}
              {lauf.kontrolle.abweichungen.length > 0 && <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>{lauf.kontrolle.abweichungen.slice(0, 10).map((a) => <li key={`${a.land}-${a.sku}`}><b>{a.land}</b> {a.sku}: {a.text}</li>)}</ul>}
            </div>
          ) : lauf.kontrolleFaelligAm ? (
            <div className="small muted row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="bq-kontrolle-offen">
              Nachkontrolle ab {uhrBerlin(lauf.kontrolleFaelligAm)} automatisch.
              {inhaber && (
                <form action={nachkontrolleAction}>
                  <input type="hidden" name="lauf" value={lauf.id} />
                  <button className="btn btn-small" type="submit" data-testid="bq-kontrolle-jetzt">Nachkontrolle jetzt</button>
                </form>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="small muted">Heute noch kein Lauf{stand.eingerichtet && !stand.aus ? " – startet ab 06:00 automatisch" : ""}.</div>
      )}

      {laeufe.length > 1 && (
        <details className="small">
          <summary style={{ cursor: "pointer" }}>Letzte Läufe</summary>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {laeufe.map((l) => (
              <li key={l.id}>
                <Link href={`/repricer/bqool?lauf=${l.id}#freigabe`}>{l.tag.split("-").reverse().join(".")} {uhrBerlin(l.createdAt)}</Link> · {PHASE[l.phase] ?? l.phase}
                {l.freigabe ? ` · Freigabe ${FREIGABE[l.freigabe] ?? l.freigabe}` : ""}
                {l.zusammenfassung?.gesamt ? ` · ${jeLandText(l.zusammenfassung.jeLand)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {inhaber && (
        <form action={kreislaufEinstellungenAction} className="stack small" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 8 }} id="kreislauf-einstellungen" data-testid="bq-kreislauf-einstellungen">
          <strong>Einstellungen</strong>
          <label>
            <input type="checkbox" name="min_geprueft" value="1" defaultChecked={einstellungen.minGeprueft} /> Min-Verhalten in BQool geprüft – an einer SKU nachgesehen, wie BQool den Min aus der Datei nimmt{einstellungen.minGeprueftAm ? ` (bestätigt ${new Date(einstellungen.minGeprueftAm).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })})` : ""}
          </label>
          <label style={{ opacity: einstellungen.minGeprueft ? 1 : 0.6 }}>
            <input type="checkbox" name="automatisch" value="1" defaultChecked={einstellungen.automatisch} /> täglich automatisch hochladen, außer bei Regelwechsel oder Min unter Break-even{!einstellungen.minGeprueft ? " – erst nach der Prüfung oben möglich" : ""}
          </label>
          <div>
            Min in der Datei bei Margen-Regeln:{" "}
            <label><input type="radio" name="min_in_datei" value="effektiv" defaultChecked={einstellungen.minInDatei === "effektiv"} /> effektiver Min (Break-even + Mindestmarge der Altersstufe, harte Untergrenze – Standard)</label>{" "}
            <label><input type="radio" name="min_in_datei" value="sicherheitsnetz" defaultChecked={einstellungen.minInDatei === "sicherheitsnetz"} /> Break-even ohne Marge (nur, wenn BQool den Min bei Margen-Regeln selbst aus Cost + Marge rechnet)</label>
          </div>
          <div><button className="btn btn-small" type="submit" data-testid="bq-kreislauf-speichern">Speichern</button></div>
        </form>
      )}
    </section>
  );
}
