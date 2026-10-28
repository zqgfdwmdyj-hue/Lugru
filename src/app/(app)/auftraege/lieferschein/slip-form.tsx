"use client";

import { useActionState } from "react";
import { SHIP_CHOICE_LABEL, type ShipChoice } from "@/lib/shipping/packing-slip";
import { WS_OPTIONS } from "@/lib/shipping/warensendung";
import { splitVariant } from "@/lib/shipping/variant";
import { slipAction, type SlipState } from "./actions";
import type { SkuWeightInfo } from "@/lib/shipping/weights-service";

const eur = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const kgText = (g: number | null) => (g === null ? "" : (g / 1000).toLocaleString("de-DE", { maximumFractionDigits: 3 }));

/**
 * Labels in einem Schritt: Amazon-Lieferschein hochladen oder offene Aufträge (z. B. eBay) übernehmen →
 * Vorschau mit Versandart je Bestellung (1 Stück → Warensendung, ab 2 → DHL) → ein Knopf für alle Labels.
 */
export function SlipForm({ postReady, dhlReady, postPrice, sandbox, initial, weights, prepName }: { postReady: boolean; dhlReady: boolean; postPrice: number; sandbox: boolean; initial: SlipState; weights: SkuWeightInfo[]; prepName: string }) {
  // Warensendung: über die Schnittstelle kaufen (wenn eingerichtet) oder CSV für den Internetmarke-Shop.
  const [state, action, pending] = useActionState<SlipState, FormData>(slipAction, initial);
  const rows = state?.rows ?? [];
  const labels = state?.labels;
  const open = rows.filter((r) => !r.done);
  const count = (c: ShipChoice) => open.filter((r) => r.choice === c).length;
  const resultFor = (id: string) => labels?.results.find((x) => x.orderId === id);
  // Artikel der offenen Sendungen – Gewicht je Stück einmal eintragen, gilt dann für alle Sendungen.
  // Alle bekannten Artikel (letzte Aufträge + hinterlegte Gewichte), dazu die der aktuellen Tabelle – immer sichtbar.
  const done = (x: { grams: number | null; wsMax: number | null }) => Number(x.grams !== null) + Number(x.wsMax !== null);
  const skus = [...new Map([...weights, ...rows.flatMap((r) => r.skus)].map((s) => [s.sku, s])).values()].sort((a, b) => done(a) - done(b) || a.title.localeCompare(b.title, "de"));
  const missing = skus.filter((s) => s.grams === null || s.wsMax === null).length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="slip-sources">
        <form action={action} className="card card-pad stack" style={{ gap: 10 }} data-testid="slip-upload">
          <h2>Amazon-Lieferschein</h2>
          <label className="label" htmlFor="slip-pdf">PDF aus Seller Central (eine Bestellung je Seite)</label>
          <input className="input" id="slip-pdf" name="pdf" type="file" accept="application/pdf,.pdf" required data-testid="slip-file" />
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="direkt" data-testid="slip-direct" /> Labels gleich erstellen (ohne Vorschau)
          </label>
          <div>
            <button className="btn btn-primary" type="submit" disabled={pending} data-testid="slip-read">{pending ? "Bitte warten …" : "Lieferschein einlesen"}</button>
          </div>
        </form>
        <form action={action} className="card card-pad stack" style={{ gap: 10 }} data-testid="slip-open">
          <input type="hidden" name="intent" value="open" />
          <h2>Offene Aufträge</h2>
          <label className="label" htmlFor="slip-channel">Kanal (Name und Anschrift kommen aus dem Auftrag)</label>
          <select className="select" id="slip-channel" name="channel" defaultValue="ebay" data-testid="slip-channel">
            <option value="ebay">eBay</option>
            <option value="amazon">Amazon (FBM)</option>
            <option value="alle">alle Kanäle</option>
          </select>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="refresh" defaultChecked data-testid="slip-refresh" /> vorher neue Bestellungen abrufen
          </label>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="direkt" data-testid="slip-open-direct" /> Labels gleich erstellen (ohne Vorschau)
          </label>
          <div>
            <button className="btn btn-primary" type="submit" disabled={pending} data-testid="slip-load-open">{pending ? "Bitte warten …" : "Offene Aufträge übernehmen"}</button>
          </div>
        </form>
      </div>
      <span className="small muted">Warensendung (Deutsche Post, {eur(postPrice)}), wenn alle Artikel laut Festlegung hineinpassen, höchstens 1 kg und Inland – sonst DHL-Paket. „bitte prüfen“ wird nicht gekauft, alles mit Label bleibt stehen.</span>

      {state?.error && <div className="notice notice-error" data-testid="slip-error">{state.error}</div>}
      {state?.note && <div className="notice notice-info" data-testid="slip-note">{state.note}</div>}

      {labels && (
        <section className="card card-pad stack" data-testid="slip-result">
          <h2>{labels.results.filter((r) => r.ok).length} Label(s) erstellt{labels.results.some((r) => !r.ok) ? ` · ${labels.results.filter((r) => !r.ok).length} nicht` : ""}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {labels.fileId && <a className="btn btn-primary" href={`/datei/${labels.fileId}`} target="_blank" rel="noreferrer" data-testid="slip-pdf-all">Alle Labels öffnen & drucken</a>}
            {labels.postFileId && labels.dhlFileId && <a className="btn" href={`/datei/${labels.postFileId}`} target="_blank" rel="noreferrer" data-testid="slip-pdf-post">Nur Warensendungen</a>}
            {labels.postFileId && labels.dhlFileId && <a className="btn" href={`/datei/${labels.dhlFileId}`} target="_blank" rel="noreferrer" data-testid="slip-pdf-dhl">Nur DHL</a>}
          </div>
          {labels.csvFileId && (
            <div className="notice notice-info stack" style={{ gap: 6 }} data-testid="slip-csv">
              <div><a className="btn btn-primary" href={`/datei/${labels.csvFileId}`} data-testid="slip-csv-link">CSV für Internetmarke herunterladen ({labels.csvCount} Warensendung{labels.csvCount === 1 ? "" : "en"})</a></div>
              <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Datei <strong>nicht</strong> in Excel öffnen (sonst ändert sich das Format).</li>
                <li><a href="https://shop.deutschepost.de/internetmarke" target="_blank" rel="noreferrer">Internetmarke-Shop</a> öffnen → Produkt <strong>„Warensendung“</strong> wählen.</li>
                <li>„Absender und Empfänger hinzufügen“ → „Datei auswählen“ → die CSV hochladen (Zeile 1 = Absender, danach {labels.csvCount} Empfänger in der Reihenfolge der Tabelle).</li>
                <li>Bezahlen und drucken. Die Aufträge stehen schon auf „Label erstellt“.</li>
              </ol>
            </div>
          )}
          {labels.walletCents !== null && <span className="small muted">Guthaben Portokasse danach: {eur(labels.walletCents / 100)}</span>}
          <span className="small muted">Danach unter Aufträge → „Label erstellt“ → „Alle als versendet markieren“: Amazon bzw. eBay bekommen die Versandmeldung (Warensendung ohne Sendungsnummer).</span>
        </section>
      )}

      <form action={action} className="card card-pad stack" style={{ gap: 10 }} data-testid="slip-weights">
        <input type="hidden" name="intent" value="weights" />
        <h2>Artikel: Gewicht & Warensendung{skus.length ? ` (${skus.length - missing} vollständig${missing ? `, ${missing} offen` : ""})` : ""}</h2>
        <span className="small muted">
          Je Artikel einmal: <strong>Gewicht für ein Stück inkl. Verpackung</strong> (Sendung = Stück × Gewicht) und <strong>wie viele Stück in eine Warensendung passen</strong>.
          Bedingungen der Post: höchstens 35,3 × 25 × <strong>5 cm</strong> dick, bis 1.000 g, nur innerhalb Deutschlands, Ware ohne persönliche Mitteilung (Lieferschein darf rein). Passt es nicht oder ist nichts festgelegt, geht die Sendung als DHL.
        </span>
        <div className="slip-weights">
          {skus.map((s, i) => (
            <div key={`${s.sku}:${s.grams}:${s.wsMax}:${s.shipFrom}`} className="field" data-testid="slip-weight" data-sku={s.sku}>
              {(() => {
                // Größe/Farbe immer sichtbar – sonst sehen M und L nach dem Kürzen gleich aus.
                const v = splitVariant(s.title);
                return (
                  <label className="label small" htmlFor={`w_${i}`} title={`${s.title} · ${s.sku}`}>
                    {v.base.length > 55 ? `${v.base.slice(0, 53)} …` : v.base}
                    {v.variant && <span className="slip-variant" data-testid="slip-variant">{v.variant}</span>}
                  </label>
                );
              })()}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input className="input" id={`w_${i}`} name={`w_${i}`} defaultValue={kgText(s.grams)} placeholder="z. B. 0,3" inputMode="decimal" style={{ width: 80 }} aria-label="Gewicht je Stück in kg" />
                <span className="small muted">kg</span>
                {s.grams === null && <span className="tag tag-warn">fehlt</span>}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select className="select" name={`ws_${i}`} defaultValue={s.wsMax === null ? "" : String(s.wsMax)} aria-label="Warensendung bis … Stück" data-testid="slip-ws" style={{ maxWidth: 170 }}>
                  {WS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value === "" ? "Warensendung: ?" : o.value === "0" ? "Warensendung: nie" : `Warensendung ${o.label}`}</option>)}
                </select>
                {s.wsMax === null && <span className="tag tag-warn">festlegen</span>}
              </div>
              <span className="small muted num">{s.sku}</span>
              <input type="hidden" name={`s_${i}`} value={s.sku} />
              <input type="hidden" name={`o_${i}`} value={kgText(s.grams)} />
              <input type="hidden" name={`ows_${i}`} value={s.wsMax === null ? "" : String(s.wsMax)} />
              <select className="select" name={`sf_${i}`} defaultValue={s.shipFrom ?? ""} aria-label="Wer verschickt diesen Artikel" data-testid="slip-shipfrom" style={{ maxWidth: 200 }}>
                <option value="">Versand: Standard</option>
                <option value="self">Versand: ich</option>
                <option value="prep">Versand: {prepName}</option>
              </select>
              <input type="hidden" name={`osf_${i}`} value={s.shipFrom ?? ""} />
            </div>
          ))}
          <div className="field" data-testid="slip-weight-new">
            <label className="label small" htmlFor={`s_${skus.length}`}>Weiterer Artikel (SKU)</label>
            <input className="input" id={`s_${skus.length}`} name={`s_${skus.length}`} placeholder="SKU" style={{ width: 180 }} />
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input className="input" name={`w_${skus.length}`} placeholder="z. B. 0,3" inputMode="decimal" aria-label="Gewicht je Stück" style={{ width: 80 }} />
              <span className="small muted">kg</span>
            </div>
            <select className="select" name={`ws_${skus.length}`} defaultValue="" aria-label="Warensendung bis … Stück" style={{ maxWidth: 170 }}>
              {WS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value === "" ? "Warensendung: ?" : o.value === "0" ? "Warensendung: nie" : `Warensendung ${o.label}`}</option>)}
            </select>
            <input type="hidden" name={`o_${skus.length}`} value="" />
            <input type="hidden" name={`ows_${skus.length}`} value="" />
          </div>
        </div>
        <div><button className="btn" type="submit" disabled={pending} data-testid="slip-save-weights">Speichern & neu rechnen</button></div>
      </form>

      {rows.length > 0 && (
        <form action={action} className="stack" style={{ gap: 10 }} data-testid="slip-preview">
          <input type="hidden" name="intent" value="create" />
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead><tr><th>Bestellung</th><th>Empfänger</th><th>Artikel</th><th className="right">Stück</th><th>Versand</th><th>Ergebnis</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const res = resultFor(r.orderId);
                  return (
                    <tr key={r.orderId} data-testid="slip-row" data-order={r.orderNo} data-choice={r.choice}>
                      <td className="num"><a href={`/auftraege/${r.orderId}`} target="_blank" rel="noreferrer">{r.orderNo}</a><div className="small muted">{r.channel}</div></td>
                      <td>{r.name}<div className="small muted">{r.place}</div>{r.warnings.length > 0 && <div className="small" style={{ color: "var(--warn)" }}>{r.warnings.join(" · ")}</div>}</td>
                      <td className="small" style={{ maxWidth: 280 }}>{r.items}</td>
                      <td className="num right"><strong>{r.quantity}</strong></td>
                      <td>
                        {r.done ? (
                          <span className="small muted">{r.done}</span>
                        ) : (
                          <>
                            <input type="hidden" name="orderId" value={r.orderId} />
                            <select key={`${r.orderId}:${r.choice}`} className="select" name={`choice_${r.orderId}`} defaultValue={r.choice} aria-label={`Versandart ${r.orderNo}`} data-testid="slip-choice">
                              {(["warensendung", "dhl", "pruefen"] as const).map((c) => <option key={c} value={c}>{c === "pruefen" ? "nicht versenden (prüfen)" : SHIP_CHOICE_LABEL[c]}</option>)}
                            </select>
                            <div className="small" style={{ color: r.wsNeedsSetup ? "var(--warn)" : "var(--muted)" }} data-testid="slip-reason">{r.reason}{r.wsNeedsSetup ? " – oben bei „Artikel“ festlegen" : ""}</div>
                            <select key={`${r.orderId}:sh:${r.shipper}`} className="select" name={`shipper_${r.orderId}`} defaultValue={r.shipper} aria-label={`Wer verschickt ${r.orderNo}`} data-testid="slip-shipper" style={{ marginTop: 4 }}>
                              <option value="self">verschickt: ich</option>
                              <option value="prep">verschickt: {prepName}</option>
                            </select>
                            <div className="small" data-testid="slip-weight-note" style={{ color: r.weightSource === "geschaetzt" ? "var(--warn)" : "var(--muted)" }}>{r.weightNote}</div>
                          </>
                        )}
                      </td>
                      <td className="small" data-testid="slip-row-result">{res ? <span style={{ color: res.ok ? "var(--ok)" : "var(--danger)" }}>{res.message}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          {open.length > 0 && count("warensendung") > 0 && (
            <div className="field" style={{ maxWidth: 520 }}>
              <label className="label" htmlFor="slip-postmode">Warensendungen</label>
              <select className="select" id="slip-postmode" name="postMode" defaultValue={postReady ? "api" : "csv"} data-testid="slip-postmode">
                <option value="api" disabled={!postReady}>über die Internetmarke-Schnittstelle kaufen (PDF){postReady ? "" : " – noch nicht eingerichtet"}</option>
                <option value="csv">als CSV-Datei für den Internetmarke-Shop (dort bezahlen &amp; drucken)</option>
              </select>
            </div>
          )}
          {open.length > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="submit" disabled={pending} data-testid="slip-create">
                {pending ? "Bitte warten …" : count("warensendung") + count("dhl") > 0 ? `Labels erstellen: ${count("warensendung")} × Warensendung, ${count("dhl")} × DHL` : "Labels für die Auswahl erstellen"}
              </button>
              <span className="small muted">
                Warensendungen ca. {eur(count("warensendung") * postPrice)}{sandbox ? " · DHL-Sandbox aktiv (Testlabels)" : ""}. Eine Auswahl oben ändern geht vor dem Erstellen.
              </span>
            </div>
          )}
          {!postReady && count("warensendung") > 0 && <div className="notice notice-info small">Internetmarke-Schnittstelle noch nicht eingerichtet – Warensendungen kommen als <strong>CSV-Datei für den Internetmarke-Shop</strong>, DHL-Labels wie gewohnt. Später: <a href="/anbindungen?p=deutschepost#deutschepost">Anbindungen → Deutsche Post INTERNETMARKE</a>.</div>}
          {!dhlReady && count("dhl") > 0 && <div className="notice notice-warn small">DHL ist noch nicht eingerichtet – Anbindungen → DHL und Einstellungen → Versand.</div>}
        </form>
      )}
    </div>
  );
}
