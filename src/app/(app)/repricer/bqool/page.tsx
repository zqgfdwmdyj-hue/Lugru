import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { EXPORT_LAENDER } from "@/lib/bqool/export-logic";
import { bqoolExporte, bqoolVorschau, zuweisungen } from "@/lib/bqool/export-service";
import { formatDate, formatEuro } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { getIntegration } from "@/lib/integrations/store";
import { bqoolUploadAdressen } from "@/lib/automatik/bqool-logic";
import { letzterBqoolVergleich } from "@/lib/arbitrageone/service";
import { anBqoolAction, exportErzeugenAction, istUebernehmenAction, katalogAction, liquidationPruefenAction, liquidationTestAction, liquidationTestExportAction, rueckkehrAction, verlustFreigabeAction, vorschlagFreigebenAction, zuweisungAction, zuweisungLoeschenAction } from "./actions";
import { liquidationsStand } from "@/lib/bqool/liquidation";
import { RUECKKEHR_AUFSCHLAG, RUECKKEHR_TAGE } from "@/lib/bqool/export-logic";
import { kreislaufStand, letzteLaeufe } from "@/lib/bqool/kreislauf";
import { KreislaufKarte } from "./kreislauf-karte";

// BQool-Dateien direkt aus dem System: Ist (BQool) → Soll (Regeln hier), Freigabe vor jedem Export, Download je Land/ZIP.

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatEuro(n));
const ART_TEXT = { neu: "neu", geaendert: "geändert", gleich: "gleich" } as const;

