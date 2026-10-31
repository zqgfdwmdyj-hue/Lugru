import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { EXPORT_LAENDER } from "@/lib/bqool/export-logic";
import { bqoolExporte, bqoolVorschau, zuweisungen } from "@/lib/bqool/export-service";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { anBqoolAction, exportErzeugenAction, istUebernehmenAction, katalogAction, vorschlagFreigebenAction, zuweisungAction, zuweisungLoeschenAction } from "./actions";

// BQool-Dateien direkt aus dem System: Ist (BQool) → Soll (Regeln hier), Freigabe vor jedem Export, Download je Land/ZIP.

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatEuro(n));
const ART_TEXT = { neu: "neu", geaendert: "geändert", gleich: "gleich" } as const;

export default async function BqoolDateienPage({ searchParams }: { searchParams: Promise<{ meldung?: string; export?: string; land?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const [v, s, zuw, exporte] = await Promise.all([bqoolVorschau(session.tenantId), getSettings(session.tenantId), zuweisungen(session.tenantId), bqoolExporte(session.tenantId, 5)]);
  const b = s.bqool;
  const aktiv = sp.export ? exporte.find((e) => e.id === sp.export) : exporte[0];
  const kannSchreiben = !session.readOnly;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/repricer">Repricer</Link></div>
          <h1>BQool-Dateien</h1>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      <p className="small muted" style={{ marginTop: 0 }}>
        Je Land eine Datei im BQool-Format (Tab-getrennt, Dezimalpunkt) – ohne den Umweg über ArbitrageOne. Cost = EK netto × {String(1 + b.costUst).replace(".", ",")} wie bisher. Bei Margen-Regeln rechnet BQool den Mindestpreis selbst aus Cost + Mindestmarge; Min Price ist dort nur ein Sicherheitsnetz (Break-even mit landeseigener USt). Bei „Liquidation“ zählt die feste Untergrenze. Ist-Stand: BQool-Datei je Land unter <Link href="/uploads">Uploads</Link> hochladen.
      </p>

      <section className="card card-pad stack" data-testid="bq-export">
        <h2 style={{ margin: 0 }}>Freigabe und Export</h2>
        <div className="grid-kpi">
          {v.laender.map((l) => (
            <div key={l.land} className="card card-pad" data-testid="bq-land" data-land={l.land}>
              <div className="kpi-label">{l.land} · {l.zeilen.length} SKUs</div>
              <div className="small">neu {l.neu} · geändert {l.geaendert} · gleich {l.gleich}</div>
              <div className="small">Regelwechsel {l.regelWechsel} · <span style={{ color: l.mitWarnung ? "var(--warn)" : undefined }}>Warnungen {l.mitWarnung}</span></div>
              <div className="small muted">{l.vergleichMit === "bqool" ? `Ist: BQool-Datei vom ${formatDate(l.istStand?.toISOString() ?? null)}` : l.vergleichMit === "export" ? "Vergleich: letzter eigener Export" : "noch kein Ist-Stand"}</div>
            </div>
          ))}
        </div>
        {kannSchreiben && (
          <form action={exportErzeugenAction} className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }} data-testid="bq-export-form">
            {EXPORT_LAENDER.map((l) => (
              <label key={l} className="small"><input type="checkbox" name="land" value={l} defaultChecked={b.laender.includes(l)} /> {l}</label>
            ))}
            <label className="small"><input type="checkbox" name="nur_aenderungen" value="1" defaultChecked /> nur Änderungen</label>
            <button className="btn btn-primary" type="submit" data-testid="bq-export-los">Export erzeugen</button>
          </form>
        )}
        {aktiv && (
          <div className="small" data-testid="bq-downloads">
            Export vom {formatDate(aktiv.createdAt.toISOString())} ({aktiv.nurAenderungen ? "nur Änderungen" : "alles"}):{" "}
            <a href={`/repricer/bqool/datei?export=${aktiv.id}`} data-testid="bq-zip">ZIP ({(aktiv.laender as string[]).length} Länder)</a>
            {(aktiv.laender as string[]).map((l) => (
              <span key={l}> · <a href={`/repricer/bqool/datei?export=${aktiv.id}&land=${l}`} data-testid={`bq-datei-${l}`}>{l} ({aktiv.anzahl[l] ?? 0})</a></span>
            ))}
            {aktiv.uebertragung && <span data-testid="bq-uebertragung"> · BQool: {{ laeuft: "Übertragung läuft", fertig: "hochgeladen ✓", fehler: "Übertragung abgebrochen" }[aktiv.uebertragung]}</span>}
          </div>
        )}
        {aktiv && kannSchreiben && (
          <form action={anBqoolAction} className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="bq-automatik">
            <input type="hidden" name="export" value={aktiv.id} />
            <label><input type="checkbox" name="bestaetigt" value="1" /> Freigabe geprüft – Preise bei BQool jetzt ändern</label>
            <button className="btn" type="submit">An BQool übertragen (Browser)</button>
            <span className="muted">braucht die Anbindung „BQool – Anmeldung“; sonst ZIP herunterladen.</span>
          </form>
        )}
        {aktiv && aktiv.protokoll.length > 0 && <ul className="small muted" style={{ margin: 0 }}>{aktiv.protokoll.slice(-6).map((p, i) => <li key={i}>{p.text}</li>)}</ul>}
      </section>

      {v.laender.map((l) => {
        const wichtig = l.zeilen.filter((z) => z.art !== "gleich" || z.warnungen.length || z.erklaerung);
        return (
          <details key={l.land} className="card card-pad" style={{ marginTop: 12 }} data-testid="bq-tabelle" data-land={l.land} open={l.land === (sp.land ?? v.laender[0]?.land)}>
            <summary><b>{l.land}</b> – {wichtig.length} Zeilen mit Änderung oder Warnung (von {l.zeilen.length})</summary>
            <div className="table-wrap">
              <table className="table small">
                <thead>
                  <tr><th>SKU</th><th>Artikel</th><th>Regel Ist → Soll</th><th>Cost</th><th>Min Ist → Datei</th><th>Max</th><th>eff. Min (Marge)</th><th>Buy Box</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {wichtig.slice(0, 200).map((z) => (
                    <tr key={z.sku} data-testid="bq-zeile" data-sku={z.sku}>
                      <td>{z.sku}</td>
                      <td>{(z.titel ?? "").slice(0, 50)}</td>
                      <td style={{ color: z.regelWechsel ? "var(--warn)" : undefined }}>{z.istRegel ?? "–"} → <b>{z.regel}</b></td>
                      <td>{z.cost.toFixed(2)}</td>
                      <td>{z.istMin?.toFixed(2) ?? "–"} → {z.min.toFixed(2)}</td>
                      <td>{z.max.toFixed(2)}</td>
                      <td>{z.effMin?.toFixed(2) ?? "–"}{z.marge !== null ? ` (${z.marge} %)` : ""}</td>
                      <td>{z.buybox?.toFixed(2) ?? "–"}</td>
                      <td>{ART_TEXT[z.art]}{z.enable === "0" ? " · in BQool aus" : ""}{z.warnungen.map((w) => <div key={w} style={{ color: "var(--warn)" }}>{w}</div>)}{z.erklaerung && <div className="muted">{z.erklaerung}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="bq-abgleich">
        <h2 style={{ margin: 0 }}>Abgleich BQool ↔ System ({v.abgleich.length})</h2>
        {v.abgleich.length ? (
          <ul className="small" style={{ margin: 0 }}>{v.abgleich.slice(0, 60).map((f) => <li key={`${f.land}${f.sku}${f.art}`}>{f.text}</li>)}</ul>
        ) : (
          <div className="small muted">Keine Abweichungen{v.laender.some((l) => l.vergleichMit === "bqool") ? "" : " – es ist noch kein BQool-Ist-Stand hochgeladen"}.</div>
        )}
        <div className="small muted">Regeln in BQool selbst anpassen – das System ändert keine BQool-Regeln.</div>
      </section>

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="bq-vorschlaege">
        <h2 style={{ margin: 0 }}>Vorschläge der Kapital-Ampel → „Abverkauf“ ({v.vorschlaege.length})</h2>
        {v.vorschlaege.length ? (
          <table className="table small">
            <tbody>
              {v.vorschlaege.slice(0, 50).map((x) => (
                <tr key={x.sku}>
                  <td>{x.sku}</td><td>{(x.titel ?? "").slice(0, 60)}</td><td>Reichweite {x.reichweite !== null && x.reichweite >= 9999 ? "keine Verkäufe" : `${x.reichweite} Tage`}</td><td>{eur(x.kapital)}</td>
                  <td>{kannSchreiben && <form action={vorschlagFreigebenAction}><input type="hidden" name="sku" value={x.sku} /><button className="btn btn-sm" type="submit">freigeben</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="small muted">Keine – nur rote Kapital-Ampel mit Reichweite über {s.kapital.rotReichweite} Tagen wird vorgeschlagen.</div>
        )}
      </section>

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="bq-zuweisungen">
        <h2 style={{ margin: 0 }}>Soll-Regeln: Liquidation, Abverkauf, Ausnahmen ({zuw.length})</h2>
        {kannSchreiben && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <form action={istUebernehmenAction}><button className="btn" type="submit" data-testid="bq-ist-uebernehmen">Listen aus BQool übernehmen</button></form>
            <span className="small muted">übernimmt Liquidation (mit Min als Untergrenze) und Abverkauf aus dem hochgeladenen Ist-Stand; von Hand Gepflegtes bleibt.</span>
          </div>
        )}
        {zuw.length > 0 && (
          <table className="table small">
            <thead><tr><th>Land</th><th>SKU</th><th>Regel</th><th>Untergrenze</th><th>Quelle</th><th /></tr></thead>
            <tbody>
              {zuw.map((z) => (
                <tr key={`${z.land}${z.sku}`} data-testid="bq-zuweisung" data-sku={z.sku} data-land={z.land}>
                  <td>{z.land}</td><td>{z.sku}</td><td>{z.regel}</td><td>{z.untergrenze?.toFixed(2) ?? "–"}</td><td>{{ vorlage: "aus BQool", hand: "von Hand", kapital: "Kapital-Ampel" }[z.quelle]}{z.freigegeben ? "" : " (nicht freigegeben)"}</td>
                  <td>{kannSchreiben && <form action={zuweisungLoeschenAction}><input type="hidden" name="land" value={z.land} /><input type="hidden" name="sku" value={z.sku} /><button className="btn btn-sm" type="submit">entfernen</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {kannSchreiben && (
          <form action={zuweisungAction} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="bq-zuweisung-form">
            <input name="sku" placeholder="SKU" required style={{ width: 160 }} />
            <select name="regel" defaultValue={b.katalog[0]?.name}>{b.katalog.map((k) => <option key={k.name}>{k.name}</option>)}</select>
            <input name="untergrenze" placeholder="Untergrenze (nur Liquidation)" style={{ width: 200 }} />
            {EXPORT_LAENDER.map((l) => <label key={l} className="small"><input type="checkbox" name="land" value={l} defaultChecked /> {l}</label>)}
            <button className="btn" type="submit">Regel setzen</button>
          </form>
        )}
      </section>

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="bq-ek-fehlt">
        <h2 style={{ margin: 0 }}>EK fehlt – nicht in der Datei ({v.ekFehlt.length})</h2>
        {v.ekFehlt.length ? (
          <div className="small">{[...new Map(v.ekFehlt.map((x) => [x.sku, x])).values()].slice(0, 100).map((x) => <span key={x.sku} style={{ marginRight: 12 }}>{x.sku}</span>)} <Link href="/produkte?ansicht=zuordnung&art=ek-fehlt">EK nachtragen →</Link></div>
        ) : (
          <div className="small muted">Alle SKUs mit Bestand haben einen EK.</div>
        )}
      </section>

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="bq-katalog">
        <h2 style={{ margin: 0 }}>Regel-Katalog (spiegelt BQool)</h2>
        <p className="small muted" style={{ margin: 0 }}>Namen exakt wie in BQool. Staffel als „Tage:Marge Unterregel“, z. B. „30:10 SB, 60:8 EQ, :0 SB“ (SB = Sales Booster: an/unter Min → Min; EQ = Equalizer: an/unter Min → Buy Box + 0,01 €, verliert bewusst die Buy Box; letzte Stufe ohne Tage). Einmal mit BQool abgleichen – vor allem die Altersstufen der Abverkauf-Regeln.</p>
        <form action={katalogAction} className="stack" style={{ gap: 8 }}>
          <div className="table-wrap">
            <table className="table small">
              <thead><tr><th>Name</th><th>Länder</th><th>Strategie</th><th>Staffel</th><th>feste Untergrenze</th><th>Risiko</th><th>Hinweis</th><th>löschen</th></tr></thead>
              <tbody>
                {[...b.katalog, { name: "", laender: null, strategie: "", staffel: null, festeUntergrenze: false, risiko: false, hinweis: "" }].map((k, i) => (
                  <tr key={i}>
                    <td><input name="name" defaultValue={k.name} placeholder="neue Regel" style={{ width: 120 }} /></td>
                    <td><input name={`laender_${i}`} defaultValue={k.laender?.join(" ") ?? ""} placeholder="alle" style={{ width: 90 }} /></td>
                    <td><input name={`strategie_${i}`} defaultValue={k.strategie} style={{ width: 150 }} /></td>
                    <td><input name={`staffel_${i}`} defaultValue={k.staffel?.map((x) => `${x.bisTage ?? ""}:${x.marge}${x.unterregel ? ` ${x.unterregel === "Equalizer" ? "EQ" : "SB"}` : ""}`).join(", ") ?? ""} style={{ width: 240 }} /></td>
                    <td><input type="checkbox" name={`fest_${i}`} value="1" defaultChecked={k.festeUntergrenze} /></td>
                    <td><input type="checkbox" name={`risiko_${i}`} value="1" defaultChecked={k.risiko} /></td>
                    <td><input name={`hinweis_${i}`} defaultValue={k.hinweis} style={{ width: 180 }} /></td>
                    <td>{k.name && <input type="checkbox" name={`loeschen_${i}`} value="1" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="small">Ausnahmen (je Zeile „ASIN oder Marke/Produktname · Land · Regel“, Land * = alle):<br /><textarea name="marken" rows={3} style={{ width: "100%" }} defaultValue={b.markenRegeln.map((m) => `${m.marke} ${m.land ?? "*"} ${m.regel}`).join("\n")} /></label>
          <label className="small">Teure Elektronik (Marken, Komma-getrennt) → Abverkauf in den Ländern <input name="elektronik_laender" defaultValue={b.elektronikLaender.join(" ")} style={{ width: 90 }} />:<br /><input name="elektronik" style={{ width: "100%" }} defaultValue={b.elektronikMarken.join(", ")} /></label>
          <div className="row small" style={{ gap: 12, flexWrap: "wrap" }}>
            <label>Max = Ø Buy Box 90 T × <input name="max_faktor" defaultValue={String(b.maxFaktor).replace(".", ",")} style={{ width: 60 }} /></label>
            <label>Cost = EK × (1 + <input name="cost_ust" defaultValue={String(Math.round(b.costUst * 100))} style={{ width: 40 }} /> %)</label>
            <label>Zusatzkosten je Stück <input name="zusatzkosten" defaultValue={String(b.zusatzkosten).replace(".", ",")} style={{ width: 60 }} /> €</label>
            <label>Fixgebühr <input name="fix" defaultValue={String(b.fixGebuehr).replace(".", ",")} style={{ width: 60 }} /> €</label>
          </div>
          {kannSchreiben && <div><button className="btn" type="submit" data-testid="bq-katalog-speichern">Regeln speichern</button></div>}
        </form>
      </section>
    </>
  );
}
