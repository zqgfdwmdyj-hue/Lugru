import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { EXPORT_LAENDER, RUECKKEHR_AUFSCHLAG, STRATEGIEN, staffelAlsText, stufenBereich } from "@/lib/repricing/strategie-logic";
import { exportAuswahl, freigabeNoetig, profitguardExporte, sollVorschau, zuweisungen } from "@/lib/repricing/soll-service";
import { formatDate } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { liquidationsStand } from "@/lib/repricing/liquidation";
import { VORSCHLAG_TEXT, vorschlaegeOffen, type VorschlagArt } from "@/lib/repricing/leiter";
import { ablaufStand, ZUSTAND_TEXT, type Zustand } from "@/lib/repricing/leiter-logic";
import { todayIso } from "@/lib/dates";
import { ablaufAction, exportErzeugenAction, formatZuruecksetzenAction, importiertAction, istUebernehmenAction, leiterEinstellungenAction, leiterVorschlagAction, liquidationPruefenAction, rueckkehrAction, strategieEinstellungenAction, verlustFreigabeAction, vorschlagFreigebenAction, zuweisungAction, zuweisungLoeschenAction } from "./actions";

// Repricer → ProfitGuard-Datei: Soll (Seller-System) gegen Ist (ProfitGuard-Export), Freigabe vor jeder Importdatei,
// Download je Land. Das System sendet nichts an ProfitGuard oder Amazon – Ludwig importiert die Datei selbst.

const ART_TEXT = { neu: "neu", geaendert: "geändert", gleich: "gleich" } as const;
const f2 = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(2).replace(".", ","));