export default async function BqoolDateienPage({ searchParams }: { searchParams: Promise<{ meldung?: string; export?: string; land?: string; lauf?: string; freigeben?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const [v, s, zuw, exporte, bqWeb, aoVergleich, kStand, laeufe, liq] = await Promise.all([bqoolVorschau(session.tenantId), getSettings(session.tenantId), zuweisungen(session.tenantId), bqoolExporte(session.tenantId, 5), getIntegration(session.tenantId, "bqool_web"), letzterBqoolVergleich(session.tenantId), kreislaufStand(session.tenantId), letzteLaeufe(session.tenantId, 6), liquidationsStand(session.tenantId)]);
  // B31.2: angezeigter Lauf – aus dem Push (?lauf=…), sonst der heutige bzw. der letzte
  const lauf = (sp.lauf ? laeufe.find((l) => l.id === sp.lauf) : null) ?? kStand.heute ?? laeufe[0] ?? null;
  // B23: Upload-Seite je Land (eigene Adresse bzw. aus DE abgeleitet)
  const adressen = bqWeb?.uploadUrl ? bqoolUploadAdressen(bqWeb).filter((a) => (EXPORT_LAENDER as readonly string[]).includes(a.land)) : [];
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
        Je Land eine Datei im BQool-Format (Tab-getrennt, Dezimalpunkt) – ohne den Umweg über ArbitrageOne. Cost = EK netto × {String(1 + b.costUst).replace(".", ",")} wie bisher. Min Price bei Margen-Regeln: mindestens der effektive Min (Break-even mit landeseigener USt + Mindestmarge der Altersstufe) – BQool setzt einen niedrigeren Min ohnehin auf den Margen-Wert zurück. Soll eine SKU darunter verkaufen (gewünschter Min unter dem effektiven Min), kommt sie auf „Liquidation“ mit festem Min, nie unter Break-even ohne Freigabe (B31.6). Bei „Liquidation“ zählt die feste Untergrenze. Ist-Stand: täglich 06:00 automatisch bzw. BQool-Datei je Land unter <Link href="/uploads">Uploads</Link> hochladen.
      </p>

      <KreislaufKarte stand={kStand} lauf={lauf} laeufe={laeufe} inhaber={session.role === "owner" && !session.readOnly} freigebenHinweis={sp.freigeben === "1"} einstellungen={b.kreislauf} />

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
        {(() => {
          // B25.5: Warnungen vor der Freigabe auf einen Blick (Min über Buy Box × 1,2, unter Break-even, kein Min in BQool …)
          const warn = v.laender.flatMap((l) => l.zeilen.filter((z) => z.warnungen.length).map((z) => ({ land: l.land, sku: z.sku, w: z.warnungen })));
          if (!warn.length) return <div className="small muted" data-testid="bq-warnungen-keine">Keine Warnungen – Min-Preise liegen zwischen Break-even und Buy Box × 1,2.</div>;
          return (
            <div className="notice notice-warn small" data-testid="bq-warnungen">
              <strong>{warn.length} Warnung{warn.length === 1 ? "" : "en"} vor der Freigabe prüfen:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {warn.slice(0, 15).map((x) => <li key={`${x.land}-${x.sku}`}><b>{x.land}</b> {x.sku}: {x.w.join(" · ")}</li>)}
              </ul>
              {warn.length > 15 && <div className="muted">… und {warn.length - 15} weitere (unten je Land).</div>}
            </div>
          );
        })()}
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
            {aktiv.uebertragung && <span data-testid="bq-uebertragung"> · BQool: {{ laeuft: "Übertragung läuft", fertig: "hochgeladen ✓", teilweise: "teilweise hochgeladen (siehe Protokoll)", fehler: "Übertragung abgebrochen", pruefen: "hochgeladen – Bestätigung bitte in BQool prüfen (Einstellungen → Hintergrund & Importe)" }[aktiv.uebertragung]}</span>}
          </div>
        )}
        {aktiv && kannSchreiben && (
          <form action={anBqoolAction} className="row small" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="bq-automatik">
            <input type="hidden" name="export" value={aktiv.id} />
            <label><input type="checkbox" name="bestaetigt" value="1" /> Freigabe geprüft – Preise bei BQool jetzt ändern</label>
            <button className="btn" type="submit">An BQool übertragen (Browser)</button>
            <span className="muted">braucht die Anbindung „BQool – Anmeldung“; sonst ZIP herunterladen.</span>
            {adressen.length > 0 && (
              <span className="muted" data-testid="bq-adressen">
                Upload-Seiten: {adressen.map((a) => `${a.land} ${a.url ? (a.abgeleitet ? "✓ (aus DE)" : "✓") : "– fehlt"}`).join(" · ")} · <Link href="/anbindungen?p=bqool_web#bqool_web">prüfen</Link>
              </span>
            )}
          </form>
        )}
        {aktiv && aktiv.protokoll.length > 0 && <ul className="small muted" style={{ margin: 0 }}>{aktiv.protokoll.slice(-6).map((p, i) => <li key={i}>{p.text}</li>)}</ul>}
      </section>

      {(() => {
        // B31.6: Regelwechsel auf Liquidation (Min unter Marge), Min unter Break-even, aktive Liquidationen, Rückkehr, Test
        const inhaber = session.role === "owner" && !session.readOnly;
        const alle = v.laender.flatMap((l) => l.zeilen);
        const wechsel = alle.filter((z) => z.liquidation === "neu" && (z.regelWechsel || z.art !== "gleich"));
        const unterBe = alle.filter((z) => z.warnungen.some((w) => /^Min .* unter Break-even/.test(w)));
        const zeileZu = new Map(alle.map((z) => [`${z.land}|${z.sku}`, z]));
        const aktiv = liq.zeilen.filter((r) => r.grund === "min_unter_marge" && r.status !== "vorgeschlagen");
        const t = b.liquidationTest;
        const kandidaten = wechsel.filter((z) => z.wartetAufTest);
        const f2 = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(2));
        return (
          <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="liquidation" data-testid="bq-liquidation">
            <h2 style={{ margin: 0 }}>Liquidation wegen Min unter Marge</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Liegt der gewünschte Min unter dem effektiven Min der Regel (Marge unter 10 % bei ia, 7 % bei „Abverkauf DE“, 4 % bei „Abverkauf“), setzt BQool ihn auf den Margen-Wert zurück – nur „Liquidation“ nimmt den Min als feste Untergrenze. Deshalb wechselt die Regel auf Liquidation, Min fest, nie unter Break-even ohne Freigabe. Steht die Buy Box {RUECKKEHR_TAGE} Tage über dem effektiven Min der ursprünglichen Regel + {Math.round(RUECKKEHR_AUFSCHLAG * 100)} %, schlägt das System die Rückkehr vor. „Liquidation“ ist AI Win Sales Booster: der Preis kann bis zum Min fallen.
            </p>
            <div className={`notice ${t.bestanden ? "notice-ok" : "notice-warn"} small`} data-testid="bq-liq-test" data-bestanden={t.bestanden ? "1" : "0"}>
              {t.bestanden ? (
                <>Test bestanden{t.am ? ` am ${formatDate(t.am.slice(0, 10))}` : ""}{t.sku ? ` (${t.land} ${t.sku})` : ""}{t.vonHand ? " – von Hand bestätigt" : " – BQool-Ist zeigte Liquidation und Min nach dem nächsten Lauf noch"}. Regelwechsel kommen in die Datei (Upload weiter nur mit Freigabe).</>
              ) : (
                <>Test vor dem ersten Regelwechsel offen: eine SKU von Hand mit „Liquidation“ und festem Min hochladen; nach dem nächsten BQool-Lauf prüft das System, ob Min und Regel stehen bleiben. Bis dahin kommen Regelwechsel nicht in die Datei ({kandidaten.length} warten).</>
              )}
              {inhaber && !t.bestanden && kandidaten.length > 0 && (
                <form action={liquidationTestExportAction} className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <select name="wahl" data-testid="bq-liq-test-wahl">{kandidaten.map((z) => <option key={`${z.land}|${z.sku}`} value={`${z.land}|${z.sku}`}>{z.land} {z.sku} – Min {f2(z.min)}</option>)}</select>
                  <button className="btn btn-sm" type="submit" data-testid="bq-liq-test-export">Test-Export nur für diese SKU</button>
                </form>
              )}
              {inhaber && (
                <form action={liquidationTestAction} className="row" style={{ gap: 8, marginTop: 6 }}>
                  <input type="hidden" name="bestanden" value={t.bestanden ? "0" : "1"} />
                  <button className="btn btn-sm" type="submit" data-testid="bq-liq-test-hand">{t.bestanden ? "Test zurücksetzen" : "In BQool nachgesehen – Test bestanden"}</button>
                </form>
              )}
            </div>
            <div>
              <strong className="small">Regelwechsel auf Liquidation ({wechsel.length})</strong>
              {wechsel.length ? (
                <div className="table-wrap">
                  <table className="table small" data-testid="bq-liq-wechsel">
                    <thead><tr><th>Land</th><th>SKU</th><th>Artikel</th><th>Regel</th><th>Min alt → neu</th><th>Marge neu</th><th>Break-even</th><th>Buy Box</th><th>Status</th></tr></thead>
                    <tbody>
                      {wechsel.map((z) => (
                        <tr key={`${z.land}|${z.sku}`} data-testid="bq-liq-zeile" data-sku={z.sku} data-land={z.land}>
                          <td>{z.land}</td><td>{z.sku}</td><td>{(z.titel ?? "").slice(0, 40)}</td>
                          <td>{z.istRegel ?? z.regelVorher ?? "–"} → <b>{z.regel}</b></td>
                          <td>{f2(z.istMin)} → <b>{f2(z.min)}</b>{z.minGewuenscht !== null && Math.abs(z.minGewuenscht - z.min) > 0.005 ? <div className="muted">gewünscht {f2(z.minGewuenscht)}</div> : null}</td>
                          <td>{z.margeNeu !== null ? `${String(z.margeNeu).replace(".", ",")} %` : "–"}</td>
                          <td>{f2(z.breakEven)}</td><td>{f2(z.buybox)}</td>
                          <td>{z.wartetAufTest ? <span className="tag tag-warn">wartet auf Test</span> : "in der nächsten Datei"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="small muted">Keine – gewünschte Min-Preise liegen auf oder über dem effektiven Min. Einen niedrigeren Min unten unter „Soll-Regeln“ eintragen (Regel bleibt, z. B. ia; das System stellt dann auf Liquidation um).</div>
              )}
            </div>
            {unterBe.length > 0 && (
              <div data-testid="bq-liq-unter-be">
                <strong className="small">Min unter Break-even ({unterBe.length})</strong>
                <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {unterBe.map((z) => (
                    <li key={`${z.land}|${z.sku}`}>
                      <b>{z.land}</b> {z.sku}: Min {f2(z.min)} unter Break-even {f2(z.breakEven)}{z.verlustBis ? ` – freigegeben bis ${f2(z.verlustBis)} € je Stück` : " – nicht freigegeben"}
                      {inhaber && (
                        <form action={verlustFreigabeAction} className="row" style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
                          <input type="hidden" name="land" value={z.land} /><input type="hidden" name="sku" value={z.sku} />
                          <input name="verlust_bis" defaultValue={z.verlustBis ? String(z.verlustBis).replace(".", ",") : ""} placeholder="Verlust bis € je Stück" style={{ width: 150 }} aria-label="Mindest-Verlust akzeptiert bis" />
                          <button className="btn btn-sm" type="submit">speichern</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <strong className="small">Aktiv in BQool ({aktiv.length}){liq.rueckkehr ? ` · ${liq.rueckkehr} Rückkehr vorgeschlagen` : ""}</strong>
              {aktiv.length ? (
                <div className="table-wrap">
                  <table className="table small" data-testid="bq-liq-aktiv">
                    <thead><tr><th>Land</th><th>SKU</th><th>Regel vorher</th><th>Min</th><th>seit</th><th>Buy Box / Schwelle</th><th>über Schwelle seit</th><th /></tr></thead>
                    <tbody>
                      {aktiv.map((r) => {
                        const z = zeileZu.get(`${r.land}|${r.sku}`);
                        const schwelle = r.effMinVorher !== null ? r.effMinVorher * (1 + RUECKKEHR_AUFSCHLAG) : null;
                        return (
                          <tr key={`${r.land}|${r.sku}`} data-testid="bq-liq-aktiv-zeile" data-sku={r.sku} data-status={r.status}>
                            <td>{r.land}</td><td>{r.sku}</td><td>{r.regelVorher ?? "–"}</td><td>{f2(r.minGesetzt)}</td>
                            <td>{r.aktivSeit ? formatDate(r.aktivSeit.toISOString().slice(0, 10)) : "–"}</td>
                            <td>{f2(z?.buybox)} / {f2(schwelle)}</td>
                            <td>{r.ueberSeit ? formatDate(r.ueberSeit) : "–"}</td>
                            <td>
                              {r.status === "zurueck_vorgeschlagen" && inhaber ? (
                                <span className="row" style={{ gap: 6 }}>
                                  <form action={rueckkehrAction}><input type="hidden" name="land" value={r.land} /><input type="hidden" name="sku" value={r.sku} /><button className="btn btn-sm btn-primary" type="submit" data-testid="bq-liq-zurueck">zurück auf {r.regelVorher}</button></form>
                                  <form action={rueckkehrAction}><input type="hidden" name="land" value={r.land} /><input type="hidden" name="sku" value={r.sku} /><input type="hidden" name="entscheidung" value="bleiben" /><button className="btn btn-sm" type="submit">bleibt</button></form>
                                </span>
                              ) : r.status === "zurueck_vorgeschlagen" ? <span className="tag tag-warn">Rückkehr vorgeschlagen</span> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="small muted">Noch keine – aktiv, sobald das BQool-Ist Liquidation mit dem gesetzten Min zeigt{liq.vorgeschlagen ? ` (${liq.vorgeschlagen} hochgeladen bzw. in der Datei, noch nicht im Ist)` : ""}.</div>
              )}
            </div>
            {kannSchreiben && <form action={liquidationPruefenAction}><button className="btn btn-sm" type="submit" data-testid="bq-liq-pruefen" title="Sonst täglich automatisch (BQool-Lauf bzw. Hintergrund)">Liquidation jetzt prüfen</button></form>}
          </section>
        );
      })()}

      {v.laender.map((l) => {
        const wichtig = l.zeilen.filter((z) => z.art !== "gleich" || z.warnungen.length || z.erklaerung);
        return (
          <details key={l.land} id={`vorschau-${l.land}`} className="card card-pad" style={{ marginTop: 12, scrollMarginTop: 70 }} data-testid="bq-tabelle" data-land={l.land} open={l.land === (sp.land ?? v.laender[0]?.land)}>
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

      {aoVergleich && (
        <section className="card card-pad stack" style={{ marginTop: 12 }} id="ao-vergleich" data-testid="ao-bqool-vergleich">
          <h2 style={{ margin: 0 }}>Vergleich ArbitrageOne ↔ Seller-System</h2>
          <div className="small"><strong>{aoVergleich.text}</strong> <span className="muted">(BQool-Export aus ArbitrageOne vom {aoVergleich.am ? formatDate(aoVergleich.am.toISOString().slice(0, 10)) : "–"})</span></div>
          {(aoVergleich.laender ?? []).some((l) => l.beispiele.length) && (
            <table className="table small">
              <thead><tr><th>Land</th><th>SKU</th><th>Abweichung</th><th>ArbitrageOne</th><th>Seller-System</th></tr></thead>
              <tbody>
                {(aoVergleich.laender ?? []).flatMap((l) => l.beispiele.slice(0, 15).map((b) => (
                  <tr key={`${l.land}${b.sku}${b.art}`}><td>{l.land}</td><td>{b.sku}</td><td>{{ nur_arbitrageone: "nur in ArbitrageOne", nur_system: "nur im Seller-System", regel: "andere Regel", min: "anderer Min-Preis", max: "anderer Max-Preis" }[b.art] ?? b.art}</td><td>{b.arbitrageone}</td><td>{b.system}</td></tr>
                )))}
              </tbody>
            </table>
          )}
          <div className="small muted">Nur zum Vergleich: Die BQool-Datei aus ArbitrageOne wird nie übernommen oder hochgeladen – maßgeblich sind die Soll-Regeln hier (zwei Quellen würden sich widersprechen).</div>
        </section>
      )}

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
            <input name="untergrenze" placeholder="Min (gewünscht)" title="Bei Liquidation die feste Untergrenze; bei Margen-Regeln (ia, Abverkauf) der gewünschte Min – liegt er unter dem effektiven Min, stellt das System auf Liquidation um (nie unter Break-even ohne Freigabe)" style={{ width: 200 }} />
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