export default async function ProfitguardPage({ searchParams }: { searchParams: Promise<{ meldung?: string; export?: string; land?: string }> }) {
  const session = await requireArea("buchhaltung");
  const sp = await searchParams;
  const [v, s, zuw, exporte, liq, leiterVorschlaege] = await Promise.all([sollVorschau(session.tenantId), getSettings(session.tenantId), zuweisungen(session.tenantId), profitguardExporte(session.tenantId, 5), liquidationsStand(session.tenantId), vorschlaegeOffen(session.tenantId)]);
  const heute = todayIso();
  const b = s.repricing;
  const aktiv = sp.export ? exporte.find((e) => e.id === sp.export) : exporte[0];
  const kannSchreiben = !session.readOnly;
  const inhaber = session.role === "owner" && !session.readOnly;
  const auswahl = exportAuswahl(v, { nurAenderungen: true });
  const alle = v.laender.flatMap((l) => l.zeilen);
  const zeileZu = new Map(alle.map((z) => [`${z.land}|${z.sku}`, z]));
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/repricer">Repricer</Link></div>
          <h1>ProfitGuard-Datei</h1>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      <p className="small muted" style={{ marginTop: 0 }}>
        Soll je SKU und Land aus dem Seller-System: Strategie (Standard, Abverkauf, Liquidation, Schnelldreher), Min = Break-even mit der Mindestmarge der Altersstufe (wie in ProfitGuard), Max = Min × {String(s.pricing.maxPriceFactor).replace(".", ",")} bzw. Ziel-VK. Verglichen wird mit dem letzten ProfitGuard-Export (hochladen unter <Link href="/repricer#profitguard-upload">Repricer</Link> oder <Link href="/uploads">Uploads</Link>). Die Importdatei hat das Format dieses Exports{b.profitguard.format ? "" : " – noch keins gelernt, bis dahin gilt eine Standard-CSV"}. Das System sendet nichts an ProfitGuard oder Amazon.
      </p>

      <section className="card card-pad stack" id="export" style={{ scrollMarginTop: 70 }} data-testid="pg-export">
        <h2 style={{ margin: 0 }}>Freigabe und Importdatei</h2>
        <div className="grid-kpi">
          {v.laender.map((l) => (
            <div key={l.land} className="card card-pad" data-testid="pg-land" data-land={l.land}>
              <div className="kpi-label">{l.land} · {l.zeilen.length} SKUs</div>
              <div className="small">neu {l.neu} · geändert {l.geaendert} · gleich {l.gleich}</div>
              <div className="small">Strategiewechsel {l.regelWechsel} · <span style={{ color: l.mitWarnung ? "var(--warn)" : undefined }}>Warnungen {l.mitWarnung}</span> · <span style={{ color: l.mitHinweis ? "var(--danger)" : undefined }}>auffällig {l.mitHinweis}</span></div>
              <div className="small muted">{l.vergleichMit === "profitguard" ? `Ist: ProfitGuard-Export vom ${formatDate(l.istStand?.toISOString() ?? null)}` : l.vergleichMit === "export" ? "Vergleich: letzte eigene Datei" : "noch kein Ist-Stand"}</div>
            </div>
          ))}
        </div>
        {(() => {
          const warn = alle.filter((z) => z.warnungen.length);
          if (!warn.length) return <div className="small muted" data-testid="pg-warnungen-keine">Keine Warnungen.</div>;
          return (
            <div className="notice notice-warn small" data-testid="pg-warnungen">
              <strong>{warn.length} Warnung{warn.length === 1 ? "" : "en"} vor der Freigabe prüfen:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{warn.slice(0, 15).map((x) => <li key={`${x.land}-${x.sku}`}><b>{x.land}</b> {x.sku}: {x.warnungen.join(" · ")}</li>)}</ul>
              {warn.length > 15 && <div className="muted">… und {warn.length - 15} weitere (unten je Land).</div>}
            </div>
          );
        })()}
        {kannSchreiben && (
          <form action={exportErzeugenAction} className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }} data-testid="pg-export-form">
            {EXPORT_LAENDER.map((l) => <label key={l} className="small"><input type="checkbox" name="land" value={l} defaultChecked={b.laender.includes(l)} /> {l}</label>)}
            <label className="small"><input type="checkbox" name="nur_aenderungen" value="1" defaultChecked /> nur Änderungen</label>
            <label className="small" title="Nötig bei Strategiewechsel, neuer Liquidation oder Min unter Break-even"><input type="checkbox" name="freigabe" value="1" data-testid="pg-freigabe" /> Freigabe geprüft{freigabeNoetig(auswahl.zusammenfassung) ? ` (nötig: ${auswahl.zusammenfassung.regelWechsel} Wechsel, ${auswahl.zusammenfassung.liquidation} Liquidation neu, ${auswahl.zusammenfassung.unterBreakEven} unter Break-even)` : ""}</label>
            <button className="btn btn-primary" type="submit" data-testid="pg-export-los">Importdatei erzeugen</button>
          </form>
        )}
        {aktiv && (
          <div className="small" data-testid="pg-downloads">
            Datei vom {formatDate(aktiv.createdAt.toISOString())} ({aktiv.nurAenderungen ? "nur Änderungen" : "alles"}):{" "}
            <a href={`/repricer/profitguard/datei?export=${aktiv.id}`} data-testid="pg-datei-alle">alle Länder</a>
            {(aktiv.laender as string[]).filter((l) => aktiv.anzahl[l]).map((l) => <span key={l}> · <a href={`/repricer/profitguard/datei?export=${aktiv.id}&land=${l}`} data-testid={`pg-datei-${l}`}>{l} ({aktiv.anzahl[l] ?? 0})</a></span>)}
            {aktiv.importiertAm ? (
              <span className="tag tag-ok" style={{ marginLeft: 8 }} data-testid="pg-importiert">in ProfitGuard importiert ({formatDate(aktiv.importiertAm.toISOString().slice(0, 10))}{aktiv.importiertVon ? `, ${aktiv.importiertVon}` : ""})</span>
            ) : kannSchreiben ? (
              <form action={importiertAction} style={{ display: "inline", marginLeft: 8 }}><input type="hidden" name="export" value={aktiv.id} /><button className="btn btn-sm" type="submit" data-testid="pg-importiert-bestaetigen">in ProfitGuard importiert</button></form>
            ) : null}
          </div>
        )}
      </section>

      {(() => {
        const wechsel = alle.filter((z) => z.liquidation === "neu" && (z.regelWechsel || z.art === "neu"));
        const unterBe = alle.filter((z) => z.warnungen.some((w) => /^Min .* unter Break-even/.test(w)));
        const aktivL = liq.zeilen.filter((r) => (r.grund === "min_unter_marge" || r.grund === "leiter") && r.status !== "vorgeschlagen");
        return (
          <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="liquidation" data-testid="pg-liquidation">
            <h2 style={{ margin: 0 }}>Liquidation</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Liegt der gewünschte Min unter dem Soll-Min der Strategie und die Buy Box darunter, wechselt die Soll-Strategie auf „Liquidation“ mit festem Min – nie unter Break-even ohne Freigabe „Verlust akzeptiert bis x €“. Aktiv, sobald der ProfitGuard-Export die Liquidations-Strategie mit dem gesetzten Min zeigt; dann gilt automatisch eine Verlust-Stopp-Ausnahme im freigegebenen Rahmen. Rückkehr-Vorschlag, wenn die Buy Box {14} Tage über dem Soll-Min der alten Strategie + {Math.round(RUECKKEHR_AUFSCHLAG * 100)} % liegt.
            </p>
            <div>
              <strong className="small">Wechsel auf Liquidation ({wechsel.length})</strong>
              {wechsel.length ? (
                <div className="table-wrap">
                  <table className="table small" data-testid="pg-liq-wechsel">
                    <thead><tr><th>Land</th><th>SKU</th><th>Artikel</th><th>Strategie</th><th>Min Ist → Soll</th><th>Marge neu</th><th>Break-even</th><th>Buy Box</th></tr></thead>
                    <tbody>
                      {wechsel.map((z) => (
                        <tr key={`${z.land}|${z.sku}`} data-testid="pg-liq-zeile" data-sku={z.sku} data-land={z.land}>
                          <td>{z.land}</td><td>{z.sku}</td><td>{(z.titel ?? "").slice(0, 40)}</td>
                          <td>{z.istStrategieName ?? z.regelVorher ?? "–"} → <b>{z.regel}</b></td>
                          <td>{f2(z.istMin)} → <b>{f2(z.min)}</b>{z.minGewuenscht !== null && Math.abs(z.minGewuenscht - z.min) > 0.005 ? <div className="muted">gewünscht {f2(z.minGewuenscht)}</div> : null}</td>
                          <td>{z.margeNeu !== null ? `${String(z.margeNeu).replace(".", ",")} %` : "–"}</td>
                          <td>{f2(z.breakEven)}</td><td>{f2(z.buybox)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="small muted">Keine – gewünschte Min-Preise liegen auf oder über dem Soll-Min. Einen niedrigeren Min unten unter „Soll-Strategien“ eintragen.</div>
              )}
            </div>
            {unterBe.length > 0 && (
              <div data-testid="pg-liq-unter-be">
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
              <strong className="small">Aktiv in ProfitGuard ({aktivL.length}){liq.rueckkehr ? ` · ${liq.rueckkehr} Rückkehr vorgeschlagen` : ""}</strong>
              {aktivL.length ? (
                <div className="table-wrap">
                  <table className="table small" data-testid="pg-liq-aktiv">
                    <thead><tr><th>Land</th><th>SKU</th><th>Strategie vorher</th><th>Min</th><th>seit</th><th>Liquidation bis</th><th>Buy Box / Schwelle</th><th>über Schwelle seit</th><th /></tr></thead>
                    <tbody>
                      {aktivL.map((r) => {
                        const z = zeileZu.get(`${r.land}|${r.sku}`);
                        const schwelle = r.effMinVorher !== null ? r.effMinVorher * (1 + RUECKKEHR_AUFSCHLAG) : null;
                        const a = ablaufStand({ bis: r.bis, dauerhaft: r.dauerhaft, heute, vorwarnTage: b.leiter.ablaufVorwarnTage });
                        return (
                          <tr key={`${r.land}|${r.sku}`} data-testid="pg-liq-aktiv-zeile" data-sku={r.sku} data-status={r.status}>
                            <td>{r.land}</td><td>{r.sku}</td><td>{r.regelVorher ?? "–"}</td><td>{f2(r.minGesetzt)}</td>
                            <td>{r.aktivSeit ? formatDate(r.aktivSeit.toISOString().slice(0, 10)) : "–"}</td>
                            <td data-testid="pg-liq-bis">{a.stand === "dauerhaft" ? "dauerhaft" : r.bis ? <>{formatDate(r.bis)}<div style={{ color: a.stand === "abgelaufen" ? "var(--danger)" : a.stand === "bald" ? "var(--warn)" : undefined }} className={a.stand === "laeuft" ? "muted" : ""}>{a.stand === "abgelaufen" ? "überfällig" : `noch ${a.restTage} T`}{r.verlaengert ? ` · ${r.verlaengert}× verlängert` : ""}</div></> : "–"}</td>
                            <td>{f2(z?.buybox)} / {f2(schwelle)}</td>
                            <td>{r.ueberSeit ? formatDate(r.ueberSeit) : "–"}</td>
                            <td>
                              {r.status === "zurueck_vorgeschlagen" && inhaber ? (
                                <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                  <form action={rueckkehrAction}><input type="hidden" name="land" value={r.land} /><input type="hidden" name="sku" value={r.sku} /><button className="btn btn-sm btn-primary" type="submit" data-testid="pg-liq-zurueck">zurück auf {r.rueckkehrRegel ?? r.regelVorher}</button></form>
                                  <form action={rueckkehrAction}><input type="hidden" name="land" value={r.land} /><input type="hidden" name="sku" value={r.sku} /><input type="hidden" name="entscheidung" value="bleiben" /><button className="btn btn-sm" type="submit">bleibt</button></form>
                                  {r.rueckkehrGrund && <span className="small muted">{r.rueckkehrGrund}</span>}
                                </span>
                              ) : r.status === "zurueck_vorgeschlagen" ? <span className="tag tag-warn">Rückkehr vorgeschlagen</span> : inhaber && r.status === "aktiv" ? (
                                <span className="row" style={{ gap: 4, flexWrap: "wrap" }} data-testid="pg-liq-ablauf">
                                  {[["verlaengern", `+${b.leiter.verlaengernTage} T`], ["zurueck", "zurück"], ["dauerhaft", "dauerhaft"]].map(([w, t]) => (
                                    <form key={w} action={ablaufAction}><input type="hidden" name="land" value={r.land} /><input type="hidden" name="sku" value={r.sku} /><input type="hidden" name="wahl" value={w} /><button className={`btn btn-sm${r.ablaufGemeldetAm && w === "verlaengern" ? " btn-primary" : ""}`} type="submit" title={w === "verlaengern" ? "Verlängern" : w === "zurueck" ? "Zurück auf alte Strategie (Stufe 2)" : "Dauerhaft Liquidation"}>{t}</button></form>
                                  ))}
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="small muted">Noch keine – aktiv, sobald der ProfitGuard-Export die Liquidation mit dem gesetzten Min zeigt{liq.vorgeschlagen ? ` (${liq.vorgeschlagen} in einer Datei, noch nicht im Ist)` : ""}.</div>
              )}
            </div>
            {kannSchreiben && <form action={liquidationPruefenAction}><button className="btn btn-sm" type="submit" data-testid="pg-liq-pruefen" title="Sonst täglich automatisch">Jetzt prüfen (Liquidation, Leiter, Abgleich)</button></form>}
          </section>
        );
      })()}

      {(() => {
        const e = b.leiter;
        const st = b.leiterStand;
        const knopf = (id: string, entscheidung: string, text: string, primaer = false) => (
          <form action={leiterVorschlagAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="entscheidung" value={entscheidung} /><button className={`btn btn-sm${primaer ? " btn-primary" : ""}`} type="submit" data-testid={`pg-leiter-${entscheidung}`}>{text}</button></form>
        );
        return (
          <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="leiter" data-testid="pg-leiter">
            <h2 style={{ margin: 0 }}>Regel-Leiter, Schnelldreher, Zustand</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Stufe 1 „Standard“ → Stufe 2 „Abverkauf“ → Stufe 3 „Liquidation“ → zurück auf Stufe 2 (auf Stufe 1 nur mit frischem Nachschub). Reihenfolge: {e.reihenfolge === "liquidation_zuerst" ? "Liquidation als kurze Brücke vor Abverkauf" : "Abverkauf vor Liquidation"}. Jeder Wechsel ist ein Vorschlag – erst nach Freigabe steht er in der nächsten ProfitGuard-Datei. Schnelldreher: Min mindestens Break-even + {e.schnell.margeBoden} %, kein Abverkauf. Gebrauchte Ware: eigener Zielpreis und Min = Break-even + {e.zustand.mindestmarge} %.
            </p>
            {st && <div className="small" data-testid="pg-leiter-stand">Stand {formatDate(st.am)}: Stufe 2 {st.stufe2} · Stufe 3 {st.stufe3} (davon {st.unterBe} unter Break-even){st.schnellUnterMin ? ` · Schnelldreher unter Min ${st.schnellUnterMin}` : ""}{st.gebrauchtNeupreis ? ` · ${st.gebrauchtNeupreis} gebrauchte mit Neupreis-Min` : ""}{st.zustandUnbekannt ? ` · ${st.zustandUnbekannt} ohne Zustand` : ""}</div>}
            {leiterVorschlaege.length ? (
              <div className="table-wrap">
                <table className="table small" data-testid="pg-leiter-vorschlaege">
                  <thead><tr><th>Land</th><th>SKU</th><th>Vorschlag</th><th>Strategie</th><th>Min</th><th>Gründe</th><th /></tr></thead>
                  <tbody>
                    {leiterVorschlaege.map((x) => (
                      <tr key={x.id} data-testid="pg-leiter-zeile" data-sku={x.sku} data-land={x.land} data-art={x.art}>
                        <td>{x.land}</td><td>{x.sku}<div className="muted">{String((x.daten as { titel?: string }).titel ?? "").slice(0, 40)}</div></td>
                        <td>{VORSCHLAG_TEXT[x.art as VorschlagArt] ?? x.art}</td>
                        <td>{x.vonRegel || x.nachRegel ? <>{x.vonRegel ?? "–"} → <b>{x.nachRegel ?? "–"}</b></> : "–"}</td>
                        <td>{x.min !== null ? f2(x.min) : "–"}</td>
                        <td>{(x.gruende ?? []).join(" · ")}</td>
                        <td>{inhaber && (
                          <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                            {x.art === "schnelldreher_ende" ? <>{knopf(x.id, "verlaengern", `Schutz +${e.schnell.verlaengernTage} T`, true)}{knopf(x.id, "abverkauf", "Abverkauf zulassen")}{knopf(x.id, "min_manuell", "Min manuell")}</> : x.art === "ebay" ? <>{knopf(x.id, "freigeben", "gemerkt", true)}{knopf(x.id, "ablehnen", "bleibt bei Amazon")}</> : <>{knopf(x.id, "freigeben", "Freigeben", true)}{knopf(x.id, "ablehnen", "Ablehnen")}{knopf(x.id, "spaeter", "Später")}</>}
                          </span>
                        )}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="small muted">Keine offenen Vorschläge.</div>
            )}
            {v.zustandUnbekannt.length > 0 && (
              <div className="notice notice-warn small" data-testid="pg-zustand-unbekannt">
                <strong>Zustand unbekannt ({new Set(v.zustandUnbekannt.map((z) => z.sku)).size})</strong> – kein automatischer Preis, nicht in der Datei: {[...new Set(v.zustandUnbekannt.map((z) => z.sku))].slice(0, 12).join(", ")}. <Link href="/repricer?ab=alle&zustand=unbekannt#abgleich">Zustand setzen</Link>
              </div>
            )}
            {inhaber && (
              <details id="leiter-einstellungen" style={{ scrollMarginTop: 70 }} data-testid="pg-leiter-einstellungen">
                <summary className="small">Einstellungen der Regel-Leiter (Schwellen änderbar)</summary>
                <form action={leiterEinstellungenAction} className="stack" style={{ marginTop: 8 }}>
                  <label className="small">Reihenfolge <select name="reihenfolge" defaultValue={e.reihenfolge}><option value="abverkauf_zuerst">Standard → Abverkauf → Liquidation</option><option value="liquidation_zuerst">Standard → Liquidation → Abverkauf (Brücke)</option></select></label>
                  <div className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
                    <label>1→2 Reichweite über <input name="reichweite_tage" defaultValue={e.reichweiteTage} style={{ width: 60 }} /> T</label>
                    <label>Lagerdauer über <input name="alter_12" defaultValue={e.alterTage12} style={{ width: 60 }} /> T mit Kapital über <input name="kapital_12" defaultValue={e.kapital12} style={{ width: 70 }} /> €</label>
                    <label>Soll-Min über Buy Box seit <input name="ueber_tage" defaultValue={e.ueberTage} style={{ width: 50 }} /> T bei Buy-Box-Anteil unter <input name="bb_quote_12" defaultValue={e.bbQuote12} style={{ width: 50 }} /> %</label>
                    <label>2→3 Lagerdauer über <input name="alter_23" defaultValue={e.alterTage23} style={{ width: 60 }} /> T oder Kapital über <input name="kapital_23" defaultValue={e.kapital23} style={{ width: 70 }} /> €</label>
                  </div>
                  <div className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
                    <label>Liquidation <input name="liquidation_tage" defaultValue={e.liquidationTage} style={{ width: 50 }} /> Tage</label>
                    <label>oder fest bis <input name="liquidation_bis_fest" type="date" defaultValue={e.liquidationBisFest ?? ""} /></label>
                    <label>verlängern um <input name="verlaengern_tage" defaultValue={e.verlaengernTage} style={{ width: 50 }} /> T</label>
                  </div>
                  <div className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
                    <label>Schnelldreher ab <input name="schnell_verkaeufe" defaultValue={e.schnell.verkaeufe30} style={{ width: 50 }} /> Verkäufen/30 T</label>
                    <label>Boden <input name="schnell_boden" defaultValue={e.schnell.margeBoden} style={{ width: 50 }} /> %</label>
                    <label>Ende nach <input name="schnell_ohne_bb" defaultValue={e.schnell.ohneBuyboxTage} style={{ width: 50 }} /> T ohne Buy Box</label>
                  </div>
                  <div className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
                    <span>Gebraucht – Faktor auf Neupreis:</span>
                    {(Object.keys(e.zustand.faktoren) as (keyof typeof e.zustand.faktoren)[]).filter((k) => k !== "neu").map((k) => (
                      <label key={k}>{ZUSTAND_TEXT[k as Zustand].replace("gebraucht – ", "")} <input name={`faktor_${k}`} defaultValue={String(e.zustand.faktoren[k]).replace(".", ",")} style={{ width: 50 }} /></label>
                    ))}
                    <label>Mindestmarge gebraucht <input name="zustand_marge" defaultValue={e.zustand.mindestmarge} style={{ width: 50 }} /> %</label>
                  </div>
                  <button className="btn btn-sm" type="submit" data-testid="pg-leiter-speichern">Speichern</button>
                </form>
              </details>
            )}
          </section>
        );
      })()}

      {v.laender.map((l) => {
        const wichtig = l.zeilen.filter((z) => z.art !== "gleich" || z.warnungen.length || z.hinweise.length);
        return (
          <details key={l.land} id={`vorschau-${l.land}`} className="card card-pad" style={{ marginTop: 12, scrollMarginTop: 70 }} data-testid="pg-tabelle" data-land={l.land} open={l.land === (sp.land ?? v.laender[0]?.land)}>
            <summary><b>{l.land}</b> – {wichtig.length} mit Änderung, Warnung oder Auffälligkeit (von {l.zeilen.length})</summary>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="table small">
                <thead><tr><th>SKU</th><th>Strategie Ist → Soll</th><th>Min Ist → Soll</th><th>Marge</th><th>Max</th><th>Buy Box</th><th>im Repricing</th><th>Art</th><th>Hinweise</th></tr></thead>
                <tbody>
                  {wichtig.slice(0, 200).map((z) => (
                    <tr key={z.sku} data-testid="pg-zeile" data-sku={z.sku}>
                      <td>{z.sku}<div className="muted">{(z.titel ?? "").slice(0, 40)}</div></td>
                      <td>{z.istStrategieName ?? "–"} → <b>{z.strategieName}</b>{z.stufe ? <div className="muted">Stufe {z.stufe}{z.alterTage !== null ? ` · ${z.alterTage} T alt` : ""}</div> : null}</td>
                      <td>{f2(z.istMin)} → <b>{f2(z.min)}</b>{z.breakEven !== null ? <div className="muted">Break-even {f2(z.breakEven)}</div> : null}</td>
                      <td>{z.marge !== null ? `${String(z.marge).replace(".", ",")} %` : "–"}{z.gebuehren.geschaetzt ? <div className="muted" title={`Gebühren: ${z.gebuehren.quelle}`}>Gebühren geschätzt</div> : null}</td>
                      <td>{f2(z.istMax)} → {f2(z.max)}</td>
                      <td>{f2(z.buybox)}</td>
                      <td>{z.istImRepricing === null ? "–" : z.istImRepricing ? "ja" : "nein"}{z.aktiv && z.istImRepricing === false ? " → ja" : ""}</td>
                      <td>{ART_TEXT[z.art]}{z.regelWechsel ? " · Wechsel" : ""}</td>
                      <td>{[...z.warnungen].join(" · ") || <span className="muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {wichtig.length > 200 && <div className="small muted">… und {wichtig.length - 200} weitere.</div>}
            </div>
          </details>
        );
      })}

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="pg-vorschlaege">
        <h2 style={{ margin: 0 }}>Vorschläge der Kapital-Ampel → „Abverkauf“ ({v.vorschlaege.length})</h2>
        {v.vorschlaege.length ? (
          <table className="table small">
            <thead><tr><th>SKU</th><th>Artikel</th><th className="right">Reichweite</th><th className="right">Kapital</th><th /></tr></thead>
            <tbody>
              {v.vorschlaege.map((x) => (
                <tr key={x.sku}>
                  <td>{x.sku}</td><td>{(x.titel ?? "").slice(0, 50)}</td><td className="num right">{x.reichweite ?? "–"} T</td><td className="num right">{f2(x.kapital)} €</td>
                  <td>{kannSchreiben && <form action={vorschlagFreigebenAction}><input type="hidden" name="sku" value={x.sku} /><button className="btn btn-sm" type="submit">freigeben</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="small muted">Keine.</div>}
      </section>

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="pg-zuweisungen">
        <h2 style={{ margin: 0 }}>Soll-Strategien: Liquidation, Abverkauf, Ausnahmen ({zuw.length})</h2>
        {kannSchreiben && <form action={istUebernehmenAction}><button className="btn" type="submit" data-testid="pg-ist-uebernehmen">Strategien aus ProfitGuard übernehmen</button></form>}
        {zuw.length > 0 && (
          <table className="table small">
            <thead><tr><th>Land</th><th>SKU</th><th>Strategie</th><th>Untergrenze</th><th>Quelle</th><th>Grund</th><th /></tr></thead>
            <tbody>
              {zuw.map((z) => (
                <tr key={`${z.land}${z.sku}`} data-testid="pg-zuweisung" data-sku={z.sku} data-land={z.land}>
                  <td>{z.land}</td><td>{z.sku}</td><td>{z.regel}{z.freigegeben ? "" : " (nicht freigegeben)"}</td><td>{f2(z.untergrenze)}</td><td>{z.quelle}</td><td className="muted">{z.grund ?? ""}</td>
                  <td>{kannSchreiben && <form action={zuweisungLoeschenAction}><input type="hidden" name="land" value={z.land} /><input type="hidden" name="sku" value={z.sku} /><button className="btn btn-sm" type="submit">entfernen</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {kannSchreiben && (
          <form action={zuweisungAction} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="pg-zuweisung-form">
            <input name="sku" placeholder="SKU" required style={{ width: 160 }} aria-label="SKU" />
            <select name="regel" defaultValue="Abverkauf" aria-label="Strategie">{STRATEGIEN.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <input name="untergrenze" placeholder="Min (optional)" style={{ width: 120 }} aria-label="Untergrenze" />
            {EXPORT_LAENDER.map((l) => <label key={l} className="small"><input type="checkbox" name="land" value={l} defaultChecked /> {l}</label>)}
            <input name="grund" placeholder="Grund (optional)" style={{ width: 200 }} aria-label="Grund" />
            <button className="btn btn-sm" type="submit">speichern</button>
          </form>
        )}
      </section>

      <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="pg-ek-fehlt">
        <h2 style={{ margin: 0 }}>EK fehlt – nicht in der Datei ({new Set(v.ekFehlt.map((x) => x.sku)).size})</h2>
        {v.ekFehlt.length ? <div className="small">{[...new Set(v.ekFehlt.map((x) => x.sku))].slice(0, 40).join(", ")} – <Link href="/produkte?ansicht=zuordnung&art=ek-fehlt">EK nachtragen</Link></div> : <div className="small muted">Keine.</div>}
      </section>

      {v.nurIst.length > 0 && (
        <section className="card card-pad stack" style={{ marginTop: 12 }} data-testid="pg-nur-ist">
          <h2 style={{ margin: 0 }}>Nur in ProfitGuard ({v.nurIst.length})</h2>
          <div className="small muted">SKUs im ProfitGuard-Export ohne Bestand bei Amazon bzw. ohne Soll im Seller-System – werden nicht in die Datei geschrieben.</div>
          <div className="small">{v.nurIst.slice(0, 40).map((x) => `${x.land} ${x.sku}`).join(", ")}{v.nurIst.length > 40 ? " …" : ""}</div>
        </section>
      )}

      <section className="card card-pad stack" style={{ marginTop: 12, scrollMarginTop: 70 }} id="strategien" data-testid="pg-strategien">
        <h2 style={{ margin: 0 }}>Strategien und Zuordnung zu ProfitGuard</h2>
        <p className="small muted" style={{ margin: 0 }}>Soll-Min = Break-even (EK netto + FBA-Gebühr + Fixgebühr + Zusatzkosten, Provision und USt des Landes) mit der Mindestmarge der Altersstufe – vom Brutto-Preis gerechnet, wie in ProfitGuard. Die Staffeln hier müssen zu den Einstellungen in ProfitGuard passen, sonst stimmen Abgleich und Warnungen nicht.</p>
        <table className="table small">
          <thead><tr><th>Strategie</th><th>Logik</th><th>Stufen</th></tr></thead>
          <tbody>
            {b.katalog.map((k) => (
              <tr key={k.name} data-testid="pg-strategie" data-strategie={k.name}>
                <td><b>{k.name}</b><div className="muted">in ProfitGuard: „{b.profitguard.strategieNamen[k.name]}“</div></td>
                <td>{k.strategie}<div className="muted">{k.hinweis}</div></td>
                <td>{k.staffel ? k.staffel.map((x, i) => `${stufenBereich(k.staffel!, i)} T: ${String(x.marge).replace(".", ",")} %`).join(" · ") : "fester Min je SKU und Land"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {inhaber && (
          <form action={strategieEinstellungenAction} className="stack" style={{ gap: 8 }}>
            <label className="small">Staffel Standard (bis Tage : Marge %) <input name="staffel_standard" defaultValue={staffelAlsText(b.staffeln.standard)} style={{ width: "100%" }} data-testid="pg-staffel-standard" /></label>
            <label className="small">Staffel Abverkauf <input name="staffel_abverkauf" defaultValue={staffelAlsText(b.staffeln.abverkauf)} style={{ width: "100%" }} data-testid="pg-staffel-abverkauf" /></label>
            <div className="row small" style={{ gap: 10, flexWrap: "wrap" }}>
              {STRATEGIEN.map((x) => <label key={x}>Name in ProfitGuard für „{x}“ <input name={`name_${x}`} defaultValue={b.profitguard.strategieNamen[x]} style={{ width: 160 }} /></label>)}
            </div>
            <div><button className="btn btn-sm" type="submit" data-testid="pg-strategien-speichern">Speichern</button></div>
          </form>
        )}
        <div className="small" data-testid="pg-format">
          Dateiformat: {b.profitguard.format ? <>gelernt aus dem letzten ProfitGuard-Export ({b.profitguard.format.kopf.length} Spalten, Trennzeichen „{b.profitguard.format.trenner === "\t" ? "Tab" : b.profitguard.format.trenner}“, Dezimal „{b.profitguard.format.dezimal}“)</> : "Standard-CSV (SKU, Marketplace, Min Price, Max Price, Strategy, Repricing) – vor dem ersten Import mit der ProfitGuard-Vorlage abgleichen"}
          {inhaber && b.profitguard.format && <form action={formatZuruecksetzenAction} style={{ display: "inline", marginLeft: 8 }}><button className="btn btn-sm" type="submit">zurücksetzen</button></form>}
        </div>
      </section>
    </>
  );
}
